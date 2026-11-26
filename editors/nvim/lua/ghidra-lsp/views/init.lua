-- Copyright 2026 ByteLand Technology Limited
-- SPDX-License-Identifier: MIT

-- Public facade for Listing, Memory, Defined Strings, Xrefs, CFG, and Call Graph views.
local client = require('ghidra-lsp.client')
local format = require('ghidra-lsp.format')
local ui = require('ghidra-lsp.ui')
local common = require('ghidra-lsp.views.common')
local listing = require('ghidra-lsp.views.listing')
local memory = require('ghidra-lsp.views.memory')
local graphs = require('ghidra-lsp.views.graphs')

local M = {}

M.open_listing = listing.open_listing
M.open_memory = memory.open_memory
M.open_control_flow = graphs.open_control_flow
M.open_call_graph = graphs.open_call_graph

--- Populate the quickfix list with incoming references to an address.
function M.show_address_xrefs(md5, addr)
    local res = client.exec_sync('ghidra.query', {
        md5 = md5,
        domain = 'reference',
        operation = 'list',
        params = { filter = { direction = 'to', to = addr }, page = { limit = 500 } },
        all = true,
    })
    local items = type(res.items) == 'table' and res.items or {}
    if #items == 0 then
        vim.notify('No incoming references to ' .. format.display_address(addr), vim.log.levels.INFO)
        return
    end
    local qf = {}
    for _, ref in ipairs(items) do
        local from_addr = tostring(ref.from or '')
        local rtype = tostring(ref.type or 'DATA')
        local resolved_buf = 0
        local lnum, col = 1, 1
        local line_txt = string.format('%s -> %s (%s)', format.display_address(from_addr), format.display_address(addr), rtype)
        if from_addr ~= '' then
            local rev, rev_err = client.execute_command_sync('ghidra.reveal', { { md5 = md5, address = from_addr } })
            if not rev_err and type(rev) == 'table' and type(rev.uri) == 'string' then
                local b = vim.uri_to_bufnr(rev.uri)
                pcall(vim.fn.bufload, b)
                resolved_buf = b
                if type(rev.range) == 'table' and type(rev.range.start) == 'table' then
                    lnum = (rev.range.start.line or 0) + 1
                    col = (rev.range.start.character or 0) + 1
                    local l = vim.api.nvim_buf_get_lines(b, lnum - 1, lnum, false)[1]
                    if l and l ~= '' then line_txt = l end
                end
            end
        end
        table.insert(qf, {
            bufnr = resolved_buf,
            lnum = lnum,
            col = col,
            text = line_txt,
        })
    end
    ui.install_quickfix_formatter()
    vim.fn.setqflist({}, ' ', {
        title = 'Xrefs to ' .. format.display_address(addr),
        items = qf,
    })
    vim.cmd('copen')
end

--- Open a read-only virtual buffer displaying a defined string at the given address.
function M.open_string(md5, addr, initial_value)
    local text = type(initial_value) == 'string' and initial_value or nil
    if text == nil then
        local ok, gv = pcall(client.exec_sync, 'ghidra.query', {
            md5 = md5,
            domain = 'global_variable',
            operation = 'get',
            params = { selector = { address = addr } },
        })
        if ok and type(gv) == 'table' then
            text = tostring(gv.value or gv.representation or '')
        else
            local ok_str, sres = pcall(client.exec_sync, 'ghidra.strings', { md5 = md5 }, 60000)
            if ok_str and type(sres) == 'table' and type(sres.items) == 'table' then
                for _, item in ipairs(sres.items) do
                    if type(item) == 'table' and (item.address == addr or format.same_address(item.address, addr)) then
                        text = tostring(item.value or '')
                        break
                    end
                end
            end
        end
    end
    local lines = vim.split(tostring(text or ''), '\n', { plain = true })
    local buf_name = string.format('ghidra-string://%s/string/%s', md5, format.url_encode(addr))
    local buf = common.open_split_buffer(buf_name, 'ghidra-string://' .. md5 .. '/', true)
    common.set_readonly_lines(buf, lines, 'text')

    local kopts = { buffer = buf, silent = true, nowait = true }
    vim.keymap.set('n', 'gr', function() M.show_address_xrefs(md5, addr) end, kopts)
    vim.keymap.set('n', 'x', function() M.show_address_xrefs(md5, addr) end, kopts)
    vim.keymap.set('n', '<leader>gl', function() M.open_listing({ md5 = md5, address = addr }) end, kopts)
    vim.keymap.set('n', '<leader>gm', function() M.open_memory({ md5 = md5, address = addr }) end, kopts)
    vim.keymap.set('n', 'q', function()
        if #vim.api.nvim_tabpage_list_wins(0) > 1 then vim.cmd('close') end
    end, kopts)
    ui.refresh_statuslines()
    return buf
end

--- Browse defined strings in the active Ghidra session and open the selected string.
function M.strings(arg)
    local md5 = common.require_md5(arg, false)
    if not md5 then return end

    local res = client.exec_sync('ghidra.strings', { md5 = md5 }, 60000)
    local items = type(res.items) == 'table' and res.items or {}
    if #items == 0 then
        vim.notify('No defined strings found in program', vim.log.levels.INFO)
        return
    end

    ui.pick(items, {
        prompt = 'Defined Strings:',
        format_item = function(item)
            local one_line = tostring(item.value or ''):gsub('\r', '\\r'):gsub('\n', '\\n'):gsub('\t', '\\t')
            if #one_line > 72 then one_line = one_line:sub(1, 69) .. '...' end
            return string.format('%-10s  "%s"', tostring(item.displayAddress or format.display_address(item.address)), one_line)
        end,
    }, function(choice)
        if choice then
            M.open_string(md5, choice.address, choice.value)
        end
    end)
end

--- Re-render a Listing, Memory, CFG, or Call Graph buffer in place.
function M.refresh_buffer(buf)
    if buf == 0 then
        buf = vim.api.nvim_get_current_buf()
    end
    if not vim.api.nvim_buf_is_valid(buf) then return end
    local name = vim.api.nvim_buf_get_name(buf)
    local l_md5, l_addr = name:match('^ghidra%-listing://([^/]+)/(.*)$')
    if l_md5 then
        local md5 = l_md5:lower()
        local start_a = vim.b[buf].ghidra_listing_start or format.url_decode(l_addr)
        listing.render_listing_into_buf(buf, md5, start_a, start_a, nil, vim.b[buf].ghidra_listing_start ~= nil)
        return
    end
    local m_md5, m_addr = name:match('^ghidra%-memory://([^/]+)/(.*)$')
    if m_md5 then
        local st = vim.b[buf].ghidra_memory_state
        local md5 = m_md5:lower()
        local base = (st and st.chunkStart) or format.url_decode(m_addr)
        memory.render_memory_into_buf(buf, md5, base, vim.b[buf].ghidra_memory_cursor_addr, st and st.endian)
        return
    end
    local c_md5, c_entry = name:match('^ghidra%-cfg://([^/]+)/(.*)$')
    if c_md5 then
        local md5 = c_md5:lower()
        local entry = vim.b[buf].ghidra_cfg_entry or format.url_decode(c_entry)
        graphs.render_cfg_into_buf(buf, md5, entry, nil)
        return
    end
    local cg_md5, cg_entry = name:match('^ghidra%-callgraph://([^/]+)/(.*)$')
    if cg_md5 then
        local md5 = cg_md5:lower()
        local st = vim.b[buf].ghidra_callgraph_state or {}
        local entry = st.entry or format.url_decode(cg_entry)
        graphs.render_call_graph_into_buf(buf, md5, entry, nil, st.callersDepth or 1, st.calleesDepth or 1)
        return
    end
    local s_md5, s_addr = name:match('^ghidra%-string://([^/]+)/string/(.*)$')
    if s_md5 and s_addr then
        local md5 = s_md5:lower()
        local addr = format.url_decode(s_addr)
        local text = ''
        local ok, gv = pcall(client.exec_sync, 'ghidra.query', {
            md5 = md5,
            domain = 'global_variable',
            operation = 'get',
            params = { selector = { address = addr } },
        })
        if ok and type(gv) == 'table' then
            text = tostring(gv.value or gv.representation or '')
        end
        common.set_readonly_lines(buf, vim.split(text, '\n', { plain = true }), 'text')
        return
    end
end

return M
