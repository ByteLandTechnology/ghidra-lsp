// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

/**
 * Friendly error message parser and formatter for Ghidra LSP & MCP.
 * Converts raw JSON-RPC envelopes and backend stack/error objects into human-readable, actionable messages.
 */

export function formatFriendlyError(error: unknown): string {
    if (!error) {
        return 'Unknown error';
    }

    let raw = typeof error === 'string' ? error : extractMessageFromParsed(error) || (error instanceof Error ? error.message : String(error));

    // Strip common wrapper prefixes from language client or jsonrpc
    raw = raw.replace(/^Request workspace\/executeCommand failed with message:\s*/i, '');
    raw = raw.replace(/^Error:\s*/i, '');

    // Try to extract JSON object embedded in the error string (e.g. MCP symbol.list: {...})
    const jsonMatch = raw.match(/(\{[\s\S]*\})/);
    if (jsonMatch) {
        try {
            const parsed = JSON.parse(jsonMatch[1]);
            const extracted = extractMessageFromParsed(parsed);
            if (extracted) {
                raw = extracted;
            }
        } catch {
            // Not valid JSON, continue with pattern matching
        }
    }

    // Pattern matching on the raw message string
    if (/binary target\s+[`'"]?path[`'"]?\s+is not available|target path cannot be resolved/i.test(raw)) {
        return 'Cannot open the binary: the file does not exist or the path is inaccessible. Check the path and choose it again with Ghidra: Open Binary.';
    }

    const missingTargetMatch = raw.match(/binary\s+([a-f\d]{16,64})\s+is not available/i)
        || raw.match(/target\s+[`']?([a-f\d]{16,64})[`']?\s+is not available/i);
    if (missingTargetMatch) {
        const id = missingTargetMatch[1];
        return `The binary is unavailable in Ghidra (target: ${id.slice(0, 12)}...). Reopen it with Ghidra: Open Binary.`;
    }

    if (/is not available; upload the binary/i.test(raw)) {
        return 'The binary is unavailable in the Ghidra session. Reopen it with Ghidra: Open Binary.';
    }

    if (/Save or discard the pending rename/i.test(raw)) {
        return 'A rename preview is not saved. Press Ctrl+S to save it, or use Ghidra: Discard Pending Rename.';
    }

    if (/Only the exact F2 rename/i.test(raw) || /Only an F2 rename/i.test(raw) || /Saved text does not match the pending F2 rename/i.test(raw)) {
        return 'Cannot save changes to read-only decompiled text. Use F2 or Rename Symbol to rename a function or variable.';
    }

    if (/MCP handshake timed out/i.test(raw)) {
        return 'The Ghidra MCP handshake timed out. Check ghidraLsp.mcpCommand and ensure the backend is running.';
    }

    if (/inspect\s+daemon\.log/i.test(raw)) {
        return 'The Ghidra MCP backend request failed. Check daemon.log and ensure clients sharing a backend use the same GHIDRA_MCP_HOME. Do not delete the persistent projects directory.';
    }

    if (/spawn\b.*ENOENT|launching.*server.*not found/i.test(raw)) {
        return /ghidra-mcp/i.test(raw)
            ? 'Ghidra MCP was not found. Run "Ghidra: Install or Update Binaries" or set ghidraLsp.mcpCommand, then reload the window.'
            : 'Ghidra LSP was not found. Run "Ghidra: Install or Update Binaries" or set ghidraLsp.serverPath, then reload the window.';
    }

    if (/timed out; a write may have completed/i.test(raw)) {
        return 'The Ghidra request timed out, but the write may have completed. Check its state before retrying.';
    }

    if (/timed out/i.test(raw)) {
        return 'Ghidra timed out. The operation may still be running; wait and refresh.';
    }

    if (/Ghidra LSP has stopped/i.test(raw)) {
        return 'Ghidra LSP has stopped. Reload the window or restart the service.';
    }

    if (/Choose a local binary/i.test(raw)) {
        return 'Choose a valid binary on a local disk.';
    }

    if (/backend scan is incomplete/i.test(raw)) {
        return 'The Ghidra scan is incomplete. Refresh after analysis finishes.';
    }

    if (/This analysis session is closed/i.test(raw)) {
        return 'This analysis session is closed. Reopen it from Sessions.';
    }

    if (/does not support this operation|unknown operation of ghidra_|No such (?:method|operation):\s*(?:instruction\.|code_unit\.)|\/patch\/(?:clear_existing|disassemble) is not allowed/i.test(raw)) {
        return 'The installed Ghidra MCP backend does not support this patching operation yet. Run "Ghidra: Install or Update Binaries" or update ghidra-mcp, then reload the window.';
    }

    // Strip "MCP <domain>.<operation>: " prefix if still present
    raw = raw.replace(/^MCP\s+[\w.-]+:\s*/i, '');

    return raw.trim() || 'Operation failed';
}

/** Recursively extract a readable error message from a parsed JSON object. */
function extractMessageFromParsed(parsed: unknown, depth = 0): string | undefined {
    if (!parsed || typeof parsed !== 'object' || depth > 10) {
        return undefined;
    }

    const obj = parsed as Record<string, unknown>;

    // Handle nested response
    if (obj.response && typeof obj.response === 'object') {
        const res = extractMessageFromParsed(obj.response, depth + 1);
        if (res) { return res; }
    }

    // Handle nested error
    if (obj.error && typeof obj.error === 'object') {
        const res = extractMessageFromParsed(obj.error, depth + 1);
        if (res) { return res; }
    }

    const data = obj.data as Record<string, unknown> | undefined;
    const details = (data?.details || obj.details) as Record<string, unknown> | undefined;

    const errType = String(data?.type || obj.type || '');
    const target = String(details?.target || data?.target || '');
    const reason = String(details?.reason || data?.reason || '');

    if (errType === 'missing_target') {
        if (target === 'path') {
            return `Cannot open the binary${reason ? `: ${reason}` : ''}. Check that the file exists and choose it again with Ghidra: Open Binary.`;
        }
        if (!target || /^[0-9a-f]{16,64}$/i.test(target)) {
            const idDisplay = target ? ` (Target: ${target.slice(0, 12)}...)` : '';
            return `The binary is unavailable in Ghidra${idDisplay}. Reopen it with Ghidra: Open Binary.`;
        }
    }

    if (reason) {
        return reason;
    }

    if (typeof obj.message === 'string' && obj.message) {
        // Recursively check if the message itself is a stringified JSON
        if (obj.message.startsWith('{') && obj.message.endsWith('}')) {
            try {
                const inner = JSON.parse(obj.message);
                const innerExtracted = extractMessageFromParsed(inner, depth + 1);
                if (innerExtracted) { return innerExtracted; }
            } catch {}
        }
        return obj.message;
    }

    return undefined;
}
