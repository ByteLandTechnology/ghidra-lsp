-- Copyright 2026 ByteLand Technology Limited
-- SPDX-License-Identifier: MIT

-- Inline 5-kind comment float editor, C header importer, and function/variable mutation forms.
local client = require('ghidra-lsp.client')
local comments = require('ghidra-lsp.comments')
local format = require('ghidra-lsp.format')
local ui = require('ghidra-lsp.ui')

local M = {}

M.COMMENT_KINDS = comments.COMMENT_KINDS
M.KIND_LABELS = comments.KIND_LABELS
M.edit_comment = comments.edit_comment

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

    --- Render the YAML-style function signature form lines from a prototype snapshot.
    local function render_fn_lines(snapshot, param_list)
        local out = {
            '# Ghidra Function Signature (' .. format.display_address(snapshot.entry or entry) .. ')',
            '# Edit values after colon; set signature for one-line C, <M-k>/<M-j> move param, :w save, q close.',
            'signature: ',
            'name: ' .. tostring(snapshot.name or ''),
            'return_type: ' .. tostring(snapshot.returnType or 'void'),
            'calling_convention: ' .. tostring(snapshot.callingConvention or 'default'),
            'varargs: ' .. tostring(snapshot.hasVarArgs == true),
            'noreturn: ' .. tostring(snapshot.hasNoReturn == true),
            'inline: ' .. tostring(snapshot.isInline == true),
            'comment: ' .. tostring(snapshot.comment or ''):gsub('\n', '\\n'),
        }
        for i, p in ipairs(param_list) do
            local ord = tonumber(p.ordinal) or (i - 1)
            table.insert(out, string.format('param.%d: %s | %s', ord, tostring(p.type or ''), tostring(p.name or '')))
        end
        return out
    end

    local form_lines = render_fn_lines(proto, params)

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
            { ' save', 'GhidraFloatFooter' },
            { ' │ ', 'GhidraStatusAccent' },
            { '<M-k>/<M-j>', 'GhidraStatusAccent' },
            { ' move param', 'GhidraFloatFooter' },
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

    --- Swap the parameter line under the cursor up (`-1`) or down (`1`).
    local function move_param_line(delta)
        if not vim.api.nvim_win_is_valid(win) then return end
        local row = vim.api.nvim_win_get_cursor(win)[1]
        local lines = vim.api.nvim_buf_get_lines(buf, 0, -1, false)
        local cur = lines[row]
        local target = row + delta
        if not cur or not cur:match('^param[%.%:]') then return end
        if target < 1 or target > #lines or not lines[target]:match('^param[%.%:]') then return end
        lines[row], lines[target] = lines[target], lines[row]
        vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
        vim.api.nvim_win_set_cursor(win, { target, 0 })
    end

    local function save_fn_form()
        local lines = vim.api.nvim_buf_get_lines(buf, 0, -1, false)
        local kv = {}
        local edited_params = {}
        local claimed = {}
        for _, line in ipairs(lines) do
            if not line:match('^%s*#') and vim.trim(line) ~= '' then
                local idx_s, spec = line:match('^param%.(%d+):%s*(.*)$')
                if not idx_s then
                    spec = line:match('^param:%s*(.*)$')
                end
                if spec then
                    local tpart, npart = spec:match('^(.-)%s*|%s*(.-)$')
                    if not tpart or not npart then
                        error('Invalid parameter syntax (expected "param.N: <type> | <name>" or "param: <type> | <name>")')
                    end
                    local orig_idx = idx_s and tonumber(idx_s) or nil
                    local item = {
                        ordinal = #edited_params,
                        type = vim.trim(tpart),
                        name = vim.trim(npart),
                    }
                    if orig_idx and orig_idx >= 0 and orig_idx < #params and not claimed[orig_idx] then
                        claimed[orig_idx] = true
                        item._original = orig_idx
                    else
                        item._original = ''
                    end
                    table.insert(edited_params, item)
                else
                    local k, v = line:match('^([%w_]+):%s*(.*)$')
                    if k then kv[k] = v end
                end
            end
        end

        local sig = vim.trim(kv.signature or '')
        local comment_val = kv.comment and kv.comment:gsub('\\n', '\n') or ''
        local payload = {
            md5 = md5,
            entry = proto.entry or entry,
            original = orig_snapshot,
            name = vim.trim(kv.name or proto.name or ''),
            hasVarArgs = kv.varargs == 'true',
            hasNoReturn = kv.noreturn == 'true',
            isInline = kv.inline == 'true',
            comment = comment_val,
        }
        if sig ~= '' then
            if #sig > 8192 then
                error('C signature must not exceed 8192 UTF-8 bytes')
            end
            payload.signature = sig
        else
            payload.returnType = vim.trim(kv.return_type or proto.returnType or 'void')
            payload.callingConvention = vim.trim(kv.calling_convention or proto.callingConvention or 'default')
            payload.parameters = edited_params
        end
        client.exec_sync('ghidra.saveFunctionPrototype', payload, 30000)

        local updated = client.exec_sync('ghidra.functionPrototype', { md5 = md5, entry = proto.entry or entry }, 20000)
        proto = updated
        orig_snapshot = updated.original
        params = type(updated.parameters) == 'table' and updated.parameters or {}
        fn_name = tostring(updated.name or fn_name)
        local refreshed_lines = render_fn_lines(updated, params)
        vim.api.nvim_buf_set_lines(buf, 0, -1, false, refreshed_lines)
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

    vim.keymap.set('n', '<M-k>', function() move_param_line(-1) end, { buffer = buf, silent = true })
    vim.keymap.set('n', '<M-j>', function() move_param_line(1) end, { buffer = buf, silent = true })
    vim.keymap.set('n', '<A-Up>', function() move_param_line(-1) end, { buffer = buf, silent = true })
    vim.keymap.set('n', '<A-Down>', function() move_param_line(1) end, { buffer = buf, silent = true })
    vim.keymap.set('n', 'q', function()
        if vim.api.nvim_win_is_valid(win) then vim.api.nvim_win_close(win, true) end
    end, { buffer = buf, silent = true })

    return { buf = buf, win = win, save = save_fn_form, move_param = move_param_line }
end

--- Format a structured VariableStorageReference or string into a compact label.
local function format_storage_label(st)
    if st == nil or st == vim.NIL then return '' end
    if type(st) == 'string' then return st end
    if type(st) ~= 'table' then return '' end
    if type(st.serialization) == 'string' and st.serialization ~= '' then return st.serialization end
    if type(st.register) == 'string' and st.register ~= '' then return st.register end
    if st.stack_offset ~= nil and st.stack_offset ~= vim.NIL then
        return string.format('Stack[%s]', tostring(st.stack_offset))
    end
    return type(st.kind) == 'string' and st.kind or ''
end

--- Open a floating C header scratch buffer and import declarations through `data_type.parse_c` on `:w`.
function M.parse_c(arg)
    local commands = require('ghidra-lsp.commands')
    local md5 = (type(arg) == 'table' and arg.md5) or commands.get_active_md5()
    if not md5 then
        vim.notify('No active Ghidra session', vim.log.levels.WARN)
        return nil
    end
    md5 = md5:lower()

    local raw_cat = (type(arg) == 'table' and arg.category_path)
        or (type(arg) == 'string' and vim.trim(arg) ~= '' and vim.trim(arg))
        or '/'
    local init_cat = raw_cat:sub(1, 1) == '/' and raw_cat or ('/' .. raw_cat)

    local buf = vim.api.nvim_create_buf(false, true)
    vim.bo[buf].buftype = 'acwrite'
    vim.bo[buf].bufhidden = 'wipe'
    vim.bo[buf].swapfile = false
    vim.bo[buf].filetype = 'c'
    pcall(vim.api.nvim_buf_set_name, buf, string.format('ghidra-parse-c://%s', md5))
    vim.api.nvim_buf_set_lines(buf, 0, -1, false, {
        '// category_path: ' .. init_cat,
        '// Write C declarations (struct, union, enum, typedef, function) and run :w to import.',
        '',
    })
    vim.bo[buf].modified = false

    local columns = vim.o.columns
    local w = math.min(math.max(44, columns - 4), math.max(70, math.min(math.floor(columns * 0.7), 96)))
    local h = math.min(20, math.max(12, math.floor(vim.o.lines * 0.55)))
    local note = ''

    local function build_title()
        local chunks = {
            { ' Import C Header · ', 'GhidraFloatTitle' },
            { md5:sub(1, 8), 'GhidraTabFilled' },
        }
        if vim.api.nvim_buf_is_valid(buf) and vim.bo[buf].modified then
            table.insert(chunks, { ' ', 'GhidraFloatTitle' })
            table.insert(chunks, { '[*]', 'GhidraTabDirty' })
        end
        if note ~= '' then
            local hl = note:match('^imported') and 'GhidraTabFilled' or 'GhidraTabDirty'
            table.insert(chunks, { ' │ ', 'GhidraStatusAccent' })
            table.insert(chunks, { note, hl })
        end
        table.insert(chunks, { ' ', 'GhidraFloatTitle' })
        return chunks
    end

    local function build_footer()
        return {
            { ' :w', 'GhidraStatusAccent' },
            { ' parse & import', 'GhidraFloatFooter' },
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
    }, build_title(), build_footer())

    local function save_parse_c()
        local lines = vim.api.nvim_buf_get_lines(buf, 0, -1, false)
        local category_path = init_cat
        local body = {}
        for _, line in ipairs(lines) do
            local cat_match = line:match('^%s*//%s*category_path:%s*(.-)%s*$')
            if cat_match and cat_match ~= '' then
                category_path = cat_match:sub(1, 1) == '/' and cat_match or ('/' .. cat_match)
            elseif not line:match('^%s*//%s*Write C declarations') then
                table.insert(body, line)
            end
        end
        local c_source = vim.trim(table.concat(body, '\n'))
        if c_source == '' then
            error('Enter at least one C declaration before importing')
        end
        if #c_source > 65536 then
            error('C declarations must not exceed 65536 UTF-8 bytes')
        end
        local res = client.exec_sync('ghidra.mutate', {
            md5 = md5,
            domain = 'data_type',
            operation = 'parse_c',
            params = {
                declarations = c_source,
                category_path = category_path,
            },
        }, 30000)
        local r = (type(res) == 'table' and type(res.result) == 'table') and res.result or {}
        local dts = type(r.items) == 'table' and r.items or (type(r.data_types) == 'table' and r.data_types or {})
        note = string.format('imported %d', #dts)
        vim.bo[buf].modified = false
        ui.set_float_chrome(win, build_title(), build_footer())
        vim.notify(string.format('Imported %d C data type(s) into %s', #dts, category_path), vim.log.levels.INFO)
        return res
    end

    local grp = vim.api.nvim_create_augroup('GhidraParseCFloat', { clear = true })
    vim.api.nvim_create_autocmd({ 'TextChanged', 'TextChangedI' }, {
        group = grp,
        buffer = buf,
        callback = function()
            note = ''
            ui.set_float_chrome(win, build_title(), build_footer())
        end,
    })
    vim.api.nvim_create_autocmd('BufWriteCmd', {
        group = grp,
        buffer = buf,
        callback = function()
            local call_ok, call_err = pcall(save_parse_c)
            if not call_ok then
                note = 'import failed'
                ui.set_float_chrome(win, build_title(), build_footer())
                vim.notify('Failed to import C declarations: ' .. tostring(call_err), vim.log.levels.ERROR)
            end
        end,
    })

    vim.keymap.set({ 'n', 'i' }, '<C-s>', '<Cmd>write<CR>', { buffer = buf, silent = true })
    vim.keymap.set('n', 'q', function()
        if vim.api.nvim_win_is_valid(win) then vim.api.nvim_win_close(win, true) end
    end, { buffer = buf, silent = true })

    return { buf = buf, win = win, save = save_parse_c }
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
    for _, v in ipairs(proto.locals or {}) do
        table.insert(vars, { kind = 'local', raw = v })
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
            local storage = format_storage_label(r.storage)
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
                    payload.locals = { { originalName = r.name, name = new_name, type = new_type } }
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
