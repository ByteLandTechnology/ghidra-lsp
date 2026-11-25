// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

import * as vscode from 'vscode';
import { Call, VirtualDocument } from './memory';
import { formatFriendlyError } from './error';

/** Server-tracked state for one scoped symbol rename preview. */
interface PendingRename {
    origin: string;
    oldName: string;
    newName: string;
    documents: string[];
    applied: boolean;
    originApplied?: boolean;
    patched: boolean;
}

/** Tracks scoped `F2` rename previews, file badges, status bar state, and origin save commits. */
export class ReadonlyRenames implements vscode.Disposable, vscode.FileDecorationProvider {
    /** Latest pending rename state keyed by program MD5. */
    private readonly pending = new Map<string, PendingRename>();
    /** Debounce timers for refreshing rename state per program. */
    private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
    /** Scheduled auto-save timers keyed by program MD5. */
    private readonly autosave = new Map<string, ReturnType<typeof setTimeout>>();
    /** Auto-save identity keys already attempted for each program. */
    private readonly attempted = new Map<string, string>();
    /** Active commit promises keyed by program MD5. */
    private readonly saving = new Map<string, Promise<boolean>>();
    /** Generation counters used to discard stale `renameState` responses. */
    private readonly generations = new Map<string, number>();
    /** Emitter for VS Code file badge decoration updates. */
    private readonly decorations = new vscode.EventEmitter<vscode.Uri[]>();
    /** Event fired when pending rename badges change on open virtual tabs. */
    readonly onDidChangeFileDecorations = this.decorations.event;
    /** Status bar indicator for pending rename previews. */
    private readonly status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 12);
    /** Event subscriptions and UI resources owned by this tracker. */
    private readonly disposables: vscode.Disposable[];
    /** Previously active editor URI used to detect focus changes for auto-save. */
    private previous?: vscode.Uri;
    /** Whether this tracker has been disposed. */
    private disposed = false;

    /** Register document, editor, focus, and configuration listeners for rename previews. */
    constructor(private readonly call: Call, private readonly committed: (md5: string) => Promise<void>) {
        this.status.command = 'ghidraLsp.showPendingRename';
        this.disposables = [this.status, this.decorations, vscode.window.registerFileDecorationProvider(this),
            vscode.workspace.onDidChangeTextDocument(event => {
                if (event.contentChanges.length && this.functionUri(event.document.uri)) { this.schedule(event.document.uri.authority); }
            }),
            vscode.window.onDidChangeActiveTextEditor(editor => {
                const previous = this.previous;
                this.previous = editor?.document.uri;
                if (previous && previous.toString() !== this.previous?.toString()) { this.focusSave(previous.authority, 'onFocusChange'); }
                if (editor && this.functionUri(editor.document.uri)) { this.schedule(editor.document.uri.authority); }
            }),
            vscode.window.onDidChangeWindowState(state => {
                if (!state.focused) { for (const md5 of this.pending.keys()) { this.focusSave(md5, 'onWindowChange'); } }
            }),
            vscode.workspace.onDidChangeConfiguration(event => {
                if (event.affectsConfiguration('files.autoSave') || event.affectsConfiguration('files.refactoring.autoSave')) {
                    for (const md5 of this.pending.keys()) { this.attempted.delete(md5); this.schedule(md5); }
                }
            }),
        ];
    }

    /** Return true when `uri` points to a decompiled function buffer. */
    private functionUri(uri: vscode.Uri): boolean { return uri.scheme === 'ghidra' && uri.path.startsWith('/function/'); }

    /** Schedule a debounced pending-rename state refresh for program `md5`. */
    schedule(md5: string): void {
        if (this.disposed) { return; }
        const previous = this.timers.get(md5);
        if (previous) { clearTimeout(previous); }
        this.timers.set(md5, setTimeout(() => {
            this.timers.delete(md5);
            void this.refresh(md5).catch(console.error);
        }, 100));
    }

    /** Query `ghidra.renameState` for `md5` and update badges, status, and auto-save plans. */
    async refresh(md5: string): Promise<PendingRename | undefined> {
        const generation = (this.generations.get(md5) || 0) + 1;
        this.generations.set(md5, generation);
        const { pending } = await this.call<{ pending?: PendingRename }>('ghidra.renameState', { md5 });
        if (this.disposed || this.generations.get(md5) !== generation) { return pending || undefined; }
        const previous = this.pending.get(md5);
        if (pending) { this.pending.set(md5, pending); }
        else { this.pending.delete(md5); this.attempted.delete(md5); }
        const changed = [...(previous?.documents || []), ...(pending?.documents || [])];
        this.decorations.fire([...new Set(changed)].map(uri => vscode.Uri.parse(uri)));
        this.updateStatus();
        this.planAutoSave(md5, pending);
        return pending || undefined;
    }

    /** Return true when program `md5` has an active or patched rename preview. */
    hasPending(md5: string): boolean { const plan = this.pending.get(md5); return !!plan && (plan.applied || plan.patched); }

    /** Update the status bar item and editor context key for pending renames. */
    private updateStatus(): void {
        const plans = [...this.pending.values()].filter(plan => plan.applied || plan.patched);
        void vscode.commands.executeCommand('setContext', 'ghidra.hasPendingRename', plans.length > 0);
        if (!plans.length) { this.status.hide(); return; }
        const plan = plans[plans.length - 1];
        this.status.text = plans.length === 1 ? `$(edit) Ghidra: ${plan.newName} · pending` : `$(edit) Ghidra: ${plans.length} pending renames`;
        this.status.tooltip = `${plan.oldName} → ${plan.newName}\nClick to return to the original view, then press Ctrl+S to save. Closing the view does not save; reloading the window discards pending previews.`;
        this.status.show();
    }

    /** Provide an `M` file badge for virtual buffers modified by a pending rename. */
    provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
        const plan = this.pending.get(uri.authority);
        if (plan && (plan.applied || plan.patched) && plan.documents.includes(uri.toString())) {
            return { badge: 'M', tooltip: `Pending rename: ${plan.oldName} → ${plan.newName}`, color: new vscode.ThemeColor('gitDecoration.modifiedResourceForeground') };
        }
        return undefined;
    }

    /** Schedule or cancel automatic save timers according to user `files.autoSave` settings. */
    private planAutoSave(md5: string, plan?: PendingRename): void {
        const oldTimer = this.autosave.get(md5);
        if (oldTimer) { clearTimeout(oldTimer); this.autosave.delete(md5); }
        if (!plan?.applied || this.saving.has(md5)) { return; }
        const identity = `${plan.origin}:${plan.oldName}:${plan.newName}`;
        if (this.attempted.get(md5) === identity) { return; }
        const settings = vscode.workspace.getConfiguration('files', vscode.Uri.parse(plan.origin));
        const refactoring = plan.documents.length > 1 && settings.get<boolean>('refactoring.autoSave', true);
        const mode = refactoring ? 'refactoring' : settings.get<string>('autoSave', 'off');
        if (mode === 'off'
            || mode === 'onFocusChange' && vscode.window.activeTextEditor?.document.uri.toString() === plan.origin
            || mode === 'onWindowChange' && vscode.window.state.focused) { return; }
        const delay = mode === 'afterDelay' ? settings.get<number>('autoSaveDelay', 1000) : 0;
        this.autosave.set(md5, setTimeout(() => {
            this.autosave.delete(md5);
            this.automaticSave(md5, mode);
        }, delay));
    }

    /** Trigger an auto-save when focus leaves an editor or window under focus-based `autoSave`. */
    private focusSave(md5: string, mode: string): void {
        const plan = this.pending.get(md5);
        if (plan?.applied && vscode.workspace.getConfiguration('files', vscode.Uri.parse(plan.origin)).get('autoSave') === mode) { this.automaticSave(md5, mode); }
    }

    /** Commit a pending rename automatically when the configured `autoSave` mode still matches. */
    private automaticSave(md5: string, mode: string): void {
        const plan = this.pending.get(md5);
        if (!plan?.applied || this.disposed) { return; }
        const settings = vscode.workspace.getConfiguration('files', vscode.Uri.parse(plan.origin));
        if (mode === 'refactoring' ? plan.documents.length < 2 || !settings.get<boolean>('refactoring.autoSave', true) : settings.get<string>('autoSave', 'off') !== mode) { return; }
        const identity = `${plan.origin}:${plan.oldName}:${plan.newName}`;
        if (this.attempted.get(md5) === identity) { return; }
        this.attempted.set(md5, identity);
        void this.save(vscode.Uri.parse(plan.origin)).catch(error => {
            void vscode.window.showErrorMessage(`Ghidra rename was not saved. Press Ctrl+S to retry: ${formatFriendlyError(error)}`);
        });
    }

    /** Commit the pending rename associated with origin document `uri`, coalescing concurrent saves. */
    async save(uri: vscode.Uri): Promise<boolean> {
        if (!this.functionUri(uri)) { return false; }
        const running = this.saving.get(uri.authority);
        if (running) { return running; }
        const operation = this.commit(uri).finally(() => { this.saving.delete(uri.authority); });
        this.saving.set(uri.authority, operation);
        return operation;
    }

    /** Send `ghidra.saveDocument` for the origin function view and notify listeners on success. */
    private async commit(uri: vscode.Uri): Promise<boolean> {
        const plan = await this.refresh(uri.authority);
        if (!plan || (!plan.applied && !plan.patched) || plan.origin !== uri.toString()) { return false; }
        if (plan.originApplied === false) { throw new Error('Apply the rename to its origin document in the native preview before saving'); }
        const document = vscode.workspace.textDocuments.find(item => item.uri.toString() === plan.origin && !item.isClosed);
        const text = document?.getText() ?? (await this.call<VirtualDocument>('ghidra.document', { uri: plan.origin, includePending: true })).text;
        try {
            await this.call('ghidra.saveDocument', { uri: plan.origin, text });
        } finally {
            await this.refresh(uri.authority);
        }
        await this.committed(uri.authority);
        return true;
    }

    /** Commit all pending renames across open Ghidra sessions. */
    async saveAll(): Promise<void> {
        const sessions = new Set([...this.pending.keys(), ...this.timers.keys(), ...vscode.workspace.textDocuments
            .filter(document => this.functionUri(document.uri)).map(document => document.uri.authority)]);
        for (const md5 of sessions) {
            const plan = await this.refresh(md5);
            if (plan && (plan.applied || plan.patched)) { await this.save(vscode.Uri.parse(plan.origin)); }
        }
    }

    /** Focus the origin function view for the active or first pending rename. */
    async showPending(): Promise<void> {
        const active = vscode.window.activeTextEditor?.document.uri.authority;
        const plan = (active ? this.pending.get(active) : undefined)
            || [...this.pending.values()].find(item => item.applied || item.patched);
        if (plan) { await vscode.window.showTextDocument(vscode.Uri.parse(plan.origin), { preview: false }); }
    }

    /** Throw an error when program `md5` has an uncommitted pending rename. */
    async assertClean(md5: string): Promise<void> {
        const plan = await this.refresh(md5);
        if (plan && (plan.applied || plan.patched)) { throw new Error('Save or discard the pending rename in this session first'); }
    }

    /** Throw an error when program `md5` holds any pending rename preview, including unpatched previews. */
    async assertNoPendingPreview(md5: string): Promise<void> {
        const plan = await this.refresh(md5);
        if (plan) { throw new Error('Save or discard the pending rename in this session first'); }
    }

    /** Cancel timers and dispose UI resources. */
    dispose(): void {
        this.disposed = true;
        for (const timer of [...this.timers.values(), ...this.autosave.values()]) { clearTimeout(timer); }
        for (const disposable of this.disposables) { disposable.dispose(); }
    }
}
