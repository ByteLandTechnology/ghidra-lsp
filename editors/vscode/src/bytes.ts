// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

import * as vscode from 'vscode';
import { Call } from './memory';
import { ProgramContext } from './context';
import { bytesOf, formatHexDump } from './bytes-format';
import { plainAddress } from './listing-format';
import { AddressRange, addressRange, addressText, intersects, selectedLines } from './view-ranges';
import { bytesExtension, withoutExtension } from './virtual-files';
import { Data } from './web';

/** URI scheme for virtual hex-dump byte windows. */
export const memoryScheme = 'ghidra-memory';

/** Byte cells in both columns, shared by navigation and range selection. */
function byteRow(document: vscode.TextDocument, line: number): { address: AddressRange; hex: number; ascii: number; count: number } | undefined {
    const text = document.lineAt(line).text;
    const match = /^([0-9A-Fa-f]{2,16})\s/.exec(text);
    if (!match) { return undefined; }
    const hex = text.indexOf('  ') + 2, ascii = text.indexOf('|');
    const count = text.slice(hex, ascii < 0 ? undefined : ascii).trim().split(/\s+/)
        .filter(value => /^[0-9A-Fa-f]{2}$/.test(value)).length;
    let space = '';
    try {
        const address = JSON.parse(document.uri.query)?.address;
        if (typeof address === 'string') { space = address.slice(0, address.lastIndexOf(':') + 1); }
    } catch { /* A plain address uses the default space. */ }
    const address = addressRange(space + match[1], count);
    return address && count ? { address, hex, ascii, count } : undefined;
}
/** Resolve the machine address for one cursor position inside a hex dump document. */
export function memoryAddress(document: vscode.TextDocument, position: vscode.Position): string | undefined {
    const row = byteRow(document, position.line);
    if (!row) { return undefined; }
    const offset = row.ascii >= 0 && position.character > row.ascii ? position.character - row.ascii - 1
        : Math.floor((position.character - row.hex) / 3);
    const start = row.address.start + BigInt(Math.max(0, Math.min(offset, row.count - 1)));
    return addressText({ ...row.address, start });
}
/** Return the machine address at the active cursor when viewing a `ghidra-memory` editor. */
export function memoryAddressAt(editor: vscode.TextEditor | undefined): string | undefined {
    return editor && editor.document.languageId === memoryScheme ? memoryAddress(editor.document, editor.selection.active) : undefined;
}
/** Return machine address ranges covered by hex or ASCII selections in a byte view. */
export function memorySelectedAddresses(document: vscode.TextDocument, selections: readonly vscode.Selection[]): AddressRange[] {
    const result: AddressRange[] = [];
    for (const line of selectedLines(document, selections)) {
        const row = byteRow(document, line);
        if (!row) { continue; }
        for (let offset = 0; offset < row.count; offset++) {
            const hex = new vscode.Range(line, row.hex + offset * 3, line, row.hex + offset * 3 + 2);
            const ascii = new vscode.Range(line, row.ascii + 1 + offset, line, row.ascii + 2 + offset);
            if (selections.some(selection => [hex, ascii].some(cell => {
                const overlap = selection.intersection(cell);
                return overlap && !overlap.isEmpty;
            }))) {
                const start = row.address.start + BigInt(offset);
                result.push({ ...row.address, start, end: start });
            }
        }
    }
    // Selecting only an address column still denotes a location.
    if (!result.length) {
        for (const selection of selections) {
            const address = memoryAddress(document, selection.active);
            const range = address && addressRange(address);
            if (range) { result.push(range); }
        }
    }
    return result;
}
/** Map machine address ranges back to hex column ranges inside a byte dump document. */
export function memoryRanges(document: vscode.TextDocument, addresses: AddressRange[]): vscode.Range[] {
    const result: vscode.Range[] = [];
    for (let line = 0; line < document.lineCount; line++) {
        const row = byteRow(document, line);
        if (!row) { continue; }
        for (const address of addresses) {
            if (!intersects(row.address, address)) { continue; }
            const start = Number((address.start > row.address.start ? address.start : row.address.start) - row.address.start);
            const end = Number((address.end < row.address.end ? address.end : row.address.end) - row.address.start);
            result.push(new vscode.Range(line, row.hex + start * 3, line, row.hex + end * 3 + 2));
        }
    }
    return result;
}

/** How many bytes a byte view shows when no range is given. */
export const defaultByteWindow = 256;
/** The largest byte view a single read may produce. */
export const maxByteWindow = 1024;

/** Cached hex-dump buffer and diagnostic notes for one byte window URI. */
interface Entry { data: Uint8Array; created: number; modified: number; notes: string[] }

/** Serves read-only byte dumps as virtual files under the ghidra-memory scheme. */
export class MemoryFiles implements vscode.FileSystemProvider, vscode.Disposable {
    /** Cached byte-window entries keyed by URI string. */
    private readonly entries = new Map<string, Entry>();
    /** In-flight read promises coalesced by URI string. */
    private readonly pending = new Map<string, Promise<Entry>>();
    /** Emitter for virtual filesystem change notifications. */
    private readonly changes = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    /** Event fired when cached byte windows are invalidated or refreshed. */
    readonly onDidChangeFile = this.changes.event;

    /** Create a read-only byte-window provider backed by `call` and `context`. */
    constructor(private readonly call: Call, private readonly context: ProgramContext) {}
    /** Return a no-op file watcher disposable for virtual byte windows. */
    watch(): vscode.Disposable { return new vscode.Disposable(() => { }); }
    /** Parse program MD5, start address, and optional byte length from `uri`. */
    private target(uri: vscode.Uri): { md5: string; address: string; length?: number } | undefined {
        const match = /^\/memory\/([^/]+)$/.exec(uri.path);
        if (!match || !/^[a-f\d]{32}$/i.test(uri.authority)) { return undefined; }
        let address = decodeURIComponent(withoutExtension(match[1], bytesExtension));
        let length: number | undefined;
        try {
            const query = JSON.parse(uri.query);
            if (query && typeof query === 'object') {
                if (typeof query.address === 'string' && query.address) { address = query.address; }
                if (typeof query.length === 'number' && query.length > 0) { length = Math.min(query.length, maxByteWindow); }
            }
        } catch { /* A plain address in the path is enough. */ }
        return { md5: uri.authority.toLowerCase(), address, length };
    }
    /** Return a cached byte-window entry or coalesce a new server read. */
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
    /** Read raw bytes from the backend and format them as a hex dump. */
    private async query(target: { md5: string; address: string; length?: number }): Promise<Entry> {
        const length = target.length || defaultByteWindow;
        const result = await this.call<Data>('ghidra.query', {
            md5: target.md5, domain: 'memory', operation: 'read',
            params: { selector: { address: target.address }, encoding: 'hex', length },
        });
        const hex = bytesOf(result.bytes);
        const notes: string[] = [];
        const count = hex ? hex.split(' ').length : 0;
        if (count < length) { notes.push(`Only ${count} bytes are readable at ${plainAddress(target.address)}.`); }
        const now = Date.now();
        return {
            data: Buffer.from(count ? formatHexDump(target.address, hex) : `No bytes at ${target.address}.`, 'utf8'),
            created: now, modified: now, notes,
        };
    }
    /** The notes of the window currently rendered for a byte view. */
    notes(uri: vscode.Uri): string[] { return this.entries.get(uri.toString())?.notes || []; }
    /** Return read-only file metadata for byte-window `uri`. */
    async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
        const target = this.target(uri);
        if (!target) { throw vscode.FileSystemError.FileNotFound(uri); }
        const entry = await this.load(uri);
        return { type: vscode.FileType.File, ctime: entry.created, mtime: entry.modified, size: entry.data.byteLength, permissions: vscode.FilePermission.Readonly };
    }
    /** Read formatted hex-dump UTF-8 bytes for `uri`. */
    async readFile(uri: vscode.Uri): Promise<Uint8Array> {
        const entry = await this.load(uri);
        return Uint8Array.from(entry.data);
    }
    /** List cached virtual byte-window files under `uri`. */
    readDirectory(uri: vscode.Uri): [string, vscode.FileType][] {
        const prefix = uri.path.replace(/\/$/, '') + '/';
        return [...this.entries.keys()].map(key => vscode.Uri.parse(key))
            .filter(item => item.authority === uri.authority && item.path.startsWith(prefix))
            .map(item => [item.path.slice(prefix.length), vscode.FileType.File]);
    }
    /** Ignore explicit directory creation in the implicit virtual namespace. */
    createDirectory(): void { /* Directories are implicit in the virtual namespace. */ }
    /** Reject writes to read-only byte windows. */
    writeFile(): never { throw vscode.FileSystemError.NoPermissions('Ghidra byte views are readonly.'); }
    /** Reject deletions on read-only byte windows. */
    delete(): never { throw vscode.FileSystemError.NoPermissions('Ghidra byte views are not source files'); }
    /** Reject renames on read-only byte windows. */
    rename(): never { throw vscode.FileSystemError.NoPermissions('Ghidra byte views are not source files'); }
    /** Drop cached byte windows belonging to program `md5`. */
    invalidate(md5: string): void {
        for (const key of [...this.entries.keys()]) {
            if (vscode.Uri.parse(key).authority === md5) { this.entries.delete(key); }
        }
    }
    /** Invalidate and notify VS Code to reload open byte views for `md5`. */
    refresh(md5: string): void {
        if (this.context.isClosing(md5)) { return; }
        const changed = [...this.entries.keys()].map(key => vscode.Uri.parse(key)).filter(uri => uri.authority === md5);
        this.invalidate(md5);
        if (changed.length) { this.changes.fire(changed.map(uri => ({ type: vscode.FileChangeType.Changed, uri }))); }
    }
    /** Clear caches and dispose event emitters. */
    dispose(): void { this.entries.clear(); this.pending.clear(); this.changes.dispose(); }
}
