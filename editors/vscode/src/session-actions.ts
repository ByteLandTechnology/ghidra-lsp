// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

import * as vscode from 'vscode';
import { ProgramBrowser } from './browser';
import { MemoryFiles } from './bytes';
import { ProgramContext } from './context';
import { ControlFlowView } from './control-flow-view';
import { EditingUI } from './editing';
import { DocumentLabels } from './labels';
import { ListingFiles } from './listing';
import { Call, GhidraMemory } from './memory';
import { ReferenceViews } from './references';
import { ReadonlyRenames } from './rename';
import { SessionsView } from './sessions';
import { StringFiles } from './string-files';
import { DataTypeFiles } from './type-files';
import { Workbench } from './workbench';

/** Server payload returned by `ghidra.undo` and `ghidra.redo`. */
interface HistoryMutationResponse {
    md5: string;
    undone?: string;
    redone?: string;
    can_undo: boolean;
    can_redo: boolean;
}

/** Shared extension services required by Undo, Redo, Save Program, and Reset Session commands. */
export interface SessionHistoryDeps {
    call: Call;
    context: ProgramContext;
    renames: ReadonlyRenames;
    typeFiles: DataTypeFiles;
    memory: GhidraMemory;
    labels: DocumentLabels;
    references: ReferenceViews;
    stringFiles: StringFiles;
    listingFiles: ListingFiles;
    byteFiles: MemoryFiles;
    browser: ProgramBrowser;
    workbench: Workbench;
    graphView: ControlFlowView;
    editing: EditingUI;
    sessionsView: SessionsView;
    programVersions: Map<string, string>;
    settleRequests: (md5: string) => Promise<void>;
    updateStatus: () => void;
}

/** Refresh all open views and trees belonging to program `md5` after a history or reset change. */
async function refreshSessionViews(deps: SessionHistoryDeps, md5: string): Promise<void> {
    deps.memory.refresh(md5);
    deps.labels.refresh(md5);
    deps.references.refresh(md5);
    deps.stringFiles.refresh(md5);
    deps.listingFiles.refresh(md5);
    deps.byteFiles.refresh(md5);
    await Promise.all([
        deps.typeFiles.refresh(md5),
        deps.renames.refresh(md5),
        deps.browser.refresh(md5),
        deps.workbench.refresh(md5),
        deps.graphView.refresh(md5),
    ]);
    deps.sessionsView.refresh();
    deps.updateStatus();
}

/** Register Undo, Redo, Save Program, and Reset Session commands on the VS Code extension. */
export function registerSessionHistoryCommands(
    register: (name: string, action: (resource?: unknown, extra?: unknown) => Promise<void>) => void,
    deps: SessionHistoryDeps,
): void {
    register('undo', async resource => {
        const md5 = deps.context.require(resource);
        await deps.renames.assertNoPendingPreview(md5);
        deps.typeFiles.assertClean(md5);
        const name = deps.context.name(md5);
        const result = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Ghidra: Undo · ${name}` },
            async () => {
                const response = await deps.call<HistoryMutationResponse>('ghidra.undo', { md5 });
                deps.programVersions.delete(md5.toLowerCase());
                await refreshSessionViews(deps, md5);
                return response;
            },
        );
        void vscode.window.showInformationMessage(`Undid: ${result.undone || 'transaction'}.`);
    });

    register('redo', async resource => {
        const md5 = deps.context.require(resource);
        await deps.renames.assertNoPendingPreview(md5);
        deps.typeFiles.assertClean(md5);
        const name = deps.context.name(md5);
        const result = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Ghidra: Redo · ${name}` },
            async () => {
                const response = await deps.call<HistoryMutationResponse>('ghidra.redo', { md5 });
                deps.programVersions.delete(md5.toLowerCase());
                await refreshSessionViews(deps, md5);
                return response;
            },
        );
        void vscode.window.showInformationMessage(`Redid: ${result.redone || 'transaction'}.`);
    });

    register('saveProgram', async resource => {
        const md5 = deps.context.require(resource);
        await deps.renames.assertClean(md5);
        deps.typeFiles.assertClean(md5);
        const name = deps.context.name(md5);
        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Ghidra: Saving ${name}` },
            async () => {
                await deps.call('ghidra.saveProgram', { md5 });
                deps.sessionsView.refresh();
            },
        );
        void vscode.window.showInformationMessage(`Saved program ${name}.`);
    });

    register('resetSession', async resource => {
        const md5 = deps.context.require(resource);
        await deps.renames.assertNoPendingPreview(md5);
        deps.typeFiles.assertClean(md5);
        const name = deps.context.name(md5);
        const choice = await vscode.window.showWarningMessage(
            `Reset ${name} to its clean binary? Unsaved and saved Ghidra database edits will be discarded.`,
            { modal: true },
            'Reset Session',
        );
        if (choice !== 'Reset Session') { return; }
        await deps.settleRequests(md5);
        await deps.renames.assertNoPendingPreview(md5);
        deps.typeFiles.assertClean(md5);
        deps.editing.close(md5);
        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Ghidra: Resetting ${name}` },
            async () => {
                await deps.call('ghidra.resetSession', { md5, reopen: true });
                deps.programVersions.delete(md5.toLowerCase());
                await deps.typeFiles.resetSnapshots(md5);
                if (!deps.context.current || deps.context.current === md5.toLowerCase()) {
                    await deps.context.activate(md5, name, deps.context.path(md5));
                }
                await refreshSessionViews(deps, md5);
            },
        );
        void vscode.window.showInformationMessage(`Reset session for ${name}.`);
    });
}
