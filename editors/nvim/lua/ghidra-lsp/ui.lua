-- Copyright 2026 ByteLand Technology Limited
-- SPDX-License-Identifier: MIT

-- Floating filter picker, Quickfix formatter, and buffer statusline titles.
local format = require('ghidra-lsp.format')

local M = {}

--- Window highlight mapping applied to floating Ghidra windows.
M.FLOAT_WINHIGHLIGHT = table.concat({
    'Normal:NormalFloat',
    'FloatBorder:GhidraFloatBorder',
    'FloatTitle:GhidraFloatTitle',
    'FloatFooter:GhidraFloatFooter',
}, ',')

--- Default theme-linked highlight targets for Ghidra UI elements.
local HIGHLIGHT_LINKS = {
    --- Floating window border highlight group.
    GhidraFloatBorder = 'FloatBorder',
    --- Floating window title highlight group.
    GhidraFloatTitle = 'Title',
    --- Floating window footer highlight group.
    GhidraFloatFooter = 'Comment',
    --- Active tab pill highlight group.
    GhidraTabActive = 'PmenuSel',
    --- Dirty tab indicator highlight group.
    GhidraTabDirty = 'DiagnosticWarn',
    --- Populated inactive tab pill highlight group.
    GhidraTabFilled = 'DiagnosticInfo',
    --- Separator and hotkey accent highlight group.
    GhidraStatusAccent = 'Special',
}

local initial_ui_select = vim.ui.select
local active_picker = nil

--- Define default theme-linked highlight groups for Ghidra floating windows.
function M.setup_highlights()
    for group, target in pairs(HIGHLIGHT_LINKS) do
        vim.api.nvim_set_hl(0, group, { link = target, default = true })
    end
end

--- Define missing Ghidra highlight groups before opening a floating window.
function M.ensure_highlights()
    for group, _ in pairs(HIGHLIGHT_LINKS) do
        if vim.fn.hlexists(group) == 0 then
            M.setup_highlights()
            return
        end
    end
end

--- Return the total terminal display width of a border chunk list.
function M.chunks_display_width(chunks)
    local total = 0
    for _, chunk in ipairs(chunks or {}) do
        if type(chunk) == 'table' and type(chunk[1]) == 'string' then
            total = total + vim.fn.strdisplaywidth(chunk[1])
        end
    end
    return total
end

--- Truncate `text` with an ellipsis when its display width exceeds `max_width`.
function M.truncate_display(text, max_width)
    local value = tostring(text or '')
    if max_width <= 1 or vim.fn.strdisplaywidth(value) <= max_width then
        return value
    end
    local limit = max_width - 1
    local count = vim.fn.strchars(value)
    local out = {}
    local used = 0
    for i = 0, count - 1 do
        local ch = vim.fn.strcharpart(value, i, 1)
        local w = vim.fn.strdisplaywidth(ch)
        if used + w > limit then
            break
        end
        table.insert(out, ch)
        used = used + w
    end
    return table.concat(out) .. '…'
end

--- Attach version-compatible title and footer chunk lists to a float config table.
function M.apply_float_chrome(cfg, title_chunks, footer_chunks)
    if title_chunks ~= nil and vim.fn.has('nvim-0.9') == 1 then
        cfg.title = title_chunks
        cfg.title_pos = cfg.title_pos or 'left'
    else
        cfg.title = nil
        cfg.title_pos = nil
    end
    if footer_chunks ~= nil and vim.fn.has('nvim-0.10') == 1 then
        cfg.footer = footer_chunks
        cfg.footer_pos = cfg.footer_pos or 'left'
    else
        cfg.footer = nil
        cfg.footer_pos = nil
    end
    return cfg
end

--- Open a floating window with theme-linked highlights and border chrome chunks.
function M.open_float(buf, enter, cfg, title_chunks, footer_chunks)
    M.ensure_highlights()
    local win_cfg = M.apply_float_chrome(vim.deepcopy(cfg), title_chunks, footer_chunks)
    local win = vim.api.nvim_open_win(buf, enter, win_cfg)
    if vim.api.nvim_win_is_valid(win) then
        vim.wo[win].winhighlight = M.FLOAT_WINHIGHLIGHT
    end
    return win
end

--- Update border title and footer chunks on an open floating window safely.
function M.set_float_chrome(win, title_chunks, footer_chunks)
    if not win or not vim.api.nvim_win_is_valid(win) then
        return
    end
    local cfg = M.apply_float_chrome({}, title_chunks, footer_chunks)
    if next(cfg) ~= nil then
        pcall(vim.api.nvim_win_set_config, win, cfg)
    end
end

--- Return true when `name` uses a Ghidra virtual buffer URI scheme.
local function is_ghidra_buf_name(name)
    if type(name) ~= 'string' then return false end
    return name:match('^ghidra://') ~= nil
        or name:match('^ghidra%-type://') ~= nil
        or name:match('^ghidra%-overview://') ~= nil
        or name:match('^ghidra%-listing://') ~= nil
        or name:match('^ghidra%-memory://') ~= nil
        or name:match('^ghidra%-string://') ~= nil
        or name:match('^ghidra%-cfg://') ~= nil
        or name:match('^ghidra%-callgraph://') ~= nil
end

--- Append the program name to `base` when more than one session is open.
local function with_program_suffix(base, md5, include_program, client_mod)
    local prog = client_mod.session_names[md5]
    if (include_program or client_mod.active_program_count() > 1) and prog and prog ~= '' then
        return base .. ' · ' .. prog
    end
    return base
end

--- Format a Ghidra virtual URI as a short human-readable label.
function M.short_uri(uri, include_program)
    if type(uri) ~= 'string' or uri == '' then return '' end
    local client_mod = require('ghidra-lsp.client')
    local md5, suffix = uri:match('^ghidra://([^/]+)/(.*)$')
    if md5 and suffix then
        md5 = md5:lower()
        local prog = client_mod.session_names[md5]
        local show_prog = include_program
        if show_prog == nil then
            show_prog = client_mod.active_program_count() > 1
        end
        local base
        local kind, rest = suffix:match('^([^/]+)/(.*)$')
        local decoded = format.url_decode(rest or '')
        if kind == 'function' then
            local fns = client_mod.function_names[md5]
            local fn_name = fns and (fns[decoded:lower()] or fns[decoded])
            local addr_disp = format.display_address(decoded)
            if fn_name and fn_name ~= '' then
                base = string.format('%s · %s', fn_name, addr_disp)
            else
                base = addr_disp
            end
        elseif kind == 'type' then
            local clean = decoded:gsub('%.md$', '')
            local leaf = clean:match('([^/]+)$') or clean
            local cat = clean:match('^(.*)/[^/]+$')
            if cat and cat ~= '' and cat ~= '/' then
                base = string.format('Type · %s (%s)', leaf, cat)
            else
                base = 'Type · ' .. leaf
            end
        elseif kind == 'symbol' then
            base = 'Symbol · #' .. decoded
        elseif kind == 'references' then
            base = 'References · #' .. decoded
        else
            base = suffix
        end
        if show_prog and prog and prog ~= '' then
            return base .. ' · ' .. prog
        end
        return base
    end

    local ov_md5 = uri:match('^ghidra%-overview://([^/]+)')
    if ov_md5 then
        local prog = client_mod.session_names[ov_md5:lower()] or ov_md5:sub(1, 8)
        return 'Overview · ' .. prog
    end

    local l_md5, l_addr = require('ghidra-lsp.buffer').parse_listing_uri(uri)
    if l_md5 and l_addr then
        local base = 'Listing · ' .. format.display_address(l_addr)
        return with_program_suffix(base, l_md5, include_program, client_mod)
    end

    local m_md5, m_addr = uri:match('^ghidra%-memory://([^/]+)/(.*)$')
    if m_md5 then
        local base = 'Memory · ' .. format.display_address(format.url_decode(m_addr))
        return with_program_suffix(base, m_md5:lower(), include_program, client_mod)
    end

    local s_md5, s_addr = uri:match('^ghidra%-string://([^/]+)/string/(.*)$')
    if s_md5 then
        local base = 'String · ' .. format.display_address(format.url_decode(s_addr))
        return with_program_suffix(base, s_md5:lower(), include_program, client_mod)
    end

    local c_md5, c_entry = uri:match('^ghidra%-cfg://([^/]+)/(.*)$')
    if c_md5 then
        local decoded = format.url_decode(c_entry)
        local key = c_md5:lower()
        local fns = client_mod.function_names[key]
        local fn_name = fns and (fns[decoded:lower()] or fns[decoded])
        local base = 'CFG · ' .. (fn_name and (fn_name .. ' · ' .. format.display_address(decoded)) or format.display_address(decoded))
        return with_program_suffix(base, key, include_program, client_mod)
    end

    local cg_md5, cg_entry = uri:match('^ghidra%-callgraph://([^/]+)/(.*)$')
    if cg_md5 then
        local decoded = format.url_decode(cg_entry)
        local key = cg_md5:lower()
        local fns = client_mod.function_names[key]
        local fn_name = fns and (fns[decoded:lower()] or fns[decoded])
        local base = 'Call Graph · ' .. (fn_name and (fn_name .. ' · ' .. format.display_address(decoded)) or format.display_address(decoded))
        return with_program_suffix(base, key, include_program, client_mod)
    end

    local t_md5, t_raw = uri:match('^ghidra%-type://([^/]+)(/.*)$')
    if t_md5 and t_raw then
        local clean = format.url_decode(t_raw):gsub('%?.*$', ''):gsub('%.ghidra%-type$', ''):gsub('%.jsonc$', '')
        local leaf = clean:match('([^/]+)$') or clean
        local cat = clean:match('^(.*)/[^/]+$')
        local base
        if cat and cat ~= '' and cat ~= '/' then
            base = string.format('Type · %s (%s)', leaf, cat)
        else
            base = 'Type · ' .. leaf
        end
        return with_program_suffix(base, t_md5:lower(), include_program, client_mod)
    end

    return uri
end

--- Build the statusline title for a Ghidra buffer.
function M.buffer_title(bufnr)
    if not vim.api.nvim_buf_is_valid(bufnr) then return '' end
    local name = vim.api.nvim_buf_get_name(bufnr)
    if not is_ghidra_buf_name(name) then return '' end

    local client_mod = require('ghidra-lsp.client')
    local buffer_mod = require('ghidra-lsp.buffer')
    local base = M.short_uri(name)

    local md5 = name:match('^ghidra://([^/]+)/')
    if md5 and name:match('^ghidra://[^/]+/function/') then
        local plan = client_mod.pending_rename[md5:lower()]
        if plan and (plan.applied or plan.patched) then
            local canon_name = buffer_mod.canonicalize_uri(name)
            local canon_origin = plan.origin and buffer_mod.canonicalize_uri(plan.origin) or ''
            local pair = string.format('%s -> %s', tostring(plan.oldName or '?'), tostring(plan.newName or '?'))
            if canon_origin == canon_name then
                return string.format('%s  [pending rename: %s · :w save · :GhidraDiscardRename]', base, pair)
            else
                return string.format('%s  [pending rename: %s · :GhidraOrigin to save]', base, pair)
            end
        end
    end

    if name:match('^ghidra%-type://') then
        local st = vim.b[bufnr].ghidra_type_state
        if type(st) == 'table' and st.uncertain then
            return base .. '  [uncertain · :GhidraRefresh]'
        end
    end

    if vim.bo[bufnr].readonly or not vim.bo[bufnr].modifiable then
        return base .. '  [RO]'
    end
    return base
end

--- Return true when `stl` is empty or the built-in Neovim default statusline.
local function is_default_statusline(stl)
    if type(stl) ~= 'string' or stl == '' then
        return true
    end
    -- Neovim 0.12+ sets a built-in default global statusline expression referencing vim._core.util.
    return stl:find('vim%._core%.util', 1) ~= nil
end

--- Update buffer titles and managed window statuslines across Ghidra buffers.
function M.refresh_statuslines()
    local default_stl = is_default_statusline(vim.go.statusline)
    for _, bufnr in ipairs(vim.api.nvim_list_bufs()) do
        if vim.api.nvim_buf_is_valid(bufnr) then
            local name = vim.api.nvim_buf_get_name(bufnr)
            if is_ghidra_buf_name(name) then
                vim.b[bufnr].ghidra_title = M.buffer_title(bufnr)
            end
        end
    end
    for _, win in ipairs(vim.api.nvim_list_wins()) do
        if vim.api.nvim_win_is_valid(win) then
            local b = vim.api.nvim_win_get_buf(win)
            local name = vim.api.nvim_buf_get_name(b)
            if is_ghidra_buf_name(name) then
                if default_stl or vim.w[win].ghidra_managed_stl then
                    vim.w[win].ghidra_managed_stl = true
                    vim.wo[win].statusline = "  %{get(b:,'ghidra_title',expand('%:t'))}%=%l:%c  %P "
                end
            elseif vim.w[win].ghidra_managed_stl then
                vim.w[win].ghidra_managed_stl = false
                vim.wo[win].statusline = ''
            end
        end
    end
end

--- Format quickfix and location list entries for Ghidra virtual buffers.
function M.quickfix_text_func(info)
    local items
    if info.quickfix == 1 then
        items = vim.fn.getqflist({ id = info.id, items = 0 }).items or {}
    else
        items = vim.fn.getloclist(info.winid, { id = info.id, items = 0 }).items or {}
    end
    local out = {}
    local start_idx = math.max(1, tonumber(info.start_idx) or 1)
    local end_idx = math.min(#items, tonumber(info.end_idx) or #items)
    for i = start_idx, end_idx do
        local item = items[i]
        local bname = ''
        if item.bufnr and item.bufnr > 0 and vim.api.nvim_buf_is_valid(item.bufnr) then
            bname = vim.api.nvim_buf_get_name(item.bufnr)
        elseif type(item.user_data) == 'table' and type(item.user_data.uri) == 'string' then
            bname = item.user_data.uri
        end
        local text = vim.trim((item.text or ''):gsub('%s+', ' '))
        if is_ghidra_buf_name(bname) then
            local label = M.short_uri(bname)
            if item.lnum and item.lnum > 0 then
                table.insert(out, string.format('%s │ %d:%d │ %s', label, item.lnum, math.max(1, item.col or 1), text))
            else
                table.insert(out, string.format('%s │ %s', label, text))
            end
        else
            local fname = bname ~= '' and vim.fn.fnamemodify(bname, ':~:.') or ''
            if item.lnum and item.lnum > 0 then
                table.insert(out, string.format('%s|%d col %d| %s', fname, item.lnum, math.max(1, item.col or 1), text))
            else
                table.insert(out, string.format('%s|| %s', fname, text))
            end
        end
    end
    return out
end

--- Register quickfixtextfunc when no user formatter is set.
function M.install_quickfix_formatter()
    if vim.o.quickfixtextfunc == '' then
        vim.o.quickfixtextfunc = "v:lua.require'ghidra-lsp.ui'.quickfix_text_func"
    end
end

--- Show an interactive floating filter picker, or fall back to vim.ui.select when headless or overridden.
function M.pick(items, opts, on_choice)
    opts = opts or {}
    local list = items or {}
    if #list == 0 then
        if on_choice then on_choice(nil) end
        return
    end

    local headless = #vim.api.nvim_list_uis() == 0
    local user_overridden = vim.ui.select ~= initial_ui_select
    if headless or user_overridden then
        vim.ui.select(list, opts, on_choice)
        return
    end

    if active_picker and active_picker.close then
        pcall(active_picker.close)
        active_picker = nil
    end

    local format_item = opts.format_item or function(x) return tostring(x) end
    local search_text = opts.search_text or format_item
    local prompt_title = (opts.prompt or 'Select'):gsub(':%s*$', '')

    local entries = {}
    for idx, item in ipairs(list) do
        local label = format_item(item):gsub('[\r\n]+', ' ')
        local hay = (label .. ' ' .. tostring(search_text(item) or '')):lower()
        entries[idx] = { item = item, label = label, hay = hay }
    end

    local columns = vim.o.columns
    local lines = vim.o.lines
    local width = math.min(math.max(24, columns - 2), math.max(44, math.min(math.floor(columns * 0.72), 96)))
    local max_results = math.max(6, math.min(#entries, math.floor(lines * 0.55), 18))
    local total_h = max_results + 3
    local row = math.max(1, math.floor((lines - total_h) / 2) - 1)
    local col = math.max(0, math.floor((columns - width) / 2))

    --- Build title chunks for the picker prompt border.
    local function build_picker_title(shown_count)
        local count_text = string.format('(%d/%d)', shown_count, #entries)
        local count_hl = shown_count == 0 and 'GhidraTabDirty' or 'GhidraStatusAccent'
        local max_label = math.max(6, width - vim.fn.strdisplaywidth(count_text) - 3)
        local label = M.truncate_display(prompt_title, max_label)
        return {
            { ' ' .. label .. ' ', 'GhidraFloatTitle' },
            { count_text, count_hl },
            { ' ', 'GhidraFloatTitle' },
        }
    end

    --- Build footer hint chunks for the picker results border.
    local function build_picker_footer()
        local full = {
            { ' <CR>', 'GhidraStatusAccent' },
            { ' select', 'GhidraFloatFooter' },
            { ' · ', 'GhidraStatusAccent' },
            { '<C-n>/<C-p>', 'GhidraStatusAccent' },
            { ' move', 'GhidraFloatFooter' },
            { ' · ', 'GhidraStatusAccent' },
            { '<Esc>/q', 'GhidraStatusAccent' },
            { ' close ', 'GhidraFloatFooter' },
        }
        if M.chunks_display_width(full) <= width then
            return full
        end
        local compact = {
            { ' <CR>', 'GhidraStatusAccent' },
            { ' select', 'GhidraFloatFooter' },
            { ' · ', 'GhidraStatusAccent' },
            { '<Tab>', 'GhidraStatusAccent' },
            { ' move', 'GhidraFloatFooter' },
            { ' · ', 'GhidraStatusAccent' },
            { 'q', 'GhidraStatusAccent' },
            { ' close ', 'GhidraFloatFooter' },
        }
        if M.chunks_display_width(compact) <= width then
            return compact
        end
        return nil
    end

    local prompt_buf = vim.api.nvim_create_buf(false, true)
    local list_buf = vim.api.nvim_create_buf(false, true)
    vim.bo[prompt_buf].buftype = 'nofile'
    vim.bo[prompt_buf].bufhidden = 'wipe'
    vim.bo[list_buf].buftype = 'nofile'
    vim.bo[list_buf].bufhidden = 'wipe'

    local prompt_win = M.open_float(prompt_buf, true, {
        relative = 'editor',
        row = row,
        col = col,
        width = width,
        height = 1,
        style = 'minimal',
        border = 'rounded',
        title_pos = 'left',
        zindex = 60,
    }, build_picker_title(#entries), nil)

    local list_win = M.open_float(list_buf, false, {
        relative = 'editor',
        row = row + 3,
        col = col,
        width = width,
        height = max_results,
        style = 'minimal',
        border = 'rounded',
        footer_pos = 'left',
        focusable = false,
        zindex = 59,
    }, nil, build_picker_footer())

    vim.wo[prompt_win].wrap = false
    vim.wo[list_win].wrap = false
    vim.wo[list_win].cursorline = false

    local filtered = {}
    local selected = 1
    local closed = false
    local ns = vim.api.nvim_create_namespace('ghidra_lsp_picker')

    local function render(query)
        if closed or not vim.api.nvim_buf_is_valid(list_buf) then return end
        local q = vim.trim((query or ''):lower())
        local terms = q == '' and {} or vim.split(q, '%s+', { trimempty = true })
        filtered = {}
        for _, entry in ipairs(entries) do
            local ok = true
            for _, term in ipairs(terms) do
                if not entry.hay:find(term, 1, true) then
                    ok = false
                    break
                end
            end
            if ok then
                table.insert(filtered, entry)
            end
        end

        if #filtered == 0 then
            selected = 0
        elseif selected < 1 then
            selected = 1
        elseif selected > #filtered then
            selected = #filtered
        end

        local lines_out = {}
        if #filtered == 0 then
            lines_out = { '  (no matches)' }
        else
            for i, e in ipairs(filtered) do
                local marker = (i == selected) and '▶ ' or '  '
                table.insert(lines_out, marker .. e.label)
            end
        end

        vim.bo[list_buf].modifiable = true
        vim.api.nvim_buf_set_lines(list_buf, 0, -1, false, lines_out)
        vim.bo[list_buf].modifiable = false

        vim.api.nvim_buf_clear_namespace(list_buf, ns, 0, -1)
        if selected >= 1 and selected <= #filtered then
            vim.api.nvim_buf_add_highlight(list_buf, ns, 'Visual', selected - 1, 0, -1)
            vim.api.nvim_buf_add_highlight(list_buf, ns, 'Directory', selected - 1, 0, 2)
            if vim.api.nvim_win_is_valid(list_win) then
                pcall(vim.api.nvim_win_set_cursor, list_win, { selected, 0 })
            end
        elseif #filtered == 0 then
            vim.api.nvim_buf_add_highlight(list_buf, ns, 'GhidraFloatFooter', 0, 0, -1)
        end

        M.set_float_chrome(prompt_win, build_picker_title(#filtered), nil)
    end

    local function close_picker(chosen)
        if closed then return end
        closed = true
        active_picker = nil
        pcall(vim.cmd, 'stopinsert')
        if vim.api.nvim_win_is_valid(list_win) then
            pcall(vim.api.nvim_win_close, list_win, true)
        end
        if vim.api.nvim_win_is_valid(prompt_win) then
            pcall(vim.api.nvim_win_close, prompt_win, true)
        end
        if on_choice then
            vim.schedule(function()
                on_choice(chosen)
            end)
        end
    end

    local function move(delta)
        if #filtered == 0 then return end
        selected = ((selected - 1 + delta) % #filtered) + 1
        local cur_query = vim.api.nvim_buf_get_lines(prompt_buf, 0, 1, false)[1] or ''
        render(cur_query)
    end

    local function accept()
        local choice = (selected >= 1 and filtered[selected]) and filtered[selected].item or nil
        close_picker(choice)
    end

    active_picker = {
        close = function() close_picker(nil) end,
    }

    local map_opts = { buffer = prompt_buf, silent = true, nowait = true }
    for _, mode in ipairs({ 'i', 'n' }) do
        vim.keymap.set(mode, '<CR>', accept, map_opts)
        vim.keymap.set(mode, '<Esc>', function() close_picker(nil) end, map_opts)
        vim.keymap.set(mode, '<C-c>', function() close_picker(nil) end, map_opts)
        vim.keymap.set(mode, '<Down>', function() move(1) end, map_opts)
        vim.keymap.set(mode, '<Up>', function() move(-1) end, map_opts)
        vim.keymap.set(mode, '<C-n>', function() move(1) end, map_opts)
        vim.keymap.set(mode, '<C-p>', function() move(-1) end, map_opts)
        vim.keymap.set(mode, '<Tab>', function() move(1) end, map_opts)
        vim.keymap.set(mode, '<S-Tab>', function() move(-1) end, map_opts)
    end
    vim.keymap.set('n', 'j', function() move(1) end, map_opts)
    vim.keymap.set('n', 'k', function() move(-1) end, map_opts)
    vim.keymap.set('n', 'q', function() close_picker(nil) end, map_opts)

    local grp = vim.api.nvim_create_augroup('GhidraLspPicker', { clear = true })
    vim.api.nvim_create_autocmd({ 'TextChanged', 'TextChangedI' }, {
        group = grp,
        buffer = prompt_buf,
        callback = function()
            local line = vim.api.nvim_buf_get_lines(prompt_buf, 0, 1, false)[1] or ''
            render(line)
        end,
    })
    vim.api.nvim_create_autocmd('WinClosed', {
        group = grp,
        pattern = tostring(prompt_win),
        once = true,
        callback = function()
            close_picker(nil)
        end,
    })

    if opts.initial_query and opts.initial_query ~= '' then
        vim.api.nvim_buf_set_lines(prompt_buf, 0, -1, false, { opts.initial_query })
        render(opts.initial_query)
    else
        render('')
    end
    pcall(vim.cmd, 'startinsert!')
end

return M
