-- Copyright 2026 ByteLand Technology Limited
-- SPDX-License-Identifier: MIT

-- Health checks for :checkhealth ghidra-lsp.
local M = {}

--- Verify Neovim version, binaries, LSP client, and active session state.
function M.check()
    local health = vim.health
    health.start('ghidra-lsp')

    if vim.fn.has('nvim-0.10') == 1 then
        health.ok('Neovim >= 0.10 (' .. tostring(vim.version()) .. ')')
    else
        health.error('Neovim >= 0.10 is required')
    end

    local client_mod = require('ghidra-lsp.client')
    local installer = require('ghidra-lsp.installer')
    health.info('Shared managed binary directory: ' .. installer.managed_bin_dir())
    health.info('Automatic npm installation (auto_install): ' .. tostring(client_mod.config.auto_install ~= false))

    if vim.fn.executable('npm') == 1 then
        health.ok('npm found: ' .. vim.fn.exepath('npm'))
    else
        health.warn('npm not found on PATH (required for automatic installation and :GhidraInstall)')
    end

    local server_resolved, server_source = installer.find_binary(client_mod.config.server_path, 'ghidra-lsp')
    if server_resolved then
        health.ok('Ghidra LSP server binary found (' .. server_source .. '): ' .. server_resolved)
    else
        health.error('Ghidra LSP server binary not found; run :GhidraInstall or set server_path')
    end

    local mcp_resolved, mcp_source = installer.find_binary(client_mod.config.mcp_command, 'ghidra-mcp')
    if mcp_resolved then
        health.ok('Ghidra MCP executable found (' .. mcp_source .. '): ' .. mcp_resolved)
    else
        health.warn('Ghidra MCP executable not found (' .. tostring(client_mod.config.mcp_command or 'ghidra-mcp') .. '); run :GhidraInstall or set mcp_command')
    end

    local client = client_mod.get_client()
    if client and not client:is_stopped() then
        health.ok(string.format(
            'LSP client is running (id: %d, initialized: %s, offset_encoding: %s)',
            client.id,
            tostring(client.initialized),
            tostring(client.offset_encoding or 'utf-16')
        ))
    else
        health.warn('LSP client is not currently running')
    end

    local commands = require('ghidra-lsp.commands')
    local md5 = commands.get_active_md5()
    if md5 then
        local name = client_mod.session_names[md5]
        health.ok('Active Ghidra session: ' .. (name and (name .. ' (' .. md5 .. ')') or md5))
        if client_mod.pending_rename[md5] then
            health.info('Pending rename active; save origin buffer (:w) or run :GhidraDiscardRename')
        end
    else
        health.info('No active Ghidra session selected')
    end
end

return M
