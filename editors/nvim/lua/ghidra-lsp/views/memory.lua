-- Copyright 2026 ByteLand Technology Limited
-- SPDX-License-Identifier: MIT

-- Hex and memory viewer with live server-decoded data inspector (ghidra-memory://).
local client = require('ghidra-lsp.client')
local format = require('ghidra-lsp.format')
local ui = require('ghidra-lsp.ui')
local common = require('ghidra-lsp.views.common')

local M = {}

--- Build a lookup table of Data Inspector entries keyed by label.
local function inspector_map(entries)
    local by_label = {}
    for _, e in ipairs(entries or {}) do
        if type(e) == 'table' and type(e.label) == 'string' then
            by_label[e.label] = e
        end
    end
    return by_label
end

--- Split a combined `"signed / unsigned"` Data Inspector value and optional char hint.
local function split_pair(raw)
    if type(raw) ~= 'string' then return nil, nil, nil end
    local signed, rest = raw:match('^%s*(.-)%s*/%s*(.-)%s*$')
    if not signed then return nil, nil, nil end
    local unsigned, ch = rest:match('^(.-)%s*\194\183%s*(.+)$')
    if unsigned then
        return signed, unsigned, ch
    end
    return signed, rest, nil
end

--- Format the two-line Data Inspector header for a byte cursor position.
local function format_inspector_lines(addr, offset_in_chunk, endian, entries)
    local disp_addr = format.display_address(addr or '')
    local m = inspector_map(entries)
    local function val_or(k, fallback)
        return (m[k] and m[k].value) or fallback or '--'
    end
    local s8, u8, ch8 = split_pair(m['int8 / uint8'] and m['int8 / uint8'].value)
    local _, u16 = split_pair(m['int16 / uint16'] and m['int16 / uint16'].value)
    local s32, u32 = split_pair(m['int32 / uint32'] and m['int32 / uint32'].value)
    local _, u64 = split_pair(m['int64 / uint64'] and m['int64 / uint64'].value)

    local char_val = ch8 or (m['ASCII'] and m['ASCII'].value) or '--'
    local ptr = m['Pointer'] and m['Pointer'].value or '--'
    local cstr = (m['UTF-8'] and m['UTF-8'].value) or (m['ASCII'] and m['ASCII'].value) or '--'
    if vim.fn.strchars(cstr) > 28 then
        cstr = vim.fn.strcharpart(cstr, 0, 25) .. '...'
    end

    local line1 = string.format('  Inspector │ %s (+0x%03x) · %s │ uint8: %-4s  int8: %-5s  char: %-6s  utf8: %s',
        disp_addr,
        math.max(0, tonumber(offset_in_chunk) or 0),
        tostring(endian or 'little'):upper(),
        val_or('uint8', u8),
        val_or('int8', s8),
        char_val,
        cstr
    )
    local line2 = string.format('  Values    │ uint16: %-8s  uint32: %-12s  int32: %-12s  uint64: %-20s  ptr: %s',
        val_or('uint16', u16),
        val_or('uint32', u32),
        val_or('int32', s32),
        val_or('uint64', u64),
        ptr
    )
    return { line1, line2 }
end

--- Highlight the selected byte in both hex and ASCII columns.
local function apply_memory_cursor_highlight(buf, st, row_line_1, col_idx_0)
    vim.api.nvim_buf_clear_namespace(buf, common.NS_MEMORY, 0, -1)
    pcall(vim.api.nvim_buf_add_highlight, buf, common.NS_MEMORY, 'Title', 0, 0, -1)
    pcall(vim.api.nvim_buf_add_highlight, buf, common.NS_MEMORY, 'Special', 1, 2, 11)
    pcall(vim.api.nvim_buf_add_highlight, buf, common.NS_MEMORY, 'Special', 2, 2, 11)
    pcall(vim.api.nvim_buf_add_highlight, buf, common.NS_MEMORY, 'Comment', 3, 0, -1)

    local row_info = st.rows[row_line_1]
    if row_info and row_info.hex_spans[col_idx_0 + 1] then
        local hs = row_info.hex_spans[col_idx_0 + 1]
        local asc = row_info.ascii_start + col_idx_0
        pcall(vim.api.nvim_buf_add_highlight, buf, common.NS_MEMORY, 'IncSearch', row_line_1 - 1, hs[1], hs[2])
        pcall(vim.api.nvim_buf_add_highlight, buf, common.NS_MEMORY, 'IncSearch', row_line_1 - 1, asc, asc + 1)
    end
end

--- Update the live Data Inspector header for the byte under `(row_line_1, col_idx_0)`.
local function update_memory_inspector_at(buf, row_line_1, col_idx_0)
    local st = vim.b[buf].ghidra_memory_state
    if type(st) ~= 'table' then return end
    local rinfo = st.rows[row_line_1]
    if not rinfo then return end
    local cell = rinfo.cells[col_idx_0 + 1]
    if not cell or not cell.address then return end

    if vim.b[buf].ghidra_memory_cursor_addr == cell.address then
        apply_memory_cursor_highlight(buf, st, row_line_1, col_idx_0)
        return
    end

    local slice = {}
    local start_flat = cell.flat_idx
    if start_flat then
        for k = 0, 15 do
            local v = st.flat_bytes[start_flat + k]
            if v == nil then break end
            if v == false then
                table.insert(slice, vim.NIL)
            else
                table.insert(slice, v)
            end
        end
    end

    local ok, insp_res = pcall(client.exec_sync, 'ghidra.inspectBytes', {
        md5 = st.md5,
        bytes = slice,
        endian = st.endian,
        addressSizeBits = st.addressSizeBits,
        blocks = st.blocks,
        defaultSpace = st.defaultSpace,
        addressWidth = st.addressWidth,
    }, 3000)

    local entries = (ok and type(insp_res) == 'table' and insp_res.entries) or {}
    local insp_lines = format_inspector_lines(cell.address, (start_flat or 1) - 1, st.endian, entries)
    vim.b[buf].ghidra_memory_cursor_addr = cell.address

    vim.bo[buf].readonly = false
    vim.bo[buf].modifiable = true
    vim.api.nvim_buf_set_lines(buf, 1, 3, false, insp_lines)
    vim.bo[buf].modifiable = false
    vim.bo[buf].readonly = true
    vim.bo[buf].modified = false

    apply_memory_cursor_highlight(buf, st, row_line_1, col_idx_0)
end

--- Fetch and render a hex memory window into the given buffer.
function M.render_memory_into_buf(buf, md5, target_addr, focus_addr, endian_override)
    local req = {
        md5 = md5,
        length = common.HEX_CHUNK_BYTES,
        bytesPerRow = 16,
        selectionLength = 1,
    }
    if target_addr and target_addr ~= '' then
        req.address = target_addr
    end
    if endian_override and endian_override ~= '' then
        req.endian = endian_override
    end
    if focus_addr and focus_addr ~= '' then
        req.inspectAddress = focus_addr
    end

    local res = client.exec_sync('ghidra.memoryWindow', req)
    common.cache_program_meta(md5, res)

    local chunk = type(res.chunk) == 'table' and res.chunk or {}
    local block = type(chunk.block) == 'table' and chunk.block or nil
    local endian = tostring(res.endian or 'little')
    local selected_addr = tostring(res.selectedAddress or chunk.start or target_addr or '')
    local uninit_notice = (block and block.initialized == false)
        and ('Uninitialized block (' .. tostring(block.name or '') .. ')')
        or nil

    local blk_banner
    if block then
        blk_banner = string.format('; ── %s  %s..%s  [%s]  Endian: %s%s ──',
            tostring(block.name or ''),
            format.display_address(block.start or ''),
            format.display_address(block['end'] or ''),
            common.block_perms(block),
            endian:upper(),
            uninit_notice and ('  ·  ' .. uninit_notice) or ''
        )
    else
        blk_banner = string.format('; ── Memory · %s · Endian: %s ──', format.display_address(chunk.start or ''), endian:upper())
    end

    local lines = {
        blk_banner,
        '',
        '',
        '  Address     00 01 02 03 04 05 06 07  08 09 0A 0B 0C 0D 0E 0F  │ ASCII',
    }
    local first_data_line = #lines + 1
    local rows = {}
    local flat_bytes = {}
    local selected_line = first_data_line
    local selected_col_0 = 0
    local selected_offset = 0

    for _, r in ipairs(chunk.rows or {}) do
        local prefix = string.format('  %-10s  ', format.display_address(r.rowAddress or ''))
        local hex_cells = {}
        local hex_spans = {}
        local ascii_chars = {}
        local cells_meta = {}
        local cur_byte_col = #prefix

        for c = 0, 15 do
            if c == 8 then
                cur_byte_col = cur_byte_col + 1
            end
            local cell = (type(r.cells) == 'table' and r.cells[c + 1]) or {}
            local in_block = cell.inBlock == true
            local val = (cell.value ~= vim.NIL and type(cell.value) == 'number') and cell.value or nil
            local cell_txt
            if not in_block then
                cell_txt = '  '
            elseif val then
                cell_txt = string.format('%02x', val)
            else
                cell_txt = '??'
            end
            hex_spans[c + 1] = { cur_byte_col, cur_byte_col + 2 }
            table.insert(hex_cells, (c == 8) and (' ' .. cell_txt) or cell_txt)
            cur_byte_col = cur_byte_col + 3

            if not in_block or not val then
                table.insert(ascii_chars, ' ')
            elseif val >= 32 and val < 127 then
                table.insert(ascii_chars, string.char(val))
            else
                table.insert(ascii_chars, '.')
            end

            local flat_idx = nil
            if in_block then
                table.insert(flat_bytes, val or false)
                flat_idx = #flat_bytes
            end
            cells_meta[c + 1] = {
                address = cell.address,
                inBlock = in_block,
                value = val,
                flat_idx = flat_idx,
            }
        end

        local left = prefix .. table.concat(hex_cells, ' ') .. '  │ '
        local line = left .. table.concat(ascii_chars, '')
        table.insert(lines, line)
        local lidx = #lines
        rows[lidx] = {
            hex_spans = hex_spans,
            ascii_start = #left,
            cells = cells_meta,
        }
        for c = 0, 15 do
            local cm = cells_meta[c + 1]
            if cm and cm.address and selected_addr ~= '' and format.same_address(cm.address, selected_addr) then
                selected_line = lidx
                selected_col_0 = c
                selected_offset = (cm.flat_idx or 1) - 1
            end
        end
    end

    local insp_lines = format_inspector_lines(selected_addr, selected_offset, endian, res.inspector or {})
    lines[2] = insp_lines[1]
    lines[3] = insp_lines[2]

    common.set_readonly_lines(buf, lines, 'ghidra-memory')

    local state = {
        md5 = md5,
        chunkStart = chunk.start or target_addr,
        endian = endian,
        addressSizeBits = res.addressSizeBits or 64,
        defaultSpace = res.defaultSpace or 'ram',
        addressWidth = res.addressWidth or 8,
        blocks = res.blocks or {},
        flat_bytes = flat_bytes,
        rows = rows,
        prevAddress = res.prevAddress ~= vim.NIL and res.prevAddress or nil,
        nextAddress = res.nextAddress ~= vim.NIL and res.nextAddress or nil,
    }
    vim.b[buf].ghidra_memory_state = state
    vim.b[buf].ghidra_memory_cursor_addr = selected_addr

    local target_row = rows[selected_line]
    local target_col = (target_row and target_row.hex_spans[selected_col_0 + 1][1]) or 14
    local win = vim.fn.bufwinid(buf)
    if win ~= -1 then
        pcall(vim.api.nvim_win_set_cursor, win, { selected_line, target_col })
    end
    apply_memory_cursor_highlight(buf, state, selected_line, selected_col_0)
    ui.refresh_statuslines()
end

--- Open the Hex and Memory Viewer synced to the given argument or cursor location.
function M.open_memory(arg)
    local md5 = common.require_md5(arg)
    if not md5 then return nil end

    local ok, target_addr = pcall(common.resolve_target_address, md5, arg)
    if not ok or not target_addr then
        vim.notify('Memory error: ' .. tostring(target_addr or 'no target address'), vim.log.levels.ERROR)
        return nil
    end

    local buf_name = string.format('ghidra-memory://%s/%s', md5, format.url_encode(target_addr))
    local buf = common.open_split_buffer(buf_name, 'ghidra-memory://' .. md5 .. '/', true)
    M.render_memory_into_buf(buf, md5, target_addr, target_addr, nil)

    local grp = vim.api.nvim_create_augroup('GhidraMemoryInspector_' .. buf, { clear = true })
    vim.api.nvim_create_autocmd('CursorMoved', {
        group = grp,
        buffer = buf,
        callback = function()
            local st = vim.b[buf].ghidra_memory_state
            if type(st) ~= 'table' then return end
            local pos = vim.api.nvim_win_get_cursor(0)
            local rinfo = st.rows[pos[1]]
            if not rinfo then return end
            local c = pos[2]
            local col_idx = 0
            if c >= rinfo.ascii_start then
                col_idx = math.max(0, math.min(15, c - rinfo.ascii_start))
            else
                local best_i, best_d = 0, 9999
                for i, sp in ipairs(rinfo.hex_spans) do
                    if c >= sp[1] and c < sp[2] then
                        best_i = i - 1
                        break
                    end
                    local d = math.min(math.abs(c - sp[1]), math.abs(c - sp[2]))
                    if d < best_d then
                        best_d = d
                        best_i = i - 1
                    end
                end
                col_idx = best_i
            end
            update_memory_inspector_at(buf, pos[1], col_idx)
        end,
    })

    local commands = require('ghidra-lsp.commands')
    local kopts = { buffer = buf, silent = true, nowait = true }
    vim.keymap.set('n', '<CR>', function()
        local a = vim.b[buf].ghidra_memory_cursor_addr
        if a then require('ghidra-lsp.views').open_listing({ md5 = md5, address = a }) end
    end, kopts)
    vim.keymap.set('n', 'l', function()
        local a = vim.b[buf].ghidra_memory_cursor_addr
        if a then require('ghidra-lsp.views').open_listing({ md5 = md5, address = a }) end
    end, kopts)
    vim.keymap.set('n', 'd', function()
        local a = vim.b[buf].ghidra_memory_cursor_addr
        if a then commands.goto_address({ md5 = md5, address = a }) end
    end, kopts)
    vim.keymap.set('n', 'p', function()
        local a = vim.b[buf].ghidra_memory_cursor_addr
        if a then require('ghidra-lsp.patch').patch_bytes({ md5 = md5, address = a }) end
    end, kopts)
    vim.keymap.set('n', 'a', function()
        local a = vim.b[buf].ghidra_memory_cursor_addr
        if a then require('ghidra-lsp.patch').assemble({ md5 = md5, address = a }) end
    end, kopts)
    vim.keymap.set('n', 'D', function()
        local a = vim.b[buf].ghidra_memory_cursor_addr
        if a then require('ghidra-lsp.patch').disassemble({ md5 = md5, address = a }) end
    end, kopts)
    vim.keymap.set('n', 'u', function()
        local a = vim.b[buf].ghidra_memory_cursor_addr
        if a then require('ghidra-lsp.patch').clear_code_units({ md5 = md5, address = a }) end
    end, kopts)
    vim.keymap.set('n', 'e', function()
        local st = vim.b[buf].ghidra_memory_state
        if not st then return end
        local next_endian = st.endian == 'little' and 'big' or 'little'
        local cur_a = vim.b[buf].ghidra_memory_cursor_addr or st.chunkStart
        M.render_memory_into_buf(buf, md5, st.chunkStart, cur_a, next_endian)
    end, kopts)
    vim.keymap.set('n', ']p', function()
        local st = vim.b[buf].ghidra_memory_state
        if st and st.nextAddress then
            M.render_memory_into_buf(buf, md5, st.nextAddress, st.nextAddress, st.endian)
        end
    end, kopts)
    vim.keymap.set('n', '[p', function()
        local st = vim.b[buf].ghidra_memory_state
        if st and st.prevAddress then
            M.render_memory_into_buf(buf, md5, st.prevAddress, st.prevAddress, st.endian)
        end
    end, kopts)
    vim.keymap.set('n', 'g', function()
        commands.goto_address({ md5 = md5 })
    end, kopts)
    vim.keymap.set('n', 'r', function()
        local st = vim.b[buf].ghidra_memory_state
        if not st then return end
        M.render_memory_into_buf(buf, md5, st.chunkStart, vim.b[buf].ghidra_memory_cursor_addr, st.endian)
    end, kopts)
    vim.keymap.set('n', 'q', function()
        if #vim.api.nvim_tabpage_list_wins(0) > 1 then vim.cmd('close') end
    end, kopts)
    return buf
end

return M
