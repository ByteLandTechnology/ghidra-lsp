-- Copyright 2026 ByteLand Technology Limited
-- SPDX-License-Identifier: MIT

-- Program assembly listing virtual view (ghidra-listing://).
local client = require('ghidra-lsp.client')
local format = require('ghidra-lsp.format')
local ui = require('ghidra-lsp.ui')
local common = require('ghidra-lsp.views.common')

local M = {}

--- Fetch and render a Program Listing window into the given buffer.
function M.render_listing_into_buf(buf, md5, target_addr, focus_addr, cursor_opt, exact_start)
    local req = {
        md5 = md5,
        limit = common.LISTING_LIMIT,
        showTemplateArguments = client.config.template_arguments == 'show',
    }
    if cursor_opt and cursor_opt ~= '' then
        req.cursor = cursor_opt
    elseif target_addr and target_addr ~= '' then
        req.address = target_addr
    end
    if exact_start then
        req.exactStart = true
    end

    local res = client.exec_sync('ghidra.listingWindow', req)
    common.cache_program_meta(md5, res)

    local block = type(res.block) == 'table' and res.block or nil
    local items = type(res.collapsedItems) == 'table' and res.collapsedItems or (type(res.units) == 'table' and res.units or {})

    local lines = {}
    local row_meta = {}
    local highlights = {}
    local target_line = 1

    local blk_header
    if block then
        blk_header = string.format('; ── %s  %s..%s  [%s%s] ─────────────────────────',
            tostring(block.name or ''),
            format.display_address(block.start or ''),
            format.display_address(block['end'] or ''),
            common.block_perms(block),
            block.initialized == false and ' UNINIT' or ''
        )
    else
        blk_header = '; ── Program Listing · ' .. format.display_address(res.startAddress or target_addr or '') .. ' ──'
    end
    table.insert(lines, blk_header)
    table.insert(highlights, { #lines - 1, 'Title', 0, -1 })
    table.insert(lines, '; Keys: <CR>/d Decompile | a Assemble | D Disasm | u Undefine | p Patch | m Hex | c Comment | gr Xrefs | q Close')
    table.insert(highlights, { #lines - 1, 'Comment', 0, -1 })

    if #items == 0 then
        table.insert(lines, string.format('  %s  (no defined code units in range)', format.display_address(target_addr or res.startAddress or '')))
    end

    for _, item in ipairs(items) do
        if type(item.units) == 'table' then
            local line = string.format('  %s..%s  .. %d undefined byte(s)%s',
                format.display_address(item.startAddress or ''),
                format.display_address(item.endAddress or ''),
                tonumber(item.byteLength) or #item.units,
                item.uninitialized and ' [UNINIT]' or '')
            table.insert(lines, line)
            local lidx = #lines
            row_meta[lidx] = { address = item.startAddress }
            table.insert(highlights, { lidx - 1, 'Comment', 0, -1 })
            if focus_addr and item.startAddress and format.same_address(item.startAddress, focus_addr) then
                target_line = lidx
            end
        else
            local uaddr = tostring(item.address or '')
            if type(item.functionHeader) == 'table' then
                table.insert(lines, '')
                local sig = tostring(item.functionHeader.displaySignature or item.functionHeader.name or uaddr)
                table.insert(lines, string.format('; ══ %s ══════════════════════════════════════════════════', sig))
                table.insert(highlights, { #lines - 1, 'Function', 0, -1 })
            end

            if type(item.labels) == 'table' then
                for _, lbl in ipairs(item.labels) do
                    local suffix = ''
                    if lbl.primary and tonumber(item.xrefTotal) and item.xrefTotal > 0 then
                        suffix = string.format('  ; xrefs: %d', item.xrefTotal)
                    end
                    table.insert(lines, string.format('  %s:%s', tostring(lbl.name or ''), suffix))
                    table.insert(highlights, { #lines - 1, 'Label', 0, -1 })
                end
            end

            if type(item.plateComment) == 'string' and item.plateComment ~= '' then
                for _, pline in ipairs(vim.split(item.plateComment, '\n', { plain = true })) do
                    table.insert(lines, '; * ' .. pline)
                    table.insert(highlights, { #lines - 1, 'Comment', 0, -1 })
                end
            end
            if type(item.preComment) == 'string' and item.preComment ~= '' then
                for _, pline in ipairs(vim.split(item.preComment, '\n', { plain = true })) do
                    table.insert(lines, ';   ' .. pline)
                    table.insert(highlights, { #lines - 1, 'Comment', 0, -1 })
                end
            end

            local disp_addr = format.display_address(uaddr)
            local bytes_s = tostring(item.bytesShort or item.bytesText or '')
            if #bytes_s > 23 then bytes_s = bytes_s:sub(1, 21) .. '..' end
            local mnem = tostring(item.mnemonic or '')
            local ops = tostring(item.operandsText or '')
            local eol = (type(item.eolComment) == 'string' and item.eolComment ~= '')
                and ('  ; ' .. item.eolComment:gsub('\n', ' '))
                or ''

            local addr_col = string.format('  %-10s', disp_addr)
            local byte_col = string.format('%-24s', bytes_s)
            local mnem_col = string.format('%-10s', mnem)
            local line = addr_col .. byte_col .. mnem_col .. ops .. eol
            table.insert(lines, line)
            local lidx = #lines
            row_meta[lidx] = { address = uaddr, unit = item }

            local b_addr_end = #addr_col
            local b_byte_end = b_addr_end + #byte_col
            local b_mnem_end = b_byte_end + #mnem_col
            local b_ops_end = b_mnem_end + #ops
            table.insert(highlights, { lidx - 1, 'Number', 2, b_addr_end })
            table.insert(highlights, { lidx - 1, 'Comment', b_addr_end, b_byte_end })
            table.insert(highlights, { lidx - 1, 'Statement', b_byte_end, b_mnem_end })
            if #ops > 0 then
                table.insert(highlights, { lidx - 1, 'Identifier', b_mnem_end, b_ops_end })
            end
            if #eol > 0 then
                table.insert(highlights, { lidx - 1, 'Comment', b_ops_end, #line })
            end

            if focus_addr and format.same_address(uaddr, focus_addr) then
                target_line = lidx
            elseif not focus_addr and target_line == 1 then
                target_line = lidx
            end

            if type(item.postComment) == 'string' and item.postComment ~= '' then
                for _, pline in ipairs(vim.split(item.postComment, '\n', { plain = true })) do
                    table.insert(lines, ';   ' .. pline)
                    table.insert(highlights, { #lines - 1, 'Comment', 0, -1 })
                end
            end
        end
    end

    common.set_readonly_lines(buf, lines, 'ghidra-listing', common.NS_LISTING, highlights)

    vim.b[buf].ghidra_listing_rows = row_meta
    vim.b[buf].ghidra_listing_md5 = md5
    vim.b[buf].ghidra_listing_start = res.startAddress or target_addr
    vim.b[buf].ghidra_listing_end = res.endAddress or target_addr
    vim.b[buf].ghidra_listing_next = res.nextCursor ~= vim.NIL and res.nextCursor or nil
    vim.b[buf].ghidra_listing_has_more = res.hasMoreAfter == true
    vim.b[buf].ghidra_listing_blocks = res.blocks or {}
    vim.b[buf].ghidra_listing_block = block

    local win = vim.fn.bufwinid(buf)
    if win ~= -1 then
        pcall(vim.api.nvim_win_set_cursor, win, { target_line, 2 })
    end
    ui.refresh_statuslines()
end

--- Open the Program Listing view synced to the given argument or cursor location.
function M.open_listing(arg)
    local md5 = common.require_md5(arg)
    if not md5 then return nil end

    local ok, target_addr = pcall(common.resolve_target_address, md5, arg)
    if not ok or not target_addr then
        vim.notify('Listing error: ' .. tostring(target_addr or 'no target address'), vim.log.levels.ERROR)
        return nil
    end

    local buf_name = string.format('ghidra-listing://%s/%s', md5, format.url_encode(target_addr))
    local buf = common.open_split_buffer(buf_name, 'ghidra-listing://' .. md5 .. '/', true)
    M.render_listing_into_buf(buf, md5, target_addr, target_addr, nil)

    local commands = require('ghidra-lsp.commands')
    local kopts = { buffer = buf, silent = true, nowait = true }
    local function cur_addr()
        local r = vim.api.nvim_win_get_cursor(0)[1]
        local rows = vim.b[buf].ghidra_listing_rows
        return rows and rows[r] and rows[r].address
    end
    local function step_block(delta)
        local blks = vim.b[buf].ghidra_listing_blocks or {}
        local cur = vim.b[buf].ghidra_listing_block
        if #blks == 0 then return end
        for i, b in ipairs(blks) do
            if cur and b.start == cur.start then
                local next_b = blks[i + delta]
                if next_b then
                    M.render_listing_into_buf(buf, md5, next_b.start, next_b.start, nil, true)
                end
                return
            end
        end
    end

    vim.keymap.set('n', '<CR>', function()
        local a = cur_addr()
        if a then commands.goto_address({ md5 = md5, address = a }) end
    end, kopts)
    vim.keymap.set('n', 'd', function()
        local a = cur_addr()
        if a then commands.goto_address({ md5 = md5, address = a }) end
    end, kopts)
    vim.keymap.set('n', 'm', function()
        local a = cur_addr()
        if a then require('ghidra-lsp.views').open_memory({ md5 = md5, address = a }) end
    end, kopts)
    vim.keymap.set('n', 'c', function()
        local a = cur_addr()
        if a then require('ghidra-lsp.edit').edit_comment({ md5 = md5, address = a, explicit_address = true }) end
    end, kopts)
    vim.keymap.set('n', 'a', function()
        local a = cur_addr()
        if a then require('ghidra-lsp.patch').assemble({ md5 = md5, address = a }) end
    end, kopts)
    vim.keymap.set('n', 'D', function()
        local a = cur_addr()
        if a then require('ghidra-lsp.patch').disassemble({ md5 = md5, address = a }) end
    end, kopts)
    vim.keymap.set('x', 'D', function()
        local l1 = vim.fn.line('v')
        local l2 = vim.fn.line('.')
        vim.api.nvim_feedkeys(vim.api.nvim_replace_termcodes('<Esc>', true, false, true), 'nx', false)
        require('ghidra-lsp.patch').disassemble({ md5 = md5, line1 = l1, line2 = l2, has_range = true })
    end, kopts)
    vim.keymap.set('n', 'u', function()
        local a = cur_addr()
        if a then require('ghidra-lsp.patch').clear_code_units({ md5 = md5, address = a }) end
    end, kopts)
    vim.keymap.set('x', 'u', function()
        local l1 = vim.fn.line('v')
        local l2 = vim.fn.line('.')
        vim.api.nvim_feedkeys(vim.api.nvim_replace_termcodes('<Esc>', true, false, true), 'nx', false)
        require('ghidra-lsp.patch').clear_code_units({ md5 = md5, line1 = l1, line2 = l2, has_range = true })
    end, kopts)
    vim.keymap.set('n', 'p', function()
        local a = cur_addr()
        if a then require('ghidra-lsp.patch').patch_bytes({ md5 = md5, address = a }) end
    end, kopts)
    vim.keymap.set('n', 'gr', function()
        local a = cur_addr()
        if a then require('ghidra-lsp.views').show_address_xrefs(md5, a) end
    end, kopts)
    vim.keymap.set('n', 'x', function()
        local a = cur_addr()
        if a then require('ghidra-lsp.views').show_address_xrefs(md5, a) end
    end, kopts)
    vim.keymap.set('n', 'g', function()
        commands.goto_address({ md5 = md5 })
    end, kopts)
    vim.keymap.set('n', ']p', function()
        local nxt = vim.b[buf].ghidra_listing_next
        if nxt then
            M.render_listing_into_buf(buf, md5, nil, nil, nxt, true)
        elseif vim.b[buf].ghidra_listing_has_more then
            step_block(1)
        end
    end, kopts)
    vim.keymap.set('n', '[p', function()
        local start_a = vim.b[buf].ghidra_listing_start or target_addr
        local ok_prev, res = pcall(client.exec_sync, 'ghidra.resolveTarget', {
            md5 = md5,
            input = '-0x80',
            currentAddress = start_a,
        })
        if ok_prev and type(res) == 'table' and type(res.address) == 'string' then
            M.render_listing_into_buf(buf, md5, res.address, res.address, nil, true)
        else
            local cur = vim.b[buf].ghidra_listing_block
            if cur and cur.start and not format.same_address(cur.start, start_a) then
                M.render_listing_into_buf(buf, md5, cur.start, cur.start, nil, true)
            else
                step_block(-1)
            end
        end
    end, kopts)
    vim.keymap.set('n', ']b', function() step_block(1) end, kopts)
    vim.keymap.set('n', '[b', function() step_block(-1) end, kopts)
    vim.keymap.set('n', 'r', function()
        local start_a = vim.b[buf].ghidra_listing_start or target_addr
        local focus = cur_addr() or start_a
        M.render_listing_into_buf(buf, md5, start_a, focus, nil, vim.b[buf].ghidra_listing_start ~= nil)
    end, kopts)
    vim.keymap.set('n', 'q', function()
        if #vim.api.nvim_tabpage_list_wins(0) > 1 then vim.cmd('close') end
    end, kopts)
    return buf
end

return M
