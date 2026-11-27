-- Copyright 2026 ByteLand Technology Limited
-- SPDX-License-Identifier: MIT

-- Inline 5-kind comment float editor and function/variable mutation forms.
local client = require('ghidra-lsp.client')
local format = require('ghidra-lsp.format')
local ui = require('ghidra-lsp.ui')

local M = {}

M.COMMENT_KINDS = { 'plate', 'pre', 'eol', 'post', 'repeatable' }
M.KIND_LABELS = {
    plate = 'PLATE',
    pre = 'PRE',
    eol = 'EOL',
    post = 'POST',
    repeatable = 'REPEATABLE (ext)',
}

local active_comment = nil

--- Resolve the target MD5, CodeUnit address, and optional function entry for comment edits.
local function resolve_comment_target(arg)
    local commands = require('ghidra-lsp.commands')
    local buffer_mod = require('ghidra-lsp.buffer')

    local opts = {}
    if type(arg) == 'string' and arg ~= '' then
        opts.address = arg
    elseif type(arg) == 'table' then
        opts = arg
    end

    local md5 = opts.md5 or commands.get_active_md5()
    if not md5 then
        error('No active Ghidra session')
    end
    md5 = md5:lower()

    if type(opts.uri) == 'string' and type(opts.position) == 'table' and not opts.explicit_address then
        local loc_arg = {
            uri = buffer_mod.canonicalize_uri(opts.uri),
            position = opts.position,
        }
        if opts.version ~= nil then
            loc_arg.version = opts.version
        end
        local loc = client.exec_sync('ghidra.location', loc_arg, 20000)
        if not loc.native then
            error('Upgrade ghidra-mcp and ghidra-lsp for native GUI comment locations.')
        end
        if not loc.code_unit_address then
            error('The selected position has no CodeUnit. Select a code token before editing comments.')
        end
        return md5, loc.code_unit_address, loc.entry
    end

    local cur_buf = vim.api.nvim_get_current_buf()
    local cur_name = vim.api.nvim_buf_get_name(cur_buf)

    if not opts.address and cur_name:match('^ghidra://[^/]+/function/') then
        local win = vim.fn.bufwinid(cur_buf)
        local pos = buffer_mod.cursor_utf16_position(win ~= -1 and win or 0)
        local loc = client.exec_sync('ghidra.location', {
            uri = buffer_mod.canonicalize_uri(cur_name),
            position = pos,
        }, 20000)
        if not loc.native then
            error('Upgrade ghidra-mcp and ghidra-lsp for native GUI comment locations.')
        end
        if loc.code_unit_address then
            return md5, loc.code_unit_address, loc.entry
        end
        if loc.address then
            opts.address = loc.address
        else
            error('The cursor has no valid code context. Select a code token before editing comments.')
        end
    end

    if not opts.address and cur_name:match('^ghidra%-listing://') then
        local row = vim.api.nvim_win_get_cursor(0)[1]
        local rows = vim.b[cur_buf].ghidra_listing_rows
        if type(rows) == 'table' and rows[row] and rows[row].address then
            opts.address = rows[row].address
        end
    elseif not opts.address and cur_name:match('^ghidra%-memory://') then
        local addr = vim.b[cur_buf].ghidra_memory_cursor_addr
        if type(addr) == 'string' and addr ~= '' then
            opts.address = addr
        end
    end

    local raw_addr = opts.address
    if not raw_addr or raw_addr == '' then
        return nil
    end

    local resolved = client.exec_sync('ghidra.resolveTarget', {
        md5 = md5,
        input = vim.trim(raw_addr),
    }, 20000)
    if type(resolved.address) ~= 'string' or resolved.address == '' then
        error('No CodeUnit found at address: ' .. tostring(raw_addr))
    end
    local fn_entry = type(resolved.entry) == 'string' and resolved.entry or nil
    return md5, resolved.address, fn_entry
end

--- Read all five Ghidra comment kinds at `addr`.
local function read_five_comments(md5, addr)
    local res = client.exec_sync('ghidra.commentsAt', { md5 = md5, address = addr }, 20000)
    local src = type(res.comments) == 'table' and res.comments or {}
    local out = {}
    for _, k in ipairs(M.COMMENT_KINDS) do
        out[k] = type(src[k]) == 'string' and src[k] or ''
    end
    return out
end

--- Open the five-kind floating comment editor with preloaded comment values.
local function open_comment_editor_with_state(md5, addr, entry, preferred_kind, initial_comments)
    if active_comment and active_comment.win and vim.api.nvim_win_is_valid(active_comment.win) then
        pcall(vim.api.nvim_win_close, active_comment.win, true)
    end

    local saved = vim.deepcopy(initial_comments)
    local drafts = vim.deepcopy(initial_comments)
    local active_kind = preferred_kind
    if not active_kind or not vim.tbl_contains(M.COMMENT_KINDS, active_kind) then
        active_kind = (entry and format.same_address(addr, entry)) and 'plate' or 'pre'
    end

    local buf = vim.api.nvim_create_buf(false, true)
    vim.bo[buf].buftype = 'acwrite'
    vim.bo[buf].bufhidden = 'wipe'
    vim.bo[buf].swapfile = false
    vim.bo[buf].filetype = 'markdown'
    pcall(vim.api.nvim_buf_set_name, buf, string.format('ghidra-comment://%s/%s', md5, addr))

    local columns = vim.o.columns
    local lines_total = vim.o.lines
    local max_width = math.max(40, columns - 4)
    local width = math.min(max_width, math.max(90, math.min(math.floor(columns * 0.74), 98)))
    local height = 8
    local win_pos = vim.api.nvim_win_get_position(0)
    local win_h = vim.api.nvim_win_get_height(0)
    local win_w = vim.api.nvim_win_get_width(0)
    local cursor = vim.api.nvim_win_get_cursor(0)
    local row = win_pos[1] + math.min(win_h - 1, math.max(1, cursor[1] - vim.fn.line('w0') + 2))
    if row + height + 3 > lines_total then
        row = math.max(1, lines_total - height - 4)
    end
    local max_col = math.max(1, columns - width - 2)
    local col = math.max(1, math.min(max_col, win_pos[2] + math.min(4, math.max(0, win_w - width))))

    local state = {
        md5 = md5,
        address = addr,
        entry = entry,
        buf = buf,
        win = nil,
        saved = saved,
        drafts = drafts,
        active_kind = active_kind,
        note = '',
        uncertain = false,
        switching = false,
    }
    active_comment = state

    local function any_dirty()
        for _, k in ipairs(M.COMMENT_KINDS) do
            if state.drafts[k] ~= state.saved[k] then
                return true
            end
        end
        return false
    end

    local function sync_current_draft()
        if not vim.api.nvim_buf_is_valid(buf) or state.switching then return end
        local buf_lines = vim.api.nvim_buf_get_lines(buf, 0, -1, false)
        state.drafts[state.active_kind] = table.concat(buf_lines, '\n')
    end

    --- Append a comment kind badge or pill to `chunks` with active and dirty styling.
    local function append_kind_pill(chunks, label, pill_hl, dirty)
        if dirty then
            table.insert(chunks, { '[' .. label, pill_hl })
            table.insert(chunks, { '*', 'GhidraTabDirty' })
            table.insert(chunks, { ']', pill_hl })
        else
            table.insert(chunks, { '[' .. label .. ']', pill_hl })
        end
    end

    --- Build border title chunks for the active comment address, kind, and save note.
    local function build_title()
        local kind = state.active_kind
        local label = M.KIND_LABELS[kind] or kind:upper()
        local dirty = state.drafts[kind] ~= state.saved[kind]
        local addr_label = format.display_address(addr)
        local function make_chunks(prefix, note_text)
            local chunks = {
                { ' ' .. prefix .. addr_label .. ' ', 'GhidraFloatTitle' },
            }
            append_kind_pill(chunks, label, 'GhidraTabActive', dirty)
            if note_text ~= '' then
                local note_hl = note_text == 'saved' and 'GhidraTabFilled' or 'GhidraTabDirty'
                table.insert(chunks, { ' │ ', 'GhidraStatusAccent' })
                table.insert(chunks, { note_text, note_hl })
            end
            table.insert(chunks, { ' ', 'GhidraFloatTitle' })
            return chunks
        end
        local chunks = make_chunks('Ghidra Comments · ', state.note)
        if ui.chunks_display_width(chunks) > width then
            chunks = make_chunks('Comments · ', state.note)
        end
        return chunks
    end

    --- Build border footer chunks for all five comment kind pills and shortcut hints.
    local function build_footer()
        local chunks = { { ' ', 'GhidraFloatFooter' } }
        for idx, k in ipairs(M.COMMENT_KINDS) do
            if idx > 1 then
                table.insert(chunks, { ' ', 'GhidraFloatFooter' })
            end
            local label = M.KIND_LABELS[k]
            local dirty = state.drafts[k] ~= state.saved[k]
            local nonempty = vim.trim(state.drafts[k]) ~= ''
            local pill_hl = 'GhidraFloatFooter'
            if k == state.active_kind then
                pill_hl = 'GhidraTabActive'
            elseif nonempty then
                pill_hl = 'GhidraTabFilled'
            end
            append_kind_pill(chunks, label, pill_hl, dirty)
        end
        local sep = ' │ '
        local full_hint = ':w/<C-s> save · <Tab> kind · q close '
        local compact_hint = '<C-s> · <Tab> · q '
        local pills_w = ui.chunks_display_width(chunks)
        local sep_w = vim.fn.strdisplaywidth(sep)
        if pills_w + sep_w + vim.fn.strdisplaywidth(full_hint) <= width then
            table.insert(chunks, { sep, 'GhidraStatusAccent' })
            table.insert(chunks, { full_hint, 'GhidraFloatFooter' })
        elseif pills_w + sep_w + vim.fn.strdisplaywidth(compact_hint) <= width then
            table.insert(chunks, { sep, 'GhidraStatusAccent' })
            table.insert(chunks, { compact_hint, 'GhidraFloatFooter' })
        else
            table.insert(chunks, { ' ', 'GhidraFloatFooter' })
        end
        return chunks
    end

    --- Refresh floating border title, footer chunks, and buffer modified state.
    local function refresh_chrome()
        ui.set_float_chrome(state.win, build_title(), build_footer())
        if vim.api.nvim_buf_is_valid(buf) then
            vim.bo[buf].modified = state.drafts[state.active_kind] ~= state.saved[state.active_kind]
        end
    end

    local function load_kind(kind)
        state.switching = true
        state.active_kind = kind
        state.note = state.uncertain and 'uncertain outcome · reopen before retry' or ''
        local text = state.drafts[kind] or ''
        local split_lines = text == '' and { '' } or vim.split(text, '\n', { plain = true })
        vim.api.nvim_buf_set_lines(buf, 0, -1, false, split_lines)
        vim.bo[buf].modified = state.drafts[kind] ~= state.saved[kind]
        state.switching = false
        refresh_chrome()
    end

    local function switch_tab(delta)
        sync_current_draft()
        local cur_idx = 1
        for i, k in ipairs(M.COMMENT_KINDS) do
            if k == state.active_kind then
                cur_idx = i
                break
            end
        end
        local next_idx = ((cur_idx - 1 + delta) % #M.COMMENT_KINDS) + 1
        load_kind(M.COMMENT_KINDS[next_idx])
    end

    local function save_current()
        sync_current_draft()
        if state.uncertain then
            error('Previous save has an uncertain outcome. Close and reopen comments before saving again.')
        end
        local kind = state.active_kind
        local text = state.drafts[kind] or ''
        if text == state.saved[kind] then
            vim.bo[buf].modified = false
            refresh_chrome()
            vim.notify('No changes in ' .. M.KIND_LABELS[kind] .. ' comment', vim.log.levels.INFO)
            return true
        end

        local ok, save_res = pcall(client.exec_sync, 'ghidra.saveComment', {
            md5 = md5,
            address = addr,
            kind = kind,
            text = text,
            expected = state.saved[kind],
        }, 30000)
        if not ok then
            local msg = tostring(save_res)
            if msg:match('changed outside') then
                state.note = 'NOT SAVED: changed externally'
            elseif msg:match('may have reached') or msg:match('persistence failed') or msg:match('saving.*failed') then
                state.uncertain = true
                state.note = 'uncertain outcome · reopen before retry'
            else
                state.note = 'save failed'
            end
            refresh_chrome()
            error(save_res)
        end

        local persisted_text = type(save_res) == 'table' and type(save_res.text) == 'string' and save_res.text or ''
        state.saved[kind] = persisted_text
        state.drafts[kind] = persisted_text
        state.note = 'saved'
        vim.bo[buf].modified = false
        refresh_chrome()
        vim.notify(string.format('Saved %s comment at %s', M.KIND_LABELS[kind], format.display_address(addr)), vim.log.levels.INFO)
        return true
    end

    local function close_float(force)
        sync_current_draft()
        if not force and any_dirty() then
            local choice = vim.fn.confirm('Discard unsaved comment drafts?', '&Keep editing\n&Discard', 1)
            if choice ~= 2 then return end
        end
        pcall(vim.cmd, 'stopinsert')
        if state.win and vim.api.nvim_win_is_valid(state.win) then
            pcall(vim.api.nvim_win_close, state.win, true)
        end
        if active_comment == state then
            active_comment = nil
        end
    end

    state.switch_tab = switch_tab
    state.set_kind = function(kind)
        sync_current_draft()
        load_kind(kind)
    end
    state.save = save_current
    state.close = close_float

    state.win = ui.open_float(buf, true, {
        relative = 'editor',
        row = row,
        col = col,
        width = width,
        height = height,
        style = 'minimal',
        border = 'rounded',
        zindex = 55,
    }, build_title(), build_footer())
    vim.wo[state.win].wrap = true
    vim.wo[state.win].linebreak = true

    local grp = vim.api.nvim_create_augroup('GhidraCommentFloat', { clear = true })
    vim.api.nvim_create_autocmd({ 'TextChanged', 'TextChangedI' }, {
        group = grp,
        buffer = buf,
        callback = function()
            if not state.switching and not state.uncertain and state.note ~= '' then
                state.note = ''
            end
            sync_current_draft()
            refresh_chrome()
        end,
    })
    vim.api.nvim_create_autocmd('BufWriteCmd', {
        group = grp,
        buffer = buf,
        callback = function()
            local ok, err = pcall(save_current)
            if not ok then
                vim.notify('Comment save failed: ' .. tostring(err), vim.log.levels.ERROR)
            end
        end,
    })

    local kopts = { buffer = buf, silent = true, nowait = true }
    vim.keymap.set('n', '<Tab>', function() switch_tab(1) end, kopts)
    vim.keymap.set('n', '<S-Tab>', function() switch_tab(-1) end, kopts)
    vim.keymap.set({ 'n', 'i' }, '<C-s>', function()
        pcall(vim.cmd, 'stopinsert')
        local ok, err = pcall(save_current)
        if not ok then
            vim.notify('Comment save failed: ' .. tostring(err), vim.log.levels.ERROR)
        end
    end, kopts)
    vim.keymap.set('n', 'q', function() close_float(false) end, kopts)
    vim.keymap.set('n', '<Esc>', function() close_float(false) end, kopts)

    load_kind(active_kind)
    return state
end

--- Open the inline 5-kind comment editor for the cursor location or given address.
function M.edit_comment(arg)
    if (type(arg) ~= 'string' or arg == '') and type(arg) ~= 'table' then
        local cur_name = vim.api.nvim_buf_get_name(0)
        if not cur_name:match('^ghidra://[^/]+/function/')
            and not cur_name:match('^ghidra%-listing://')
            and not cur_name:match('^ghidra%-memory://')
        then
            vim.ui.input({ prompt = 'Comment address (e.g. 0040115a or ram:0040115a): ' }, function(input)
                if input and vim.trim(input) ~= '' then
                    M.edit_comment({ address = vim.trim(input), explicit_address = true })
                end
            end)
            return nil
        end
    end

    local ok, md5, addr, entry = pcall(resolve_comment_target, arg)
    if not ok then
        vim.notify('Comment error: ' .. tostring(md5), vim.log.levels.ERROR)
        return nil
    end
    if not md5 or not addr then return nil end

    local comments_ok, comments = pcall(read_five_comments, md5, addr)
    if not comments_ok then
        vim.notify('Failed to read comments: ' .. tostring(comments), vim.log.levels.ERROR)
        return nil
    end

    local preferred = type(arg) == 'table' and (arg.kind or arg.commentType or arg.type) or nil
    return open_comment_editor_with_state(md5, addr, entry, preferred, comments)
end

--- Resolve the active MD5 and function entry address from arguments or the current buffer.
local function resolve_function_entry(arg)
    local commands = require('ghidra-lsp.commands')
    local md5 = (type(arg) == 'table' and arg.md5) or commands.get_active_md5()
    if not md5 then error('No active Ghidra session') end
    md5 = md5:lower()
    if type(arg) == 'table' and type(arg.entry) == 'string' and arg.entry ~= '' then
        return md5, arg.entry
    end
    local cur = vim.api.nvim_buf_get_name(0)
    local uri_entry = cur:match('^ghidra://[^/]+/function/(.*)$')
        or cur:match('^ghidra%-cfg://[^/]+/(.*)$')
        or cur:match('^ghidra%-callgraph://[^/]+/(.*)$')
    if uri_entry then
        return md5, format.url_decode(uri_entry)
    end
    return md5, nil
end

--- Open a floating form to edit function name, signature, attributes, and parameters.
function M.edit_function(arg)
    local ok, md5, entry = pcall(resolve_function_entry, arg)
    if not ok then
        vim.notify(tostring(md5), vim.log.levels.ERROR)
        return nil
    end
    if not entry then
        local meta = client.exec_sync('ghidra.programMeta', {
            md5 = md5,
            showTemplateArguments = client.config.template_arguments == 'show',
        }, 20000)
        local items = meta.functions or {}
        ui.pick(items, {
            prompt = 'Edit Function:',
            format_item = function(item)
                return string.format('%s  [%s]', tostring(item.displayName or item.name or ''), format.display_address(item.entry))
            end,
        }, function(choice)
            if choice then M.edit_function({ md5 = md5, entry = choice.entry }) end
        end)
        return nil
    end

    local proto = client.exec_sync('ghidra.functionPrototype', { md5 = md5, entry = entry }, 20000)
    local orig_snapshot = proto.original
    local params = type(proto.parameters) == 'table' and proto.parameters or {}

    local form_lines = {
        '# Ghidra Function Signature (' .. format.display_address(proto.entry or entry) .. ')',
        '# Edit values after the colon; use :w to save to Ghidra, q to close.',
        'name: ' .. tostring(proto.name or ''),
        'return_type: ' .. tostring(proto.returnType or 'void'),
        'calling_convention: ' .. tostring(proto.callingConvention or 'default'),
        'varargs: ' .. tostring(proto.hasVarArgs == true),
        'noreturn: ' .. tostring(proto.hasNoReturn == true),
        'inline: ' .. tostring(proto.isInline == true),
        'comment: ' .. tostring(proto.comment or ''):gsub('\n', '\\n'),
    }
    for i, p in ipairs(params) do
        local ord = tonumber(p.ordinal) or (i - 1)
        table.insert(form_lines, string.format('param.%d: %s | %s', ord, tostring(p.type or ''), tostring(p.name or '')))
    end

    local buf = vim.api.nvim_create_buf(false, true)
    vim.bo[buf].buftype = 'acwrite'
    vim.bo[buf].bufhidden = 'wipe'
    vim.bo[buf].swapfile = false
    vim.bo[buf].filetype = 'yaml'
    pcall(vim.api.nvim_buf_set_name, buf, string.format('ghidra-edit-fn://%s/%s', md5, entry))
    vim.api.nvim_buf_set_lines(buf, 0, -1, false, form_lines)
    vim.bo[buf].modified = false

    local columns = vim.o.columns
    local w = math.min(math.max(40, columns - 4), math.max(66, math.min(math.floor(columns * 0.65), 90)))
    local h = math.min(20, #form_lines + 2)
    local fn_name = tostring(proto.name or '')
    local addr_disp = format.display_address(proto.entry or entry)
    local fn_note = ''

    --- Build border title chunks for the floating function signature editor.
    local function build_fn_title()
        local function make_chunks(name_text)
            local chunks = {
                { ' Edit Function · ', 'GhidraFloatTitle' },
            }
            if name_text ~= '' and name_text ~= addr_disp then
                table.insert(chunks, { name_text .. ' ', 'GhidraFloatTitle' })
                table.insert(chunks, { '[' .. addr_disp .. ']', 'GhidraTabFilled' })
            else
                table.insert(chunks, { addr_disp, 'GhidraFloatTitle' })
            end
            if vim.api.nvim_buf_is_valid(buf) and vim.bo[buf].modified then
                table.insert(chunks, { ' ', 'GhidraFloatTitle' })
                table.insert(chunks, { '[*]', 'GhidraTabDirty' })
            end
            if fn_note ~= '' then
                local note_hl = fn_note == 'saved' and 'GhidraTabFilled' or 'GhidraTabDirty'
                table.insert(chunks, { ' │ ', 'GhidraStatusAccent' })
                table.insert(chunks, { fn_note, note_hl })
            end
            table.insert(chunks, { ' ', 'GhidraFloatTitle' })
            return chunks
        end
        local display_name = fn_name
        local chunks = make_chunks(display_name)
        if ui.chunks_display_width(chunks) > w and display_name ~= '' then
            display_name = format.brief_templates(display_name)
            chunks = make_chunks(display_name)
            local overflow = ui.chunks_display_width(chunks) - w
            if overflow > 0 then
                local target_w = math.max(8, vim.fn.strdisplaywidth(display_name) - overflow)
                chunks = make_chunks(ui.truncate_display(display_name, target_w))
            end
        end
        return chunks
    end

    --- Build border footer chunks for the floating function signature editor.
    local function build_fn_footer()
        return {
            { ' :w', 'GhidraStatusAccent' },
            { ' save to Ghidra', 'GhidraFloatFooter' },
            { ' │ ', 'GhidraStatusAccent' },
            { 'q', 'GhidraStatusAccent' },
            { ' close ', 'GhidraFloatFooter' },
        }
    end

    local win = ui.open_float(buf, true, {
        relative = 'editor',
        row = math.max(1, math.floor((vim.o.lines - h) / 2)),
        col = math.max(1, math.floor((columns - w) / 2)),
        width = w,
        height = h,
        style = 'minimal',
        border = 'rounded',
        zindex = 55,
    }, build_fn_title(), build_fn_footer())

    local function save_fn_form()
        local lines = vim.api.nvim_buf_get_lines(buf, 0, -1, false)
        local kv = {}
        local edited_params = {}
        for _, line in ipairs(lines) do
            if not line:match('^%s*#') and vim.trim(line) ~= '' then
                local idx_s, spec = line:match('^param%.(%d+):%s*(.*)$')
                if idx_s then
                    local tpart, npart = spec:match('^(.-)%s*|%s*(.-)$')
                    if not tpart or not npart then
                        error('Invalid parameter syntax (expected "param.N: <type> | <name>")')
                    end
                    local orig_idx = tonumber(idx_s)
                    local item = {
                        ordinal = #edited_params,
                        type = vim.trim(tpart),
                        name = vim.trim(npart),
                    }
                    if orig_idx and orig_idx < #params then
                        item._original = orig_idx
                    end
                    table.insert(edited_params, item)
                else
                    local k, v = line:match('^([%w_]+):%s*(.*)$')
                    if k then kv[k] = v end
                end
            end
        end

        local comment_val = kv.comment and kv.comment:gsub('\\n', '\n') or ''
        client.exec_sync('ghidra.saveFunctionPrototype', {
            md5 = md5,
            entry = proto.entry or entry,
            original = orig_snapshot,
            name = vim.trim(kv.name or proto.name or ''),
            returnType = vim.trim(kv.return_type or proto.returnType or 'void'),
            callingConvention = vim.trim(kv.calling_convention or proto.callingConvention or 'default'),
            hasVarArgs = kv.varargs == 'true',
            hasNoReturn = kv.noreturn == 'true',
            isInline = kv.inline == 'true',
            comment = comment_val,
            parameters = edited_params,
        }, 30000)

        local updated = client.exec_sync('ghidra.functionPrototype', { md5 = md5, entry = proto.entry or entry }, 20000)
        orig_snapshot = updated.original
        params = type(updated.parameters) == 'table' and updated.parameters or {}
        fn_name = tostring(updated.name or fn_name)
        fn_note = 'saved'
        vim.bo[buf].modified = false
        ui.set_float_chrome(win, build_fn_title(), build_fn_footer())
        vim.notify('Function signature saved to Ghidra', vim.log.levels.INFO)
        return true
    end

    local fn_grp = vim.api.nvim_create_augroup('GhidraFunctionFloat', { clear = true })
    vim.api.nvim_create_autocmd({ 'TextChanged', 'TextChangedI' }, {
        group = fn_grp,
        buffer = buf,
        callback = function()
            fn_note = ''
            ui.set_float_chrome(win, build_fn_title(), build_fn_footer())
        end,
    })
    vim.api.nvim_create_autocmd('BufWriteCmd', {
        group = fn_grp,
        buffer = buf,
        callback = function()
            local call_ok, call_err = pcall(save_fn_form)
            if not call_ok then
                fn_note = 'save failed'
                ui.set_float_chrome(win, build_fn_title(), build_fn_footer())
                vim.notify('Failed to save function signature: ' .. tostring(call_err), vim.log.levels.ERROR)
            end
        end,
    })

    vim.keymap.set('n', 'q', function()
        if vim.api.nvim_win_is_valid(win) then vim.api.nvim_win_close(win, true) end
    end, { buffer = buf, silent = true })

    return { buf = buf, win = win, save = save_fn_form }
end

--- Pick a parameter or local variable and update its name and data type.
function M.edit_variables(arg)
    local ok, md5, entry = pcall(resolve_function_entry, arg)
    if not ok then
        vim.notify(tostring(md5), vim.log.levels.ERROR)
        return
    end
    if not entry then
        vim.notify('Open a function buffer before editing its variables', vim.log.levels.WARN)
        return
    end

    local proto = client.exec_sync('ghidra.functionPrototype', { md5 = md5, entry = entry }, 20000)
    local vars = {}
    for _, p in ipairs(proto.parameters or {}) do
        table.insert(vars, { kind = 'parameter', raw = p })
    end
    for idx, v in ipairs(proto.locals or {}) do
        table.insert(vars, { kind = 'local', raw = v, index = idx - 1 })
    end
    if #vars == 0 then
        vim.notify('No parameters or local variables in this function', vim.log.levels.INFO)
        return
    end

    ui.pick(vars, {
        prompt = 'Edit Parameter / Local Variable:',
        format_item = function(item)
            local r = item.raw
            local tag = item.kind == 'parameter' and ('param ' .. tostring(r.ordinal or 0)) or 'local'
            local storage = tostring(r.storage or '')
            return string.format('[%s] %s %s  (%s)', tag, tostring(r.type or ''), tostring(r.name or ''), storage)
        end,
    }, function(choice)
        if not choice then return end
        local r = choice.raw
        local orig_type = tostring(r.type or '')
        vim.ui.input({ prompt = 'New name: ', default = tostring(r.name or '') }, function(new_name)
            if not new_name or vim.trim(new_name) == '' then return end
            new_name = vim.trim(new_name)
            vim.ui.input({ prompt = 'New data type: ', default = orig_type }, function(new_type)
                if not new_type or vim.trim(new_type) == '' then return end
                new_type = vim.trim(new_type)
                local payload = {
                    md5 = md5,
                    entry = proto.entry or entry,
                    original = proto.original,
                }
                if choice.kind == 'parameter' then
                    payload.parameters = { { ordinal = r.ordinal, name = new_name, type = new_type } }
                else
                    payload.locals = { {
                        _original = choice.index,
                        originalName = r.name,
                        storage = r.storage,
                        name = new_name,
                        type = new_type,
                    } }
                end
                local save_ok, save_err = pcall(client.exec_sync, 'ghidra.saveVariables', payload, 30000)
                if not save_ok then
                    vim.notify('Failed to update variable: ' .. tostring(save_err), vim.log.levels.ERROR)
                    return
                end
                vim.notify(string.format('Updated %s %s in %s', choice.kind, new_name, tostring(proto.name or entry)), vim.log.levels.INFO)
            end)
        end)
    end)
end

return M
