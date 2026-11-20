-- Copyright 2026 ByteLand Technology Limited
-- SPDX-License-Identifier: MIT

-- Automatic npm installation and binary resolution for ghidra-lsp and ghidra-mcp.
local M = {}

local uv = vim.uv or vim.loop

local NPM_PACKAGES = {
    ['ghidra-lsp'] = '@ghidra-lsp/cli@latest',
    ['ghidra-mcp'] = '@ghidra-mcp/cli@latest',
}

local NPM_SCOPES = {
    ['ghidra-lsp'] = '@ghidra-lsp',
    ['ghidra-mcp'] = '@ghidra-mcp',
}

local SUPPORTED_PLATFORMS = {
    ['darwin-arm64'] = true,
    ['darwin-x64'] = true,
    ['linux-arm64'] = true,
    ['linux-x64'] = true,
    ['win32-arm64'] = true,
    ['win32-x64'] = true,
}

local in_flight = nil
local queued_requests = {}

--- Return true when Neovim is running on Windows.
local function is_windows()
    return vim.fn.has('win32') == 1 or vim.fn.has('win64') == 1 or uv.os_uname().sysname == 'Windows_NT'
end

--- Return the shared managed storage root shared with VS Code.
function M.managed_root()
    if is_windows() then
        local base = vim.env.LOCALAPPDATA
        if not base or vim.trim(base) == '' then
            base = vim.fs.joinpath(uv.os_homedir(), 'AppData', 'Local')
        end
        return vim.fs.joinpath(vim.trim(base), 'ghidra-lsp')
    end
    local base = vim.env.XDG_DATA_HOME
    if not base or vim.trim(base) == '' then
        base = vim.fs.joinpath(uv.os_homedir(), '.local', 'share')
    end
    return vim.fs.joinpath(vim.trim(base), 'ghidra-lsp')
end

--- Return the shared managed directory holding native executables.
function M.managed_bin_dir()
    return vim.fs.joinpath(M.managed_root(), 'bin')
end

--- Return the native executable filename for `target` on the host platform.
function M.executable_name(target)
    return is_windows() and (target .. '.exe') or target
end

--- Return the full managed executable path for `target`.
function M.managed_executable(target)
    return vim.fs.joinpath(M.managed_bin_dir(), M.executable_name(target))
end

--- Return the npm platform package suffix for the host OS and CPU architecture.
function M.platform_suffix()
    local uname = uv.os_uname()
    local sysname = uname.sysname or ''
    local os_key
    if is_windows() or sysname == 'Windows_NT' then
        os_key = 'win32'
    elseif sysname == 'Darwin' then
        os_key = 'darwin'
    elseif sysname == 'Linux' then
        os_key = 'linux'
    else
        return nil, 'Unsupported OS for automatic npm installation: ' .. tostring(sysname)
    end

    local raw_arch = (uname.machine or ''):lower()
    if raw_arch == '' and os_key == 'win32' then
        raw_arch = (vim.env.PROCESSOR_ARCHITECTURE or ''):lower()
    end
    local arch_key
    if raw_arch == 'x86_64' or raw_arch == 'amd64' or raw_arch == 'x64' then
        arch_key = 'x64'
    elseif raw_arch == 'arm64' or raw_arch == 'aarch64' then
        arch_key = 'arm64'
    else
        return nil, 'Unsupported architecture for automatic npm installation: ' .. tostring(uname.machine)
    end

    local suffix = os_key .. '-' .. arch_key
    if not SUPPORTED_PLATFORMS[suffix] then
        return nil, 'Unsupported platform for automatic npm installation: ' .. suffix
    end
    return suffix, nil
end

--- Return true when `path` exists as an executable regular file.
local function is_executable(path)
    if type(path) ~= 'string' or path == '' then
        return false
    end
    local stat = uv.fs_stat(path)
    if not stat or stat.type ~= 'file' then
        return false
    end
    return vim.fn.executable(path) == 1
end

--- Return true when `configured` leaves the default command name unchanged.
local function is_default_setting(configured, default_name)
    if configured == nil then
        return true
    end
    local trimmed = vim.trim(tostring(configured))
    return trimmed == '' or trimmed == default_name
end

--- Resolve `default_name` across custom setting, managed bin directory, and `PATH`.
function M.find_binary(configured, default_name)
    if not is_default_setting(configured, default_name) then
        return vim.trim(tostring(configured)), 'custom'
    end
    local managed = M.managed_executable(default_name)
    if is_executable(managed) then
        return managed, 'managed'
    end
    local on_path = vim.fn.exepath(default_name)
    if type(on_path) == 'string' and on_path ~= '' and is_executable(on_path) then
        return on_path, 'path'
    end
    return nil, 'missing'
end

--- Deduplicate target names while validating each entry.
local function normalize_targets(targets)
    local list = (type(targets) == 'table' and #targets > 0) and targets or { 'ghidra-lsp', 'ghidra-mcp' }
    local seen = {}
    local unique = {}
    for _, target in ipairs(list) do
        if NPM_PACKAGES[target] and not seen[target] then
            seen[target] = true
            table.insert(unique, target)
        end
    end
    return unique
end

--- Return true when every entry in `needles` is contained in `haystack`.
local function covers_targets(haystack, needles)
    local lookup = {}
    for _, item in ipairs(haystack) do
        lookup[item] = true
    end
    for _, item in ipairs(needles) do
        if not lookup[item] then
            return false
        end
    end
    return true
end

--- Ensure the isolated npm staging directory and private `package.json` exist.
local function prepare_npm_workspace()
    local npm_dir = vim.fs.joinpath(M.managed_root(), 'npm')
    local bin_dir = M.managed_bin_dir()
    vim.fn.mkdir(npm_dir, 'p')
    vim.fn.mkdir(bin_dir, 'p')
    local manifest = vim.fs.joinpath(npm_dir, 'package.json')
    if not uv.fs_stat(manifest) then
        local fd, open_err = uv.fs_open(manifest, 'w', tonumber('644', 8))
        if not fd then
            return nil, 'Cannot write npm manifest: ' .. tostring(open_err)
        end
        uv.fs_write(fd, '{"private":true}\n', -1)
        uv.fs_close(fd)
    end
    return npm_dir, nil
end

--- Copy one platform executable atomically into the shared managed bin directory.
local function copy_managed_binary(npm_dir, suffix, target)
    local exe = M.executable_name(target)
    local src = vim.fs.joinpath(npm_dir, 'node_modules', NPM_SCOPES[target], suffix, 'bin', exe)
    local stat = uv.fs_stat(src)
    if not stat or stat.type ~= 'file' then
        return nil, string.format(
            'Installed %s did not include %s for %s. Check npm optional dependencies or libc compatibility.',
            NPM_PACKAGES[target],
            exe,
            suffix
        )
    end
    local dest = M.managed_executable(target)
    local tmp = string.format('%s.tmp.%d.%d', dest, uv.os_getpid(), math.floor(uv.hrtime() % 1000000000))
    local ok_copy, err_copy = uv.fs_copyfile(src, tmp)
    if not ok_copy then
        pcall(uv.fs_unlink, tmp)
        return nil, 'Failed to copy binary: ' .. tostring(err_copy)
    end
    if not is_windows() then
        local ok_chmod, err_chmod = uv.fs_chmod(tmp, tonumber('755', 8))
        if not ok_chmod then
            pcall(uv.fs_unlink, tmp)
            return nil, 'Failed to set executable permission: ' .. tostring(err_chmod)
        end
    end
    local ok_rename, err_rename = uv.fs_rename(tmp, dest)
    if not ok_rename then
        pcall(uv.fs_unlink, tmp)
        return nil, 'Failed to place binary at ' .. dest .. ': ' .. tostring(err_rename)
    end
    return dest, nil
end

--- Extract the last non-empty diagnostic line from `npm` output.
local function last_output_line(obj)
    local combined = ((obj.stderr or '') .. '\n' .. (obj.stdout or ''))
    local last = ''
    for line in combined:gmatch('[^\r\n]+') do
        local trimmed = vim.trim(line)
        if trimmed ~= '' then
            last = trimmed
        end
    end
    return last
end

--- Run `npm install` asynchronously for `targets` and extract native binaries.
function M.install_async(targets, callback)
    local unique = normalize_targets(targets)
    if #unique == 0 then
        vim.schedule(function()
            if callback then callback(true, {}) end
        end)
        return
    end

    if in_flight then
        if covers_targets(in_flight.targets, unique) then
            table.insert(in_flight.callbacks, callback)
        else
            table.insert(queued_requests, { targets = unique, callback = callback })
        end
        return
    end

    local suffix, suffix_err = M.platform_suffix()
    if not suffix then
        vim.schedule(function()
            if callback then callback(false, suffix_err) end
        end)
        return
    end

    if vim.fn.executable('npm') ~= 1 then
        vim.schedule(function()
            if callback then
                callback(false, 'npm was not found on PATH. Install Node.js (>= 18) and npm, or install ghidra-lsp and ghidra-mcp manually.')
            end
        end)
        return
    end

    local npm_dir, ws_err = prepare_npm_workspace()
    if not npm_dir then
        vim.schedule(function()
            if callback then callback(false, ws_err) end
        end)
        return
    end

    in_flight = {
        targets = unique,
        callbacks = { callback },
    }

    local cmd = is_windows() and { 'cmd.exe', '/d', '/s', '/c', 'npm' } or { 'npm' }
    for _, arg in ipairs({ 'install', '--no-save', '--no-audit', '--no-fund', '--package-lock=false', '--include=optional' }) do
        table.insert(cmd, arg)
    end
    for _, target in ipairs(unique) do
        table.insert(cmd, NPM_PACKAGES[target])
    end

    vim.system(cmd, { cwd = npm_dir, text = true }, function(obj)
        vim.schedule(function()
            local ok = false
            local result_or_err
            if obj.code ~= 0 then
                local detail = last_output_line(obj)
                result_or_err = string.format(
                    'npm install exited with code %s%s',
                    tostring(obj.code),
                    detail ~= '' and (': ' .. detail) or ''
                )
            else
                local installed = {}
                local copy_err = nil
                for _, target in ipairs(unique) do
                    local dest, err = copy_managed_binary(npm_dir, suffix, target)
                    if not dest then
                        copy_err = err
                        break
                    end
                    installed[target] = dest
                end
                if copy_err then
                    result_or_err = copy_err
                else
                    ok = true
                    result_or_err = installed
                end
            end

            local current = in_flight
            in_flight = nil
            for _, cb in ipairs(current.callbacks) do
                if cb then
                    pcall(cb, ok, result_or_err)
                end
            end

            if #queued_requests > 0 then
                local next_req = table.remove(queued_requests, 1)
                M.install_async(next_req.targets, next_req.callback)
            end
        end)
    end)
end

--- Run `npm install` synchronously until completion or timeout.
function M.install_sync(targets, timeout_ms)
    local done = false
    local install_ok = false
    local install_res = nil
    M.install_async(targets, function(ok, res)
        done = true
        install_ok = ok
        install_res = res
    end)
    local completed = vim.wait(timeout_ms or 180000, function()
        return done
    end, 50)
    if not completed then
        return nil, 'Timed out waiting for npm installation'
    end
    if not install_ok then
        return nil, tostring(install_res)
    end
    return install_res, nil
end

--- Resolve `ghidra-lsp` and `ghidra-mcp`, auto-installing missing defaults when enabled.
function M.resolve_or_install(config)
    config = config or {}
    local server_path, server_source = M.find_binary(config.server_path, 'ghidra-lsp')
    local mcp_command, mcp_source = M.find_binary(config.mcp_command, 'ghidra-mcp')
    local missing = {}
    if server_source == 'missing' then
        table.insert(missing, 'ghidra-lsp')
    end
    if mcp_source == 'missing' then
        table.insert(missing, 'ghidra-mcp')
    end

    if #missing > 0 then
        if config.auto_install == false then
            return nil, string.format(
                'Missing %s. Run :GhidraInstall, enable auto_install, or configure server_path/mcp_command.',
                table.concat(missing, ' and ')
            )
        end
        vim.notify('Ghidra LSP: installing ' .. table.concat(missing, ' and ') .. ' via npm...', vim.log.levels.INFO)
        local installed, err = M.install_sync(missing)
        if not installed then
            return nil, err
        end
        if server_source == 'missing' then
            server_path = installed['ghidra-lsp']
        end
        if mcp_source == 'missing' then
            mcp_command = installed['ghidra-mcp']
        end
        vim.notify(
            'Ghidra LSP: installed ' .. table.concat(missing, ' and ') .. ' into ' .. M.managed_bin_dir(),
            vim.log.levels.INFO
        )
    end

    return {
        server_path = server_path,
        mcp_command = mcp_command,
    }, nil
end

return M
