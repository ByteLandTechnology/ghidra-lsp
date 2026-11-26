-- Copyright 2026 ByteLand Technology Limited
-- SPDX-License-Identifier: MIT

-- Checkpoint picker, checkpoint restore, session reset, and full buffer refresh for Neovim.
local buffer = require('ghidra-lsp.buffer')
local client = require('ghidra-lsp.client')
local ui = require('ghidra-lsp.ui')
local views = require('ghidra-lsp.views')

local M = {}

--- Resolve a lowercase 32-hex session MD5 from an explicit value, current buffer, or active session.
local function resolve_md5(explicit_md5)
    if type(explicit_md5) == 'string' and explicit_md5:match('^[a-fA-F0-9]+$') and #explicit_md5 == 32 then
        return explicit_md5:lower()
    end
    local cur_name = vim.api.nvim_buf_get_name(0)
    local buf_md5 = cur_name:match('^ghidra[^:]*://([a-fA-F0-9]+)/')
    if buf_md5 and #buf_md5 == 32 then
        return buf_md5:lower()
    end
    if type(client.current_md5) == 'string' and #client.current_md5 == 32 then
        return client.current_md5:lower()
    end
    vim.notify('No active Ghidra session. Run :GhidraOpenBinary or :GhidraSelectSession first.', vim.log.levels.WARN)
    return nil
end

--- Format a byte count into a short human-readable string.
local function format_bytes(bytes)
    local n = tonumber(bytes) or 0
    if n < 1024 then
        return string.format('%d B', math.max(0, math.floor(n)))
    elseif n < 1024 * 1024 then
        return string.format('%.1f KiB', n / 1024)
    end
    return string.format('%.1f MiB', n / (1024 * 1024))
end

--- Check whether any loaded ghidra-type:// buffer for `md5` has unsaved modifications.
local function confirm_dirty_type_buffers(md5, action_label)
    local dirty = false
    for _, b in ipairs(vim.api.nvim_list_bufs()) do
        if vim.api.nvim_buf_is_valid(b) and vim.api.nvim_buf_is_loaded(b) and vim.bo[b].modified then
            local name = vim.api.nvim_buf_get_name(b):lower()
            if name:find('^ghidra%-type://' .. md5 .. '/') then
                dirty = true
                break
            end
        end
    end
    if not dirty then
        return true
    end
    local choice = vim.fn.confirm(
        'Unsaved Ghidra data type drafts exist for this session. ' .. action_label .. ' and discard them?',
        '&Yes\n&Cancel',
        2
    )
    return choice == 1
end

--- Reload or close one ghidra-type:// buffer after checkpoint restore or session reset.
local function refresh_type_buffer_force(bufnr, md5, uri)
    local parsed_md5, path = buffer.parse_type_uri(uri)
    if parsed_md5 ~= md5 or not path then
        return
    end
    local res, err = client.execute_command_sync('ghidra.typeDocument', { { md5 = md5, path = path } }, 30000)
    if err or type(res) ~= 'table' or type(res.text) ~= 'string' then
        vim.bo[bufnr].modified = false
        pcall(vim.api.nvim_buf_delete, bufnr, { force = true })
        return
    end
    local text = res.text
    local trailing_nl = text:sub(-1) == '\n'
    local body = trailing_nl and text:sub(1, -2) or text
    local new_lines = body == '' and { '' } or vim.split(body, '\n', { plain = true })
    local readonly = res.readonly == true
    local readonly_reason = (res.readonlyReason ~= vim.NIL and type(res.readonlyReason) == 'string') and res.readonlyReason or nil
    vim.bo[bufnr].modifiable = true
    vim.bo[bufnr].readonly = false
    vim.api.nvim_buf_set_lines(bufnr, 0, -1, false, new_lines)
    vim.b[bufnr].ghidra_type_state = {
        key = buffer.canonicalize_uri(uri),
        md5 = md5,
        path = path,
        program = res.program,
        original = res.original,
        readonly = readonly,
        readonly_reason = readonly_reason,
        trailing_nl = trailing_nl,
        validate_seq = 0,
        saving = false,
        uncertain = false,
    }
    vim.bo[bufnr].readonly = readonly
    vim.bo[bufnr].modifiable = not readonly
    vim.bo[bufnr].modified = false
    vim.diagnostic.set(buffer.TYPE_DIAG_NS, bufnr, {})
end

--- Refresh all loaded virtual buffers, metadata caches, and statuslines for `md5`.
function M.refresh_all_buffers(md5)
    if type(md5) ~= 'string' or md5 == '' then
        return
    end
    local target = md5:lower()
    client.function_names[target] = nil
    client.pending_rename[target] = nil
    buffer.ensure_program_metadata_cached(target)

    for _, b in ipairs(vim.api.nvim_list_bufs()) do
        if vim.api.nvim_buf_is_valid(b) and vim.api.nvim_buf_is_loaded(b) then
            local name = vim.api.nvim_buf_get_name(b)
            local lower = name:lower()
            if lower:find('^ghidra://' .. target .. '/') then
                vim.bo[b].modified = false
                pcall(buffer.load_document, b, name)
            elseif lower:find('^ghidra%-type://' .. target .. '/') then
                refresh_type_buffer_force(b, target, name)
            elseif lower:find('^ghidra%-overview://' .. target) then
                pcall(function() require('ghidra-lsp.commands').overview(target, true) end)
            elseif lower:find('^ghidra%-listing://' .. target .. '/')
                or lower:find('^ghidra%-memory://' .. target .. '/')
                or lower:find('^ghidra%-string://' .. target .. '/')
                or lower:find('^ghidra%-cfg://' .. target .. '/')
                or lower:find('^ghidra%-callgraph://' .. target .. '/')
            then
                pcall(views.refresh_buffer, b)
            end
        end
    end
    pcall(ui.refresh_statuslines)
end

--- Return checkpoint ID completion candidates for `:GhidraRestoreCheckpoint`.
function M.complete_checkpoints(arg_lead)
    local md5 = resolve_md5(nil)
    if not md5 then
        return {}
    end
    local res, err = client.execute_command_sync('ghidra.checkpoints', { { md5 = md5 } }, 10000)
    if err or type(res) ~= 'table' or type(res.items) ~= 'table' then
        return {}
    end
    local prefix = tostring(arg_lead or '')
    local matches = {}
    for _, item in ipairs(res.items) do
        if type(item) == 'table' and type(item.id) == 'string' then
            if prefix == '' or item.id:sub(1, #prefix) == prefix then
                table.insert(matches, item.id)
            end
        end
    end
    return matches
end

--- Restore a specific checkpoint ID (or the newest checkpoint when `id_or_opts` is empty).
function M.restore_checkpoint(id_or_opts, explicit_md5)
    local id = nil
    local name = nil
    local md5_arg = explicit_md5
    if type(id_or_opts) == 'table' then
        id = id_or_opts.id
        name = id_or_opts.name
        md5_arg = id_or_opts.md5 or md5_arg
    elseif type(id_or_opts) == 'string' and vim.trim(id_or_opts) ~= '' then
        id = vim.trim(id_or_opts)
    end
    local md5 = resolve_md5(md5_arg)
    if not md5 then
        return nil
    end
    if not confirm_dirty_type_buffers(md5, 'Restore checkpoint') then
        return nil
    end
    local payload = { md5 = md5 }
    if type(id) == 'string' and id ~= '' then
        payload.id = id
    end
    if type(name) == 'string' and name ~= '' then
        payload.name = name
    end
    vim.notify('Restoring Ghidra checkpoint for ' .. (client.session_names[md5] or md5) .. '...', vim.log.levels.INFO)
    local res, err = client.execute_command_sync('ghidra.restoreCheckpoint', { payload }, 600000)
    if err then
        local msg = type(err) == 'table' and (err.message or vim.inspect(err)) or tostring(err)
        vim.notify('Failed to restore checkpoint: ' .. msg, vim.log.levels.ERROR)
        return nil
    end
    client.current_md5 = md5
    client.open_sessions[md5] = true
    M.refresh_all_buffers(md5)
    local cp = type(res) == 'table' and res.checkpoint or nil
    local label = (type(cp) == 'table' and (cp.name or cp.id)) or id or 'latest'
    vim.notify('Restored checkpoint: ' .. tostring(label), vim.log.levels.INFO)
    return res
end

--- Open an interactive picker of saved checkpoints for the active session and restore selection.
function M.checkpoints(arg)
    local md5 = resolve_md5(type(arg) == 'table' and arg.md5 or arg)
    if not md5 then
        return
    end
    local res, err = client.execute_command_sync('ghidra.checkpoints', { { md5 = md5 } }, 30000)
    if err then
        local msg = type(err) == 'table' and (err.message or vim.inspect(err)) or tostring(err)
        vim.notify('Failed to list checkpoints: ' .. msg, vim.log.levels.ERROR)
        return
    end
    local items = (type(res) == 'table' and type(res.items) == 'table') and res.items or {}
    if #items == 0 then
        vim.notify('No saved checkpoints exist for ' .. (client.session_names[md5] or md5), vim.log.levels.INFO)
        return
    end
    ui.pick(items, {
        prompt = 'Restore Ghidra Checkpoint:',
        format_item = function(item)
            local label = (type(item.name) == 'string' and item.name ~= '') and item.name or 'Saved checkpoint'
            local created = tostring(item.createdAt or '')
            local size = format_bytes(item.sizeBytes)
            return string.format('%-36s  %s  (%s, %s)', label, created, tostring(item.id or ''), size)
        end,
    }, function(choice)
        if choice and type(choice.id) == 'string' then
            M.restore_checkpoint({ md5 = md5, id = choice.id })
        end
    end)
end

--- Execute `ghidra.resetSession` for `md5` and refresh all loaded session buffers.
local function run_reset_session(md5, analyze)
    if not confirm_dirty_type_buffers(md5, 'Reset session') then
        return nil
    end
    local label = client.session_names[md5] or md5
    vim.notify(
        string.format('Resetting Ghidra session %s%s...', label, analyze and ' and running analysis' or ''),
        vim.log.levels.INFO
    )
    local res, err = client.execute_command_sync('ghidra.resetSession', { {
        md5 = md5,
        reopen = true,
        analyze = analyze == true,
    } }, 600000)
    if err then
        local msg = type(err) == 'table' and (err.message or vim.inspect(err)) or tostring(err)
        vim.notify('Failed to reset Ghidra session: ' .. msg, vim.log.levels.ERROR)
        return nil
    end
    client.current_md5 = md5
    client.open_sessions[md5] = true
    M.refresh_all_buffers(md5)
    vim.notify('Reset Ghidra session: ' .. label, vim.log.levels.INFO)
    return res
end

--- Reset the active Ghidra session to a clean binary import, optionally re-analyzing it.
function M.reset_session(arg)
    if type(arg) == 'table' then
        local md5 = resolve_md5(arg.md5)
        if not md5 then return nil end
        return run_reset_session(md5, arg.analyze == true)
    end
    if arg == 'analyze' or arg == 'noanalyze' then
        local md5 = resolve_md5(nil)
        if not md5 then return nil end
        return run_reset_session(md5, arg == 'analyze')
    end
    local md5 = resolve_md5(arg)
    if not md5 then
        return nil
    end
    local choices = {
        { label = 'Reset and re-analyze binary', analyze = true },
        { label = 'Reset without analysis', analyze = false },
        { label = 'Cancel', cancel = true },
    }
    vim.ui.select(choices, {
        prompt = 'Reset Ghidra session ' .. (client.session_names[md5] or md5) .. ' (deletes saved edits and checkpoints):',
        format_item = function(item) return item.label end,
    }, function(choice)
        if not choice or choice.cancel then
            return
        end
        run_reset_session(md5, choice.analyze)
    end)
end

return M
