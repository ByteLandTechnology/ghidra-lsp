-- Copyright 2026 ByteLand Technology Limited
-- SPDX-License-Identifier: MIT

-- Shared constants, session resolution, metadata cache, and buffer layout helpers for views.
local client = require('ghidra-lsp.client')

local M = {}

M.LISTING_LIMIT = 120
M.HEX_CHUNK_BYTES = 1024 -- 64 rows x 16 bytes.
M.NS_LISTING = vim.api.nvim_create_namespace('ghidra_lsp_listing')
M.NS_MEMORY = vim.api.nvim_create_namespace('ghidra_lsp_memory')
M.NS_CFG = vim.api.nvim_create_namespace('ghidra_lsp_cfg')
M.NS_CALLGRAPH = vim.api.nvim_create_namespace('ghidra_lsp_callgraph')

--- Cache program name and function display names from a server metadata payload.
function M.cache_program_meta(md5, meta)
    if type(meta) ~= 'table' then return end
    if type(meta.programName) == 'string' and meta.programName ~= '' and not client.session_names[md5] then
        client.session_names[md5] = meta.programName
    end
    if type(meta.functions) == 'table' then
        local fn_map = {}
        for _, f in ipairs(meta.functions) do
            if type(f) == 'table' and type(f.entry) == 'string' then
                local disp = tostring(f.displayName or f.name or f.entry)
                fn_map[f.entry:lower()] = disp
                fn_map[f.entry] = disp
            end
        end
        client.function_names[md5] = fn_map
    end
end

--- Fetch and cache program metadata for the specified program MD5.
function M.get_program_meta(md5)
    local meta = client.exec_sync('ghidra.programMeta', {
        md5 = md5,
        showTemplateArguments = client.config.template_arguments == 'show',
    })
    M.cache_program_meta(md5, meta)
    return meta
end

--- Resolve active program MD5 from argument or session state, warning when absent.
function M.require_md5(arg, mark_open)
    local commands = require('ghidra-lsp.commands')
    local md5 = (type(arg) == 'table' and arg.md5) or commands.get_active_md5()
    if not md5 then
        vim.notify('No active Ghidra session', vim.log.levels.WARN)
        return nil
    end
    md5 = md5:lower()
    if mark_open ~= false then
        client.open_sessions[md5] = true
    end
    return md5
end

--- Open or reuse a split window and virtual buffer matching a view URI prefix.
function M.open_split_buffer(buf_name, existing_prefix, prefer_vsplit)
    local existing_win = -1
    local reused_buf = -1
    for _, w in ipairs(vim.api.nvim_list_wins()) do
        if vim.api.nvim_win_is_valid(w) then
            local b = vim.api.nvim_win_get_buf(w)
            local bname = vim.api.nvim_buf_get_name(b)
            if bname:find(existing_prefix, 1, true) == 1 then
                existing_win = w
                reused_buf = b
                break
            end
        end
    end

    if existing_win ~= -1 then
        vim.api.nvim_set_current_win(existing_win)
    else
        local cur_name = vim.api.nvim_buf_get_name(0)
        if prefer_vsplit and cur_name:match('^ghidra') then
            vim.cmd('rightbelow vsplit')
        elseif cur_name:match('^ghidra') then
            vim.cmd('belowright split')
        end
    end

    local buf = require('ghidra-lsp.buffer').find_buf_by_name(buf_name)
    if buf == -1 then
        buf = vim.api.nvim_create_buf(false, true)
        pcall(vim.api.nvim_buf_set_name, buf, buf_name)
    end
    vim.api.nvim_set_current_buf(buf)
    pcall(function() vim.wo[0].wrap = false end)
    if reused_buf ~= -1 and reused_buf ~= buf and vim.api.nvim_buf_is_valid(reused_buf) then
        if vim.fn.bufwinid(reused_buf) == -1 then
            pcall(vim.api.nvim_buf_delete, reused_buf, { force = true })
        end
    end
    return buf
end

--- Populate a read-only virtual view buffer with lines and optional highlights.
function M.set_readonly_lines(buf, lines, filetype, ns, highlights)
    vim.bo[buf].modifiable = true
    vim.bo[buf].readonly = false
    vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
    vim.bo[buf].buftype = 'nofile'
    vim.bo[buf].swapfile = false
    vim.bo[buf].bufhidden = 'hide'
    vim.bo[buf].filetype = filetype
    vim.bo[buf].modifiable = false
    vim.bo[buf].readonly = true
    vim.bo[buf].modified = false

    if ns and type(highlights) == 'table' then
        vim.api.nvim_buf_clear_namespace(buf, ns, 0, -1)
        for _, h in ipairs(highlights) do
            pcall(vim.api.nvim_buf_add_highlight, buf, ns, h[2], h[1], h[3], h[4])
        end
    end
end

--- Resolve the target Ghidra address from arguments or the current buffer cursor.
function M.resolve_target_address(md5, arg)
    local target = type(arg) == 'table' and (arg.address or arg.entry) or (type(arg) == 'string' and arg or nil)
    if target and vim.trim(target) ~= '' then
        local resolved = client.exec_sync('ghidra.resolveTarget', {
            md5 = md5,
            input = vim.trim(target),
        })
        return resolved.address, resolved
    end

    local cur_buf = vim.api.nvim_get_current_buf()
    local cur_name = vim.api.nvim_buf_get_name(cur_buf)
    if cur_name:match('^ghidra://[^/]+/function/') then
        local buffer = require('ghidra-lsp.buffer')
        local win = vim.fn.bufwinid(cur_buf)
        local loc = client.execute_command_sync('ghidra.location', { {
            uri = buffer.canonicalize_uri(cur_name),
            position = buffer.cursor_utf16_position(win ~= -1 and win or 0),
        } })
        if loc and (loc.code_unit_address or loc.address) then
            return loc.code_unit_address or loc.address, { entry = loc.entry }
        end
    elseif cur_name:match('^ghidra%-listing://') then
        local row = vim.api.nvim_win_get_cursor(0)[1]
        local rows = vim.b[cur_buf].ghidra_listing_rows
        if type(rows) == 'table' and rows[row] and rows[row].address then
            return rows[row].address, nil
        end
    elseif cur_name:match('^ghidra%-memory://') then
        local addr = vim.b[cur_buf].ghidra_memory_cursor_addr
        if type(addr) == 'string' and addr ~= '' then
            return addr, nil
        end
    elseif cur_name:match('^ghidra%-cfg://') then
        local rows = vim.b[cur_buf].ghidra_cfg_rows
        local r = vim.api.nvim_win_get_cursor(0)[1]
        if type(rows) == 'table' and rows[r] then
            return rows[r], nil
        end
    elseif cur_name:match('^ghidra%-callgraph://') then
        local rows = vim.b[cur_buf].ghidra_callgraph_rows
        local r = vim.api.nvim_win_get_cursor(0)[1]
        if type(rows) == 'table' and rows[r] then
            return rows[r], nil
        end
    end

    local resolved = client.exec_sync('ghidra.resolveTarget', { md5 = md5, input = '' })
    return resolved.address, resolved
end

--- Format memory block read, write, and execute flags as RWX text.
function M.block_perms(b)
    if not b then return '---' end
    return (b.read and 'R' or '-') .. (b.write and 'W' or '-') .. (b.execute and 'X' or '-')
end

return M
