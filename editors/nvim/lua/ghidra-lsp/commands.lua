-- Copyright 2026 ByteLand Technology Limited
-- SPDX-License-Identifier: MIT

-- User commands for Ghidra sessions, navigation, overview, types, and analysis.
local client = require('ghidra-lsp.client')
local buffer = require('ghidra-lsp.buffer')
local format = require('ghidra-lsp.format')
local ui = require('ghidra-lsp.ui')

local M = {}

--- Convert an LSP error value into a display string.
local function format_error(err)
    if not err then return 'unknown error' end
    if type(err) == 'table' then
        return err.message or vim.inspect(err)
    end
    return tostring(err)
end

--- Format one data type entry for the picker list.
local function format_type_item(item)
    local size_s = item.length and (tostring(item.length) .. 'B') or (item.size and (tostring(item.size) .. 'B') or '')
    return string.format('%-30s  %-10s  %6s  %s',
        tostring(item.name or ''),
        tostring(item.kind or 'type'),
        size_s,
        tostring(item.path or ''))
end

--- Return the active program MD5 from the current Ghidra buffer or stored session state.
function M.get_active_md5()
    local cur_name = vim.api.nvim_buf_get_name(0)
    local md5 = cur_name:match('^ghidra://([a-fA-F0-9]+)/')
        or cur_name:match('^ghidra%-type://([a-fA-F0-9]+)/')
        or cur_name:match('^ghidra%-overview://([a-fA-F0-9]+)')
        or cur_name:match('^ghidra%-listing://([a-fA-F0-9]+)/')
        or cur_name:match('^ghidra%-memory://([a-fA-F0-9]+)/')
        or cur_name:match('^ghidra%-string://([a-fA-F0-9]+)/')
        or cur_name:match('^ghidra%-cfg://([a-fA-F0-9]+)/')
        or cur_name:match('^ghidra%-callgraph://([a-fA-F0-9]+)/')
        or cur_name:match('^ghidra%-parse%-c://([a-fA-F0-9]+)')
    if md5 then
        client.current_md5 = md5:lower()
        return client.current_md5
    end
    return client.current_md5
end

--- Cache session display names and readiness states in client memory.
local function cache_sessions_metadata(sessions)
    for _, s in ipairs(sessions or {}) do
        if type(s.md5) == 'string' then
            local smd5 = s.md5:lower()
            client.session_names[smd5] = s.fileName or s.name or client.session_names[smd5]
            client.open_sessions[smd5] = (s.status == 'ready') or nil
        end
    end
end

--- Prompt to select or activate a Ghidra program session.
function M.select_session(callback)
    client.execute_command('ghidra.sessions', { vim.empty_dict() }, function(err, result)
        if err or not result or not result.sessions then
            vim.notify('Failed to list Ghidra sessions: ' .. format_error(err), vim.log.levels.ERROR)
            return
        end
        cache_sessions_metadata(result.sessions)
        local selectable = {}
        for _, s in ipairs(result.sessions) do
            if s.status == 'ready' or s.status == 'closed' or s.status == 'stale' or s.status == 'disconnected' then
                table.insert(selectable, s)
            end
        end
        if #selectable == 0 then
            vim.notify('No Ghidra sessions found; open a binary with :GhidraOpenBinary', vim.log.levels.WARN)
            return
        end

        local function activate(s)
            local md5 = s.md5:lower()
            if s.status ~= 'ready' then
                M.open_binary(md5, type(callback) == 'function' and callback or nil)
                return
            end
            client.execute_command('ghidra.selectSession', { { md5 = md5 } }, function(select_err)
                if select_err then
                    vim.notify('Failed to select session: ' .. format_error(select_err), vim.log.levels.ERROR)
                else
                    client.current_md5 = md5
                    client.open_sessions[md5] = true
                    client.session_names[md5] = s.fileName or s.name or client.session_names[md5]
                    vim.schedule(function()
                        ui.refresh_statuslines()
                    end)
                    vim.notify('Active Ghidra session: ' .. (s.fileName or s.name or md5), vim.log.levels.INFO)
                    if type(callback) == 'function' then callback(s) end
                end
            end)
        end

        if #selectable == 1 and selectable[1].status == 'ready' then
            activate(selectable[1])
            return
        end

        ui.pick(selectable, {
            prompt = 'Select Ghidra Session:',
            format_item = function(item)
                local label = item.fileName or item.name or 'Session'
                local state = item.status == 'ready' and 'open' or tostring(item.status)
                return string.format('%-24s  %-8s  %s', label, '[' .. state .. ']', item.md5:sub(1, 8))
            end,
            search_text = function(item)
                return string.format('%s %s %s', tostring(item.fileName or ''), tostring(item.name or ''), tostring(item.md5 or ''))
            end,
        }, function(choice)
            if choice then
                activate(choice)
            end
        end)
    end)
end

--- Open a binary file path or 32-hex MD5 session in Ghidra.
function M.open_binary(path_or_md5, callback)
    local function proceed(raw_input)
        if not raw_input or vim.trim(raw_input) == '' then return end
        local trimmed = vim.trim(raw_input)
        local is_md5 = trimmed:match('^[a-fA-F0-9]+$') ~= nil and #trimmed == 32
        local open_arg, display_name
        if is_md5 then
            open_arg = { md5 = trimmed:lower() }
            display_name = client.session_names[trimmed:lower()] or trimmed:sub(1, 8)
        else
            local expanded = vim.fn.fnamemodify(vim.fn.expand(trimmed), ':p')
            open_arg = { path = expanded }
            display_name = vim.fn.fnamemodify(expanded, ':t')
        end

        client.execute_command('ghidra.openBinary', { open_arg }, function(err, result)
            if err or not result or not result.md5 then
                vim.notify('Failed to open Ghidra program: ' .. format_error(err), vim.log.levels.ERROR)
                return
            end
            local md5 = result.md5:lower()
            client.current_md5 = md5
            client.open_sessions[md5] = true
            if not is_md5 then
                client.session_names[md5] = display_name
            end
            vim.schedule(function()
                ui.refresh_statuslines()
            end)
            vim.notify('Opened ' .. display_name .. ' (' .. md5:sub(1, 8) .. ')', vim.log.levels.INFO)

            local function opened()
                if type(callback) == 'function' then callback(md5) end
            end
            if result.analyzed or result.analysisRunning then
                opened()
                return
            end
            ui.pick({ 'Analyze now', 'Open without analysis' }, {
                prompt = 'Program has not completed analysis. Analyze now?',
            }, function(choice)
                if choice ~= 'Analyze now' then
                    opened()
                    return
                end
                -- Re-check backend status before triggering analysis to prevent duplicate runs.
                client.execute_command('ghidra.query', { { md5 = md5, domain = 'analysis', operation = 'get', params = vim.empty_dict() } }, function(qerr, status)
                    if not qerr and type(status) == 'table' then
                        if status.analyzed == true or status.status == 'completed' then
                            vim.notify('Analysis already completed: ' .. display_name, vim.log.levels.INFO)
                            opened()
                            return
                        end
                        if status.status == 'running' then
                            vim.notify('Analysis already running in background: ' .. display_name, vim.log.levels.INFO)
                            opened()
                            return
                        end
                    end
                    vim.notify('Analyzing ' .. display_name .. ' with Ghidra...', vim.log.levels.INFO)
                    client.execute_command('ghidra.reanalyze', { { md5 = md5 } }, function(analysis_err)
                        if analysis_err then
                            vim.notify('Ghidra analysis failed: ' .. format_error(analysis_err), vim.log.levels.ERROR)
                        else
                            vim.notify('Ghidra analysis finished: ' .. display_name, vim.log.levels.INFO)
                        end
                        opened()
                    end)
                end)
            end)
        end)
    end

    if path_or_md5 and path_or_md5 ~= '' then
        proceed(path_or_md5)
    else
        vim.ui.input({ prompt = 'Path to binary or 32-hex MD5: ', completion = 'file' }, proceed)
    end
end

--- Cache formatted function display names keyed by entry address.
local function cache_functions_list(md5, items)
    local omit = client.config.template_arguments ~= 'show'
    local map = client.function_names[md5] or {}
    for _, item in ipairs(items or {}) do
        if type(item.entry) == 'string' then
            local disp = format.display_symbol_name(item, omit)
            map[item.entry:lower()] = disp
            map[item.entry] = disp
        end
    end
    client.function_names[md5] = map
end

--- Open a Ghidra function by entry address, function name, or interactive picker.
function M.open_function(entry_or_name, md5, callback)
    md5 = md5 or M.get_active_md5()
    if not md5 then
        M.select_session(function(s)
            M.open_function(entry_or_name, s.md5, callback)
        end)
        return
    end
    md5 = md5:lower()

    if entry_or_name and entry_or_name ~= '' then
        local target = vim.trim(entry_or_name)
        local looks_like_addr = target:match('^[^:]+:%x+$') or target:match('^0[xX]%x+$') or target:match('^%x%x%x%x+$')
        local function open_by_entry(entry_addr)
            client.execute_command('ghidra.openFunction', { { entry = entry_addr, md5 = md5 } }, function(err, result)
                if err or not result or not result.uri then
                    vim.notify('Failed to open function: ' .. format_error(err), vim.log.levels.ERROR)
                    return
                end
                local bufnr = buffer.open_uri(result.uri)
                if callback then callback(bufnr, result.uri) end
            end)
        end

        if looks_like_addr then
            local canonical_entry = target:match(':') and target or ('ram:' .. target:gsub('^0[xX]', ''))
            open_by_entry(canonical_entry)
            return
        end

        client.execute_command('ghidra.functions', { { md5 = md5 } }, function(err, result)
            if err or not result or not result.items then
                vim.notify('Failed to list functions: ' .. format_error(err), vim.log.levels.ERROR)
                return
            end
            cache_functions_list(md5, result.items)
            local omit = client.config.template_arguments ~= 'show'
            local needle = target:lower()
            local matches = {}
            for _, item in ipairs(result.items) do
                local raw = tostring(item.name or ''):lower()
                local disp = format.display_symbol_name(item, omit):lower()
                local full = format.full_symbol_name(item):lower()
                if raw == needle or disp == needle or full == needle then
                    open_by_entry(item.entry)
                    return
                elseif raw:find(needle, 1, true) or full:find(needle, 1, true) then
                    table.insert(matches, item)
                end
            end
            if #matches == 1 then
                open_by_entry(matches[1].entry)
            elseif #matches > 1 then
                ui.pick(matches, {
                    prompt = 'Select Matching Function:',
                    format_item = function(item)
                        return string.format('%-36s  %s', format.display_symbol_name(item, omit), format.display_address(item.entry))
                    end,
                }, function(choice)
                    if choice then open_by_entry(choice.entry) end
                end)
            else
                vim.notify('Function not found: ' .. target, vim.log.levels.WARN)
            end
        end)
        return
    end

    client.execute_command('ghidra.functions', { { md5 = md5 } }, function(err, result)
        if err or not result or not result.items then
            vim.notify('Failed to list functions: ' .. format_error(err), vim.log.levels.ERROR)
            return
        end
        local items = result.items
        if #items == 0 then
            vim.notify('No functions found in program', vim.log.levels.WARN)
            return
        end
        cache_functions_list(md5, items)
        local omit = client.config.template_arguments ~= 'show'
        ui.pick(items, {
            prompt = 'Select Function:',
            format_item = function(item)
                local name = format.display_symbol_name(item, omit)
                return string.format('%-36s  %s', name, format.display_address(item.entry))
            end,
            search_text = function(item)
                return string.format('%s %s %s %s',
                    tostring(item.name or ''),
                    format.full_symbol_name(item),
                    tostring(item.entry or ''),
                    format.display_address(item.entry))
            end,
        }, function(choice)
            if choice then
                M.open_function(choice.entry, md5, callback)
            end
        end)
    end)
end

--- Provide cached function name completion candidates for :GhidraOpenFunction.
function M.complete_functions(arg_lead)
    local md5 = M.get_active_md5()
    if not md5 then return {} end
    local fns = client.function_names[md5]
    if not fns then return {} end
    local out = {}
    local seen = {}
    local needle = (arg_lead or ''):lower()
    for _, name in pairs(fns) do
        if type(name) == 'string' and not seen[name] and (needle == '' or name:lower():find(needle, 1, true)) then
            seen[name] = true
            table.insert(out, name)
        end
    end
    table.sort(out)
    return out
end

--- Jump to an address in the decompiler, or fall back to Program Listing.
function M.goto_address(arg)
    local raw = type(arg) == 'table' and arg.address or (type(arg) == 'string' and arg or nil)
    local md5 = (type(arg) == 'table' and arg.md5) or M.get_active_md5()
    if not md5 then
        vim.notify('No active Ghidra session', vim.log.levels.WARN)
        return
    end
    md5 = md5:lower()

    local function navigate(input)
        local addr = vim.trim(tostring(input or ''))
        if addr == '' then return end
        if not addr:match(':') and addr:match('^0?[xX]?%x+$') then
            addr = 'ram:' .. addr:gsub('^0[xX]', '')
        end
        client.execute_command('ghidra.reveal', { { md5 = md5, address = addr } }, function(err, res)
            if not err and type(res) == 'table' and type(res.uri) == 'string' then
                vim.schedule(function()
                    local b = buffer.open_uri(res.uri)
                    if type(res.range) == 'table' and type(res.range.start) == 'table' then
                        local win = vim.fn.bufwinid(b)
                        buffer.set_cursor_utf16(win ~= -1 and win or 0, res.range.start)
                    end
                end)
            else
                vim.schedule(function()
                    require('ghidra-lsp.views').open_listing({ md5 = md5, address = addr })
                end)
            end
        end)
    end

    if raw and vim.trim(raw) ~= '' then
        navigate(raw)
    else
        vim.ui.input({ prompt = 'Go to address (e.g. 0040115a or ram:0040115a): ' }, navigate)
    end
end

--- Refresh the current Ghidra buffer or all session documents from the backend.
function M.refresh()
    local cur_name = vim.api.nvim_buf_get_name(0)
    if cur_name:match('^ghidra://[^/]+/(function|symbol|references|type)/') then
        local canonical = buffer.canonicalize_uri(cur_name)
        client.execute_command('ghidra.refreshDocument', { { uri = canonical } }, function(err)
            if err then
                vim.notify('Refresh failed: ' .. format_error(err), vim.log.levels.ERROR)
            else
                vim.schedule(function()
                    buffer.load_document(0, canonical)
                    vim.notify('Document refreshed from Ghidra', vim.log.levels.INFO)
                end)
            end
        end)
    elseif cur_name:match('^ghidra%-type://') then
        local cur_buf = vim.api.nvim_get_current_buf()
        if vim.bo[cur_buf].modified then
            local choice = vim.fn.confirm('Discard unsaved data type draft and reload from Ghidra?', '&Keep editing\n&Reload', 1)
            if choice ~= 2 then return end
        end
        if buffer.load_type_document(cur_buf, cur_name) then
            vim.notify('Data type reloaded from Ghidra', vim.log.levels.INFO)
        end
    elseif cur_name:match('^ghidra%-listing://')
        or cur_name:match('^ghidra%-memory://')
        or cur_name:match('^ghidra%-cfg://')
        or cur_name:match('^ghidra%-callgraph://')
    then
        require('ghidra-lsp.views').refresh_buffer(0)
        vim.notify('View refreshed from Ghidra', vim.log.levels.INFO)
    elseif cur_name:match('^ghidra%-overview://') then
        local md5 = M.get_active_md5()
        if md5 then M.overview(md5, true) end
    else
        local md5 = M.get_active_md5()
        if md5 then
            client.execute_command('ghidra.refresh', { { md5 = md5 } }, function(err)
                if err then
                    vim.notify('Refresh failed: ' .. format_error(err), vim.log.levels.ERROR)
                else
                    vim.notify('All Ghidra session documents refreshed', vim.log.levels.INFO)
                end
            end)
        else
            vim.notify('Not in a Ghidra buffer and no active session', vim.log.levels.WARN)
        end
    end
end

--- Discard a pending scoped rename and clear modified state across function buffers.
function M.discard_rename()
    local md5 = M.get_active_md5()
    if not md5 then
        vim.notify('No active Ghidra session', vim.log.levels.WARN)
        return
    end
    md5 = md5:lower()
    client.execute_command('ghidra.discardRename', { { md5 = md5 } }, function(err)
        if err then
            vim.notify('Discard rename failed: ' .. format_error(err), vim.log.levels.ERROR)
        else
            client.pending_rename[md5] = nil
            vim.schedule(function()
                for _, b in ipairs(vim.api.nvim_list_bufs()) do
                    if vim.api.nvim_buf_is_valid(b) and vim.api.nvim_buf_is_loaded(b) then
                        local name = buffer.canonicalize_uri(vim.api.nvim_buf_get_name(b))
                        if name:lower():find('^ghidra://' .. md5 .. '/function/') then
                            vim.bo[b].modified = false
                            vim.bo[b].modifiable = false
                        end
                    end
                end
                ui.refresh_statuslines()
                vim.notify('Pending rename discarded', vim.log.levels.INFO)
                M.refresh()
            end)
        end
    end)
end

--- Jump to the origin buffer of the active pending rename.
function M.goto_origin()
    local md5 = M.get_active_md5()
    if not md5 then
        vim.notify('No active Ghidra session', vim.log.levels.WARN)
        return
    end
    md5 = md5:lower()
    client.execute_command('ghidra.renameState', { { md5 = md5 } }, function(err, res)
        if err or type(res) ~= 'table' or type(res.pending) ~= 'table' or type(res.pending.origin) ~= 'string' then
            vim.notify('No pending rename in this session', vim.log.levels.INFO)
            return
        end
        vim.schedule(function()
            buffer.open_uri(res.pending.origin)
        end)
    end)
end

--- Open or update the program overview snapshot buffer.
function M.overview(md5_arg, reuse_existing_only)
    local md5 = md5_arg or M.get_active_md5()
    if not md5 then
        vim.notify('No active Ghidra session', vim.log.levels.WARN)
        return
    end
    md5 = md5:lower()

    client.execute_command('ghidra.program', { { md5 = md5 } }, function(err, result)
        if err or not result then
            vim.notify('Failed to get program overview: ' .. format_error(err), vim.log.levels.ERROR)
            return
        end

        local prog_name = client.session_names[md5] or result.file_name or result.name or md5:sub(1, 8)
        local type_count = result.data_type_count
        local arch = tostring(result.language_id or result.processor or 'N/A')
        local compiler = tostring(result.compiler_spec_id or 'N/A')
        local base_addr = format.display_address(result.image_base or 'N/A')
        local min_a = format.display_address(result.min_address or 'N/A')
        local max_a = format.display_address(result.max_address or 'N/A')

        local lines = {
            '# Ghidra Program Overview',
            '',
            '- **Name**: ' .. tostring(prog_name),
            '- **MD5**: `' .. tostring(result.md5 or md5) .. '`',
            '- **Architecture**: ' .. arch .. ' (' .. compiler .. ')',
            '- **Format**: ' .. tostring(result.executable_format or 'N/A'),
            '- **Base Address**: `' .. base_addr .. '`',
            '- **Address Range**: `' .. min_a .. '` .. `' .. max_a .. '`',
            '- **Functions**: ' .. tostring(result.function_count or 'N/A')
                .. '  ·  **Symbols**: ' .. tostring(result.symbol_count or 'N/A')
                .. (type_count and ('  ·  **Data Types**: ' .. tostring(type_count)) or ''),
        }
        if type(result.executable_path) == 'string' and result.executable_path ~= '' then
            table.insert(lines, '- **Binary Path**: `' .. result.executable_path .. '`')
        end

        local buf_name = 'ghidra-overview://' .. md5
        local existing_buf = buffer.find_buf_by_name(buf_name)
        if reuse_existing_only and existing_buf == -1 then
            return
        end
        local buf
        if existing_buf ~= -1 then
            buf = existing_buf
        else
            buf = vim.api.nvim_create_buf(false, true)
            pcall(vim.api.nvim_buf_set_name, buf, buf_name)
        end

        vim.bo[buf].modifiable = true
        vim.bo[buf].readonly = false
        vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
        vim.bo[buf].filetype = 'markdown'
        vim.bo[buf].buftype = 'nofile'
        vim.bo[buf].swapfile = false
        vim.bo[buf].modifiable = false
        vim.bo[buf].readonly = true
        vim.bo[buf].modified = false

        vim.keymap.set('n', 'q', function()
            if #vim.api.nvim_tabpage_list_wins(0) > 1 then vim.cmd('close') end
        end, { buffer = buf, silent = true })

        if not reuse_existing_only then
            local win = vim.fn.bufwinid(buf)
            if win ~= -1 and vim.api.nvim_win_is_valid(win) then
                vim.api.nvim_set_current_win(win)
            else
                vim.cmd('belowright split')
                vim.api.nvim_set_current_buf(buf)
            end
        end
        ui.refresh_statuslines()
    end)
end

--- Pick a symbol from the active Ghidra program and navigate to it.
function M.symbols()
    local md5 = M.get_active_md5()
    if not md5 then
        vim.notify('No active Ghidra session', vim.log.levels.WARN)
        return
    end
    md5 = md5:lower()
    client.execute_command('ghidra.symbols', { { md5 = md5 } }, function(err, res)
        if err or type(res) ~= 'table' or type(res.items) ~= 'table' then
            vim.notify('Failed to load symbols: ' .. format_error(err), vim.log.levels.ERROR)
            return
        end
        local omit = client.config.template_arguments ~= 'show'
        ui.pick(res.items, {
            prompt = 'Symbols:',
            format_item = function(item)
                return string.format('%-36s  %-10s  [%s]',
                    format.display_symbol_name(item, omit),
                    format.display_address(item.address),
                    tostring(item.type or 'Symbol'))
            end,
            search_text = function(item)
                return string.format('%s %s %s', tostring(item.name or ''), format.full_symbol_name(item), tostring(item.address or ''))
            end,
        }, function(choice)
            if not choice then return end
            if type(choice.address) == 'string' and choice.address ~= '' and not choice.address:match('^EXTERNAL:') then
                M.goto_address({ md5 = md5, address = choice.address })
            elseif choice.id then
                buffer.open_uri(string.format('ghidra://%s/symbol/%s', md5, format.url_encode(choice.id)))
            end
        end)
    end)
end

--- Open a read-only Markdown snapshot buffer for a data type.
local function open_type_snapshot_uri(md5, type_path)
    local clean = buffer.normalize_type_path(type_path)
    local type_uri = string.format('ghidra://%s/type/%s', md5, format.url_encode(clean .. '.md'))
    if vim.api.nvim_buf_get_name(0):match('^ghidra') then
        vim.cmd('rightbelow vsplit')
    end
    return buffer.open_uri(type_uri)
end

--- Open an editable JSONC buffer for a project data type.
local function open_type_editor_uri(md5, type_path)
    local type_uri = buffer.type_uri(md5, type_path)
    if vim.api.nvim_buf_get_name(0):match('^ghidra') then
        vim.cmd('rightbelow vsplit')
    end
    return buffer.open_uri(type_uri)
end

--- Browse program data types and open an editable buffer or read-only snapshot.
function M.types()
    local md5 = M.get_active_md5()
    if not md5 then
        vim.notify('No active Ghidra session', vim.log.levels.WARN)
        return
    end
    md5 = md5:lower()
    client.execute_command('ghidra.types', { { md5 = md5 } }, function(err, res)
        if err or type(res) ~= 'table' or type(res.items) ~= 'table' then
            vim.notify('Failed to load data types: ' .. format_error(err), vim.log.levels.ERROR)
            return
        end
        local items = {
            { _parse_c = true, name = '+ Import C Header...', kind = 'c_header', path = '/' },
        }
        for _, item in ipairs(res.items) do
            table.insert(items, item)
        end
        ui.pick(items, {
            prompt = 'Data Types:',
            format_item = format_type_item,
        }, function(choice)
            if not choice then return end
            if choice._parse_c then
                require('ghidra-lsp.edit').parse_c({ md5 = md5 })
                return
            end
            if not choice.path then return end
            ui.pick({ 'Edit Type (.ghidra-type)', 'Inspect Type (snapshot)' }, {
                prompt = 'Data Type Action · ' .. tostring(choice.path) .. ':',
            }, function(action)
                if action == 'Edit Type (.ghidra-type)' then
                    open_type_editor_uri(md5, choice.path)
                elseif action == 'Inspect Type (snapshot)' then
                    open_type_snapshot_uri(md5, choice.path)
                end
            end)
        end)
    end)
end

--- Open an editable ghidra-type:// buffer by path, cursor position, or type picker.
function M.edit_type(arg)
    local md5 = (type(arg) == 'table' and arg.md5) or M.get_active_md5()
    if not md5 then
        vim.notify('No active Ghidra session', vim.log.levels.WARN)
        return nil
    end
    md5 = md5:lower()

    local direct_path = type(arg) == 'table' and (arg.path or arg.name) or (type(arg) == 'string' and arg or nil)
    if type(direct_path) == 'string' and vim.trim(direct_path) ~= '' then
        return open_type_editor_uri(md5, direct_path)
    end

    local pos_uri = type(arg) == 'table' and arg.uri or nil
    local pos = type(arg) == 'table' and arg.position or nil
    if not pos_uri then
        local cur_name = vim.api.nvim_buf_get_name(0)
        if cur_name:match('^ghidra://[^/]+/function/') then
            pos_uri = cur_name
            pos = buffer.cursor_utf16_position(0)
        end
    end

    if type(pos_uri) == 'string' and type(pos) == 'table' then
        local res, err = client.execute_command_sync('ghidra.typeAtPosition', { {
            uri = buffer.canonicalize_uri(pos_uri),
            position = pos,
        } })
        if not err and type(res) == 'table' and type(res.type) == 'table' and type(res.type.path) == 'string' then
            return open_type_editor_uri(md5, res.type.path)
        end
    end

    client.execute_command('ghidra.types', { { md5 = md5 } }, function(err, res)
        if err or type(res) ~= 'table' or type(res.items) ~= 'table' then
            vim.notify('Failed to load data types: ' .. format_error(err), vim.log.levels.ERROR)
            return
        end
        ui.pick(res.items, {
            prompt = 'Edit Data Type:',
            format_item = format_type_item,
        }, function(choice)
            if choice and choice.path then
                open_type_editor_uri(md5, choice.path)
            end
        end)
    end)
    return nil
end

--- Open a read-only data type snapshot by path, cursor position, or type picker.
function M.inspect_type(arg)
    local md5 = (type(arg) == 'table' and arg.md5) or M.get_active_md5()
    if not md5 then
        vim.notify('No active Ghidra session', vim.log.levels.WARN)
        return
    end
    md5 = md5:lower()

    local direct_path = type(arg) == 'table' and (arg.path or arg.name) or (type(arg) == 'string' and arg or nil)
    if type(direct_path) == 'string' and direct_path ~= '' then
        open_type_snapshot_uri(md5, direct_path)
        return
    end

    if type(arg) == 'table' and type(arg.uri) == 'string' and type(arg.position) == 'table' then
        local res, err = client.execute_command_sync('ghidra.typeAtPosition', { {
            uri = buffer.canonicalize_uri(arg.uri),
            position = arg.position,
        } })
        if not err and type(res) == 'table' and type(res.type) == 'table' and type(res.type.path) == 'string' then
            open_type_snapshot_uri(md5, res.type.path)
            return
        end
    end
    M.types()
end

--- Close the active or specified Ghidra session.
function M.close_session(md5_arg)
    local md5 = (type(md5_arg) == 'string' and vim.trim(md5_arg) ~= '' and vim.trim(md5_arg)) or M.get_active_md5()
    if not md5 then
        vim.notify('No active Ghidra session', vim.log.levels.WARN)
        return
    end
    md5 = md5:lower()
    client.execute_command('ghidra.closeSession', { { md5 = md5 } }, function(err)
        if err then
            vim.notify('Failed to close session: ' .. format_error(err), vim.log.levels.ERROR)
        else
            client.open_sessions[md5] = nil
            client.pending_rename[md5] = nil
            if client.current_md5 == md5 then client.current_md5 = nil end
            vim.schedule(function()
                ui.refresh_statuslines()
                vim.notify('Closed Ghidra session ' .. md5:sub(1, 8), vim.log.levels.INFO)
            end)
        end
    end)
end

--- Trigger analysis or reanalysis on the active Ghidra session.
function M.reanalyze()
    local md5 = M.get_active_md5()
    if not md5 then
        vim.notify('No active Ghidra session', vim.log.levels.WARN)
        return
    end
    md5 = md5:lower()
    vim.notify('Starting Ghidra analysis for ' .. (client.session_names[md5] or md5:sub(1, 8)) .. '...', vim.log.levels.INFO)
    client.execute_command('ghidra.reanalyze', { { md5 = md5 } }, function(err)
        if err then
            vim.notify('Ghidra reanalyze failed: ' .. format_error(err), vim.log.levels.ERROR)
        else
            vim.notify('Ghidra analysis completed', vim.log.levels.INFO)
        end
    end)
end

--- Show incoming or outgoing call hierarchy for the symbol under cursor.
function M.call_hierarchy(_arg)
    local c = client.get_client()
    local encoding = (c and c.offset_encoding) or 'utf-16'
    local params = vim.lsp.util.make_position_params(0, encoding)
    local req = c and function(method, p, cb) c:request(method, p, cb, 0) end
        or function(method, p, cb) vim.lsp.buf_request(0, method, p, cb) end
    req('textDocument/prepareCallHierarchy', params, function(err, result)
        if err or not result or #result == 0 then
            vim.notify('No call hierarchy available at cursor', vim.log.levels.INFO)
            return
        end
        local item = result[1]
        ui.pick({ 'Incoming Calls (Callers)', 'Outgoing Calls (Callees)' }, {
            prompt = 'Call Hierarchy for ' .. item.name .. ':',
        }, function(choice)
            if choice == 'Incoming Calls (Callers)' then
                vim.lsp.buf.incoming_calls()
            elseif choice == 'Outgoing Calls (Callees)' then
                vim.lsp.buf.outgoing_calls()
            end
        end)
    end)
end

return M
