-- Copyright 2026 ByteLand Technology Limited
-- SPDX-License-Identifier: MIT

-- Public entrypoint for the Ghidra LSP Neovim plugin.
local client = require('ghidra-lsp.client')
local buffer = require('ghidra-lsp.buffer')
local commands = require('ghidra-lsp.commands')
local views = require('ghidra-lsp.views')
local edit = require('ghidra-lsp.edit')
local ui = require('ghidra-lsp.ui')

local M = {}

--- Configure plugin options, theme highlights, and buffer autocmds.
function M.setup(opts)
    client.setup(opts)
    ui.setup_highlights()
    local hl_group = vim.api.nvim_create_augroup('GhidraLspHighlights', { clear = true })
    vim.api.nvim_create_autocmd('ColorScheme', {
        group = hl_group,
        callback = function()
            ui.setup_highlights()
        end,
    })
    buffer.setup_autocmds()
    if opts and opts.auto_start then
        client.start_client()
    end
end

--- Install or update managed `ghidra-lsp` and `ghidra-mcp` binaries via npm.
function M.install(target)
    local targets
    if target == nil or target == '' then
        targets = { 'ghidra-lsp', 'ghidra-mcp' }
    elseif target == 'lsp' or target == 'ghidra-lsp' then
        targets = { 'ghidra-lsp' }
    elseif target == 'mcp' or target == 'ghidra-mcp' then
        targets = { 'ghidra-mcp' }
    else
        vim.notify('Ghidra LSP: unknown install target `' .. tostring(target) .. '` (expected lsp or mcp)', vim.log.levels.ERROR)
        return
    end

    local installer = require('ghidra-lsp.installer')
    local was_running = client.stop_client()
    vim.notify('Ghidra LSP: installing ' .. table.concat(targets, ' and ') .. ' via npm...', vim.log.levels.INFO)
    installer.install_async(targets, function(ok, result)
        if not ok then
            vim.notify('Ghidra LSP install failed: ' .. tostring(result), vim.log.levels.ERROR)
            return
        end
        vim.notify(
            'Ghidra LSP: installed ' .. table.concat(targets, ' and ') .. ' into ' .. installer.managed_bin_dir(),
            vim.log.levels.INFO
        )
        if was_running then
            client.start_client()
        end
    end)
end

M.open_binary = commands.open_binary
M.select_session = commands.select_session
M.close_session = commands.close_session
M.reanalyze = commands.reanalyze
M.open_function = commands.open_function
M.goto_address = commands.goto_address
M.goto_origin = commands.goto_origin
M.refresh = commands.refresh
M.discard_rename = commands.discard_rename
M.overview = commands.overview
M.symbols = commands.symbols
M.types = commands.types
M.edit_type = commands.edit_type
M.inspect_type = commands.inspect_type
M.call_hierarchy = commands.call_hierarchy
M.open_listing = views.open_listing
M.open_memory = views.open_memory
M.strings = views.strings
M.open_control_flow = views.open_control_flow
M.open_call_graph = views.open_call_graph
M.edit_comment = edit.edit_comment
M.edit_function = edit.edit_function
M.edit_variables = edit.edit_variables
M.start_client = client.start_client
M.stop_client = client.stop_client
M.get_client = client.get_client

return M
