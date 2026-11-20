-- Copyright 2026 ByteLand Technology Limited
-- SPDX-License-Identifier: MIT

-- Basic-block Control Flow Graph (ghidra-cfg://) and Call Graph (ghidra-callgraph://) views.
local client = require('ghidra-lsp.client')
local format = require('ghidra-lsp.format')
local ui = require('ghidra-lsp.ui')
local common = require('ghidra-lsp.views.common')

local M = {}

--- Resolve the target function entry or address from arguments or the active buffer.
local function resolve_function_target(md5, arg)
    local entry_opt = type(arg) == 'table' and arg.entry or nil
    local addr_opt = type(arg) == 'table' and arg.address or nil
    if (not entry_opt or entry_opt == '') and (not addr_opt or addr_opt == '') then
        local cur_name = vim.api.nvim_buf_get_name(0)
        local raw_e = cur_name:match('^ghidra://[^/]+/function/(.*)$')
            or cur_name:match('^ghidra%-cfg://[^/]+/(.*)$')
            or cur_name:match('^ghidra%-callgraph://[^/]+/(.*)$')
        if raw_e then
            entry_opt = format.url_decode(raw_e)
        else
            local ok, a = pcall(common.resolve_target_address, md5, arg)
            if ok and a then addr_opt = a end
        end
    end
    return entry_opt, addr_opt
end

--- Fetch and render a basic-block Control Flow Graph into the given buffer.
function M.render_cfg_into_buf(buf, md5, entry_opt, addr_opt)
    local res = client.exec_sync('ghidra.controlFlowGraph', {
        md5 = md5,
        entry = entry_opt,
        address = addr_opt,
        showTemplateArguments = client.config.template_arguments == 'show',
    })

    local fn_label = tostring(res.name or res.displayAddress or res.entry or '')
    local entry = tostring(res.entry or entry_opt or '')
    local nodes = type(res.nodes) == 'table' and res.nodes or {}
    local edges = type(res.edges) == 'table' and res.edges or {}

    local node_by_id = {}
    local block_nodes = {}
    for _, n in ipairs(nodes) do
        if type(n) == 'table' and n.id then
            node_by_id[n.id] = n
            if n.kind == 'block' or type(n.lines) == 'table' then
                table.insert(block_nodes, n)
            end
        end
    end

    local edges_by_from = {}
    for _, e in ipairs(edges) do
        if type(e) == 'table' and e.from then
            edges_by_from[e.from] = edges_by_from[e.from] or {}
            table.insert(edges_by_from[e.from], e)
        end
    end

    local lines = {
        string.format('; ══ Control Flow Graph · %s (%s) · %d blocks ══', fn_label, tostring(res.displayAddress or format.display_address(entry)), #block_nodes),
        '; Keys: <CR> Reveal in Decompiler | l Listing | r Refresh | q Close',
        '',
    }
    local hl = { { 0, 'Function', 0, -1 }, { 1, 'Comment', 0, -1 } }
    local row_addrs = {}

    if res.hasBody == false then
        table.insert(lines, '  ' .. tostring(res.emptyReason or 'This function has no instruction body.'))
        if type(res.scope) == 'string' and res.scope ~= '' then
            table.insert(lines, '  ' .. res.scope)
        end
    else
        if type(res.scope) == 'string' and res.scope ~= '' then
            table.insert(lines, '; ! ' .. res.scope)
            table.insert(hl, { #lines - 1, 'WarningMsg', 0, -1 })
            table.insert(lines, '')
        end

        for bidx, node in ipairs(block_nodes) do
            local tag = bidx == 1 and ' [entry]' or ''
            local subtitle = (type(node.subtitle) == 'string' and node.subtitle ~= '') and ('  ·  ' .. node.subtitle) or ''
            local head = string.format('┌─ Block %d · %s%s%s ──────────────────────',
                bidx,
                tostring(node.title or format.display_address(node.address or '')),
                tag,
                subtitle)
            table.insert(lines, head)
            table.insert(hl, { #lines - 1, 'Title', 0, -1 })
            row_addrs[#lines] = node.address

            for _, insn_line in ipairs(node.lines or {}) do
                local mnem, ops = tostring(insn_line):match('^(%S+)%s*(.*)$')
                mnem = mnem or tostring(insn_line)
                ops = ops or ''
                local l = string.format('│  %-9s %s', mnem, ops)
                table.insert(lines, l)
                local lidx = #lines
                row_addrs[lidx] = node.address
                table.insert(hl, { lidx - 1, 'Statement', 3, 12 })
            end

            local out_edges = edges_by_from[node.id] or {}
            local edge_strs = {}
            for _, e in ipairs(out_edges) do
                local tgt = node_by_id[e.to]
                local tgt_label = tgt and tostring(tgt.title or format.display_address(tgt.address or e.to)) or tostring(e.to)
                local lbl = (type(e.label) == 'string' and e.label ~= '') and (e.label .. ' -> ') or '-> '
                table.insert(edge_strs, lbl .. tgt_label)
            end
            if #edge_strs == 0 then
                table.insert(edge_strs, 'return / end')
            end
            table.insert(lines, '└─▶ ' .. table.concat(edge_strs, '  │  '))
            table.insert(hl, { #lines - 1, 'Comment', 0, -1 })
            table.insert(lines, '')
        end
    end

    common.set_readonly_lines(buf, lines, 'ghidra-cfg', common.NS_CFG, hl)

    vim.b[buf].ghidra_cfg_rows = row_addrs
    vim.b[buf].ghidra_cfg_entry = entry
    ui.refresh_statuslines()
end

--- Open the basic-block Control Flow Graph view for the current or specified function.
function M.open_control_flow(arg)
    local md5 = common.require_md5(arg)
    if not md5 then return nil end

    local entry_opt, addr_opt = resolve_function_target(md5, arg)
    local key = entry_opt or addr_opt or 'default'
    local buf_name = string.format('ghidra-cfg://%s/%s', md5, format.url_encode(key))
    local buf = common.open_split_buffer(buf_name, 'ghidra-cfg://' .. md5 .. '/', true)
    local ok, err = pcall(M.render_cfg_into_buf, buf, md5, entry_opt, addr_opt)
    if not ok then
        vim.notify('Control Flow error: ' .. tostring(err), vim.log.levels.ERROR)
        return nil
    end

    local commands = require('ghidra-lsp.commands')
    local kopts = { buffer = buf, silent = true, nowait = true }
    vim.keymap.set('n', '<CR>', function()
        local rows = vim.b[buf].ghidra_cfg_rows or {}
        local a = rows[vim.api.nvim_win_get_cursor(0)[1]]
        if a then commands.goto_address({ md5 = md5, address = a }) end
    end, kopts)
    vim.keymap.set('n', 'l', function()
        local rows = vim.b[buf].ghidra_cfg_rows or {}
        local a = rows[vim.api.nvim_win_get_cursor(0)[1]] or vim.b[buf].ghidra_cfg_entry
        if a then require('ghidra-lsp.views').open_listing({ md5 = md5, address = a }) end
    end, kopts)
    vim.keymap.set('n', 'r', function()
        pcall(M.render_cfg_into_buf, buf, md5, vim.b[buf].ghidra_cfg_entry, addr_opt)
    end, kopts)
    vim.keymap.set('n', 'q', function()
        if #vim.api.nvim_tabpage_list_wins(0) > 1 then vim.cmd('close') end
    end, kopts)
    return buf
end

--- Fetch and render a bounded Call Graph into the given buffer.
function M.render_call_graph_into_buf(buf, md5, entry_opt, addr_opt, callers_depth, callees_depth)
    local res = client.exec_sync('ghidra.callGraph', {
        md5 = md5,
        entry = entry_opt,
        address = addr_opt,
        callersDepth = callers_depth,
        calleesDepth = callees_depth,
        showTemplateArguments = client.config.template_arguments == 'show',
    })

    local root_id = tostring(res.root or '')
    local root_name = tostring(res.rootName or root_id)
    local nodes = type(res.nodes) == 'table' and res.nodes or {}
    local edges = type(res.edges) == 'table' and res.edges or {}
    local warnings = type(res.warnings) == 'table' and res.warnings or {}

    local node_by_id = {}
    local callers = {}
    local callees = {}
    local root_node = nil

    for _, n in ipairs(nodes) do
        if type(n) == 'table' and n.id then
            node_by_id[n.id] = n
            if n.id == root_id then
                root_node = n
            end
            if type(n.callerDistance) == 'number' then
                table.insert(callers, n)
            end
            if type(n.calleeDistance) == 'number' then
                table.insert(callees, n)
            end
        end
    end
    table.sort(callers, function(a, b)
        if a.callerDistance ~= b.callerDistance then return a.callerDistance < b.callerDistance end
        return tostring(a.name or '') < tostring(b.name or '')
    end)
    table.sort(callees, function(a, b)
        if a.calleeDistance ~= b.calleeDistance then return a.calleeDistance < b.calleeDistance end
        return tostring(a.name or '') < tostring(b.name or '')
    end)

    local root_entry = (root_node and root_node.entry) or entry_opt or root_id
    local lines = {
        string.format('; ══ Call Graph · %s (%s) · %d nodes · %d edges (depth %d/%d) ══',
            root_name,
            format.display_address(root_entry),
            #nodes,
            #edges,
            callers_depth,
            callees_depth),
        '; Keys: <CR> Open Function | l Listing | + / - Depth | r Refresh | q Close',
        '',
    }
    local hl = { { 0, 'Function', 0, -1 }, { 1, 'Comment', 0, -1 } }
    local row_addrs = {}

    if res.limited then
        table.insert(lines, '; ! Graph truncated at server bounds (80 nodes / 240 edges)')
        table.insert(hl, { #lines - 1, 'WarningMsg', 0, -1 })
    end
    for _, w in ipairs(warnings) do
        table.insert(lines, '; ! ' .. tostring(w))
        table.insert(hl, { #lines - 1, 'WarningMsg', 0, -1 })
    end
    if res.limited or #warnings > 0 then
        table.insert(lines, '')
    end

    table.insert(lines, '── Callers (Incoming) ──')
    table.insert(hl, { #lines - 1, 'Title', 0, -1 })
    if #callers == 0 then
        table.insert(lines, '  (none)')
        table.insert(hl, { #lines - 1, 'Comment', 0, -1 })
    else
        for _, n in ipairs(callers) do
            local indent = string.rep('  ', math.max(1, n.callerDistance or 1))
            local line = string.format('%s↑ [d=%d] %s  (%s)',
                indent,
                n.callerDistance or 1,
                tostring(n.name or n.entry),
                format.display_address(n.entry or n.id))
            table.insert(lines, line)
            row_addrs[#lines] = n.entry
            table.insert(hl, { #lines - 1, 'Function', #indent, #line })
        end
    end

    table.insert(lines, '')
    table.insert(lines, '── Root ──')
    table.insert(hl, { #lines - 1, 'Title', 0, -1 })
    table.insert(lines, string.format('  ▶ %s  (%s)', root_name, format.display_address(root_entry)))
    row_addrs[#lines] = root_entry
    table.insert(hl, { #lines - 1, 'Special', 0, -1 })

    table.insert(lines, '')
    table.insert(lines, '── Callees (Outgoing) ──')
    table.insert(hl, { #lines - 1, 'Title', 0, -1 })
    if #callees == 0 then
        table.insert(lines, '  (none)')
        table.insert(hl, { #lines - 1, 'Comment', 0, -1 })
    else
        for _, n in ipairs(callees) do
            local indent = string.rep('  ', math.max(1, n.calleeDistance or 1))
            local line = string.format('%s↓ [d=%d] %s  (%s)',
                indent,
                n.calleeDistance or 1,
                tostring(n.name or n.entry),
                format.display_address(n.entry or n.id))
            table.insert(lines, line)
            row_addrs[#lines] = n.entry
            table.insert(hl, { #lines - 1, 'Function', #indent, #line })
        end
    end

    if #edges > 0 then
        table.insert(lines, '')
        table.insert(lines, '── Call Edges ──')
        table.insert(hl, { #lines - 1, 'Title', 0, -1 })
        for _, e in ipairs(edges) do
            local fn_from = node_by_id[e.from]
            local fn_to = node_by_id[e.to]
            local from_lbl = fn_from and tostring(fn_from.name or e.from) or tostring(e.from)
            local to_lbl = fn_to and tostring(fn_to.name or e.to) or tostring(e.to)
            local sites = {}
            for _, s in ipairs(e.sites or {}) do
                table.insert(sites, format.display_address(s))
            end
            local site_s = #sites > 0 and ('  @ ' .. table.concat(sites, ', ')) or ''
            local line = string.format('  %s ──▶ %s%s', from_lbl, to_lbl, site_s)
            table.insert(lines, line)
            row_addrs[#lines] = fn_to and fn_to.entry or (fn_from and fn_from.entry)
            table.insert(hl, { #lines - 1, 'Comment', 0, -1 })
        end
    end

    common.set_readonly_lines(buf, lines, 'ghidra-callgraph', common.NS_CALLGRAPH, hl)

    vim.b[buf].ghidra_callgraph_rows = row_addrs
    vim.b[buf].ghidra_callgraph_state = {
        md5 = md5,
        entry = root_entry,
        callersDepth = callers_depth,
        calleesDepth = callees_depth,
    }
    ui.refresh_statuslines()
end

--- Open the bounded Call Graph view for the current or specified function.
function M.open_call_graph(arg)
    local md5 = common.require_md5(arg)
    if not md5 then return nil end

    local entry_opt, addr_opt = resolve_function_target(md5, arg)
    local callers_depth = math.max(1, math.min(3, tonumber(type(arg) == 'table' and arg.callersDepth) or 1))
    local callees_depth = math.max(1, math.min(3, tonumber(type(arg) == 'table' and arg.calleesDepth) or 1))

    local key = entry_opt or addr_opt or 'default'
    local buf_name = string.format('ghidra-callgraph://%s/%s', md5, format.url_encode(key))
    local buf = common.open_split_buffer(buf_name, 'ghidra-callgraph://' .. md5 .. '/', true)
    local ok, err = pcall(M.render_call_graph_into_buf, buf, md5, entry_opt, addr_opt, callers_depth, callees_depth)
    if not ok then
        vim.notify('Call Graph error: ' .. tostring(err), vim.log.levels.ERROR)
        return nil
    end

    local commands = require('ghidra-lsp.commands')
    local kopts = { buffer = buf, silent = true, nowait = true }
    vim.keymap.set('n', '<CR>', function()
        local rows = vim.b[buf].ghidra_callgraph_rows or {}
        local e = rows[vim.api.nvim_win_get_cursor(0)[1]]
        if e then commands.open_function(e, md5) end
    end, kopts)
    vim.keymap.set('n', 'l', function()
        local rows = vim.b[buf].ghidra_callgraph_rows or {}
        local st = vim.b[buf].ghidra_callgraph_state or {}
        local a = rows[vim.api.nvim_win_get_cursor(0)[1]] or st.entry
        if a then require('ghidra-lsp.views').open_listing({ md5 = md5, address = a }) end
    end, kopts)
    vim.keymap.set('n', '+', function()
        local st = vim.b[buf].ghidra_callgraph_state or {}
        local d1 = math.min(3, (st.callersDepth or 1) + 1)
        local d2 = math.min(3, (st.calleesDepth or 1) + 1)
        pcall(M.render_call_graph_into_buf, buf, md5, st.entry, nil, d1, d2)
    end, kopts)
    vim.keymap.set('n', '-', function()
        local st = vim.b[buf].ghidra_callgraph_state or {}
        local d1 = math.max(1, (st.callersDepth or 1) - 1)
        local d2 = math.max(1, (st.calleesDepth or 1) - 1)
        pcall(M.render_call_graph_into_buf, buf, md5, st.entry, nil, d1, d2)
    end, kopts)
    vim.keymap.set('n', 'r', function()
        local st = vim.b[buf].ghidra_callgraph_state or {}
        pcall(M.render_call_graph_into_buf, buf, md5, st.entry, nil, st.callersDepth or 1, st.calleesDepth or 1)
    end, kopts)
    vim.keymap.set('n', 'q', function()
        if #vim.api.nvim_tabpage_list_wins(0) > 1 then vim.cmd('close') end
    end, kopts)
    return buf
end

return M
