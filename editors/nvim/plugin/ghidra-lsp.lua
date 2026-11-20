-- Copyright 2026 ByteLand Technology Limited
-- SPDX-License-Identifier: MIT

-- Register Neovim user commands and buffer autocmds for Ghidra LSP.
if vim.g.loaded_ghidra_lsp == 1 then
    return
end
vim.g.loaded_ghidra_lsp = 1

local ghidra = require('ghidra-lsp')
require('ghidra-lsp.buffer').setup_autocmds()

vim.api.nvim_create_user_command('GhidraOpenBinary', function(opts)
    ghidra.open_binary(opts.args ~= '' and opts.args or nil)
end, { nargs = '?', complete = 'file', desc = 'Open a binary in Ghidra LSP' })

vim.api.nvim_create_user_command('GhidraSelectSession', function(opts)
    ghidra.select_session(opts.args ~= '' and opts.args or nil)
end, { nargs = '?', desc = 'Select active Ghidra session' })

vim.api.nvim_create_user_command('GhidraCloseSession', function(opts)
    ghidra.close_session(opts.args ~= '' and opts.args or nil)
end, { nargs = '?', desc = 'Close active or specified Ghidra session' })

vim.api.nvim_create_user_command('GhidraReanalyze', function()
    ghidra.reanalyze()
end, { desc = 'Analyze or re-analyze the active Ghidra program' })

vim.api.nvim_create_user_command('GhidraOpenFunction', function(opts)
    ghidra.open_function(opts.args ~= '' and opts.args or nil)
end, {
    nargs = '?',
    complete = function(arg)
        return require('ghidra-lsp.commands').complete_functions(arg)
    end,
    desc = 'Open a Ghidra function by address or name',
})

vim.api.nvim_create_user_command('GhidraFunctions', function()
    ghidra.open_function(nil)
end, { desc = 'Browse and open Ghidra functions' })

vim.api.nvim_create_user_command('GhidraSymbols', function()
    ghidra.symbols()
end, { desc = 'Browse Ghidra program symbols' })

vim.api.nvim_create_user_command('GhidraTypes', function()
    ghidra.types()
end, { desc = 'Browse Ghidra data types' })

vim.api.nvim_create_user_command('GhidraStrings', function()
    ghidra.strings()
end, { desc = 'Browse defined strings in active Ghidra session' })

vim.api.nvim_create_user_command('GhidraGoto', function(opts)
    ghidra.goto_address(opts.args ~= '' and opts.args or nil)
end, { nargs = '?', desc = 'Jump to a Ghidra address' })

vim.api.nvim_create_user_command('GhidraListing', function(opts)
    ghidra.open_listing(opts.args ~= '' and { address = opts.args } or nil)
end, { nargs = '?', desc = 'Open Ghidra Program Listing view' })

vim.api.nvim_create_user_command('GhidraMemory', function(opts)
    ghidra.open_memory(opts.args ~= '' and { address = opts.args } or nil)
end, { nargs = '?', desc = 'Open Ghidra Memory / Hex viewer' })

vim.api.nvim_create_user_command('GhidraHex', function(opts)
    ghidra.open_memory(opts.args ~= '' and { address = opts.args } or nil)
end, { nargs = '?', desc = 'Alias for :GhidraMemory' })

vim.api.nvim_create_user_command('GhidraComment', function(opts)
    ghidra.edit_comment(opts.args ~= '' and { address = opts.args } or nil)
end, { nargs = '?', desc = 'Edit Ghidra inline comment at cursor or address' })

vim.api.nvim_create_user_command('GhidraEditFunction', function()
    ghidra.edit_function()
end, { desc = 'Edit current Ghidra function signature and calling convention' })

vim.api.nvim_create_user_command('GhidraEditVariables', function()
    ghidra.edit_variables()
end, { desc = 'Edit locals and parameters of current Ghidra function' })

vim.api.nvim_create_user_command('GhidraControlFlow', function()
    ghidra.open_control_flow()
end, { desc = 'Open basic-block CFG for current Ghidra function' })

vim.api.nvim_create_user_command('GhidraCallGraph', function(opts)
    ghidra.open_call_graph(opts.args ~= '' and { address = opts.args } or nil)
end, { nargs = '?', desc = 'Open bounded Call Graph for current or specified function' })

vim.api.nvim_create_user_command('GhidraEditType', function(opts)
    ghidra.edit_type(opts.args ~= '' and opts.args or nil)
end, { nargs = '?', desc = 'Open editable .ghidra-type JSONC buffer for a Ghidra data type' })

vim.api.nvim_create_user_command('GhidraRefresh', function()
    ghidra.refresh()
end, { desc = 'Refresh current Ghidra virtual buffer' })

vim.api.nvim_create_user_command('GhidraDiscardRename', function()
    ghidra.discard_rename()
end, { desc = 'Discard pending Ghidra symbol rename' })

vim.api.nvim_create_user_command('GhidraOrigin', function()
    ghidra.goto_origin()
end, { desc = 'Jump to origin buffer of pending Ghidra rename' })

vim.api.nvim_create_user_command('GhidraOverview', function()
    ghidra.overview()
end, { desc = 'Show Ghidra program overview snapshot' })

vim.api.nvim_create_user_command('GhidraCallHierarchy', function()
    ghidra.call_hierarchy()
end, { desc = 'Show call hierarchy at cursor' })

vim.api.nvim_create_user_command('GhidraInstall', function(opts)
    ghidra.install(opts.args ~= '' and opts.args or nil)
end, {
    nargs = '?',
    complete = function()
        return { 'lsp', 'mcp' }
    end,
    desc = 'Install or update ghidra-lsp and ghidra-mcp binaries via npm',
})
