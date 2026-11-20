-- Copyright 2026 ByteLand Technology Limited
-- SPDX-License-Identifier: MIT

-- LSP client lifecycle, read-only WorkspaceEdit guard, and server notification handlers.
local M = {
    config = {
        server_path = 'ghidra-lsp',
        mcp_command = nil,
        mcp_args = {},
        request_timeout_ms = 35000,
        template_arguments = 'omit',
        auto_attach = true,
        auto_install = true,
    },
    client_id = nil,
    current_md5 = nil,
    session_names = {},
    function_names = {},
    pending_rename = {},
    open_sessions = {},
}

local pending_changed = {}
local wrapped_apply_edit = false
local orig_apply_workspace_edit = nil

--- Merge user plugin options and install the WorkspaceEdit guard.
function M.setup(opts)
    M.config = vim.tbl_deep_extend('force', M.config, opts or {})
    M.install_workspace_edit_wrapper()
end

--- Count unique active Ghidra program sessions across open state and buffers.
function M.active_program_count()
    local seen = {}
    local count = 0
    for md5, active in pairs(M.open_sessions) do
        if active and not seen[md5] then
            seen[md5] = true
            count = count + 1
        end
    end
    if M.current_md5 and not seen[M.current_md5] then
        seen[M.current_md5] = true
        count = count + 1
    end
    for _, b in ipairs(vim.api.nvim_list_bufs()) do
        if vim.api.nvim_buf_is_valid(b) and vim.api.nvim_buf_is_loaded(b) then
            local name = vim.api.nvim_buf_get_name(b)
            local md5 = name:match('^ghidra[^:]*://([a-fA-F0-9]+)/')
            if md5 then
                md5 = md5:lower()
                if not seen[md5] then
                    seen[md5] = true
                    count = count + 1
                end
            end
        end
    end
    return count
end

--- Collect all document URIs referenced in an LSP WorkspaceEdit.
local function collect_edit_uris(edit)
    local uris = {}
    if type(edit) ~= 'table' then return uris end
    if type(edit.changes) == 'table' then
        for uri, _ in pairs(edit.changes) do
            table.insert(uris, uri)
        end
    end
    if type(edit.documentChanges) == 'table' then
        for _, change in ipairs(edit.documentChanges) do
            if type(change) == 'table' then
                if change.textDocument and type(change.textDocument.uri) == 'string' then
                    table.insert(uris, change.textDocument.uri)
                elseif type(change.uri) == 'string' then
                    table.insert(uris, change.uri)
                end
            end
        end
    end
    return uris
end

--- Open `uri` if needed and move the cursor to the UTF-16 LSP position.
local function set_cursor_at_lsp_pos(uri, pos)
    if type(pos) ~= 'table' or type(pos.line) ~= 'number' then return end
    local buf_mod = require('ghidra-lsp.buffer')
    if type(uri) == 'string' and uri:match('^ghidra://') then
        local cur_name = vim.api.nvim_buf_get_name(0)
        if buf_mod.canonicalize_uri(cur_name) ~= buf_mod.canonicalize_uri(uri) then
            buf_mod.open_uri(uri)
        end
    end
    buf_mod.set_cursor_utf16(0, pos)
end

--- Normalize command arguments and attach the active virtual buffer URI.
local function normalize_command_arg(command, ctx)
    local args = (type(command) == 'table' and command.arguments) or {}
    local first = args[1]
    local arg = {}
    if type(first) == 'table' then
        arg = vim.deepcopy(first)
    elseif type(first) == 'string' then
        if first:match('^ghidra://') then
            arg.uri = first
            arg.md5 = first:match('^ghidra://([^/]+)/')
            if type(args[2]) == 'string' then
                arg.entry = args[2]
            end
        else
            arg.address = first
        end
    end
    if not arg.uri and ctx and ctx.bufnr and vim.api.nvim_buf_is_valid(ctx.bufnr) then
        arg.uri = vim.api.nvim_buf_get_name(ctx.bufnr)
    elseif not arg.uri then
        local cur = vim.api.nvim_buf_get_name(0)
        if cur:match('^ghidra') then
            arg.uri = cur
        end
    end
    if not arg.md5 and type(arg.uri) == 'string' then
        arg.md5 = arg.uri:match('^ghidra[^:]*://([^/]+)/')
    end
    if type(arg.md5) == 'string' then
        arg.md5 = arg.md5:lower()
    end
    return arg
end

--- Refresh pending scoped rename state for a program session.
function M.refresh_rename_state(md5, callback)
    if type(md5) ~= 'string' or md5 == '' then
        if callback then callback(nil) end
        return
    end
    md5 = md5:lower()
    local c = M.get_client()
    if not c then
        if callback then callback(nil) end
        return
    end
    c:request('workspace/executeCommand', {
        command = 'ghidra.renameState',
        arguments = { { md5 = md5 } },
    }, function(err, res)
        if not err and type(res) == 'table' then
            if res.pending ~= vim.NIL and type(res.pending) == 'table' then
                M.pending_rename[md5] = res.pending
            else
                M.pending_rename[md5] = nil
            end
            vim.schedule(function()
                pcall(function() require('ghidra-lsp.ui').refresh_statuslines() end)
                if callback then callback(M.pending_rename[md5]) end
            end)
        elseif callback then
            callback(M.pending_rename[md5])
        end
    end)
end

--- Wrap vim.lsp.util.apply_workspace_edit to allow server edits on read-only ghidra:// buffers.
function M.install_workspace_edit_wrapper()
    if wrapped_apply_edit then return end
    wrapped_apply_edit = true
    orig_apply_workspace_edit = vim.lsp.util.apply_workspace_edit

    vim.lsp.util.apply_workspace_edit = function(workspace_edit, offset_encoding)
        local uris = collect_edit_uris(workspace_edit)
        local ghidra_bufs = {}
        local affected_md5 = {}
        for _, uri in ipairs(uris) do
            if type(uri) == 'string' and uri:match('^ghidra://') then
                local b = vim.uri_to_bufnr(uri)
                if vim.api.nvim_buf_is_valid(b) then
                    if not vim.api.nvim_buf_is_loaded(b) then
                        pcall(vim.fn.bufload, b)
                    end
                    ghidra_bufs[b] = true
                    vim.bo[b].modifiable = true
                    vim.bo[b].readonly = false
                end
                local md5 = uri:match('^ghidra://([^/]+)/')
                if md5 then
                    affected_md5[md5:lower()] = true
                end
            end
        end

        if not next(ghidra_bufs) then
            return orig_apply_workspace_edit(workspace_edit, offset_encoding)
        end

        local ok, result = pcall(orig_apply_workspace_edit, workspace_edit, offset_encoding)
        for b, _ in pairs(ghidra_bufs) do
            if vim.api.nvim_buf_is_valid(b) then
                vim.bo[b].modifiable = false
            end
        end
        for md5, _ in pairs(affected_md5) do
            vim.schedule(function()
                M.refresh_rename_state(md5)
            end)
        end
        if not ok then
            error(result)
        end
        return result
    end
end

--- Return the active ghidra-lsp Neovim client if running.
function M.get_client()
    if M.client_id then
        local client = vim.lsp.get_client_by_id(M.client_id)
        if client and not client:is_stopped() then
            return client
        end
        M.client_id = nil
    end

    local get_clients = vim.lsp.get_clients or vim.lsp.get_active_clients
    if get_clients then
        for _, client in ipairs(get_clients({ name = 'ghidra-lsp' })) do
            if not client:is_stopped() then
                M.client_id = client.id
                return client
            end
        end
    end

    return nil
end

--- Stop the active ghidra-lsp client and wait briefly for exit so binaries can update.
function M.stop_client()
    local client = M.get_client()
    if not client then
        return false
    end
    client:stop()
    vim.wait(3000, function()
        return client:is_stopped()
    end, 50)
    M.client_id = nil
    return true
end

--- Start the ghidra-lsp child process and register command and notification handlers.
function M.start_client()
    M.install_workspace_edit_wrapper()
    pcall(function() require('ghidra-lsp.ui').install_quickfix_formatter() end)

    local existing = M.get_client()
    if existing then
        return existing.id
    end

    local resolved, resolve_err = require('ghidra-lsp.installer').resolve_or_install(M.config)
    if not resolved then
        vim.notify('Ghidra LSP: ' .. tostring(resolve_err), vim.log.levels.ERROR)
        return nil
    end

    local init_options = {
        readonlyDocuments = true,
        requestTimeoutMs = M.config.request_timeout_ms,
        templateArguments = M.config.template_arguments,
    }
    if resolved.mcp_command and resolved.mcp_command ~= '' then
        init_options.mcpCommand = resolved.mcp_command
        init_options.mcpArgs = M.config.mcp_args
    end

    local client_id = vim.lsp.start({
        name = 'ghidra-lsp',
        cmd = { resolved.server_path },
        init_options = init_options,
        on_exit = function(_code, _signal, exited_client_id)
            if M.client_id == exited_client_id then
                M.client_id = nil
            end
        end,
        commands = {
            ['ghidraLsp.showReferences'] = function(command, ctx)
                local arg = normalize_command_arg(command, ctx)
                if arg.position then
                    set_cursor_at_lsp_pos(arg.uri, arg.position)
                end
                vim.lsp.buf.references()
            end,
            ['ghidraLsp.showCallers'] = function(command, ctx)
                local arg = normalize_command_arg(command, ctx)
                if arg.position then
                    set_cursor_at_lsp_pos(arg.uri, arg.position)
                end
                vim.lsp.buf.incoming_calls()
            end,
            ['ghidraLsp.showCallees'] = function(command, ctx)
                local arg = normalize_command_arg(command, ctx)
                if arg.position then
                    set_cursor_at_lsp_pos(arg.uri, arg.position)
                end
                vim.lsp.buf.outgoing_calls()
            end,
            ['ghidraLsp.showCallGraph'] = function(command, ctx)
                local arg = normalize_command_arg(command, ctx)
                if arg.position then
                    set_cursor_at_lsp_pos(arg.uri, arg.position)
                end
                require('ghidra-lsp.views').open_call_graph(arg)
            end,
            ['ghidraLsp.showListing'] = function(command, ctx)
                local arg = normalize_command_arg(command, ctx)
                require('ghidra-lsp.views').open_listing(arg)
            end,
            ['ghidraLsp.showControlFlow'] = function(command, ctx)
                local arg = normalize_command_arg(command, ctx)
                require('ghidra-lsp.views').open_control_flow(arg)
            end,
            ['ghidraLsp.editComment'] = function(command, ctx)
                local arg = normalize_command_arg(command, ctx)
                require('ghidra-lsp.edit').edit_comment(arg)
            end,
            ['ghidraLsp.inspectType'] = function(command, ctx)
                local arg = normalize_command_arg(command, ctx)
                require('ghidra-lsp.commands').inspect_type(arg)
            end,
            ['ghidraLsp.editFunction'] = function(command, ctx)
                local arg = normalize_command_arg(command, ctx)
                require('ghidra-lsp.edit').edit_function(arg)
            end,
            ['ghidraLsp.editVariables'] = function(command, ctx)
                local arg = normalize_command_arg(command, ctx)
                require('ghidra-lsp.edit').edit_variables(arg)
            end,
        },
        handlers = {
            ['workspace/applyEdit'] = function(_err, params, ctx)
                local edit = type(params) == 'table' and params.edit or nil
                if not edit then
                    return { applied = false, failureReason = 'missing WorkspaceEdit' }
                end
                local c = ctx and ctx.client_id and vim.lsp.get_client_by_id(ctx.client_id) or M.get_client()
                local enc = (c and c.offset_encoding) or 'utf-16'
                local ok, err = pcall(vim.lsp.util.apply_workspace_edit, edit, enc)
                if not ok then
                    return { applied = false, failureReason = tostring(err) }
                end

                local affected_md5 = {}
                for _, uri in ipairs(collect_edit_uris(edit)) do
                    if type(uri) == 'string' and uri:match('^ghidra://') then
                        local b = vim.uri_to_bufnr(uri)
                        if vim.api.nvim_buf_is_valid(b) then
                            vim.bo[b].modified = false
                            vim.bo[b].modifiable = false
                        end
                        local md5 = uri:match('^ghidra://([^/]+)/')
                        if md5 then
                            affected_md5[md5:lower()] = true
                        end
                    end
                end
                for md5, _ in pairs(affected_md5) do
                    M.refresh_rename_state(md5)
                end
                vim.schedule(function()
                    pcall(function() require('ghidra-lsp.ui').refresh_statuslines() end)
                end)
                return { applied = true }
            end,
            ['ghidra/changed'] = function(_err, result)
                if not result or type(result.md5) ~= 'string' then return end
                local target_md5 = result.md5:lower()
                if pending_changed[target_md5] then return end
                pending_changed[target_md5] = true
                vim.schedule(function()
                    pending_changed[target_md5] = nil
                    M.function_names[target_md5] = nil
                    M.refresh_rename_state(target_md5)
                    local buffer = require('ghidra-lsp.buffer')
                    local refreshed_meta = false
                    for _, b in ipairs(vim.api.nvim_list_bufs()) do
                        if vim.api.nvim_buf_is_valid(b) and vim.api.nvim_buf_is_loaded(b) then
                            local name = vim.api.nvim_buf_get_name(b)
                            local lower = name:lower()
                            if vim.fn.bufwinid(b) ~= -1 then
                                if lower:find('^ghidra://' .. target_md5 .. '/') then
                                    local is_snap = lower:find('^ghidra://[^/]+/symbol/')
                                        or lower:find('^ghidra://[^/]+/references/')
                                        or lower:find('^ghidra://[^/]+/type/')
                                    if is_snap then
                                        buffer.load_document(b, name)
                                    elseif not refreshed_meta then
                                        refreshed_meta = true
                                        buffer.ensure_program_metadata_cached(target_md5)
                                    end
                                elseif lower:find('^ghidra%-type://' .. target_md5 .. '/') then
                                    buffer.reload_type_document_if_clean(b)
                                elseif lower:find('^ghidra%-overview://' .. target_md5) then
                                    pcall(function() require('ghidra-lsp.commands').overview(target_md5, true) end)
                                elseif lower:find('^ghidra%-listing://' .. target_md5 .. '/')
                                    or lower:find('^ghidra%-memory://' .. target_md5 .. '/')
                                    or lower:find('^ghidra%-cfg://' .. target_md5 .. '/')
                                    or lower:find('^ghidra%-callgraph://' .. target_md5 .. '/')
                                then
                                    pcall(function() require('ghidra-lsp.views').refresh_buffer(b) end)
                                end
                            end
                        end
                    end
                    pcall(function() require('ghidra-lsp.ui').refresh_statuslines() end)
                end)
            end,
        },
    })

    M.client_id = client_id
    if client_id and M.config.auto_attach then
        for _, b in ipairs(vim.api.nvim_list_bufs()) do
            if vim.api.nvim_buf_is_valid(b) then
                local name = vim.api.nvim_buf_get_name(b)
                if name:match('^ghidra://') then
                    pcall(vim.lsp.buf_attach_client, b, client_id)
                end
            end
        end
    end
    return client_id
end

--- Ensure the ghidra-lsp client is started and initialized before returning it.
function M.ensure_client(timeout_ms)
    local client = M.get_client()
    if not client then
        local id = M.start_client()
        if not id then
            return nil
        end
        client = vim.lsp.get_client_by_id(id)
    end
    if client and not client.initialized then
        vim.wait(timeout_ms or 5000, function()
            return client.initialized == true
        end)
    end
    return client
end

--- Send a synchronous workspace/executeCommand request.
function M.execute_command_sync(cmd, args, timeout_ms)
    local client = M.ensure_client()
    if not client then
        return nil, 'Ghidra LSP client is not running'
    end
    local res, err = client:request_sync('workspace/executeCommand', {
        command = cmd,
        arguments = args or { vim.empty_dict() },
    }, timeout_ms or M.config.request_timeout_ms or 35000)
    if err then
        return nil, err
    end
    if res and res.err then
        return nil, res.err.message or vim.inspect(res.err)
    end
    return res and res.result, nil
end

--- Execute a synchronous command with a single object argument and raise readable errors.
function M.exec_sync(command, arg, timeout_ms)
    local payload = (type(arg) == 'table' and next(arg) ~= nil) and arg or vim.empty_dict()
    local res, err = M.execute_command_sync(command, { payload }, timeout_ms or 30000)
    if err then
        local msg = type(err) == 'table' and (err.message or vim.inspect(err)) or tostring(err)
        error(msg)
    end
    return res or {}
end

--- Send an asynchronous workspace/executeCommand request.
function M.execute_command(cmd, args, callback)
    local client = M.ensure_client()
    if not client then
        if callback then callback('Ghidra LSP client is not running', nil) end
        return
    end
    client:request('workspace/executeCommand', {
        command = cmd,
        arguments = args or { vim.empty_dict() },
    }, function(err, result)
        if callback then
            callback(err, result)
        end
    end)
end

return M
