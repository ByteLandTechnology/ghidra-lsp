// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

import * as vscode from 'vscode';

/** Virtual document content payload returned by `ghidra.document`. */
export interface VirtualDocument {
    uri: string;
    text: string;
    md5: string;
    entry?: string;
    warning?: string;
}
/** Typed helper signature for executing LSP-bridged Ghidra commands. */
export type Call = <T>(command: string, args?: object) => Promise<T>;
/** Cached virtual file entry stored in process memory. */
interface Entry { data: Uint8Array; created: number; modified: number; fresh?: boolean }

/** The readonly backing store is process memory. */
export class GhidraMemory implements vscode.FileSystemProvider, vscode.Disposable {
    /** Cached virtual documents keyed by URI string. */
    private readonly entries = new Map<string, Entry>();
    /** Program MD5 identifiers currently closing. */
    private readonly closing = new Set<string>();
    /** Emitter for VS Code virtual filesystem change events. */
    private readonly events = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    /** Event fired when virtual Ghidra documents update. */
    readonly onDidChangeFile = this.events.event;
    /** Create an in-memory virtual filesystem backed by `call`. */
    constructor(private readonly call: Call) {}
    /** Return a no-op file watcher disposable for virtual resources. */
    watch(): vscode.Disposable { return new vscode.Disposable(() => {}); }
    /** Return true when `uri` points to an implicit virtual directory. */
    private directory(uri: vscode.Uri): boolean {
        return uri.path === '' || uri.path === '/' || /^\/(function|symbol|references|type)\/?$/.test(uri.path);
    }
    /** Fetch and cache a virtual document from the server if not yet cached. */
    private async load(uri: vscode.Uri): Promise<Entry> {
        const known = this.entries.get(uri.toString());
        if (known) { return known; }
        if (this.closing.has(uri.authority)) { throw vscode.FileSystemError.FileNotFound(uri); }
        try {
            const document = await this.call<VirtualDocument>('ghidra.document', { uri: uri.toString(), includePending: true });
            const now = Date.now();
            const entry: Entry = { data: Buffer.from(document.text, 'utf8'), created: now, modified: now, fresh: true };
            this.entries.set(uri.toString(), entry);
            return entry;
        } catch (error) { throw vscode.FileSystemError.Unavailable(String(error)); }
    }
    /** Return read-only file or directory metadata for `uri`. */
    async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
        if (this.directory(uri)) { return { type: vscode.FileType.Directory, ctime: 0, mtime: 0, size: 0 }; }
        const entry = await this.load(uri);
        return { type: vscode.FileType.File, ctime: entry.created, mtime: entry.modified, size: entry.data.byteLength,
            permissions: vscode.FilePermission.Readonly };
    }
    /** Read UTF-8 virtual document bytes from cache or server. */
    async readFile(uri: vscode.Uri): Promise<Uint8Array> {
        const entry = await this.load(uri);
        if (entry.fresh) {
            entry.fresh = false;
            return Uint8Array.from(entry.data);
        }
        if (this.closing.has(uri.authority)) { return Uint8Array.from(entry.data); }
        const document = await this.call<VirtualDocument>('ghidra.document', { uri: uri.toString(), includePending: true });
        entry.data = Buffer.from(document.text, 'utf8');
        return Uint8Array.from(entry.data);
    }
    /** Reject direct file writes on read-only virtual Ghidra documents. */
    writeFile(): never { throw vscode.FileSystemError.NoPermissions('Ghidra views are readonly. Use F2 and Ghidra: Submit Pending Rename.'); }
    /** List cached virtual files under the given virtual directory URI. */
    readDirectory(uri: vscode.Uri): [string, vscode.FileType][] {
        const prefix = uri.path.replace(/\/$/, '') + '/';
        return [...this.entries.keys()].map(key => vscode.Uri.parse(key))
            .filter(item => item.authority === uri.authority && item.path.startsWith(prefix))
            .map(item => [item.path.slice(prefix.length), vscode.FileType.File]);
    }
    /** Ignore explicit directory creation in the implicit virtual namespace. */
    createDirectory(): void { /* Directories are implicit in the virtual namespace. */ }
    /** Reject deletion of read-only virtual Ghidra documents. */
    delete(): never { throw vscode.FileSystemError.NoPermissions('Ghidra views are not source files'); }
    /** Reject filesystem-level rename and direct users to LSP symbol rename. */
    rename(): never { throw vscode.FileSystemError.NoPermissions('Use F2 on a function or global symbol'); }
    /** Remove cached virtual documents belonging to program `md5`. */
    close(md5: string): void {
        for (const key of this.entries.keys()) { if (vscode.Uri.parse(key).authority === md5) { this.entries.delete(key); } }
    }
    /** Mark program `md5` as closing so reads stop hitting the backend. */
    beginClosing(md5: string): void { this.closing.add(md5); }
    /** Clear the closing flag when reopening program `md5`. */
    reopen(md5: string): void { this.closing.delete(md5); }
    /** Emit change notifications for non-function virtual views of `md5`. */
    refresh(md5: string): void {
        if (this.closing.has(md5)) { return; }
        const changes: vscode.FileChangeEvent[] = [];
        for (const [key, entry] of this.entries) {
            const uri = vscode.Uri.parse(key);
            if (uri.authority === md5 && !uri.path.startsWith('/function/')) {
                entry.modified = Math.max(Date.now(), entry.modified + 1);
                changes.push({ type: vscode.FileChangeType.Changed, uri });
            }
        }
        if (changes.length) { this.events.fire(changes); }
    }
    /** Release cached entries and event emitters. */
    dispose(): void { this.entries.clear(); this.closing.clear(); this.events.dispose(); }
}
