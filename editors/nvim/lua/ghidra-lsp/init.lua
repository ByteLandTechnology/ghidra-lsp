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
M.get_client = client.get_client

return M
