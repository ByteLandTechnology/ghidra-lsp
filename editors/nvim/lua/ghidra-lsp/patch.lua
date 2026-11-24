-- Copyright 2026 ByteLand Technology Limited
-- SPDX-License-Identifier: MIT

-- Interactive assembly, disassembly, code-unit clear, and byte patching actions.
local client = require('ghidra-lsp.client')
local format = require('ghidra-lsp.format')
local ui = require('ghidra-lsp.ui')
local common = require('ghidra-lsp.views.common')

local M = {}

--- Add a positive byte delta (minus 1) to a canonical hex address string when possible.
local function offset_end_address(addr, byte_length)
    local len = tonumber(byte_length) or 1
    if len <= 1 or type(addr) ~= 'string' then return addr end
    local prefix, hex = addr:match('^([A-Za-z_][A-Za-z0-9_%.%-]*:)([0-9a-fA-F]+)$')
    if not hex then
        prefix = ''
        hex = addr:match('^0x([0-9a-fA-F]+)$') or addr:match('^([0-9a-fA-F]+)$')
    end
    if not hex or #hex > 15 then return addr end
    local base = tonumber(hex, 16)
    if not base then return addr end
    local finish = base + len - 1
    return prefix .. string.format('%0' .. tostring(#hex) .. 'x', finish)
end

--- Refresh all open virtual buffers belonging to `md5` after a mutation commits.
local function refresh_program_buffers(md5)
    local views = require('ghidra-lsp.views')
    local commands = require('ghidra-lsp.commands')
    for _, buf in ipairs(vim.api.nvim_list_bufs()) do
        if vim.api.nvim_buf_is_loaded(buf) then
            local name = vim.api.nvim_buf_get_name(buf)
            local scheme_md5 = name:match('^ghidra%-[a-z]+://([^/]+)/')
            if scheme_md5 and scheme_md5:lower() == md5:lower() then
                pcall(views.refresh_buffer, buf)
            end
        end
    end
    pcall(commands.refresh, { md5 = md5 })
end

--- Resolve `md5`, `start_addr`, and optional `end_addr` from command options, visual lines, or cursor.
local function resolve_target(arg)
    local opts = type(arg) == 'table' and arg or { address = type(arg) == 'string' and arg or nil }
    local md5 = common.require_md5(opts)
    if not md5 then return nil end

    if type(opts.address) == 'string' and opts.address ~= '' then
        local a, b = opts.address:match('^(.-)%.%.(.-)$')
        if a and b and a ~= '' and b ~= '' then
            local ok1, s = pcall(common.resolve_target_address, md5, a)
            local ok2, e = pcall(common.resolve_target_address, md5, b)
            if ok1 and ok2 and s and e then
                return { md5 = md5, address = s, end_address = e }
            end
        end
        local ok, resolved = pcall(common.resolve_target_address, md5, opts.address)
        if not ok or not resolved then
            vim.notify('Address error: ' .. tostring(resolved or opts.address), vim.log.levels.ERROR)
            return nil
        end
        return { md5 = md5, address = resolved, end_address = opts.end_address, length = opts.length }
    end

    local buf = vim.api.nvim_get_current_buf()
    local name = vim.api.nvim_buf_get_name(buf)
    if name:find('^ghidra%-listing://') and type(vim.b[buf].ghidra_listing_rows) == 'table' then
        local rows = vim.b[buf].ghidra_listing_rows
        local l1 = tonumber(opts.line1) or vim.api.nvim_win_get_cursor(0)[1]
        local l2 = tonumber(opts.line2) or l1
        if l2 < l1 then l1, l2 = l2, l1 end
        local first_row, last_row
        for line = l1, l2 do
            if rows[line] and rows[line].address then
                first_row = first_row or rows[line]
                last_row = rows[line]
            end
        end
        if first_row then
            local unit_len = (last_row.unit and tonumber(last_row.unit.byteLength)) or 1
            local end_addr = (first_row ~= last_row or unit_len > 1 and opts.has_range)
                and offset_end_address(last_row.address, unit_len)
                or nil
            return {
                md5 = md5,
                address = first_row.address,
                end_address = end_addr,
                length = (first_row == last_row) and unit_len or nil,
            }
        end
    end

    if name:find('^ghidra%-memory://') then
        local cur_a = vim.b[buf].ghidra_memory_cursor_addr
        if type(cur_a) == 'string' and cur_a ~= '' then
            return { md5 = md5, address = cur_a }
        end
    end

    local ok, resolved = pcall(common.resolve_target_address, md5, nil)
    if not ok or not resolved then
        vim.notify('Address error: ' .. tostring(resolved or 'no target address'), vim.log.levels.ERROR)
        return nil
    end
    return { md5 = md5, address = resolved }
end

--- Build a `ListingScope` selector table from a resolved target.
local function make_selector(target)
    if target.end_address and target.end_address ~= '' and not format.same_address(target.address, target.end_address) then
        return { kind = 'range', start = target.address, ['end'] = target.end_address }
    end
    return { kind = 'address', address = target.address }
end

--- Split a semicolon-separated string into non-empty Sleigh instruction strings.
local function parse_instructions(raw)
    local out = {}
    for part in tostring(raw or ''):gmatch('[^;]+') do
        local trimmed = vim.trim(part)
        if trimmed ~= '' then
            table.insert(out, trimmed)
        end
    end
    return out
end

--- Strip spaces and `0x` prefixes and validate an even-length hex byte string.
local function parse_hex_bytes(raw)
    local cleaned = tostring(raw or ''):gsub('0[xX]', ''):gsub('[%s,_%-]+', ''):lower()
    if cleaned == '' or (#cleaned % 2) ~= 0 or not cleaned:match('^[0-9a-f]+$') then
        return nil, 'Enter an even number of hex digits, for example "90 90" or "31c0c3".'
    end
    return cleaned, math.floor(#cleaned / 2)
end

--- Read up to `count` bytes as spaced hex for pre-filling the byte-patch prompt.
local function preview_hex(md5, address, count)
    local ok, res = pcall(client.exec_sync, 'ghidra.query', {
        md5 = md5,
        domain = 'memory',
        operation = 'read',
        params = { selector = { address = address }, length = math.max(1, math.min(32, count or 4)), encoding = 'hex' },
    })
    if not ok or type(res) ~= 'table' or type(res.bytes) ~= 'table' or type(res.bytes.data) ~= 'string' then
        return ''
    end
    return (res.bytes.data:gsub('(..)', '%1 '):gsub('%s+$', ''))
end

--- Assemble one or more Sleigh instructions at the target address through `ghidra.mutate`.
function M.assemble(arg)
    local target = resolve_target(arg)
    if not target then return end
    local disp = format.display_address(target.address)

    local function run_assemble(insts, pad_nop)
        local ok, res = pcall(client.exec_sync, 'ghidra.mutate', {
            md5 = target.md5,
            domain = 'instruction',
            operation = 'assemble',
            params = {
                selector = { address = target.address },
                instructions = insts,
                pad_nop = pad_nop == true,
            },
        })
        if not ok then
            vim.notify('Assemble failed: ' .. tostring(res), vim.log.levels.ERROR)
            return
        end
        refresh_program_buffers(target.md5)
        local items = (type(res) == 'table' and type(res.result) == 'table' and type(res.result.items) == 'table')
            and #res.result.items or #insts
        vim.notify(string.format('Assembled %d instruction(s) at %s', items, disp), vim.log.levels.INFO)
    end

    if type(arg) == 'table' and type(arg.instructions) == 'table' and #arg.instructions > 0 then
        run_assemble(arg.instructions, arg.pad_nop ~= false)
        return
    end

    vim.ui.input({
        prompt = 'Assemble at ' .. disp .. ' (; between instructions): ',
    }, function(input)
        if not input or vim.trim(input) == '' then return end
        local insts = parse_instructions(input)
        if #insts == 0 then return end
        ui.pick({
            { label = 'Pad leftover instruction bytes with NOP', pad_nop = true },
            { label = 'Assemble exact instruction bytes only', pad_nop = false },
        }, {
            prompt = 'Assemble mode:',
            format_item = function(item) return item.label end,
        }, function(choice)
            if choice then
                run_assemble(insts, choice.pad_nop)
            end
        end)
    end)
end

--- Disassemble undefined bytes at the cursor address or selected range through `ghidra.mutate`.
function M.disassemble(arg)
    local target = resolve_target(arg)
    if not target then return end
    local selector = make_selector(target)
    local ok, res = pcall(client.exec_sync, 'ghidra.mutate', {
        md5 = target.md5,
        domain = 'instruction',
        operation = 'disassemble',
        params = { selector = selector },
    })
    if not ok then
        vim.notify('Disassemble failed: ' .. tostring(res), vim.log.levels.ERROR)
        return
    end
    refresh_program_buffers(target.md5)
    local items = (type(res) == 'table' and type(res.result) == 'table' and type(res.result.items) == 'table')
        and #res.result.items or 0
    local label = selector.kind == 'range'
        and (format.display_address(selector.start) .. '..' .. format.display_address(selector['end']))
        or format.display_address(target.address)
    vim.notify(string.format('Disassembled %d instruction(s) at %s', items, label), vim.log.levels.INFO)
end

--- Clear instructions and defined data at the cursor address or selected range through `ghidra.mutate`.
function M.clear_code_units(arg)
    local target = resolve_target(arg)
    if not target then return end
    local selector = make_selector(target)
    local label = selector.kind == 'range'
        and (format.display_address(selector.start) .. '..' .. format.display_address(selector['end']))
        or format.display_address(target.address)

    local function run_clear()
        local ok, res = pcall(client.exec_sync, 'ghidra.mutate', {
            md5 = target.md5,
            domain = 'code_unit',
            operation = 'clear',
            params = { selector = selector },
        })
        if not ok then
            vim.notify('Clear failed: ' .. tostring(res), vim.log.levels.ERROR)
            return
        end
        refresh_program_buffers(target.md5)
        vim.notify('Cleared code units at ' .. label, vim.log.levels.INFO)
    end

    if type(arg) == 'table' and arg.confirm == false then
        run_clear()
        return
    end

    ui.pick({
        { label = 'Clear code units at ' .. label, ok = true },
        { label = 'Cancel', ok = false },
    }, {
        prompt = 'Confirm clear:',
        format_item = function(item) return item.label end,
    }, function(choice)
        if choice and choice.ok then
            run_clear()
        end
    end)
end

--- Write hexadecimal bytes at the target address with optional clear and disassembly flags.
function M.patch_bytes(arg)
    local target = resolve_target(arg)
    if not target then return end
    local disp = format.display_address(target.address)

    local function run_write(hex, length, clear_existing, disassemble)
        local ok, res = pcall(client.exec_sync, 'ghidra.mutate', {
            md5 = target.md5,
            domain = 'memory',
            operation = 'write',
            params = {
                selector = { address = target.address },
                patch = {
                    bytes = { encoding = 'hex', data = hex, length = length },
                    clear_existing = clear_existing == true,
                    disassemble = disassemble == true,
                },
            },
        })
        if not ok then
            vim.notify('Byte write failed: ' .. tostring(res), vim.log.levels.ERROR)
            return
        end
        refresh_program_buffers(target.md5)
        vim.notify(string.format('Patched %d byte(s) at %s', length, disp), vim.log.levels.INFO)
    end

    if type(arg) == 'table' and type(arg.bytes) == 'string' then
        local hex, len_or_err = parse_hex_bytes(arg.bytes)
        if not hex then
            vim.notify(tostring(len_or_err), vim.log.levels.ERROR)
            return
        end
        run_write(hex, len_or_err, arg.clear_existing ~= false, arg.disassemble == true)
        return
    end

    local initial = preview_hex(target.md5, target.address, target.length or 4)
    vim.ui.input({
        prompt = 'Patch hex bytes at ' .. disp .. ': ',
        default = initial,
    }, function(input)
        if not input or vim.trim(input) == '' then return end
        local hex, len_or_err = parse_hex_bytes(input)
        if not hex then
            vim.notify(tostring(len_or_err), vim.log.levels.ERROR)
            return
        end
        ui.pick({
            { label = 'Clear prior code units and disassemble', clear_existing = true, disassemble = true },
            { label = 'Clear prior code units only', clear_existing = true, disassemble = false },
            { label = 'Strict write over undefined bytes only', clear_existing = false, disassemble = false },
        }, {
            prompt = string.format('Patch %d byte(s) at %s:', len_or_err, disp),
            format_item = function(item) return item.label end,
        }, function(choice)
            if choice then
                run_write(hex, len_or_err, choice.clear_existing, choice.disassemble)
            end
        end)
    end)
end

return M
