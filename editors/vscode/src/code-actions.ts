// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

import * as vscode from 'vscode';

/** Show command-backed analysis actions while the pseudocode remains readonly. */
export async function showCodeActions(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== 'ghidra' || !editor.document.uri.path.startsWith('/function/')) { return; }
    const actions = await vscode.commands.executeCommand<(vscode.CodeAction | vscode.Command)[]>(
        'vscode.executeCodeActionProvider', editor.document.uri, editor.selection,
    );
    const choices = (actions || []).flatMap(action => {
        const command = typeof action.command === 'string' ? action as vscode.Command : action.command;
        const disabled = 'disabled' in action ? action.disabled : undefined;
        if (!disabled && !command?.command.startsWith('ghidraLsp.')) { return []; }
        return [{ label: action.title, detail: disabled?.reason, command, disabled }];
    });
    if (!choices.length) {
        void vscode.window.showInformationMessage('No Ghidra Code Actions are available at this position.');
        return;
    }
    const selected = await vscode.window.showQuickPick(choices, {
        title: 'Ghidra Code Actions', placeHolder: 'Select an analysis action at the cursor', matchOnDetail: true,
    });
    if (selected?.disabled) { void vscode.window.showWarningMessage(selected.disabled.reason); return; }
    if (selected?.command) {
        await vscode.commands.executeCommand(selected.command.command, ...(selected.command.arguments || []));
    }
}
