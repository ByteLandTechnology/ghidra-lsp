// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

import * as vscode from 'vscode';
import { Call } from './memory';
import { ProgramContext } from './context';
import { formatListing, listingUnits, ListingUnit, plainAddress } from './listing-format';
import { symbolName } from './names';
import { MemoryFiles, memoryScheme, defaultByteWindow, memoryAddress, memorySelectedAddresses, memoryRanges } from './bytes';
import { AddressRange, addressRange, intersects, selectedLines } from './view-ranges';
import { bytesExtension, listingExtension, withoutExtension } from './virtual-files';
import { Data, object, stringOf } from './web';

/** URI scheme for virtual assembly listing documents. */
export const listingScheme = 'ghidra-listing';
/** Active text representation mode inside a `ghidra-listing://` tab. */
export type ListingMode = 'listing' | 'bytes';
/** Persisted display mode and byte-window address for one listing URI. */
interface Display { mode: ListingMode; byteAddress?: string }

/** Server response payload from `ghidra.reveal`. */
export interface Reveal { uri: string; range?: { start: { line: number; character: number }; end: { line: number; character: number } } }

/** How many code units a window shows when the address is outside any function. */
export const addressWindowUnits = 200;
/** How many code units a function window shows before it is cut short (the bridge caps a page at 1000). */
export const functionWindowUnits = 1000;

/** Resolved address window bounds and owning function metadata. */
interface Window { start: string; end?: string; entry?: string; name: string }
/** Cached listing document buffer, parsed units, and window metadata. */
interface Entry { data: Uint8Array; created: number; modified: number; units: ListingUnit[]; notes: string[]; window: Window }

/** Serves read-only listing documents as virtual files under the ghidra-listing scheme. */
export class ListingFiles implements vscode.FileSystemProvider, vscode.Disposable {
    /** Cached listing entries keyed by URI string. */
    private readonly entries = new Map<string, Entry>();
    /** In-flight listing queries coalesced by URI string. */
    private readonly pending = new Map<string, Promise<Entry>>();
    /** Emitter for VS Code virtual filesystem change notifications. */
    private readonly changes = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    /** Event fired when a listing document updates or switches display mode. */
    readonly onDidChangeFile = this.changes.event;

    /** Persisted display mode settings keyed by URI string. */
    private readonly displays: Map<string, Display>;
    /** Synthetic modification timestamps used to force editor reloads on mode switch. */
    private readonly modified = new Map<string, number>();
    /** Initialize the listing provider and restore persisted per-URI display modes. */
    constructor(private readonly call: Call, private readonly context: ProgramContext,
        private readonly bytes: MemoryFiles, private readonly state: vscode.Memento) {
        this.displays = new Map(Object.entries(state.get<Record<string, Display>>('ghidra.listingDisplays', {})));
    }
    /** Return the current display mode (`listing` or `bytes`) for `uri`. */
    mode(uri: vscode.Uri): ListingMode { return this.displays.get(uri.toString())?.mode || 'listing'; }
    /** Return the VS Code language ID matching the current display mode for `uri`. */
    language(uri: vscode.Uri): string { return this.mode(uri) === 'bytes' ? memoryScheme : listingScheme; }
    /** Build the peer `ghidra-memory://` URI used when displaying `uri` in `bytes` mode. */
    private byteUri(uri: vscode.Uri, address = this.displays.get(uri.toString())?.byteAddress): vscode.Uri {
        address ||= this.entries.get(uri.toString())?.window.start || this.target(uri)!.address;
        return vscode.Uri.from({ scheme: memoryScheme, authority: uri.authority, path: `/memory/${plainAddress(address)}${bytesExtension}`,
            query: JSON.stringify({ address }) });
    }
    /** Preload before committing the mode, so a failed read leaves the current view intact. */
    async setMode(uri: vscode.Uri, mode: ListingMode, address: string): Promise<string> {
        let entry = await this.load(uri);
        const target = addressRange(address);
        const contains = (start: string, length: number): boolean => {
            const range = addressRange(start, length);
            return !!target && !!range && intersects(target, range);
        };
        let display = this.displays.get(uri.toString());
        let data: Uint8Array;
        if (mode === 'bytes') {
            const old = display?.byteAddress;
            const byteAddress = old && contains(old, defaultByteWindow) ? old
                : contains(entry.window.start, defaultByteWindow) ? entry.window.start : address;
            data = await this.bytes.readFile(this.byteUri(uri, byteAddress));
            display = { mode, byteAddress };
        } else {
            if (!entry.units.some(unit => contains(unit.address, unit.bytes.split(' ').filter(Boolean).length))) {
                entry = await this.query({ md5: uri.authority, address });
                this.entries.set(uri.toString(), entry);
            }
            data = entry.data;
            display = { ...display, mode };
        }
        this.displays.set(uri.toString(), display);
        this.modified.set(uri.toString(), Math.max(Date.now(), (this.modified.get(uri.toString()) || 0) + 1));
        void this.state.update('ghidra.listingDisplays', Object.fromEntries(this.displays));
        return Buffer.from(data).toString('utf8');
    }
    /** Emit a file-changed event for `uri`. */
    changed(uri: vscode.Uri): void { this.changes.fire([{ type: vscode.FileChangeType.Changed, uri }]); }

    /** Return a no-op file watcher disposable for virtual listing documents. */
    watch(): vscode.Disposable { return new vscode.Disposable(() => { }); }
    /** Extract program MD5, target address, and optional function entry from `uri`. */
    private target(uri: vscode.Uri): { md5: string; address: string; entry?: string } | undefined {
        const match = /^\/listing\/([^/]+)$/.exec(uri.path);
        if (!match || !/^[a-f\d]{32}$/i.test(uri.authority)) { return undefined; }
        let address = decodeURIComponent(withoutExtension(match[1], listingExtension));
        let entry: string | undefined;
        try {
            const query = JSON.parse(uri.query);
            if (query && typeof query === 'object') {
                if (typeof query.address === 'string' && query.address) { address = query.address; }
                if (typeof query.entry === 'string' && query.entry) { entry = query.entry; }
            }
        } catch { /* A plain address in the path is enough. */ }
        return { md5: uri.authority.toLowerCase(), address, entry };
    }
    /** Return a cached listing entry or coalesce a new server query. */
    private async load(uri: vscode.Uri): Promise<Entry> {
        const target = this.target(uri);
        if (!target) { throw vscode.FileSystemError.FileNotFound(uri); }
        const key = uri.toString();
        const known = this.entries.get(key);
        if (known) { return known; }
        const inFlight = this.pending.get(key);
        if (inFlight) { return inFlight; }
        const request = this.query(target).then(entry => {
            this.entries.set(key, entry);
            this.pending.delete(key);
            return entry;
        }, error => {
            this.pending.delete(key);
            throw error;
        });
        this.pending.set(key, request);
        return request;
    }
    /** Resolve the window: the containing function when there is one, the address otherwise. */
    private async window(md5: string, address: string, entry?: string): Promise<Window> {
        let functionEntry = entry;
        if (!functionEntry) {
            const resolved = await this.call<Data>('ghidra.query', { md5, domain: 'address', operation: 'resolve', params: { selector: { address } } });
            const found = stringOf(object(resolved.function).entry);
            if (found) { functionEntry = found; }
        }
        if (!functionEntry) {
            return { start: address, name: plainAddress(address) };
        }
        const fn = await this.call<Data>('ghidra.query', { md5, domain: 'function', operation: 'get',
            params: { selector: { entry: functionEntry }, projection: { fields: ['entry', 'name', 'namespace', 'demangled_name', 'body'] } } });
        const body = object(fn.body);
        const start = stringOf(body.start), end = stringOf(body.end);
        if (!start || !end) {
            return { start: address, entry: functionEntry, name: plainAddress(address) };
        }
        return { start, end, entry: functionEntry, name: symbolName(fn, true) || plainAddress(functionEntry) };
    }
    /** Query code units for `target` from `listing.code_unit.list` and format them. */
    private async query(target: { md5: string; address: string; entry?: string }): Promise<Entry> {
        const window = await this.window(target.md5, target.address, target.entry);
        const limit = window.entry ? functionWindowUnits : addressWindowUnits;
        const result = await this.call<Data>('ghidra.query', {
            md5: target.md5, domain: 'listing', operation: 'code_unit.list',
            params: { filter: { kind: 'all' }, page: { limit },
                scan: { range: { start: window.start, ...(window.end ? { end: window.end } : {}) }, timeout_ms: 60000 } },
        });
        const units = listingUnits(result);
        const scan = object(result.scan);
        const notes: string[] = [];
        if (scan.stop_reason === 'timeout') { notes.push('Ghidra scan stopped at its time limit; this window is partial.'); }
        if (stringOf(result.next_cursor)) {
            notes.push(window.entry
                ? `This function is larger than ${limit} code units; the window is cut short.`
                : 'More code units follow this window.');
        }
        if (window.entry && !units.length) { notes.push('This function has no code units in the listing.'); }
        const now = Date.now();
        return {
            data: Buffer.from(units.length ? formatListing(units) : `No code units at ${target.address}.`, 'utf8'),
            created: now, modified: now, units, notes, window,
        };
    }
    /** The window currently rendered for a listing document. */
    entry(uri: vscode.Uri): Entry | undefined { return this.entries.get(uri.toString()); }
    /** Return read-only file metadata for listing or byte-mode `uri`. */
    async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
        const target = this.target(uri);
        if (!target) { throw vscode.FileSystemError.FileNotFound(uri); }
        const entry = await this.load(uri);
        const stat = this.mode(uri) === 'bytes' ? await this.bytes.stat(this.byteUri(uri))
            : { type: vscode.FileType.File, ctime: entry.created, mtime: entry.modified, size: entry.data.byteLength, permissions: vscode.FilePermission.Readonly };
        return { ...stat, mtime: Math.max(stat.mtime, this.modified.get(uri.toString()) || 0) };
    }
    /** Read UTF-8 listing or byte-mode content for `uri`. */
    async readFile(uri: vscode.Uri): Promise<Uint8Array> {
        const entry = await this.load(uri);
        return this.mode(uri) === 'bytes' ? this.bytes.readFile(this.byteUri(uri)) : Uint8Array.from(entry.data);
    }
    /** List cached virtual listing files under `uri`. */
    readDirectory(uri: vscode.Uri): [string, vscode.FileType][] {
        const prefix = uri.path.replace(/\/$/, '') + '/';
        return [...this.entries.keys()].map(key => vscode.Uri.parse(key))
            .filter(item => item.authority === uri.authority && item.path.startsWith(prefix))
            .map(item => [item.path.slice(prefix.length), vscode.FileType.File]);
    }
    /** Ignore explicit directory creation in the implicit virtual namespace. */
    createDirectory(): void { /* Directories are implicit in the virtual namespace. */ }
    /** Reject writes to read-only listing documents. */
    writeFile(): never { throw vscode.FileSystemError.NoPermissions('Ghidra listing views are readonly.'); }
    /** Reject deletions on read-only listing documents. */
    delete(): never { throw vscode.FileSystemError.NoPermissions('Ghidra listing views are not source files'); }
    /** Reject renames on read-only listing documents. */
    rename(): never { throw vscode.FileSystemError.NoPermissions('Ghidra listing views are not source files'); }
    /** Drop cached windows so the next read re-reads Ghidra. */
    invalidate(md5: string): void {
        this.bytes.invalidate(md5);
        for (const key of [...this.entries.keys()]) {
            if (vscode.Uri.parse(key).authority === md5) { this.entries.delete(key); }
        }
    }
    /** Invalidate cached listing and byte entries and notify open documents for `md5`. */
    refresh(md5: string): void {
        if (this.context.isClosing(md5)) { return; }
        const changed = [...this.entries.keys()]
            .map(key => vscode.Uri.parse(key))
            .filter(uri => uri.authority === md5);
        this.invalidate(md5);
        if (changed.length) {
            this.changes.fire(changed.map(uri => ({ type: vscode.FileChangeType.Changed, uri })));
        }
    }
    /** Clear cached entries and dispose event emitters. */
    dispose(): void { this.entries.clear(); this.pending.clear(); this.changes.dispose(); }
}

/** Listing documents in the editor: language, F12 into the decompiled function, and opening. */
export class ListingViews implements vscode.Disposable {
    /** Registered document listeners and definition providers. */
    private readonly disposables: vscode.Disposable[];
    /** In-flight display-mode switch promises keyed by URI string. */
    private readonly switching = new Map<string, Promise<void>>();
    /** Return true while `uri` is switching between listing and byte modes. */
    isSwitching(uri: vscode.Uri): boolean { return this.switching.has(uri.toString()); }
    /** Wait for any active mode switch on `uri` to finish. */
    async ready(uri: vscode.Uri): Promise<void> { await this.switching.get(uri.toString()); }
    /** Register language synchronization and F12 Go to Definition for listing tabs. */
    constructor(private readonly call: Call, private readonly files: ListingFiles) {
        this.disposables = [
            vscode.workspace.onDidOpenTextDocument(document => {
                if (document.uri.scheme === listingScheme && document.languageId !== this.files.language(document.uri)) {
                    void Promise.resolve(vscode.languages.setTextDocumentLanguage(document, this.files.language(document.uri))).catch(console.error);
                }
            }),
            vscode.languages.registerDefinitionProvider({ scheme: listingScheme }, {
                provideDefinition: async (document, position) => {
                    const address = this.addressAtPosition(document, position);
                    if (!address) { return undefined; }
                    const md5 = document.uri.authority;
                    const result = await this.call<Reveal>('ghidra.reveal', { md5, address });
                    const location = vscode.Uri.parse(result.uri);
                    if (!result.range) { return new vscode.Location(location, new vscode.Position(0, 0)); }
                    return new vscode.Location(location, new vscode.Range(
                        result.range.start.line, result.range.start.character,
                        result.range.end.line, result.range.end.character,
                    ));
                },
            }),
        ];
    }
    /** The listing row under the cursor, resolved through the rendered window. */
    private unitAt(document: vscode.TextDocument, position: vscode.Position): ListingUnit | undefined {
        const entry = this.files.entry(document.uri);
        const unit = entry?.units[position.line];
        if (unit) { return unit; }
        const match = /^\s*([0-9a-fA-F]+)\s/.exec(document.lineAt(position.line).text);
        return match ? { address: match[1].toUpperCase(), plain: match[1].toUpperCase(), bytes: '', body: '', kind: 'instruction' } : undefined;
    }
    /** The address of the row under the cursor, in Ghidra's own address form. */
    addressAt(editor: vscode.TextEditor | undefined): string | undefined {
        if (!editor || editor.document.uri.scheme !== listingScheme) { return undefined; }
        return this.addressAtPosition(editor.document, editor.selection.active);
    }
    /** Return the canonical machine address at `position` in a listing or byte document. */
    addressAtPosition(document: vscode.TextDocument, position: vscode.Position): string | undefined {
        return this.files.mode(document.uri) === 'bytes' ? memoryAddress(document, position) : this.unitAt(document, position)?.address;
    }
    /** Return machine address ranges covered by `selections` in `document`. */
    addresses(document: vscode.TextDocument, selections: readonly vscode.Selection[]): AddressRange[] {
        if (this.files.mode(document.uri) === 'bytes') { return memorySelectedAddresses(document, selections); }
        return selectedLines(document, selections).flatMap(line => {
            const unit = this.unitAt(document, new vscode.Position(line, 0));
            const range = unit && addressRange(unit.address, unit.bytes.split(' ').filter(Boolean).length);
            return range ? [range] : [];
        });
    }
    /** Expand mapped locations to their real instruction extent, including long instructions. */
    instructionRanges(uri: vscode.Uri, addresses: AddressRange[]): AddressRange[] {
        return (this.files.entry(uri)?.units || []).flatMap(unit => {
            const range = addressRange(unit.address, unit.bytes.split(' ').filter(Boolean).length);
            return range && addresses.some(address => intersects(range, address)) ? [range] : [];
        });
    }
    /** Map machine `addresses` to line or byte column ranges in `document`. */
    ranges(document: vscode.TextDocument, addresses: AddressRange[]): vscode.Range[] {
        if (this.files.mode(document.uri) === 'bytes') { return memoryRanges(document, addresses); }
        const result: vscode.Range[] = [];
        for (let line = 0; line < document.lineCount; line++) {
            const unit = this.unitAt(document, new vscode.Position(line, 0));
            const range = unit && addressRange(unit.address, unit.bytes.split(' ').filter(Boolean).length);
            if (range && addresses.some(address => intersects(range, address))) { result.push(document.lineAt(line).range); }
        }
        return result;
    }
    /** Change the contents and language of the existing readonly file; never create a tab. */
    async switchTo(editor: vscode.TextEditor, mode: ListingMode, address: string): Promise<void> {
        const uri = editor.document.uri, key = uri.toString();
        const previous = this.switching.get(key);
        const pending = (async () => {
            if (previous) { await previous; }
            const expected = await this.files.setMode(uri, mode, address);
            if (editor.document.getText() !== expected) {
                await new Promise<void>((resolve, reject) => {
                    const done = (error?: Error): void => { clearTimeout(timer); subscription.dispose(); error ? reject(error) : resolve(); };
                    const subscription = vscode.workspace.onDidChangeTextDocument(event => {
                        if (event.document.uri.toString() === key && event.document.getText() === expected) { done(); }
                    });
                    const timer = setTimeout(() => done(new Error('The analysis view did not refresh. Use Refresh Listing to retry.')), 10000);
                    this.files.changed(uri);
                });
            }
            if (editor.document.languageId !== this.files.language(uri)) {
                await vscode.languages.setTextDocumentLanguage(editor.document, this.files.language(uri));
            }
        })();
        this.switching.set(key, pending);
        try { await pending; }
        finally { if (this.switching.get(key) === pending) { this.switching.delete(key); } }
    }
    /** Open the decompiled function that contains the address. */
    async openFunction(md5: string, address: string): Promise<void> {
        const result = await this.call<Reveal>('ghidra.reveal', { md5, address });
        const uri = vscode.Uri.parse(result.uri);
        const document = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(document, { preview: false });
        if (result.range) {
            const range = new vscode.Range(result.range.start.line, result.range.start.character, result.range.end.line, result.range.end.character);
            editor.selection = new vscode.Selection(range.start, range.end);
            editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        }
    }
    /** Open or focus a virtual listing document at `address` and reveal its row. */
    async open(md5: string, address: string, entry?: string): Promise<vscode.TextEditor> {
        const uri = vscode.Uri.from({ scheme: listingScheme, authority: md5, path: `/listing/${plainAddress(address)}${listingExtension}`,
            query: JSON.stringify({ address, ...(entry ? { entry } : {}) }) });
        const document = await vscode.workspace.openTextDocument(uri);
        if (document.languageId !== this.files.language(uri)) {
            await vscode.languages.setTextDocumentLanguage(document, this.files.language(uri));
        }
        const editor = await vscode.window.showTextDocument(document, { preview: false });
        const notes = this.files.entry(uri)?.notes || [];
        if (notes.length) { void vscode.window.showWarningMessage(notes.join(' ')); }
        if (this.files.mode(uri) !== 'listing') { await this.switchTo(editor, 'listing', address); }
        this.revealRow(editor, address);
        return editor;
    }
    /** Put the cursor on the row of the requested address, the way Ghidra scrolls to it. */
    private revealRow(editor: vscode.TextEditor, address: string): void {
        const plain = plainAddress(address);
        for (let line = 0; line < editor.document.lineCount; line++) {
            if (!editor.document.lineAt(line).text.trim().toUpperCase().startsWith(plain)) { continue; }
            const position = new vscode.Position(line, 0);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
            return;
        }
    }
    /** Dispose registered definition providers and document listeners. */
    dispose(): void { for (const disposable of this.disposables) { disposable.dispose(); } }
}
