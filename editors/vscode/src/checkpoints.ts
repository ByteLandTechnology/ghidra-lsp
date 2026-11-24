// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

import * as vscode from 'vscode';
import { ProgramBrowser } from './browser';
import { MemoryFiles } from './bytes';
import { ProgramContext } from './context';
import { ControlFlowView } from './control-flow-view';
import { DocumentLabels } from './labels';
import { ListingFiles } from './listing';
import { Call, GhidraMemory, VirtualDocument } from './memory';
import { ReferenceViews } from './references';
import { ReadonlyRenames } from './rename';
import { SessionsView } from './sessions';
import { StringFiles } from './string-files';
import { StringsView } from './strings-view';
import { DataTypeFiles } from './type-files';
import { Workbench } from './workbench';

/** Summary item returned by `ghidra.checkpoints`. */
interface CheckpointItem {
    /** Unique checkpoint directory identifier. */
    id: string;
    /** Session MD5 digest. */
    md5: string;
    /** Optional checkpoint description recorded before an edit. */
    name?: string;
    /** RFC 3339 UTC timestamp string. */
    createdAt: string;
    /** Snapshot size in bytes on disk. */
    sizeBytes: number;
}

/** Response returned by `ghidra.checkpoints`. */
interface CheckpointListResponse {
    /** Session MD5 digest. */
    md5: string;
    /** Saved checkpoints ordered newest-first. */
    items: CheckpointItem[];
    /** Configured retention cap per binary. */
    maxPerBinary: number;
}

/** Response returned by `ghidra.restoreCheckpoint`. */
interface RestoreCheckpointResponse {
    /** Session MD5 digest. */
    md5: string;
    /** Restored checkpoint metadata. */
    checkpoint?: CheckpointItem;
}

/** Dependencies required to register VS Code checkpoint and session-reset commands. */
export interface CheckpointCommandDeps {
    /** Command registration helper bound to extension error handling. */
    register: (name: string, action: (resource?: unknown, extra?: unknown) => Promise<void>) => void;
    /** Execute-command RPC helper. */
    call: Call;
    /** Active program selection and naming tracker. */
    context: ProgramContext;
    /** Virtual `ghidra://` document filesystem provider. */
    memory: GhidraMemory;
    /** Editor tab label decorator. */
    labels: DocumentLabels;
    /** Virtual reference preview provider. */
    references: ReferenceViews;
    /** Defined string virtual file provider. */
    stringFiles: StringFiles;
    /** Defined strings sidebar view. */
    stringsView: StringsView;
    /** Disassembly listing virtual file provider. */
    listingFiles: ListingFiles;
    /** Raw memory hex virtual file provider. */
    byteFiles: MemoryFiles;
    /** Editable JSONC data type provider. */
    typeFiles: DataTypeFiles;
    /** Scoped rename state controller. */
    renames: ReadonlyRenames;
    /** Symbols and data types sidebar browser. */
    browser: ProgramBrowser;
    /** Cross-reference, import, export, and call-graph panels. */
    workbench: Workbench;
    /** Control-flow graph custom editor controller. */
    graphView: ControlFlowView;
    /** Sessions sidebar view. */
    sessionsView: SessionsView;
    /** Cached live-refresh version strings per session MD5. */
    programVersions: Map<string, string>;
    /** Runs background or foreground Ghidra analysis with progress reporting. */
    runAnalysis: (md5: string, name: string, repeat: boolean) => Promise<void>;
}

/** Format a byte count as a compact human-readable string. */
function formatByteSize(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 1024) { return `${Math.max(0, Math.round(bytes || 0))} B`; }
    if (bytes < 1024 * 1024) { return `${(bytes / 1024).toFixed(1)} KiB`; }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

/** Confirm discarding any dirty `ghidra-type://` editors for `md5` before replacing project state. */
async function confirmDirtyTypeDrafts(typeFiles: DataTypeFiles, md5: string, actionLabel: string): Promise<boolean> {
    if (!typeFiles.hasDirtyEditors(md5)) { return true; }
    const choice = await vscode.window.showWarningMessage(
        `One or more data type editors have unsaved changes. ${actionLabel} will replace them with the program state from Ghidra.`,
        { modal: true },
        actionLabel,
    );
    return choice === actionLabel;
}

/** Refresh every cached editor buffer, virtual filesystem, graph, and sidebar view for `md5`. */
async function refreshAllSessionViews(deps: CheckpointCommandDeps, md5: string): Promise<void> {
    const normalized = md5.toLowerCase();
    deps.programVersions.delete(normalized);
    deps.memory.reopen(normalized);
    deps.memory.refresh(normalized);
    deps.labels.refresh(normalized);
    deps.references.refresh(normalized);
    deps.stringFiles.refresh(normalized);
    deps.listingFiles.refresh(normalized);
    deps.byteFiles.refresh(normalized);
    for (const document of vscode.workspace.textDocuments) {
        if (document.uri.scheme !== 'ghidra' || document.isClosed || document.isDirty) { continue; }
        if (document.uri.authority.toLowerCase() !== normalized || !document.uri.path.startsWith('/function/')) { continue; }
        await deps.call<Pick<VirtualDocument, 'uri' | 'text'>>('ghidra.refreshDocument', { uri: document.uri.toString() }).catch(() => undefined);
    }
    await deps.typeFiles.syncAfterSessionRestore(normalized);
    await Promise.all([
        deps.renames.refresh(normalized),
        deps.browser.refresh(normalized),
        deps.stringsView.refresh(normalized),
        deps.workbench.refresh(normalized),
        deps.graphView.refresh(normalized),
    ]);
    deps.sessionsView.refresh();
}

/** Register VS Code commands to restore previous checkpoints, pick checkpoints, and reset sessions. */
export function registerCheckpointCommands(deps: CheckpointCommandDeps): void {
    const restoreById = async (md5: string, id?: string, label?: string): Promise<void> => {
        const name = deps.context.name(md5);
        const restored = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Ghidra: Restoring checkpoint · ${name}`,
        }, async () => {
            const payload = id ? { md5, id } : { md5 };
            const response = await deps.call<RestoreCheckpointResponse>('ghidra.restoreCheckpoint', payload);
            await deps.context.activate(md5, name);
            await refreshAllSessionViews(deps, md5);
            return response;
        });
        const summary = restored.checkpoint?.name || label || restored.checkpoint?.id || 'latest checkpoint';
        void vscode.window.showInformationMessage(`Restored ${name} to checkpoint "${summary}".`);
    };

    deps.register('restorePreviousCheckpoint', async resource => {
        const md5 = deps.context.require(resource);
        if (!await confirmDirtyTypeDrafts(deps.typeFiles, md5, 'Restore Checkpoint')) { return; }
        await restoreById(md5);
    });

    deps.register('restoreCheckpoint', async resource => {
        const md5 = deps.context.require(resource);
        const name = deps.context.name(md5);
        const listed = await deps.call<CheckpointListResponse>('ghidra.checkpoints', { md5 });
        const items = Array.isArray(listed.items) ? listed.items : [];
        if (!items.length) {
            void vscode.window.showInformationMessage(`No saved checkpoints exist for ${name}.`);
            return;
        }
        const picked = await vscode.window.showQuickPick(items.map((item, index) => ({
            label: item.name || 'Saved checkpoint',
            description: index === 0 ? `Latest · ${item.createdAt}` : item.createdAt,
            detail: `${item.id} · ${formatByteSize(item.sizeBytes)}`,
            item,
        })), {
            title: `Restore Checkpoint · ${name}`,
            placeHolder: 'Choose a saved project checkpoint to restore',
            matchOnDescription: true,
            matchOnDetail: true,
        });
        if (!picked) { return; }
        if (!await confirmDirtyTypeDrafts(deps.typeFiles, md5, 'Restore Checkpoint')) { return; }
        await restoreById(md5, picked.item.id, picked.item.name);
    });

    deps.register('resetSession', async resource => {
        const md5 = deps.context.require(resource);
        const name = deps.context.name(md5);
        const choice = await vscode.window.showWarningMessage(
            `Reset ${name} to a clean binary import? All saved Ghidra edits and checkpoints for this binary will be deleted.`,
            { modal: true },
            'Reset and Analyze',
            'Reset Without Analysis',
        );
        if (!choice) { return; }
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Ghidra: Resetting ${name}`,
        }, async () => {
            await deps.call('ghidra.resetSession', { md5, reopen: true, analyze: false });
            await deps.context.activate(md5, name);
            await refreshAllSessionViews(deps, md5);
        });
        if (choice === 'Reset and Analyze') {
            await deps.runAnalysis(md5, name, false);
            await refreshAllSessionViews(deps, md5);
        } else {
            void vscode.window.showInformationMessage(`Reset ${name} to a clean binary import.`);
        }
    });
}
