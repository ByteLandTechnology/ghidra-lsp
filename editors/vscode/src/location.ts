// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

import * as vscode from 'vscode';
import { Call } from './memory';

/** Resolved decompiler cursor location returned by `ghidra.location`. */
export interface CodeLocation {
    md5: string;
    entry?: string;
    address?: string;
    code_unit_address?: string;
    native?: boolean;
}

/** Query the server for the Ghidra location under the active decompiler cursor. */
export async function cursorLocation(call: Call, md5: string, resource?: vscode.Uri): Promise<CodeLocation | undefined> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== 'ghidra' || editor.document.uri.authority !== md5
        || !editor.document.uri.path.startsWith('/function/')
        || (resource && resource.toString() !== editor.document.uri.toString())) { return undefined; }
    return call<CodeLocation>('ghidra.location', {
        uri: editor.document.uri.toString(),
        position: { line: editor.selection.active.line, character: editor.selection.active.character },
    });
}
