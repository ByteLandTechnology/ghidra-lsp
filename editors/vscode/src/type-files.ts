// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

import * as vscode from 'vscode';
import { Call } from './memory';
import { ProgramContext } from './context';
import { Data } from './web';
import { formatFriendlyError } from './error';
import { typeExtension } from './virtual-files';
import { readonlyTypeReason, sameTypeData } from './type-model';

/** URI scheme for virtual JSONC data type documents. */
export const typeScheme = 'ghidra-type';
/** Persisted baseline and draft state for one open data type URI. */
interface Snapshot { original: Data; text: string; mtime: number; readonlyReason?: string; uncertain?: boolean; requiresReadback?: boolean; }
/** Server payload returned by `ghidra.typeDocument`. */
interface TypeDocumentPayload { md5: string; path: string; program: string; readonly: boolean; readonlyReason?: string; text: string; original: Data; }
/** Line/character range returned by type validation diagnostics. */
interface TypeRange { start: { line: number; character: number }; end: { line: number; character: number } }
/** Server response from `ghidra.validateTypeDocument`. */
interface ValidateTypeResponse { valid: boolean; message?: string; range?: TypeRange; offset?: number; length?: number }
/** Server response from `ghidra.saveTypeDocument`. */
interface SaveTypeResponse { md5: string; path: string; mutated: boolean; persisted: boolean; requiresReadback: boolean; text: string; original: Data; }
/** Memento key storing persisted data type draft snapshots. */
const storageKey = 'ghidra.typeFileSnapshots';
/** v3 ends in a Ghidra-only extension, so editor associations never target '*' or a type name's own suffix. */
export function typeUri(md5: string, path: string): vscode.Uri { return vscode.Uri.from({ scheme: typeScheme, authority: md5.toLowerCase(), path: `${path}${typeExtension}`, query: 'v=3' }); }
// Earlier shapes stay readable so restored tabs and saved drafts keep working.
/** Build a v2 `ghidra-type://` URI without the `.ghidra-type` extension. */
function v2TypeUri(md5: string, path: string): vscode.Uri { return vscode.Uri.from({ scheme: typeScheme, authority: md5.toLowerCase(), path, query: 'v=2' }); }
/** Build a legacy `.jsonc` `ghidra-type://` URI for draft migration. */
function legacyTypeUri(md5: string, path: string): vscode.Uri { return vscode.Uri.from({ scheme: typeScheme, authority: md5.toLowerCase(), path: `${path}.jsonc` }); }
/** Map URI query strings to version tags for diff snapshot URLs. */
const typeVersions: Record<string, string> = { 'v=3': 'v3', 'v=2': 'v2', '': 'legacy' };
/** Validate a `ghidra-type://` URI and extract its canonical Ghidra type path. */
export function typePath(uri: vscode.Uri): string {
    if (uri.scheme !== typeScheme || !/^[a-f\d]{32}$/.test(uri.authority) || !uri.path.startsWith('/') || uri.path === '/' || uri.fragment) {
        throw vscode.FileSystemError.FileNotFound(uri);
    }
    if (uri.query === 'v=3' && uri.path.endsWith(typeExtension) && uri.path.length > typeExtension.length + 1) { return uri.path.slice(0, -typeExtension.length); }
    if (uri.query === 'v=2') { return uri.path; }
    if (!uri.query && uri.path.endsWith('.jsonc')) { return uri.path.slice(0, -'.jsonc'.length); }
    throw vscode.FileSystemError.FileNotFound(uri);
}

/** Editable JSONC snapshots; the program and type identity live in the URI, never in the focused tab. */
export class DataTypeFiles implements vscode.FileSystemProvider, vscode.Disposable {
    /** Cached snapshots and dirty save state keyed by URI string. */
    private readonly entries = new Map<string, Snapshot>();
    /** In-flight snapshot loads coalesced by URI string. */
    private readonly loading = new Map<string, Promise<Snapshot>>();
    /** URI strings currently executing a write/save transaction. */
    private readonly saving = new Set<string>();
    /** Emitter for VS Code virtual filesystem change notifications. */
    private readonly events = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    /** Event fired when a type file updates after reload or save readback. */
    readonly onDidChangeFile = this.events.event;
    /** Diagnostic collection displaying JSONC validation errors on open type files. */
    private readonly diagnostics = vscode.languages.createDiagnosticCollection('ghidra-types');
    /** Cached server comparison texts for `ghidra-type-current://` diff views. */
    private readonly comparisons = new Map<string, string>();
    /** Latest validated document version per URI string. */
    private readonly validateVersions = new Map<string, number>();
    /** Registered providers, commands, and workspace event listeners. */
    private readonly disposables: vscode.Disposable[];
    /** Serialized persistence queue tail for memento snapshot writes. */
    private persistTail: Promise<void> = Promise.resolve();
    /** Whether this provider has been disposed. */
    private disposed = false;

    /** Restore persisted draft snapshots and register providers, listeners, and type commands. */
    constructor(private readonly call: Call, private readonly context: ProgramContext, private readonly state: vscode.Memento) {
        for (const [key, entry] of Object.entries(state.get<Record<string, Snapshot>>(storageKey, {}))) { this.entries.set(key, entry); }
        this.disposables = [
            vscode.workspace.registerFileSystemProvider(typeScheme, this, { isCaseSensitive: true }),
            vscode.workspace.registerTextDocumentContentProvider('ghidra-type-current', {
                provideTextDocumentContent: async uri => {
                    const known = this.comparisons.get(uri.toString());
                    if (known !== undefined) { return known; }
                    const source = new URLSearchParams(uri.query).get('source');
                    const doc = await this.fetchDocument(uri.with({ scheme: typeScheme, query: source === 'v3' ? 'v=3' : source === 'v2' ? 'v=2' : '' }));
                    this.comparisons.set(uri.toString(), doc.text);
                    return doc.text;
                },
            }),
            vscode.workspace.onDidOpenTextDocument(document => {
                if (document.uri.scheme !== typeScheme) { return; }
                if (document.languageId !== 'jsonc') { void vscode.languages.setTextDocumentLanguage(document, 'jsonc'); }
                void this.validate(document);
            }),
            vscode.workspace.onDidChangeTextDocument(event => { if (event.document.uri.scheme === typeScheme) { void this.validate(event.document); } }),
            vscode.workspace.onDidCloseTextDocument(document => {
                if (document.uri.scheme === 'ghidra-type-current') { this.comparisons.delete(document.uri.toString()); }
                // Language changes also close a TextDocument. Keep snapshots while its tab still exists.
                if (document.uri.scheme === typeScheme) {
                    this.validateVersions.delete(document.uri.toString());
                    this.diagnostics.delete(document.uri);
                }
            }),
        ];
        for (const [name, action] of Object.entries({
            reloadType: (uri: vscode.Uri) => this.reload(uri),
            compareType: (uri: vscode.Uri) => this.compare(uri),
            typeDetails: (uri: vscode.Uri) => vscode.commands.executeCommand('ghidraLsp.showTypeDetails', uri.authority, typePath(uri)),
        })) {
            this.disposables.push(vscode.commands.registerCommand(`ghidraLsp.${name}`, async (resource?: vscode.Uri) => {
                try {
                    const uri = resource instanceof vscode.Uri ? resource : vscode.window.activeTextEditor?.document.uri;
                    if (!uri || uri.scheme !== typeScheme) { throw new Error('Open a Ghidra data type document first.'); }
                    await action(uri);
                } catch (error) { void vscode.window.showErrorMessage(formatFriendlyError(error)); }
            }));
        }
    }
    /** Return true when any VS Code tab currently holds `uri`. */
    private hasTab(uri: vscode.Uri): boolean {
        return vscode.window.tabGroups.all.some(group => group.tabs.some(tab => (tab.input instanceof vscode.TabInputText || tab.input instanceof vscode.TabInputCustom) && tab.input.uri.toString() === uri.toString()
            || tab.input instanceof vscode.TabInputTextDiff && [tab.input.original, tab.input.modified].some(input => input.toString() === uri.toString())));
    }
    /** Find an open VS Code text document matching `uri`. */
    private document(uri: vscode.Uri): vscode.TextDocument | undefined { return vscode.workspace.textDocuments.find(document => document.uri.toString() === uri.toString()); }
    /** Fetch the current JSONC document payload for `uri` from `ghidra.typeDocument`. */
    private fetchDocument(uri: vscode.Uri): Promise<TypeDocumentPayload> {
        const path = typePath(uri);
        this.context.require(uri.authority);
        return this.call<TypeDocumentPayload>('ghidra.typeDocument', { md5: uri.authority, path });
    }
    /** Return the read-only reason for `entry`, or undefined if editable. */
    private readonlyReason(entry: Snapshot): string | undefined {
        return entry.readonlyReason !== undefined ? entry.readonlyReason : readonlyTypeReason(entry.original);
    }
    /** Serialize and persist snapshot state to workspace storage in order. */
    private persist(): Promise<void> {
        const snapshots = Object.fromEntries(this.entries);
        // Capture values now: an in-flight mutation must durably mark its outcome uncertain first.
        const frozen = JSON.parse(JSON.stringify(snapshots));
        const write = this.persistTail.catch(() => {}).then(() => this.state.update(storageKey, frozen));
        this.persistTail = write;
        return write;
    }
    /** Load or migrate a persisted snapshot for `uri`, fetching from the server if absent. */
    private async load(uri: vscode.Uri): Promise<Snapshot> {
        typePath(uri);
        const key = uri.toString(), known = this.entries.get(key);
        if (known) { return known; }
        const pending = this.loading.get(key);
        if (pending) { return pending; }
        const load = (async () => {
            // Carry over a draft saved under an older URI shape for the same type.
            const earlier = uri.query === 'v=3' ? [v2TypeUri(uri.authority, typePath(uri)), legacyTypeUri(uri.authority, typePath(uri))]
                : uri.query === 'v=2' ? [legacyTypeUri(uri.authority, typePath(uri))] : [];
            const legacy = earlier.map(older => this.entries.get(older.toString())).find(Boolean);
            const doc = legacy ? undefined : await this.fetchDocument(uri);
            const entry: Snapshot = legacy
                ? JSON.parse(JSON.stringify(legacy))
                : { original: doc!.original, text: doc!.text, readonlyReason: doc!.readonlyReason, mtime: Date.now() };
            this.entries.set(key, entry);
            await this.persist();
            return entry;
        })();
        this.loading.set(key, load);
        try { return await load; } finally { this.loading.delete(key); }
    }
    /** Return a no-op file watcher disposable for virtual data type files. */
    watch(): vscode.Disposable { return new vscode.Disposable(() => {}); }
    /** Return directory or file metadata for a virtual `ghidra-type://` URI. */
    async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
        const prefix = uri.path.replace(/\/$/, '') + '/';
        const knownDirectory = !this.entries.has(uri.toString()) && [...this.entries.keys()].some(key => {
            const child = vscode.Uri.parse(key);
            return child.authority === uri.authority && child.path.startsWith(prefix);
        });
        if (knownDirectory || (uri.query !== 'v=3' && uri.query !== 'v=2' && !uri.path.endsWith('.jsonc'))) {
            return { type: vscode.FileType.Directory, ctime: 0, mtime: 0, size: 0 };
        }
        const entry = await this.load(uri);
        return { type: vscode.FileType.File, ctime: 0, mtime: entry.mtime, size: Buffer.byteLength(entry.text),
            ...(this.readonlyReason(entry) ? { permissions: vscode.FilePermission.Readonly } : {}) };
    }
    /** Read UTF-8 JSONC bytes for `uri`. */
    async readFile(uri: vscode.Uri): Promise<Uint8Array> { return Buffer.from((await this.load(uri)).text); }
    /** List cached child entries under a `ghidra-type://` category directory. */
    readDirectory(uri: vscode.Uri): [string, vscode.FileType][] {
        const prefix = uri.path.replace(/\/$/, '') + '/', children = new Map<string, vscode.FileType>();
        for (const key of this.entries.keys()) {
            const child = vscode.Uri.parse(key);
            if (child.authority !== uri.authority || !child.path.startsWith(prefix)) { continue; }
            const relative = child.path.slice(prefix.length), first = relative.split('/')[0];
            children.set(first, relative.includes('/') ? vscode.FileType.Directory : vscode.FileType.File);
        }
        return [...children];
    }
    /** Reject direct directory creation in `ghidra-type://` and direct users to Create Data Type. */
    createDirectory(): never { throw vscode.FileSystemError.NoPermissions('Use Ghidra: Create Data Type.'); }
    /** Reject direct file deletion in `ghidra-type://` and direct users to Delete Data Type. */
    delete(): never { throw vscode.FileSystemError.NoPermissions('Use Ghidra: Delete Data Type.'); }
    /** Reject filesystem-level rename on `ghidra-type://` URIs. */
    rename(): never { throw vscode.FileSystemError.NoPermissions('The URI identifies an existing Ghidra type.'); }

    /** Validate, journal uncertainty, and commit edited JSONC type content to Ghidra. */
    async writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean; overwrite: boolean }): Promise<void> {
        const key = uri.toString();
        if (!options.overwrite) { throw vscode.FileSystemError.FileExists(uri); }
        if (this.saving.has(key)) { throw vscode.FileSystemError.Unavailable('This data type is already being saved.'); }
        this.saving.add(key);
        let mutated = false, journaled = false, entry: Snapshot | undefined, validationFailure: ValidateTypeResponse | undefined;
        try {
            entry = await this.load(uri);
            this.context.require(uri.authority);
            const reason = this.readonlyReason(entry);
            if (reason) { throw vscode.FileSystemError.NoPermissions(reason); }
            if (entry.uncertain) { throw new Error('The previous save may have reached Ghidra. Compare with Ghidra, then revert and reload this document before saving again.'); }
            const text = Buffer.from(content).toString('utf8');
            if (entry.requiresReadback && text !== entry.text) {
                throw new Error('Ghidra normalized the last saved layout while you continued editing. Your draft is preserved. Compare with Ghidra, then revert and reload before saving again.');
            }
            const validation = await this.call<ValidateTypeResponse>('ghidra.validateTypeDocument', { text, original: entry.original });
            if (!validation.valid) {
                validationFailure = validation;
                throw new Error(validation.message || 'Invalid data type document.');
            }
            entry.uncertain = true;
            journaled = true;
            await this.persist();
            const saved = await this.call<SaveTypeResponse>('ghidra.saveTypeDocument', {
                md5: uri.authority,
                path: typePath(uri),
                text,
                original: entry.original,
            });
            mutated = Boolean(saved.mutated);
            entry.original = saved.original;
            entry.text = saved.text;
            entry.requiresReadback = Boolean(saved.requiresReadback);
            entry.uncertain = false;
            entry.mtime = Math.max(Date.now(), entry.mtime + 1);
            await this.persist();
            this.diagnostics.delete(uri);
            // VS Code completes its save before observing the backend's normalized layout.
            setTimeout(() => {
                if (this.disposed) { return; }
                entry!.mtime = Math.max(Date.now(), entry!.mtime + 1);
                this.events.fire([{ type: vscode.FileChangeType.Changed, uri }]);
            }, 150);
            if (mutated) { void vscode.commands.executeCommand('ghidraLsp.refreshBrowser', uri.authority); }
        } catch (error) {
            const message = formatFriendlyError(error);
            const preSendRejection = /changed in Ghidra while you were editing|read-only|cannot be edited|program state is uncertain|is required|validation/i.test(message) || Boolean(validationFailure);
            const postSendError = /may have reached/i.test(message);
            if (entry && journaled) {
                // Only clear uncertain when we know the server rejected before sending a mutation.
                if (preSendRejection && !postSendError && !mutated) {
                    entry.uncertain = false;
                } else {
                    entry.uncertain = true;
                    mutated = true;
                }
                await this.persist().catch(() => {});
            }
            if (validationFailure) { this.report(uri, validationFailure); }
            throw vscode.FileSystemError.Unavailable(`${message}${mutated && !postSendError ? ' The save may have reached Ghidra; compare and reload before retrying.' : ''}`);
        } finally { this.saving.delete(key); }
    }

    /** Publish a validation error diagnostic onto `uri`. */
    private report(uri: vscode.Uri, failure: ValidateTypeResponse): void {
        const document = this.document(uri);
        if (!document) { return; }
        let range: vscode.Range;
        if (failure.range) {
            const start = new vscode.Position(Math.max(0, failure.range.start.line), Math.max(0, failure.range.start.character));
            let end = new vscode.Position(Math.max(0, failure.range.end.line), Math.max(0, failure.range.end.character));
            if (end.isBeforeOrEqual(start)) {
                end = document.positionAt(document.offsetAt(start) + 1);
            }
            range = new vscode.Range(start, end);
        } else {
            const offset = Math.max(0, failure.offset ?? 0);
            const length = Math.max(1, failure.length ?? 1);
            range = new vscode.Range(document.positionAt(offset), document.positionAt(offset + length));
        }
        const diagnostic = new vscode.Diagnostic(range, failure.message || 'Invalid data type document.', vscode.DiagnosticSeverity.Error);
        diagnostic.source = 'Ghidra type'; this.diagnostics.set(uri, [diagnostic]);
    }
    /** Validate an open type document against the server schema and update diagnostics. */
    private async validate(document: vscode.TextDocument): Promise<void> {
        const key = document.uri.toString();
        const entry = this.entries.get(key);
        if (entry?.requiresReadback && document.getText() === entry.text) {
            entry.requiresReadback = false;
            void this.persist().catch(error => console.error('Type readback acknowledgement', error));
        }
        if (!entry || this.readonlyReason(entry) || this.saving.has(key)) { return; }
        const version = document.version;
        this.validateVersions.set(key, version);
        try {
            const res = await this.call<ValidateTypeResponse>('ghidra.validateTypeDocument', {
                text: document.getText(),
                original: entry.original,
            });
            if (this.disposed || this.validateVersions.get(key) !== version || this.saving.has(key)) { return; }
            const current = this.document(document.uri);
            if (!current || current.version !== version) { return; }
            if (res.valid) { this.diagnostics.delete(document.uri); }
            else { this.report(document.uri, res); }
        } catch {
            // Keep existing diagnostics if validation RPC fails transiently.
        }
    }
    /** Open a `ghidra-type://` JSONC document for `path` and activate its program. */
    async open(md5: string, path: string): Promise<void> {
        // Reuse an already-open document of an older shape, including a recovered dirty draft.
        const uri = [v2TypeUri(md5, path), legacyTypeUri(md5, path)].find(older => this.hasTab(older)) || typeUri(md5, path);
        let document = await vscode.workspace.openTextDocument(uri);
        if (document.languageId !== 'jsonc') { document = await vscode.languages.setTextDocumentLanguage(document, 'jsonc'); }
        await vscode.window.showTextDocument(document, { preview: false });
        await this.context.activate(md5);
        await this.validate(document);
    }
    /** Reload the latest server definition for a clean data type document. */
    private async reload(uri: vscode.Uri): Promise<void> {
        if (this.saving.has(uri.toString())) { throw new Error('Wait for this data type to finish saving.'); }
        if (this.document(uri)?.isDirty) { throw new Error('Your type draft has unsaved changes. Save it or use File: Revert File before reloading from Ghidra.'); }
        const current = await this.fetchDocument(uri);
        // The query is asynchronous; typing while it runs must keep the old save baseline.
        if (this.document(uri)?.isDirty || this.saving.has(uri.toString())) { return; }
        const previous = this.entries.get(uri.toString());
        const text = previous && sameTypeData(previous.original, current.original) ? previous.text : current.text;
        this.entries.set(uri.toString(), {
            original: current.original,
            text,
            readonlyReason: current.readonlyReason,
            requiresReadback: this.document(uri)?.getText() !== text,
            mtime: Math.max(Date.now(), (previous?.mtime || 0) + 1),
        });
        await this.persist();
        this.diagnostics.delete(uri);
        this.events.fire([{ type: vscode.FileChangeType.Changed, uri }]);
    }
    /** Reload all open, clean data type documents belonging to program `md5`. */
    async refresh(md5: string): Promise<void> {
        for (const key of this.entries.keys()) {
            const uri = vscode.Uri.parse(key);
            if (uri.authority === md5 && this.hasTab(uri) && !this.document(uri)?.isDirty && !this.saving.has(key)) { await this.reload(uri); }
        }
    }
    /** Return true when any open data type document belonging to `md5` has unsaved changes. */
    hasDirtyEditors(md5: string): boolean {
        const target = md5.toLowerCase();
        return vscode.workspace.textDocuments.some(doc => doc.uri.scheme === typeScheme && doc.uri.authority.toLowerCase() === target && doc.isDirty);
    }
    /** Reconcile cached and open data type documents after checkpoint restore or session reset. */
    async syncAfterSessionRestore(md5: string): Promise<void> {
        const target = md5.toLowerCase();
        for (const key of [...this.comparisons.keys()]) {
            if (vscode.Uri.parse(key).authority.toLowerCase() === target) { this.comparisons.delete(key); }
        }
        const staleTabs: vscode.Tab[] = [];
        for (const [key, previous] of [...this.entries]) {
            const uri = vscode.Uri.parse(key);
            if (uri.authority.toLowerCase() !== target || this.saving.has(key)) { continue; }
            if (!this.hasTab(uri)) {
                this.entries.delete(key);
                this.diagnostics.delete(uri);
                continue;
            }
            try {
                const current = await this.fetchDocument(uri);
                const text = current.text;
                this.entries.set(key, {
                    original: current.original,
                    text,
                    readonlyReason: current.readonlyReason,
                    uncertain: false,
                    requiresReadback: this.document(uri)?.getText() !== text,
                    mtime: Math.max(Date.now(), (previous.mtime || 0) + 1),
                });
                this.diagnostics.delete(uri);
                this.events.fire([{ type: vscode.FileChangeType.Changed, uri }]);
            } catch {
                this.entries.delete(key);
                this.diagnostics.delete(uri);
                for (const group of vscode.window.tabGroups.all) {
                    for (const tab of group.tabs) {
                        const matches = (tab.input instanceof vscode.TabInputText || tab.input instanceof vscode.TabInputCustom) && tab.input.uri.toString() === key
                            || tab.input instanceof vscode.TabInputTextDiff && [tab.input.original.toString(), tab.input.modified.toString()].includes(key);
                        if (matches) { staleTabs.push(tab); }
                    }
                }
                this.events.fire([{ type: vscode.FileChangeType.Deleted, uri }]);
            }
        }
        await this.persist();
        if (staleTabs.length) {
            await vscode.window.tabGroups.close(staleTabs, true);
        }
    }
    /** Open a diff view comparing the live Ghidra type against the local draft `uri`. */
    private async compare(uri: vscode.Uri): Promise<void> {
        const current = await this.fetchDocument(uri);
        const snapshot = uri.with({ scheme: 'ghidra-type-current', query: `source=${typeVersions[uri.query] || 'legacy'}&t=${Date.now()}` });
        this.comparisons.set(snapshot.toString(), current.text);
        await vscode.commands.executeCommand('vscode.diff', snapshot, uri, `${typePath(uri)} — Ghidra ↔ Draft`);
    }
    /** Close all open type editors and diff tabs belonging to program `md5`. */
    async closeEditors(md5: string): Promise<void> {
        const tabs = vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab => {
            const owns = (uri: vscode.Uri): boolean => uri.authority === md5 && [typeScheme, 'ghidra-type-current'].includes(uri.scheme);
            return tab.input instanceof vscode.TabInputText || tab.input instanceof vscode.TabInputCustom ? owns(tab.input.uri)
                : tab.input instanceof vscode.TabInputTextDiff && (owns(tab.input.original) || owns(tab.input.modified));
        });
        if (tabs.length && !await vscode.window.tabGroups.close(tabs)) { throw new Error('Closing the program was cancelled; the data type draft and session are still open.'); }
    }
    /** Prune non-dirty, non-uncertain cached snapshots when program `md5` closes. */
    close(md5: string): void {
        const target = md5.toLowerCase();
        let removed = false;
        for (const [key, entry] of [...this.entries]) {
            const uri = vscode.Uri.parse(key);
            if (uri.authority.toLowerCase() !== target) { continue; }
            if (!this.hasTab(uri) && !this.document(uri)?.isDirty && !entry.uncertain && !entry.requiresReadback) {
                this.entries.delete(key);
                removed = true;
            }
        }
        for (const key of [...this.comparisons.keys()]) {
            if (vscode.Uri.parse(key).authority.toLowerCase() === target) { this.comparisons.delete(key); }
        }
        if (removed) { void this.persist().catch(() => {}); }
    }
    /** Dispose providers, diagnostics, and event emitters. */
    dispose(): void {
        this.disposed = true;
        for (const disposable of this.disposables) { disposable.dispose(); }
        this.events.dispose(); this.diagnostics.dispose();
    }
}
