-- Copyright 2026 ByteLand Technology Limited
-- SPDX-License-Identifier: MIT

-- Exact 64-bit unsigned address comparison, display formatting, and URL encoding helpers.
local M = {}

--- Decode percent-encoded bytes in a URI component.
function M.url_decode(str)
    return (tostring(str or ''):gsub('%%(%x%x)', function(hex)
        return string.char(tonumber(hex, 16))
    end))
end

--- Percent-encode all non-unreserved bytes in a URI component.
function M.url_encode(str)
    return (tostring(str or ''):gsub('[^A-Za-z0-9%-%._~]', function(c)
        return string.format('%%%02X', string.byte(c))
    end))
end

--- Percent-encode a URI path while preserving slash separators.
function M.url_encode_path(str)
    return (tostring(str or ''):gsub('[^A-Za-z0-9%-%._~/]', function(c)
        return string.format('%%%02X', string.byte(c))
    end))
end

--- Parse a canonical space:offset or bare hex address into high and low 32-bit parts.
function M.parse_address(value)
    if type(value) ~= 'string' then return nil end
    local trimmed = vim.trim(value)
    if trimmed == '' then return nil end

    local space, raw_hex = trimmed:match('^([^:]+):(.*)$')
    if not space then
        space = ''
        raw_hex = trimmed
    end
    local hex = raw_hex:gsub('^0[xX]', '')
    if hex == '' or not hex:match('^%x+$') or #hex > 16 then
        return nil
    end

    local padded = string.rep('0', 16 - #hex) .. hex:lower()
    local hi = tonumber(padded:sub(1, 8), 16)
    local lo = tonumber(padded:sub(9, 16), 16)
    return {
        space = space,
        hi = hi,
        lo = lo,
        hex = hex:lower(),
        width = #hex,
    }
end

--- Compare two addresses within compatible space; returns -1, 0, or 1, or nil if incompatible.
function M.compare_addresses(a, b)
    local pa = M.parse_address(a)
    local pb = M.parse_address(b)
    if not pa or not pb then return nil end
    if pa.space ~= '' and pb.space ~= '' and pa.space:lower() ~= pb.space:lower() then
        return nil
    end
    if pa.hi ~= pb.hi then
        return pa.hi < pb.hi and -1 or 1
    end
    if pa.lo ~= pb.lo then
        return pa.lo < pb.lo and -1 or 1
    end
    return 0
end

--- Return true when two addresses represent the same space and offset.
function M.same_address(a, b)
    return M.compare_addresses(a, b) == 0
end

--- Strip the ram: prefix for display while preserving all other address spaces.
function M.display_address(addr)
    if type(addr) ~= 'string' then return tostring(addr or '') end
    local trimmed = vim.trim(addr)
    if trimmed:lower():sub(1, 4) == 'ram:' then
        return trimmed:sub(5)
    end
    return trimmed
end

local OPERATORS = {
    '<<=', '>>=', '<=>', '<<', '>>', '<=', '>=', '->*', '->', '<', '>',
}

--- Return true when `ch` is an identifier character.
local function is_ident_char(ch)
    return ch:match('[%w_]') ~= nil
end

--- Collapse outer C++ template argument lists to <...> while preserving operator names.
function M.brief_templates(name)
    if type(name) ~= 'string' or name == '' then return '' end
    local out = {}
    local depth = 0
    local i = 1
    local len = #name
    while i <= len do
        local prev = i > 1 and name:sub(i - 1, i - 1) or ''
        if depth == 0 and name:sub(i, i + 7) == 'operator' and (i == 1 or not is_ident_char(prev)) then
            table.insert(out, 'operator')
            i = i + 8
            while i <= len and name:sub(i, i) == ' ' do
                table.insert(out, ' ')
                i = i + 1
            end
            local rest = name:sub(i)
            for _, sym in ipairs(OPERATORS) do
                if rest:sub(1, #sym) == sym then
                    table.insert(out, sym)
                    i = i + #sym
                    break
                end
            end
        else
            local ch = name:sub(i, i)
            if ch == '<' and (depth > 0 or (i > 1 and (is_ident_char(prev) or prev == '>'))) then
                if depth == 0 then
                    table.insert(out, '<…>')
                end
                depth = depth + 1
            elseif ch == '>' and depth > 0 then
                depth = depth - 1
            elseif depth == 0 then
                table.insert(out, ch)
            end
            i = i + 1
        end
    end
    if depth > 0 then
        return name
    end
    return table.concat(out)
end

--- Compute display name for a symbol or function record without modifying its identity.
function M.display_symbol_name(item, omit_templates)
    if type(item) ~= 'table' then return tostring(item or '') end
    local full
    if type(item.demangled_name) == 'string' and item.demangled_name ~= '' then
        full = item.demangled_name
    else
        local ns = item.namespace
        local base = item.name or ''
        if type(ns) == 'string' and ns ~= '' and ns ~= 'Global' then
            full = ns .. '::' .. base
        else
            full = base
        end
    end
    if omit_templates == false then
        return full
    end
    return M.brief_templates(full)
end

--- Return the full uncollapsed display name for a symbol or function record.
function M.full_symbol_name(item)
    return M.display_symbol_name(item, false)
end

return M
