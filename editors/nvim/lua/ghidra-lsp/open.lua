-- Copyright 2026 ByteLand Technology Limited
-- SPDX-License-Identifier: MIT

-- Parses options, completes arguments, and builds requests for :GhidraOpenBinary.
local M = {}

local FIRMWARE_EXTS = {
    bin = true,
    hex = true,
    ihex = true,
    srec = true,
}

local KEY_ALIASES = {
    programname = 'programName',
    program_name = 'programName',
    ['program-name'] = 'programName',
    processor = 'processor',
    compilerspec = 'compilerSpec',
    compiler_spec = 'compilerSpec',
    ['compiler-spec'] = 'compilerSpec',
    loader = 'loader',
    baseaddress = 'baseAddress',
    base_address = 'baseAddress',
    ['base-address'] = 'baseAddress',
    reimport = 'reimport',
    analyze = 'analyze',
}

local COMPLETIONS = {
    'programName=',
    'processor=',
    'compilerSpec=',
    'loader=',
    'baseAddress=',
    'reimport=true',
    'reimport=false',
}

local function parse_bool(raw)
    if type(raw) == 'boolean' then return raw end
    if type(raw) ~= 'string' then return nil end
    local lower = vim.trim(raw):lower()
    if lower == 'true' or lower == '1' or lower == 'yes' then return true end
    if lower == 'false' or lower == '0' or lower == 'no' then return false end
    return nil
end

--- Return true when `path` ends with a headerless firmware extension.
function M.is_firmware_path(path)
    if type(path) ~= 'string' then return false end
    local ext = path:match('%.([a-zA-Z0-9]+)$')
    return ext ~= nil and FIRMWARE_EXTS[ext:lower()] == true
end

--- Return true when `path` ends with `.gpr`.
function M.is_gpr_path(path)
    return type(path) == 'string' and path:lower():match('%.gpr$') ~= nil
end

--- Normalize a Lua options table into `ghidra.openBinary` fields.
function M.normalize_options(opts)
    local out = {}
    if type(opts) ~= 'table' then return out end
    for k, v in pairs(opts) do
        if type(k) == 'string' then
            local canonical = KEY_ALIASES[k:lower()]
            if canonical == 'reimport' or canonical == 'analyze' then
                local flag = parse_bool(v)
                if flag ~= nil then out[canonical] = flag end
            elseif canonical and type(v) == 'string' then
                local trimmed = vim.trim(v)
                if trimmed ~= '' then out[canonical] = trimmed end
            end
        end
    end
    return out
end

local function unquote(text)
    if type(text) ~= 'string' or #text < 2 then return text end
    local first = text:sub(1, 1)
    local last = text:sub(-1)
    if (first == '"' and last == '"') or (first == "'" and last == "'") then
        return text:sub(2, -2)
    end
    return text
end

--- Parse `:GhidraOpenBinary` argument list into `(target, options)`.
function M.parse_fargs(fargs)
    local target = nil
    local raw_opts = {}
    local idx = 1
    local list = fargs or {}
    while idx <= #list do
        local token = list[idx]
        local stripped = token:gsub('^%-%-?', '')
        local key, val = stripped:match('^([%w_%-]+)=(.*)$')
        local canonical = key and KEY_ALIASES[key:lower()] or nil
        if canonical then
            local quote = val:sub(1, 1)
            if (quote == '"' or quote == "'") and (#val == 1 or val:sub(-1) ~= quote) then
                while idx < #list do
                    idx = idx + 1
                    val = val .. ' ' .. list[idx]
                    if list[idx]:sub(-1) == quote then break end
                end
            end
            raw_opts[canonical] = unquote(val)
        elseif stripped:lower() == 'reimport' and token:sub(1, 1) == '-' then
            raw_opts.reimport = true
        elseif stripped:lower() == 'analyze' and token:sub(1, 1) == '-' then
            raw_opts.analyze = true
        elseif not target then
            target = unquote(token)
        else
            target = unquote(target .. ' ' .. token)
        end
        idx = idx + 1
    end
    return target, M.normalize_options(raw_opts)
end

--- Provide completion candidates for `:GhidraOpenBinary`.
function M.complete(arg_lead, cmd_line)
    local lead = arg_lead or ''
    local before = (cmd_line or ''):sub(1, #(cmd_line or '') - #lead)
    local after_cmd = before:gsub('^%s*GhidraOpenBinary!?%s*', '')
    if after_cmd == '' and not lead:find('=', 1, true) and lead:sub(1, 1) ~= '-' then
        return vim.fn.getcompletion(lead, 'file')
    end
    local out = {}
    for _, item in ipairs(COMPLETIONS) do
        if lead == '' or item:lower():find(lead:gsub('^%-%-?', ''):lower(), 1, true) == 1 then
            table.insert(out, item)
        end
    end
    if #out == 0 then
        return vim.fn.getcompletion(lead, 'file')
    end
    return out
end

--- Resolve open_binary arguments into `(target, options, callback, from_prompt_only)`.
function M.resolve_call(target_or_opts, opts_or_cb, callback)
    if type(target_or_opts) == 'table' then
        if vim.islist(target_or_opts) then
            local target, parsed = M.parse_fargs(target_or_opts)
            local cb = type(opts_or_cb) == 'function' and opts_or_cb or callback
            return target, parsed, cb, false
        end
        local cb = type(opts_or_cb) == 'function' and opts_or_cb or callback
        local target = target_or_opts.path or target_or_opts.md5
        return target, M.normalize_options(target_or_opts), cb, false
    end
    local opts = type(opts_or_cb) == 'table' and M.normalize_options(opts_or_cb) or {}
    local cb = type(opts_or_cb) == 'function' and opts_or_cb or callback
    if type(target_or_opts) == 'string' and vim.trim(target_or_opts) ~= '' then
        return vim.trim(target_or_opts), opts, cb, false
    end
    return nil, opts, cb, true
end

--- Build the `ghidra.openBinary` request table and display label.
function M.build_request(raw_target, options, session_names)
    local trimmed = vim.trim(tostring(raw_target or ''))
    if trimmed == '' then return nil, nil, false end
    local is_md5 = trimmed:match('^[a-fA-F0-9]+$') ~= nil and #trimmed == 32
    local req = vim.tbl_extend('force', {}, options or {})
    local display_name
    if is_md5 then
        local lower = trimmed:lower()
        req.md5 = lower
        display_name = req.programName or (session_names and session_names[lower]) or lower:sub(1, 8)
    else
        local expanded = vim.fn.fnamemodify(vim.fn.expand(trimmed), ':p')
        req.path = expanded
        local base = vim.fn.fnamemodify(expanded, ':t')
        display_name = req.programName and (base .. ' (' .. req.programName .. ')') or base
    end
    return req, display_name, is_md5
end

--- Prompt interactively for firmware processor and baseAddress when needed.
function M.maybe_prompt_firmware(req, interactive, done)
    if not interactive or #vim.api.nvim_list_uis() == 0 then
        done(req)
        return
    end
    if type(req.path) ~= 'string' or not M.is_firmware_path(req.path) or req.processor ~= nil then
        done(req)
        return
    end
    vim.ui.input({ prompt = 'Firmware processor (optional, e.g. ARM:LE:32:Cortex): ' }, function(proc)
        if proc == nil then return end
        if vim.trim(proc) ~= '' then req.processor = vim.trim(proc) end
        vim.ui.input({ prompt = 'Base address (optional, e.g. 0x08000000): ' }, function(base)
            if base == nil then return end
            if vim.trim(base) ~= '' then req.baseAddress = vim.trim(base) end
            done(req)
        end)
    end)
end

--- Extract candidate program names from a multi-program `.gpr` open error.
function M.extract_candidates(err_text)
    if type(err_text) ~= 'string' then return nil end
    local list = err_text:match('[Cc]andidate programs:%s*([^\r\n"}]+)')
    if not list then return nil end
    list = list:gsub('%s*%(GhidraScript%)%s*$', '')
    local out = {}
    for item in list:gmatch('[^,]+') do
        local clean = vim.trim(item)
        if clean ~= '' then table.insert(out, clean) end
    end
    return #out > 0 and out or nil
end

return M
