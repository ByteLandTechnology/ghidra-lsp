// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

import * as vscode from 'vscode';
import { ProgramContext } from './context';
import { plainAddress } from './listing-format';
import { listingExtension } from './virtual-files';
import type { Reveal } from './listing';
import { Call } from './memory';
import type { ReferenceViews } from './references';

/** URI scheme for read-only defined string documents. */
export const stringScheme = 'ghidra-string';
/** Generic JSON object map for backend query responses. */
type Data = Record<string, unknown>;
/** Cached reference lookup state for one open string document. */
interface StringEntry { address: string; references?: Promise<Data[]> }
/** CodeLens placed on line 0 of a string document to trigger reference peek. */
class StringLens extends vscode.CodeLens {
    /** Create a CodeLens bound to string document `uri`. */
    constructor(readonly uri: vscode.Uri) { super(new vscode.Range(0, 0, 0, 0)); }
}

/** `ghidra-string://<md5>/string/<address>?{"address":"ram:…"}`: the string's decoded text, nothing else. */
export function stringUri(md5: string, address: string): vscode.Uri {
    return vscode.Uri.from({ scheme: stringScheme, authority: md5, path: `/string/${plainAddress(address)}`, query: JSON.stringify({ address }) });
}

/** Extract the canonical machine address from a `ghidra-string://` URI. */
export function stringAddress(uri: vscode.Uri): string {
    try {
        const address: unknown = JSON.parse(uri.query).address;
        if (typeof address === 'string' && address) { return address; }
    } catch { /* A path-only URI still names the address. */ }
    return decodeURIComponent(uri.path.split('/').pop() || '');
}

/**
 * Defined strings open as readonly plain text, so selection, search and copy see exactly
 * the decoded characters. References use native Peek: a CodeLens and Shift+F12.
 */
export class StringFiles implements vscode.TextDocumentContentProvider, vscode.CodeLensProvider, vscode.ReferenceProvider, vscode.Disposable {
    /** Open string document entries keyed by URI string. */
    private readonly entries = new Map<string, StringEntry>();
    /** Emitter for string document text refresh notifications. */
    private readonly changes = new vscode.EventEmitter<vscode.Uri>();
    /** Event fired when an open string document reloads. */
    readonly onDidChange = this.changes.event;
    /** Emitter for CodeLens count refresh notifications. */
    private readonly lensChanges = new vscode.EventEmitter<void>();
    /** Event fired when string CodeLens counts should be recomputed. */
    readonly onDidChangeCodeLenses = this.lensChanges.event;
    /** Registered providers and document listeners owned by this instance. */
    private readonly disposables: vscode.Disposable[];

    /** Register content, CodeLens, and reference providers for `ghidra-string://`. */
    constructor(private readonly call: Call, private readonly context: ProgramContext, private readonly references: () => ReferenceViews) {
        const selector = { scheme: stringScheme };
        this.disposables = [this.changes, this.lensChanges,
            vscode.workspace.registerTextDocumentContentProvider(stringScheme, this),
            vscode.languages.registerCodeLensProvider(selector, this),
            vscode.languages.registerReferenceProvider(selector, this),
            vscode.workspace.onDidCloseTextDocument(document => { this.entries.delete(document.uri.toString()); }),
        ];
    }

    /** Open the virtual `ghidra-string://` document for `address` in a preview tab. */
    async open(md5: string, address: string): Promise<vscode.TextEditor> {
        const document = await vscode.workspace.openTextDocument(stringUri(md5, address));
        return vscode.window.showTextDocument(document, { preview: true });
    }

    /** Analysis changed: drop cached references and reread every open string of this program. */
    refresh(md5: string): void {
        const target = md5.toLowerCase();
        for (const [key, entry] of this.entries) {
            if (vscode.Uri.parse(key).authority.toLowerCase() !== target) { continue; }
            entry.references = undefined;
            this.changes.fire(vscode.Uri.parse(key));
        }
        this.lensChanges.fire();
    }

    /** Remove cached string entries belonging to closed program `md5`. */
    close(md5: string): void {
        const target = md5.toLowerCase();
        for (const key of [...this.entries.keys()]) {
            if (vscode.Uri.parse(key).authority.toLowerCase() === target) { this.entries.delete(key); }
        }
    }

    /** Load decoded string text from `ghidra_search` (`strings`), falling back to `global_variable.get`. */
    async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
        if (this.context.isClosing(uri.authority)) { throw vscode.FileSystemError.FileNotFound(uri); }
        const address = stringAddress(uri);
        this.entries.set(uri.toString(), this.entries.get(uri.toString()) || { address });
        const indexed = await this.call<{ items?: Data[] }>('ghidra.query', {
            md5: uri.authority,
            domain: 'search',
            operation: 'strings',
            params: { scan: { range: { start: address, end: address } }, page: { limit: 8 } },
        }).catch(() => ({ items: undefined }));
        const exact = (indexed.items || []).find(
            item => typeof item.value === 'string' && String(item.address || '').toLowerCase() === address.toLowerCase(),
        ) || (indexed.items || []).find(item => typeof item.value === 'string');
        if (exact && typeof exact.value === 'string') { return exact.value; }
        const data = await this.call<Data>('ghidra.query', { md5: uri.authority, domain: 'global_variable', operation: 'get', params: { selector: { address } } });
        const value = data.value ?? data.representation;
        if (typeof value !== 'string') { throw new Error(`No string at ${address}`); }
        return value;
    }

    /** Provide one top-of-file CodeLens for triggering Shift+F12 reference lookup. */
    provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] { return [new StringLens(document.uri)]; }

    /** Populate the CodeLens title with the incoming reference count. */
    async resolveCodeLens(lens: StringLens): Promise<vscode.CodeLens> {
        try {
            const count = (await this.sources(lens.uri)).length;
            lens.command = count
                ? { title: `${count} ${count === 1 ? 'reference' : 'references'}`, tooltip: 'Find references (Shift+F12)', command: 'editor.action.findReferences', arguments: [lens.uri, new vscode.Position(0, 0)] }
                : { title: 'No references', command: '' };
        } catch { lens.command = { title: 'References unavailable', command: '' }; }
        return lens;
    }

    /** Resolve incoming reference locations to pseudocode tokens or listing rows. */
    async provideReferences(document: vscode.TextDocument, _position: vscode.Position, _context: vscode.ReferenceContext, token: vscode.CancellationToken): Promise<vscode.Location[]> {
        const md5 = document.uri.authority;
        const sources = await this.sources(document.uri);
        const locations = await Promise.all(sources.map(async address => {
            if (token.isCancellationRequested) { return undefined; }
            try {
                // Inside a function: the exact pseudocode token that uses the string.
                const result = await this.call<Reveal & { exact?: boolean }>('ghidra.reveal', { md5, address });
                if (result.exact !== false && result.range) {
                    const { start, end } = result.range;
                    return new vscode.Location(vscode.Uri.parse(result.uri), new vscode.Range(start.line, start.character, end.line, end.character));
                }
            } catch { /* Outside any function, or the function has a pending edit. */ }
            // Otherwise the Listing row of the instruction or data unit holding the reference.
            return this.listingLocation(md5, address).catch(() => undefined);
        }));
        const found = locations.filter((location): location is vscode.Location => !!location);
        return this.references().locations(found, token, document.uri);
    }

    /** Resolve a reference address outside a function to its containing `ghidra-listing://` line. */
    private async listingLocation(md5: string, reference: string): Promise<vscode.Location> {
        // A Listing window starts at the requested unit, so ask for the unit that holds the reference.
        const resolved = await this.call<Data>('ghidra.query', { md5, domain: 'address', operation: 'resolve', params: { selector: { address: reference } } })
            .catch(() => ({} as Data));
        const unit = (resolved.code_unit as Data | undefined)?.address;
        const address = typeof unit === 'string' && unit ? unit : reference;
        const uri = vscode.Uri.from({ scheme: 'ghidra-listing', authority: md5, path: `/listing/${plainAddress(address)}${listingExtension}`, query: JSON.stringify({ address }) });
        const document = await vscode.workspace.openTextDocument(uri);
        const target = BigInt('0x' + plainAddress(reference));
        let line = 0;
        // Rows start with their address; a reference inside a struct or instruction lands on the unit that holds it.
        for (let index = 0; index < document.lineCount; index++) {
            const row = /^\s*([\da-f]+)\s/i.exec(document.lineAt(index).text);
            if (!row) { continue; }
            if (BigInt('0x' + row[1]) > target) { break; }
            line = index;
        }
        return new vscode.Location(uri, document.lineAt(line).range);
    }

    /** Distinct memory addresses that reference the string; the lens count and Peek list the same set. */
    private async sources(uri: vscode.Uri): Promise<string[]> {
        return [...new Set((await this.incoming(uri)).map(ref => String(ref.from ?? '')))]
            .filter(address => /^[a-z]*:?[\da-f]+$/i.test(address));
    }

    /** One reference query per open string, shared by the lens count and Peek. */
    private incoming(uri: vscode.Uri): Promise<Data[]> {
        const entry = this.entries.get(uri.toString()) || { address: stringAddress(uri) };
        this.entries.set(uri.toString(), entry);
        entry.references ||= this.call<{ items: Data[] }>('ghidra.query', { md5: uri.authority, domain: 'reference', operation: 'list',
            params: { filter: { direction: 'to', to: entry.address } }, all: true }).then(result => result.items || []);
        const request = entry.references;
        // A failed query is retried on the next lens or Peek instead of being cached.
        request.catch(() => { if (entry.references === request) { entry.references = undefined; } });
        return request;
    }

    /** Clear cached entries and dispose registered providers. */
    dispose(): void { this.entries.clear(); for (const disposable of this.disposables) { disposable.dispose(); } }
}
