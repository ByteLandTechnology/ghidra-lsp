-- Copyright 2026 ByteLand Technology Limited
-- SPDX-License-Identifier: MIT

-- Transaction undo, redo, explicit program save, and session reset commands.
local client = require('ghidra-lsp.client')
local buffer = require('ghidra-lsp.buffer')
local ui = require('ghidra-lsp.ui')

local M = {}

--- Convert an LSP error value into a display string.
local function format_error(err)
    if not err then return 'unknown error' end
    if type(err) == 'table' then
        return err.message or vim.inspect(err)
    end
    return tostring(err)
end

--- Resolve a lowercase 32-hex session MD5 from an optional command argument or active session.
local function resolve_md5(md5_arg)
    local md5 = (type(md5_arg) == 'string' and vim.trim(md5_arg) ~= '' and vim.trim(md5_arg))
        or require('ghidra-lsp.commands').get_active_md5()
    if not md5 then
        vim.notify('No active Ghidra session', vim.log.levels.WARN)
        return nil
    end
    return md5:lower()
end

--- Verify that open virtual buffers and pending rename state for `md5` are clean.
local function ensure_session_clean(md5, block_unpatched_rename)
    for _, b in ipairs(vim.api.nvim_list_bufs()) do
        if vim.api.nvim_buf_is_valid(b) and vim.api.nvim_buf_is_loaded(b) then
            local name = vim.api.nvim_buf_get_name(b)
            local lower = name:lower()
            if lower:find('^ghidra://' .. md5 .. '/') or lower:find('^ghidra%-type://' .. md5 .. '/') then
                if vim.bo[b].modified then
                    vim.notify('Save or discard unsaved buffer edits in this session first', vim.log.levels.WARN)
                    return false
                end
                local tstate = vim.b[b].ghidra_type_state
                if type(tstate) == 'table' and (tstate.saving or tstate.uncertain) then
                    vim.notify('Resolve pending or uncertain data type saves in this session first', vim.log.levels.WARN)
                    return false
                end
            end
        end
    end
    if block_unpatched_rename then
        local state, state_err = client.execute_command_sync('ghidra.renameState', { { md5 = md5 } })
        if not state_err and type(state) == 'table' and type(state.pending) == 'table' then
            vim.notify('Save or discard the pending rename in this session first', vim.log.levels.WARN)
            return false
        end
    end
    return true
end

--- Reload clean open views and statuslines for session `md5` after undo, redo, or reset.
local function refresh_open_views(md5, drop_missing_types)
    client.function_names[md5] = nil
    client.pending_rename[md5] = nil
    local refreshed_meta = false
    for _, b in ipairs(vim.api.nvim_list_bufs()) do
        if vim.api.nvim_buf_is_valid(b) and vim.api.nvim_buf_is_loaded(b) then
            local name = vim.api.nvim_buf_get_name(b)
            local lower = name:lower()
            if lower:find('^ghidra://' .. md5 .. '/') then
                local is_snap = lower:find('^ghidra://[^/]+/symbol/')
                    or lower:find('^ghidra://[^/]+/references/')
                    or lower:find('^ghidra://[^/]+/type/')
                if is_snap then
                    buffer.load_document(b, name)
                elseif not refreshed_meta then
                    refreshed_meta = true
                    buffer.ensure_program_metadata_cached(md5)
                end
            elseif lower:find('^ghidra%-type://' .. md5 .. '/') then
                if drop_missing_types then
                    local tstate = vim.b[b].ghidra_type_state
                    if type(tstate) == 'table' and not vim.bo[b].modified and not tstate.saving then
                        local res, err = client.execute_command_sync('ghidra.typeDocument', { {
                            md5 = md5,
                            path = tstate.path,
                        } })
                        if err then
                            local msg = format_error(err):lower()
                            if msg:find('not found', 1, true) or msg:find('not_found', 1, true) or msg:find('does not exist', 1, true) then
                                pcall(vim.api.nvim_buf_delete, b, { force = true })
                            end
                        elseif type(res) == 'table' then
                            buffer.reload_type_document_if_clean(b)
                        end
                    end
                else
                    buffer.reload_type_document_if_clean(b)
                end
            elseif lower:find('^ghidra%-overview://' .. md5) then
                pcall(function() require('ghidra-lsp.commands').overview(md5, true) end)
            elseif lower:find('^ghidra%-listing://' .. md5 .. '/')
                or lower:find('^ghidra%-memory://' .. md5 .. '/')
                or lower:find('^ghidra%-cfg://' .. md5 .. '/')
                or lower:find('^ghidra%-callgraph://' .. md5 .. '/')
            then
                pcall(function() require('ghidra-lsp.views').refresh_buffer(b) end)
            end
        end
    end
    ui.refresh_statuslines()
end

--- Undo the most recent committed Ghidra transaction in the active or specified session.
function M.undo(md5_arg)
    local md5 = resolve_md5(md5_arg)
    if not md5 or not ensure_session_clean(md5, true) then return end
    client.execute_command('ghidra.undo', { { md5 = md5 } }, function(err, res)
        if err then
            vim.notify('Ghidra undo failed: ' .. format_error(err), vim.log.levels.ERROR)
            return
        end
        vim.schedule(function()
            refresh_open_views(md5, true)
            local tx = (type(res) == 'table' and type(res.undone) == 'string' and res.undone ~= '') and res.undone or 'transaction'
            vim.notify('Undid: ' .. tx, vim.log.levels.INFO)
        end)
    end)
end

--- Redo the most recently undone Ghidra transaction in the active or specified session.
function M.redo(md5_arg)
    local md5 = resolve_md5(md5_arg)
    if not md5 or not ensure_session_clean(md5, true) then return end
    client.execute_command('ghidra.redo', { { md5 = md5 } }, function(err, res)
        if err then
            vim.notify('Ghidra redo failed: ' .. format_error(err), vim.log.levels.ERROR)
            return
        end
        vim.schedule(function()
            refresh_open_views(md5, false)
            local tx = (type(res) == 'table' and type(res.redone) == 'string' and res.redone ~= '') and res.redone or 'transaction'
            vim.notify('Redid: ' .. tx, vim.log.levels.INFO)
        end)
    end)
end

--- Explicitly save committed Ghidra program changes to the project database on disk.
function M.save_program(md5_arg)
    local md5 = resolve_md5(md5_arg)
    if not md5 or not ensure_session_clean(md5, true) then return end
    local label = client.session_names[md5] or md5:sub(1, 8)
    client.execute_command('ghidra.saveProgram', { { md5 = md5 } }, function(err)
        if err then
            vim.notify('Ghidra save failed: ' .. format_error(err), vim.log.levels.ERROR)
            return
        end
        vim.schedule(function()
            ui.refresh_statuslines()
            vim.notify('Saved Ghidra program ' .. label, vim.log.levels.INFO)
        end)
    end)
end

--- Reset the active or specified Ghidra session to its clean cached binary and reopen it.
function M.reset_session(md5_arg)
    local md5 = resolve_md5(md5_arg)
    if not md5 or not ensure_session_clean(md5, true) then return end
    local label = client.session_names[md5] or md5:sub(1, 8)
    local choice = vim.fn.confirm(
        'Reset Ghidra session ' .. label .. ' to its clean binary? Unsaved and saved database edits will be discarded.',
        '&Cancel\n&Reset',
        1
    )
    if choice ~= 2 then return end
    if not ensure_session_clean(md5, true) then return end
    vim.notify('Resetting Ghidra session ' .. label .. '...', vim.log.levels.INFO)
    client.execute_command('ghidra.resetSession', { { md5 = md5, reopen = true } }, function(err)
        if err then
            vim.notify('Ghidra session reset failed: ' .. format_error(err), vim.log.levels.ERROR)
            return
        end
        client.open_sessions[md5] = true
        vim.schedule(function()
            refresh_open_views(md5, true)
            vim.notify('Reset Ghidra session ' .. label, vim.log.levels.INFO)
        end)
    end)
end

return M
