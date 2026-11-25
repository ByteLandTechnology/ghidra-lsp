-- Copyright 2026 ByteLand Technology Limited
-- SPDX-License-Identifier: MIT

-- Virtual ghidra://, ghidra-type://, and ghidra-listing:// buffer management, diagnostics, and saves.
local client = require('ghidra-lsp.client')
local format = require('ghidra-lsp.format')

local M = {}

M.TYPE_DIAG_NS = vim.api.nvim_create_namespace('ghidra_lsp_type')

--- Normalize a Ghidra data-type path so it begins with a leading slash.
function M.normalize_type_path(path)
    local p = vim.trim(tostring(path or ''))
    p = p:gsub('%?.*$', ''):gsub('%.ghidra%-type$', ''):gsub('%.jsonc$', ''):gsub('%.md$', '')
    if p == '' then return '/' end
    if p:sub(1, 1) ~= '/' then
        p = '/' .. p
    end
    return p
end

--- Build a canonical ghidra-type:// URI from program md5 and data-type path.
function M.type_uri(md5, path)
    local clean_md5 = tostring(md5 or ''):lower()
    local clean_path = M.normalize_type_path(path)
    return 'ghidra-type://' .. clean_md5 .. format.url_encode_path(clean_path) .. '.ghidra-type'
end

--- Extract program md5 and decoded data-type path from a ghidra-type:// URI.
function M.parse_type_uri(uri)
    if type(uri) ~= 'string' then return nil, nil end
    local md5, raw_rest = uri:match('^ghidra%-type://([^/]+)(/.*)$')
    if not md5 or not raw_rest then return nil, nil end
    local stripped = raw_rest:gsub('%?.*$', ''):gsub('%.ghidra%-type$', ''):gsub('%.jsonc$', '')
    local decoded = M.normalize_type_path(format.url_decode(stripped))
    return md5:lower(), decoded
end

--- Build a canonical ghidra-listing:// URI from program md5 and target address.
function M.listing_uri(md5, address)
    local clean_md5 = tostring(md5 or ''):lower()
    local encoded = format.url_encode(tostring(address or ''))
    return 'ghidra-listing://' .. clean_md5 .. '/listing/' .. encoded .. '.ghidra-listing'
end

--- Extract program md5 and decoded target address from a ghidra-listing:// URI.
function M.parse_listing_uri(uri)
    if type(uri) ~= 'string' then return nil, nil end
    local md5, raw_rest = uri:match('^ghidra%-listing://([^/]+)/(.+)$')
    if not md5 or not raw_rest then return nil, nil end
    local clean = raw_rest:gsub('%?.*$', '')
    local segment = clean:match('^listing/(.+)$') or clean
    segment = segment:gsub('%.ghidra%-listing$', '')
    local decoded = vim.trim(format.url_decode(segment))
    if decoded == '' then return nil, nil end
    return md5:lower(), decoded
end

--- Normalize ghidra://, ghidra-type://, and ghidra-listing:// URIs to canonical form.
function M.canonicalize_uri(uri)
    if type(uri) ~= 'string' then return uri end
    local prefix, md5, kind, segment = uri:match('^(ghidra://)([^/]+)/([^/]+)/(.*)$')
    if prefix and md5 and kind and segment then
        local decoded = format.url_decode(segment)
        local encoded = format.url_encode(decoded)
        return prefix .. md5:lower() .. '/' .. kind .. '/' .. encoded
    end
    local t_md5, t_path = M.parse_type_uri(uri)
    if t_md5 and t_path then
        return M.type_uri(t_md5, t_path)
    end
    local l_md5, l_addr = M.parse_listing_uri(uri)
    if l_md5 and l_addr then
        return M.listing_uri(l_md5, l_addr)
    end
    return uri
end

--- Install standard LSP and reverse-engineering keymaps on a Ghidra virtual buffer.
function M.setup_keymaps(bufnr, is_function)
    local opts = { buffer = bufnr, silent = true, noremap = true }
    local map = vim.keymap.set

    map('n', 'K', function()
        vim.lsp.buf.hover({ border = 'rounded', max_width = 84 })
    end, vim.tbl_extend('force', opts, { desc = 'Ghidra hover info' }))
    map('n', '<C-k>', function()
        vim.lsp.buf.signature_help({ border = 'rounded', max_width = 84 })
    end, vim.tbl_extend('force', opts, { desc = 'Ghidra signature help' }))
    map('n', 'gd', vim.lsp.buf.definition, vim.tbl_extend('force', opts, { desc = 'Go to definition' }))
    map('n', 'gD', vim.lsp.buf.declaration, vim.tbl_extend('force', opts, { desc = 'Go to declaration' }))
    map('n', 'gi', vim.lsp.buf.implementation, vim.tbl_extend('force', opts, { desc = 'Go to implementation' }))
    map('n', 'gy', vim.lsp.buf.type_definition, vim.tbl_extend('force', opts, { desc = 'Go to type definition' }))
    map('n', 'gr', vim.lsp.buf.references, vim.tbl_extend('force', opts, { desc = 'Find references' }))
    map('n', 'gO', vim.lsp.buf.document_symbol, vim.tbl_extend('force', opts, { desc = 'Document symbols' }))
    map('n', '<F2>', vim.lsp.buf.rename, vim.tbl_extend('force', opts, { desc = 'Rename symbol (preview)' }))
    map('n', '<leader>rn', vim.lsp.buf.rename, vim.tbl_extend('force', opts, { desc = 'Rename symbol (preview)' }))
    map('n', '<leader>ca', vim.lsp.buf.code_action, vim.tbl_extend('force', opts, { desc = 'Ghidra code actions' }))

    if is_function then
        map('n', '<leader>gl', function()
            require('ghidra-lsp.views').open_listing()
        end, vim.tbl_extend('force', opts, { desc = 'Open Assembly Listing at cursor' }))
        map('n', '<leader>gm', function()
            require('ghidra-lsp.views').open_memory()
        end, vim.tbl_extend('force', opts, { desc = 'Open Hex/Memory view at cursor' }))
        map('n', '<leader>gc', function()
            require('ghidra-lsp.edit').edit_comment()
        end, vim.tbl_extend('force', opts, { desc = 'Edit comments at cursor' }))
        map('n', '<leader>go', function()
            require('ghidra-lsp.commands').goto_address()
        end, vim.tbl_extend('force', opts, { desc = 'Go to address' }))
        map('n', '<leader>gh', function()
            require('ghidra-lsp.commands').call_hierarchy()
        end, vim.tbl_extend('force', opts, { desc = 'Show call hierarchy' }))
        map('n', '<leader>gt', function()
            require('ghidra-lsp.commands').edit_type()
        end, vim.tbl_extend('force', opts, { desc = 'Edit Ghidra data type' }))
    else
        map('n', '<leader>gt', function()
            require('ghidra-lsp.commands').edit_type()
        end, vim.tbl_extend('force', opts, { desc = 'Edit Ghidra data type' }))
        map('n', 'q', function()
            if #vim.api.nvim_tabpage_list_wins(0) > 1 then
                vim.cmd('close')
            end
        end, vim.tbl_extend('force', opts, { desc = 'Close snapshot split' }))
    end
end

--- Return the buffer handle whose full name equals `target`, or `-1`.
local function find_buf_by_name(target)
    for _, b in ipairs(vim.api.nvim_list_bufs()) do
        if vim.api.nvim_buf_is_valid(b) and vim.api.nvim_buf_get_name(b) == target then
            return b
        end
    end
    return -1
end
M.find_buf_by_name = find_buf_by_name

--- Return true when two line arrays have identical contents.
local function lines_equal(a, b)
    if #a ~= #b then return false end
    for i = 1, #a do
        if a[i] ~= b[i] then return false end
    end
    return true
end

--- Replace lines in an editable type buffer while preserving the cursor position.
local function set_type_lines_keep_cursor(bufnr, text)
    local trailing_nl = text:sub(-1) == '\n'
    local body = trailing_nl and text:sub(1, -2) or text
    local new_lines = body == '' and { '' } or vim.split(body, '\n', { plain = true })

    local cur_lines = vim.api.nvim_buf_get_lines(bufnr, 0, -1, false)
    if not lines_equal(cur_lines, new_lines) then
        local win = vim.fn.bufwinid(bufnr)
        local cursor = (win ~= -1) and vim.api.nvim_win_get_cursor(win) or nil
        vim.bo[bufnr].modifiable = true
        vim.bo[bufnr].readonly = false
        vim.api.nvim_buf_set_lines(bufnr, 0, -1, false, new_lines)
        if cursor and win ~= -1 and vim.api.nvim_win_is_valid(win) then
            local max_row = math.max(1, #new_lines)
            local r = math.min(cursor[1], max_row)
            local c = math.min(cursor[2], #(new_lines[r] or ''))
            pcall(vim.api.nvim_win_set_cursor, win, { r, c })
        end
    end
    return trailing_nl
end

--- Populate cached function display names and session metadata for a program md5.
function M.ensure_program_metadata_cached(md5)
    if not md5 or md5 == '' then return end
    md5 = md5:lower()
    if client.function_names[md5] ~= nil then return end
    client.function_names[md5] = {}
    client.execute_command('ghidra.functions', { { md5 = md5 } }, function(err, res)
        if not err and type(res) == 'table' and type(res.items) == 'table' then
            local omit = client.config.template_arguments ~= 'show'
            local map = {}
            for _, item in ipairs(res.items) do
                if type(item.entry) == 'string' then
                    local disp = format.display_symbol_name(item, omit)
                    map[item.entry:lower()] = disp
                    map[item.entry] = disp
                end
            end
            client.function_names[md5] = map
            vim.schedule(function()
                pcall(function() require('ghidra-lsp.ui').refresh_statuslines() end)
            end)
        end
    end)
    if not client.session_names[md5] then
        client.execute_command('ghidra.sessions', { vim.empty_dict() }, function(err, res)
            if not err and type(res) == 'table' and type(res.sessions) == 'table' then
                for _, s in ipairs(res.sessions) do
                    if type(s.md5) == 'string' then
                        local smd5 = s.md5:lower()
                        client.session_names[smd5] = s.fileName or s.name or client.session_names[smd5]
                        if s.status == 'ready' then
                            client.open_sessions[smd5] = true
                        end
                    end
                end
                vim.schedule(function()
                    pcall(function() require('ghidra-lsp.ui').refresh_statuslines() end)
                end)
            end
        end)
    end
end
local ensure_program_metadata_cached = M.ensure_program_metadata_cached

--- Convert a 0-based LSP UTF-16 position to 0-based line and UTF-8 byte column.
function M.utf16_pos_to_byte(bufnr, pos)
    if type(pos) ~= 'table' or type(pos.line) ~= 'number' then
        return 0, 0
    end
    local line_count = vim.api.nvim_buf_line_count(bufnr)
    local lnum = math.max(0, math.min(math.max(0, line_count - 1), pos.line))
    local line_text = vim.api.nvim_buf_get_lines(bufnr, lnum, lnum + 1, false)[1] or ''
    local char = tonumber(pos.character) or 0
    if char <= 0 then
        return lnum, 0
    end
    local ok, idx = pcall(vim.str_byteindex, line_text, 'utf-16', char, false)
    local col = ok and idx or math.min(#line_text, char)
    return lnum, col
end

--- Move a window cursor to a 0-based LSP UTF-16 position.
function M.set_cursor_utf16(win, pos)
    if type(pos) ~= 'table' or type(pos.line) ~= 'number' then return end
    local target_win = (win == nil or win == 0) and 0 or win
    local bufnr = vim.api.nvim_win_get_buf(target_win)
    local lnum, col = M.utf16_pos_to_byte(bufnr, pos)
    pcall(vim.api.nvim_win_set_cursor, target_win, { lnum + 1, col })
end

--- Return the current window cursor as a 0-based LSP UTF-16 position.
function M.cursor_utf16_position(win)
    local target_win = (win == nil or win == 0) and 0 or win
    local bufnr = vim.api.nvim_win_get_buf(target_win)
    local pos = vim.api.nvim_win_get_cursor(target_win)
    local row0 = math.max(0, pos[1] - 1)
    local line = vim.api.nvim_buf_get_lines(bufnr, row0, row0 + 1, false)[1] or ''
    local col_byte = math.min(pos[2], #line)
    local ok, utf16 = pcall(vim.str_utfindex, line, 'utf-16', col_byte)
    local char_utf16 = ok and utf16 or col_byte
    return { line = row0, character = char_utf16 }
end

--- Load a ghidra:// pseudocode or snapshot document into a Neovim buffer.
function M.load_document(bufnr, uri)
    if bufnr == 0 then
        bufnr = vim.api.nvim_get_current_buf()
    end
    local canonical = M.canonicalize_uri(uri)
    if vim.api.nvim_buf_is_valid(bufnr) then
        local cur_name = vim.api.nvim_buf_get_name(bufnr)
        if cur_name ~= canonical then
            local existing = find_buf_by_name(canonical)
            if existing ~= -1 and existing ~= bufnr then
                vim.api.nvim_set_current_buf(existing)
                pcall(vim.api.nvim_buf_delete, bufnr, { force = true })
                return true
            else
                pcall(vim.api.nvim_buf_set_name, bufnr, canonical)
            end
        end
    end

    local res, err = client.execute_command_sync('ghidra.document', { { uri = canonical, includePending = true } })
    if err or not res or not res.text then
        local err_msg = type(err) == 'table' and (err.message or vim.inspect(err)) or tostring(err or 'empty response')
        vim.notify('Failed to load Ghidra document: ' .. err_msg, vim.log.levels.ERROR)
        return false
    end

    local lines = vim.split(res.text, '\n', { plain = true })
    if #lines > 1 and lines[#lines] == '' then
        table.remove(lines)
    end

    local is_function = canonical:match('^ghidra://[^/]+/function/') ~= nil
    local md5 = canonical:match('^ghidra://([^/]+)/')
    if md5 then
        md5 = md5:lower()
        client.open_sessions[md5] = true
        ensure_program_metadata_cached(md5)
    end

    local existing_lines = vim.api.nvim_buf_get_lines(bufnr, 0, -1, false)
    local is_fresh = #existing_lines == 1 and existing_lines[1] == '' and vim.b[bufnr].ghidra_loaded ~= true
    if is_fresh or not lines_equal(existing_lines, lines) then
        vim.bo[bufnr].modifiable = true
        vim.bo[bufnr].readonly = false
        vim.api.nvim_buf_set_lines(bufnr, 0, -1, false, lines)
    end
    vim.b[bufnr].ghidra_loaded = true
    vim.bo[bufnr].swapfile = false
    vim.bo[bufnr].bufhidden = 'hide'
    vim.bo[bufnr].filetype = canonical:match('%.md$') and 'markdown' or 'c'

    if is_function then
        vim.bo[bufnr].buftype = 'acwrite'
        vim.bo[bufnr].readonly = false
        vim.bo[bufnr].modifiable = false
    else
        vim.bo[bufnr].buftype = 'nofile'
        vim.bo[bufnr].readonly = true
        vim.bo[bufnr].modifiable = false
    end
    vim.bo[bufnr].modified = false

    local c = client.get_client()
    local client_id = c and c.id
    if client_id then
        vim.lsp.buf_attach_client(bufnr, client_id)
    end

    M.setup_keymaps(bufnr, is_function)
    if type(res.warning) == 'string' and res.warning ~= '' then
        vim.notify('Ghidra warning: ' .. res.warning, vim.log.levels.WARN)
    end
    pcall(function() require('ghidra-lsp.ui').refresh_statuslines() end)
    return true
end

--- Persist scoped edits on a ghidra:// function buffer back to Ghidra.
function M.save_document(bufnr, uri)
    local canonical = M.canonicalize_uri(uri)
    local is_function = canonical:match('^ghidra://[^/]+/function/') ~= nil
    if not is_function then
        vim.notify('Cannot save read-only snapshot document: ' .. canonical, vim.log.levels.ERROR)
        error('Ghidra LSP save failed: snapshot documents are read-only')
    end

    local md5 = canonical:match('^ghidra://([^/]+)/')
    if md5 then
        md5 = md5:lower()
        local state, state_err = client.execute_command_sync('ghidra.renameState', { { md5 = md5 } })
        if not state_err and type(state) == 'table' and type(state.pending) == 'table' and type(state.pending.origin) == 'string' then
            local origin_canon = M.canonicalize_uri(state.pending.origin)
            if origin_canon ~= canonical then
                local ui = require('ghidra-lsp.ui')
                local msg = string.format(
                    'Pending rename (%s -> %s) must be saved from its origin buffer (%s); use :GhidraOrigin',
                    tostring(state.pending.oldName or '?'),
                    tostring(state.pending.newName or '?'),
                    ui.short_uri(origin_canon)
                )
                vim.notify(msg, vim.log.levels.WARN)
                error('Ghidra LSP save refused: ' .. msg)
            end
        end
    end

    local lines = vim.api.nvim_buf_get_lines(bufnr, 0, -1, false)
    local text = table.concat(lines, '\n') .. '\n'

    local _res, err = client.execute_command_sync('ghidra.saveDocument', { { uri = canonical, text = text } })
    if err then
        local err_msg = type(err) == 'table' and (err.message or vim.inspect(err)) or tostring(err)
        vim.notify('Failed to save Ghidra document: ' .. err_msg, vim.log.levels.ERROR)
        error('Ghidra LSP save failed: ' .. err_msg)
    end

    if md5 then
        client.pending_rename[md5] = nil
        for _, b in ipairs(vim.api.nvim_list_bufs()) do
            if vim.api.nvim_buf_is_valid(b) and vim.api.nvim_buf_is_loaded(b) then
                local bname = M.canonicalize_uri(vim.api.nvim_buf_get_name(b))
                if bname:lower():find('^ghidra://' .. md5 .. '/function/') then
                    vim.bo[b].modified = false
                    vim.bo[b].modifiable = false
                end
            end
        end
    else
        vim.bo[bufnr].modified = false
        vim.bo[bufnr].modifiable = false
    end
    pcall(function() require('ghidra-lsp.ui').refresh_statuslines() end)
    vim.notify('Ghidra document saved to analysis project', vim.log.levels.INFO)
end

--- Return the full text of a type buffer with its preserved trailing newline.
local function type_buffer_text(bufnr, state)
    local lines = vim.api.nvim_buf_get_lines(bufnr, 0, -1, false)
    local nl = (state and state.trailing_nl ~= false) and '\n' or ''
    return table.concat(lines, '\n') .. nl
end

--- Publish server validation errors as Neovim diagnostics on the type buffer.
local function apply_type_validation_result(bufnr, res)
    if not vim.api.nvim_buf_is_valid(bufnr) then return end
    if type(res) ~= 'table' or res.valid == true then
        vim.diagnostic.set(M.TYPE_DIAG_NS, bufnr, {})
        return
    end
    local range = type(res.range) == 'table' and res.range or {}
    local sl, sc = M.utf16_pos_to_byte(bufnr, range.start)
    local el, ec = M.utf16_pos_to_byte(bufnr, range['end'])
    if el < sl or (el == sl and ec <= sc) then
        el = sl
        ec = sc + 1
    end
    vim.diagnostic.set(M.TYPE_DIAG_NS, bufnr, {
        {
            lnum = sl,
            col = sc,
            end_lnum = el,
            end_col = ec,
            severity = vim.diagnostic.severity.ERROR,
            source = 'ghidra-lsp',
            message = tostring(res.message or 'Invalid data type document'),
        },
    })
end

--- Validate an editable ghidra-type:// buffer against the server schema.
function M.validate_type_buffer(bufnr, sync)
    if bufnr == 0 then
        bufnr = vim.api.nvim_get_current_buf()
    end
    if not vim.api.nvim_buf_is_valid(bufnr) then return nil end
    local state = vim.b[bufnr].ghidra_type_state
    if type(state) ~= 'table' or state.readonly or type(state.original) ~= 'table' then
        return nil
    end

    local text = type_buffer_text(bufnr, state)
    state.validate_seq = (state.validate_seq or 0) + 1
    local seq = state.validate_seq
    vim.b[bufnr].ghidra_type_state = state

    if sync then
        local res, err = client.execute_command_sync('ghidra.validateTypeDocument', { {
            text = text,
            original = state.original,
        } })
        if not err and type(res) == 'table' then
            apply_type_validation_result(bufnr, res)
            return res
        end
        return nil
    end

    client.execute_command('ghidra.validateTypeDocument', { {
        text = text,
        original = state.original,
    } }, function(err, res)
        vim.schedule(function()
            if not vim.api.nvim_buf_is_valid(bufnr) then return end
            local cur = vim.b[bufnr].ghidra_type_state
            if type(cur) ~= 'table' or cur.validate_seq ~= seq then return end
            if not err and type(res) == 'table' then
                apply_type_validation_result(bufnr, res)
            end
        end)
    end)
    return nil
end

--- Load a ghidra-type:// JSONC document into a Neovim buffer.
function M.load_type_document(bufnr, uri)
    if bufnr == 0 then
        bufnr = vim.api.nvim_get_current_buf()
    end
    local canonical = M.canonicalize_uri(uri)
    local md5, path = M.parse_type_uri(canonical)
    if not md5 or not path then
        vim.notify('Invalid ghidra-type URI: ' .. tostring(uri), vim.log.levels.ERROR)
        return false
    end

    if vim.api.nvim_buf_is_valid(bufnr) then
        local cur_name = vim.api.nvim_buf_get_name(bufnr)
        if cur_name ~= canonical then
            local existing = find_buf_by_name(canonical)
            if existing ~= -1 and existing ~= bufnr then
                vim.api.nvim_set_current_buf(existing)
                pcall(vim.api.nvim_buf_delete, bufnr, { force = true })
                return true
            else
                pcall(vim.api.nvim_buf_set_name, bufnr, canonical)
            end
        end
    end

    local res, err = client.execute_command_sync('ghidra.typeDocument', { {
        md5 = md5,
        path = path,
    } })
    if err or type(res) ~= 'table' or type(res.text) ~= 'string' then
        local err_msg = type(err) == 'table' and (err.message or vim.inspect(err)) or tostring(err or 'empty response')
        vim.notify('Failed to load Ghidra data type: ' .. err_msg, vim.log.levels.ERROR)
        return false
    end

    client.open_sessions[md5] = true
    if type(res.program) == 'string' and res.program ~= '' and res.program ~= md5 and not client.session_names[md5] then
        client.session_names[md5] = res.program
    end

    local trailing_nl = res.text:sub(-1) == '\n'
    local body = trailing_nl and res.text:sub(1, -2) or res.text
    local lines = body == '' and { '' } or vim.split(body, '\n', { plain = true })

    local readonly = res.readonly == true
    local readonly_reason = (res.readonlyReason ~= vim.NIL and type(res.readonlyReason) == 'string') and res.readonlyReason or nil

    vim.bo[bufnr].modifiable = true
    vim.bo[bufnr].readonly = false
    vim.api.nvim_buf_set_lines(bufnr, 0, -1, false, lines)
    vim.b[bufnr].ghidra_loaded = true
    vim.b[bufnr].ghidra_type_state = {
        key = canonical,
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
    vim.bo[bufnr].swapfile = false
    vim.bo[bufnr].bufhidden = 'hide'
    vim.bo[bufnr].filetype = 'jsonc'
    vim.bo[bufnr].buftype = 'acwrite'
    vim.bo[bufnr].readonly = readonly
    vim.bo[bufnr].modifiable = not readonly
    vim.bo[bufnr].modified = false

    vim.diagnostic.set(M.TYPE_DIAG_NS, bufnr, {})

    local opts = { buffer = bufnr, silent = true, noremap = true }
    vim.keymap.set('n', '<leader>gr', function()
        require('ghidra-lsp.commands').refresh()
    end, vim.tbl_extend('force', opts, { desc = 'Reload Ghidra data type' }))
    if readonly then
        vim.keymap.set('n', 'q', function()
            if #vim.api.nvim_tabpage_list_wins(0) > 1 then
                vim.cmd('close')
            end
        end, vim.tbl_extend('force', opts, { desc = 'Close read-only type buffer' }))
        if readonly_reason then
            vim.notify('Read-only data type: ' .. readonly_reason, vim.log.levels.INFO)
        end
    end

    pcall(function() require('ghidra-lsp.ui').refresh_statuslines() end)
    return true
end

--- Reload an unmodified ghidra-type:// buffer when its server definition changes.
function M.reload_type_document_if_clean(bufnr)
    if not vim.api.nvim_buf_is_valid(bufnr) or vim.bo[bufnr].modified then
        return
    end
    local state = vim.b[bufnr].ghidra_type_state
    if type(state) ~= 'table' or state.saving or state.uncertain then
        return
    end
    client.execute_command('ghidra.typeDocument', { {
        md5 = state.md5,
        path = state.path,
    } }, function(err, res)
        vim.schedule(function()
            if not vim.api.nvim_buf_is_valid(bufnr) or vim.bo[bufnr].modified then
                return
            end
            local cur = vim.b[bufnr].ghidra_type_state
            if type(cur) ~= 'table' or cur.saving or cur.uncertain then
                return
            end
            if err or type(res) ~= 'table' or type(res.text) ~= 'string' then
                return
            end
            if type(res.original) == 'table' and vim.deep_equal(cur.original, res.original) then
                return
            end

            local trailing_nl = set_type_lines_keep_cursor(bufnr, res.text)
            local readonly = res.readonly == true
            local readonly_reason = (res.readonlyReason ~= vim.NIL and type(res.readonlyReason) == 'string') and res.readonlyReason or nil

            cur.original = res.original
            cur.readonly = readonly
            cur.readonly_reason = readonly_reason
            cur.trailing_nl = trailing_nl
            vim.b[bufnr].ghidra_type_state = cur
            vim.bo[bufnr].readonly = readonly
            vim.bo[bufnr].modifiable = not readonly
            vim.bo[bufnr].modified = false
            vim.diagnostic.set(M.TYPE_DIAG_NS, bufnr, {})
            pcall(function() require('ghidra-lsp.ui').refresh_statuslines() end)
        end)
    end)
end

--- Save edits in a ghidra-type:// buffer to Ghidra with conflict and write-outcome guards.
function M.save_type_document(bufnr, _uri)
    if bufnr == 0 then
        bufnr = vim.api.nvim_get_current_buf()
    end
    local state = vim.b[bufnr].ghidra_type_state
    if type(state) ~= 'table' or type(state.original) ~= 'table' then
        local err_msg = 'Missing Ghidra data type baseline state'
        vim.notify(err_msg, vim.log.levels.ERROR)
        error(err_msg)
    end
    if state.readonly then
        local msg = state.readonly_reason or 'This data type is read-only'
        vim.notify('Cannot save read-only data type: ' .. msg, vim.log.levels.ERROR)
        error('Ghidra LSP type save refused: ' .. msg)
    end
    if state.saving then
        local msg = 'This data type is already being saved'
        vim.notify(msg, vim.log.levels.WARN)
        error('Ghidra LSP type save refused: ' .. msg)
    end
    if state.uncertain then
        local msg = 'Previous save may have reached Ghidra; reload with :GhidraRefresh before retrying'
        vim.notify(msg, vim.log.levels.WARN)
        error('Ghidra LSP type save refused: ' .. msg)
    end

    state.saving = true
    vim.b[bufnr].ghidra_type_state = state

    local text = type_buffer_text(bufnr, state)
    local res, err = client.execute_command_sync('ghidra.saveTypeDocument', { {
        md5 = state.md5,
        path = state.path,
        text = text,
        original = state.original,
    } }, 30000)

    if err then
        state.saving = false
        local err_msg = type(err) == 'table' and (err.message or vim.inspect(err)) or tostring(err)
        local lower_err = err_msg:lower()
        local is_uncertain = lower_err:find('may have reached', 1, true) ~= nil
            or lower_err:find('modification reached', 1, true) ~= nil
            or lower_err:find('saving the project failed', 1, true) ~= nil
            or lower_err:find('persistence failed', 1, true) ~= nil
            or lower_err:find('regeneration failed', 1, true) ~= nil
            or lower_err:find('editor rejected', 1, true) ~= nil
        if is_uncertain then
            state.uncertain = true
            vim.b[bufnr].ghidra_type_state = state
            pcall(function() require('ghidra-lsp.ui').refresh_statuslines() end)
        else
            vim.b[bufnr].ghidra_type_state = state
            pcall(M.validate_type_buffer, bufnr, true)
        end
        vim.notify('Failed to save Ghidra data type: ' .. err_msg, vim.log.levels.ERROR)
        error('Ghidra LSP type save failed: ' .. err_msg)
    end

    local normalized = (type(res) == 'table' and type(res.text) == 'string') and res.text or text
    local trailing_nl = set_type_lines_keep_cursor(bufnr, normalized)

    state.original = (type(res) == 'table' and type(res.original) == 'table') and res.original or state.original
    state.trailing_nl = trailing_nl
    state.saving = false
    state.uncertain = false
    vim.b[bufnr].ghidra_type_state = state
    vim.bo[bufnr].modifiable = true
    vim.bo[bufnr].readonly = false
    vim.bo[bufnr].modified = false
    vim.diagnostic.set(M.TYPE_DIAG_NS, bufnr, {})
    pcall(function() require('ghidra-lsp.ui').refresh_statuslines() end)
    vim.notify('Ghidra data type saved: ' .. state.path, vim.log.levels.INFO)
end

--- Open or focus a ghidra:// or ghidra-type:// URI in the current window.
function M.open_uri(uri)
    local canonical = M.canonicalize_uri(uri)
    local bufnr = vim.fn.bufadd(canonical)
    vim.bo[bufnr].swapfile = false
    vim.fn.bufload(bufnr)
    local existing = find_buf_by_name(canonical)
    if existing ~= -1 then
        bufnr = existing
    end
    vim.api.nvim_set_current_buf(bufnr)
    pcall(function() require('ghidra-lsp.ui').refresh_statuslines() end)
    return bufnr
end

--- Register virtual URI buffer autocmds and live statusline refresh hooks.
function M.setup_autocmds()
    client.install_workspace_edit_wrapper()
    pcall(function() require('ghidra-lsp.ui').install_quickfix_formatter() end)

    local group = vim.api.nvim_create_augroup('GhidraLspBuffer', { clear = true })

    vim.api.nvim_create_autocmd({ 'BufNewFile', 'BufReadPre' }, {
        group = group,
        pattern = 'ghidra://*',
        callback = function(args)
            vim.bo[args.buf].swapfile = false
            local uri = (args.file and args.file ~= '') and args.file or vim.api.nvim_buf_get_name(args.buf)
            local canonical = M.canonicalize_uri(uri)
            local is_function = canonical:match('^ghidra://[^/]+/function/') ~= nil
            if is_function then
                vim.bo[args.buf].buftype = 'acwrite'
            else
                vim.bo[args.buf].buftype = 'nofile'
            end
        end,
    })

    vim.api.nvim_create_autocmd('BufReadCmd', {
        group = group,
        pattern = 'ghidra://*',
        callback = function(args)
            local uri = (args.file and args.file ~= '') and args.file or vim.api.nvim_buf_get_name(args.buf)
            M.load_document(args.buf, uri)
        end,
    })

    vim.api.nvim_create_autocmd('BufWriteCmd', {
        group = group,
        pattern = 'ghidra://*',
        callback = function(args)
            local uri = (args.file and args.file ~= '') and args.file or vim.api.nvim_buf_get_name(args.buf)
            M.save_document(args.buf, uri)
        end,
    })

    vim.api.nvim_create_autocmd({ 'BufNewFile', 'BufReadPre' }, {
        group = group,
        pattern = 'ghidra-type://*',
        callback = function(args)
            vim.bo[args.buf].swapfile = false
            vim.bo[args.buf].buftype = 'acwrite'
            vim.bo[args.buf].filetype = 'jsonc'
        end,
    })

    vim.api.nvim_create_autocmd('BufReadCmd', {
        group = group,
        pattern = 'ghidra-type://*',
        callback = function(args)
            local uri = (args.file and args.file ~= '') and args.file or vim.api.nvim_buf_get_name(args.buf)
            M.load_type_document(args.buf, uri)
        end,
    })

    vim.api.nvim_create_autocmd('BufWriteCmd', {
        group = group,
        pattern = 'ghidra-type://*',
        callback = function(args)
            local uri = (args.file and args.file ~= '') and args.file or vim.api.nvim_buf_get_name(args.buf)
            M.save_type_document(args.buf, uri)
        end,
    })

    vim.api.nvim_create_autocmd({ 'TextChanged', 'InsertLeave' }, {
        group = group,
        pattern = 'ghidra-type://*',
        callback = function(args)
            M.validate_type_buffer(args.buf, false)
        end,
    })

    vim.api.nvim_create_autocmd({ 'BufNewFile', 'BufReadPre' }, {
        group = group,
        pattern = 'ghidra-listing://*',
        callback = function(args)
            vim.bo[args.buf].swapfile = false
            vim.bo[args.buf].buftype = 'nofile'
            vim.bo[args.buf].filetype = 'ghidra-listing'
        end,
    })

    vim.api.nvim_create_autocmd('BufReadCmd', {
        group = group,
        pattern = 'ghidra-listing://*',
        callback = function(args)
            local uri = (args.file and args.file ~= '') and args.file or vim.api.nvim_buf_get_name(args.buf)
            require('ghidra-lsp.views.listing').load_listing_buffer(args.buf, uri)
        end,
    })

    vim.api.nvim_create_autocmd({ 'BufWinEnter', 'WinEnter' }, {
        group = group,
        callback = function()
            pcall(function() require('ghidra-lsp.ui').refresh_statuslines() end)
        end,
    })
end

return M
