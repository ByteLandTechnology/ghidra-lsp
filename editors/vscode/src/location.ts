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

/** One-line UTF-16 token span record from `ghidra.location` snapshot mode. */
export interface LocationSpan {
    line: number;
    start: number;
    end: number;
    address?: string;
}

/** Ordered native UTF-16 span snapshot from `ghidra.location` when `position` and `address` are absent. */
export interface LocationSnapshot {
    md5: string;
    entry?: string;
    native?: boolean;
    spans: LocationSpan[];
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
