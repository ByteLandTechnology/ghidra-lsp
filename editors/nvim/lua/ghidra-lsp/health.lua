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
    local server_path = client_mod.config.server_path
    if not server_path or server_path == '' then
        server_path = 'ghidra-lsp'
    end

    local resolved = vim.fn.exepath(server_path)
    if resolved ~= '' or vim.fn.executable(server_path) == 1 then
        health.ok('Ghidra LSP server binary found: ' .. (resolved ~= '' and resolved or server_path))
    else
        health.error('Ghidra LSP server binary not found or not executable: ' .. tostring(server_path))
    end

    local mcp_cmd = client_mod.config.mcp_command or 'ghidra-mcp'
    local mcp_resolved = vim.fn.exepath(mcp_cmd)
    if mcp_resolved ~= '' or vim.fn.executable(mcp_cmd) == 1 then
        health.ok('Ghidra MCP executable found: ' .. (mcp_resolved ~= '' and mcp_resolved or mcp_cmd))
    else
        health.warn('Ghidra MCP executable not found in PATH: ' .. tostring(mcp_cmd))
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
