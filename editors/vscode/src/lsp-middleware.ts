// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

import * as vscode from 'vscode';
import { Middleware } from 'vscode-languageclient/node';
import { Call } from './memory';
import { DataTypeFiles } from './type-files';
import { ListingFiles, listingUri } from './listing';
import { ReferenceViews, referenceScheme } from './references';
import { ReadonlyRenames } from './rename';
import { Data, object, stringOf } from './web';

/** Late-bound extension services used by LSP client middleware hooks. */
export interface MiddlewareDeps {
    /** Invoke a `ghidra.*` workspace command on the running server. */
    call: Call;
    /** Return the active `DataTypeFiles` provider when initialized. */
    typeFiles: () => DataTypeFiles | undefined;
    /** Return the active `ListingFiles` provider when initialized. */
    listingFiles: () => ListingFiles | undefined;
    /** Return the active `ReferenceViews` manager when initialized. */
    references: () => ReferenceViews | undefined;
    /** Return the active `ReadonlyRenames` coordinator when initialized. */
    renames: () => ReadonlyRenames | undefined;
    /** Command identifiers filtered from Code Actions and Code Lenses. */
    nativeNavigationCommands: ReadonlySet<string>;
}

/** Return true when `address` refers to navigable program memory rather than stack, register, or external storage. */
export function isNavigableMemoryAddress(address: string): boolean {
    const trimmed = address.trim();
    if (!trimmed) { return false; }
    return !/^(?:EXTERNAL|Stack\[|register:|unique:|const:|HASH:|OTHER:|VARIABLE:)/i.test(trimmed);
}

/** Decode a canonical or unqualified type path from a `ghidra://<md5>/type/<id>.md` URI. */
export function decodeTypeSnapshotPath(uri: vscode.Uri): string {
    const raw = decodeURIComponent(uri.path.slice('/type/'.length));
    return raw.endsWith('.md') ? raw.slice(0, -3) : raw;
}

/** Decode the symbol identifier or fallback address from a `ghidra://<md5>/symbol/<id>` URI. */
export function decodeSymbolSnapshotId(uri: vscode.Uri): string {
    return decodeURIComponent(uri.path.slice('/symbol/'.length));
}

/** Map a `vscode.SymbolKind` to an editable/read-only Ghidra type kind hint when known. */
function symbolKindHint(kind: vscode.SymbolKind): string | undefined {
    if (kind === vscode.SymbolKind.Struct) { return 'struct'; }
    if (kind === vscode.SymbolKind.Enum) { return 'enum'; }
    if (kind === vscode.SymbolKind.Interface) { return 'function_definition'; }
    if (kind === vscode.SymbolKind.TypeParameter) { return 'typedef'; }
    return undefined;
}

/** Build a `command:ghidraLsp.goToAddress` URI targeting `(md5, address)`. */
export function goToAddressCommandUri(md5: string, address: string): vscode.Uri {
    const encoded = encodeURIComponent(JSON.stringify([md5.toLowerCase(), address]));
    return vscode.Uri.parse(`command:ghidraLsp.goToAddress?${encoded}`);
}

/** Normalize an LSP definition or type-definition result into `{ uri, range }` pairs. */
function extractLocations(result: vscode.Definition | vscode.DefinitionLink[]): { uri: vscode.Uri; range: vscode.Range }[] {
    const items = Array.isArray(result) ? result : [result];
    return items.map(item => {
        if ('targetUri' in item) {
            return {
                uri: item.targetUri,
                range: item.targetSelectionRange || item.targetRange || new vscode.Range(0, 0, 0, 0),
            };
        }
        return {
            uri: item.uri,
            range: item.range || new vscode.Range(0, 0, 0, 0),
        };
    });
}

/** Resolve an unqualified type name or canonical type path to a `ghidra-type://` URI. */
async function resolveTypeUri(deps: MiddlewareDeps, md5: string, rawPath: string): Promise<vscode.Uri | undefined> {
    const files = deps.typeFiles();
    if (!files) { return undefined; }
    let resolvedPath = rawPath;
    if (!resolvedPath.startsWith('/')) {
        try {
            const list = await deps.call<{ items: Data[] }>('ghidra.types', { md5 });
            const match = list.items.find(item => item.path === rawPath || item.name === rawPath);
            resolvedPath = match && typeof match.path === 'string' && match.path ? match.path : `/${rawPath}`;
        } catch {
            resolvedPath = `/${rawPath}`;
        }
    }
    return files.uriFor(md5, resolvedPath);
}

/** Resolve a `ghidra://<md5>/symbol/<id>` snapshot URI to a `ghidra-listing://` row location when in memory. */
async function resolveSymbolLocation(deps: MiddlewareDeps, md5: string, id: string, hintAddress?: string): Promise<vscode.Location | undefined> {
    const listings = deps.listingFiles();
    if (!listings) { return undefined; }
    let address = hintAddress || '';
    if (!address) {
        try {
            const sym = await deps.call<Data>('ghidra.query', {
                md5,
                domain: 'symbol',
                operation: 'get',
                params: { selector: { id } },
            });
            address = stringOf(sym.address);
        } catch {
            address = id;
        }
    }
    if (!isNavigableMemoryAddress(address)) { return undefined; }
    try {
        return await listings.locationForAddress(md5, address);
    } catch {
        return undefined;
    }
}

/** Rewrite `ghidra://` type and symbol snapshot targets into pure `vscode.Location` values without side effects. */
export async function rewriteNavigationLocations(
    deps: MiddlewareDeps,
    raw: vscode.Definition | vscode.DefinitionLink[] | null | undefined,
    token: vscode.CancellationToken,
): Promise<vscode.Location | vscode.Location[] | null | undefined> {
    if (!raw || token.isCancellationRequested) { return raw as null | undefined; }
    const pairs = extractLocations(raw);
    const locations: vscode.Location[] = [];
    for (const pair of pairs) {
        if (token.isCancellationRequested) { return null; }
        const { uri, range } = pair;
        if (uri.scheme === 'ghidra' && /^[a-f\d]{32}$/i.test(uri.authority)) {
            const md5 = uri.authority.toLowerCase();
            if (uri.path.startsWith('/type/')) {
                try {
                    const typeTarget = await resolveTypeUri(deps, md5, decodeTypeSnapshotPath(uri));
                    if (typeTarget) {
                        locations.push(new vscode.Location(typeTarget, new vscode.Position(0, 0)));
                        continue;
                    }
                } catch {
                    // Fall back to the server's read-only Markdown snapshot URI if resolution fails.
                }
            } else if (uri.path.startsWith('/symbol/')) {
                const listingLoc = await resolveSymbolLocation(deps, md5, decodeSymbolSnapshotId(uri));
                if (listingLoc) {
                    locations.push(listingLoc);
                    continue;
                }
            }
        }
        locations.push(new vscode.Location(uri, range));
    }
    return locations.length === 1 ? locations[0] : locations;
}

/** Create the VS Code `LanguageClientOptions.middleware` routing table for `ghidra-lsp`. */
export function createLspMiddleware(deps: MiddlewareDeps): Middleware {
    const originalSymbolLocations = new WeakMap<vscode.SymbolInformation, vscode.Location>();

    return {
        didOpen: async (document, next) => {
            if (document.uri.scheme !== referenceScheme) { await next(document); }
        },
        didChange: async (event, next) => {
            if (event.document.uri.scheme !== referenceScheme) { await next(event); }
        },
        didClose: async (document, next) => {
            if (document.uri.scheme !== referenceScheme) { await next(document); }
        },
        didSave: async (document, next) => {
            if (!['ghidra', referenceScheme].includes(document.uri.scheme)) { await next(document); }
        },
        provideDefinition: async (document, position, token, next) => {
            const result = await next(document, position, token);
            return rewriteNavigationLocations(deps, result, token);
        },
        provideDeclaration: async (document, position, token, next) => {
            const result = await next(document, position, token);
            return rewriteNavigationLocations(deps, result, token);
        },
        provideImplementation: async (document, position, token, next) => {
            const result = await next(document, position, token);
            return rewriteNavigationLocations(deps, result, token);
        },
        provideTypeDefinition: async (document, position, token, next) => {
            const result = await next(document, position, token);
            return rewriteNavigationLocations(deps, result, token);
        },
        provideWorkspaceSymbols: async (query, token, next) => {
            const items = await next(query, token);
            if (!items || token.isCancellationRequested) { return items; }
            const types = deps.typeFiles();
            for (const item of items) {
                const loc = item.location;
                const uri = loc?.uri;
                if (!uri || uri.scheme !== 'ghidra' || !/^[a-f\d]{32}$/i.test(uri.authority)) { continue; }
                originalSymbolLocations.set(item, loc);
                const md5 = uri.authority.toLowerCase();
                const data = object((item as unknown as { data?: unknown }).data);
                if (uri.path.startsWith('/type/') && types) {
                    const path = decodeTypeSnapshotPath(uri);
                    const kindHint = stringOf(object(data.type).kind) || symbolKindHint(item.kind);
                    if (path.startsWith('/')) {
                        item.location = new vscode.Location(types.cachedUriFor(md5, path, kindHint), new vscode.Position(0, 0));
                    }
                } else if (uri.path.startsWith('/symbol/')) {
                    const addr = stringOf(object(data.symbol).address);
                    if (isNavigableMemoryAddress(addr)) {
                        item.location = new vscode.Location(listingUri(md5, addr), new vscode.Position(0, 0));
                    }
                }
            }
            return items;
        },
        resolveWorkspaceSymbol: async (item, token, next) => {
            const original = originalSymbolLocations.get(item);
            const previousRewritten = item.location;
            if (original) {
                item.location = original;
            }
            const resolved = await next(item, token);
            if (original) {
                item.location = previousRewritten;
            }
            if (!resolved || token.isCancellationRequested) { return resolved; }
            const sourceUri = resolved.location?.uri || original?.uri;
            if (!sourceUri || sourceUri.scheme !== 'ghidra' || !/^[a-f\d]{32}$/i.test(sourceUri.authority)) {
                return resolved;
            }
            const md5 = sourceUri.authority.toLowerCase();
            const data = object((item as unknown as { data?: unknown }).data);
            if (sourceUri.path.startsWith('/type/')) {
                try {
                    const typeTarget = await resolveTypeUri(deps, md5, decodeTypeSnapshotPath(sourceUri));
                    if (typeTarget) {
                        resolved.location = new vscode.Location(typeTarget, new vscode.Position(0, 0));
                    }
                } catch {
                    // Keep the resolved Markdown snapshot URI on failure.
                }
            } else if (sourceUri.path.startsWith('/symbol/')) {
                const hintAddr = stringOf(object(data.symbol).address);
                const listingLoc = await resolveSymbolLocation(deps, md5, decodeSymbolSnapshotId(sourceUri), hintAddr);
                if (listingLoc) {
                    resolved.location = listingLoc;
                }
            }
            return resolved;
        },
        provideDocumentLinks: async (document, token, next) => {
            const links = await next(document, token);
            if (!links || token.isCancellationRequested) { return links; }
            for (const link of links) {
                const data = object((link as unknown as { data?: unknown }).data);
                if (data.kind === 'address' && typeof data.md5 === 'string' && typeof data.address === 'string') {
                    link.target = goToAddressCommandUri(data.md5, data.address);
                    continue;
                }
                if (link.target?.scheme === 'ghidra' && link.target.path.startsWith('/symbol/') && /^[a-f\d]{32}$/i.test(link.target.authority)) {
                    const tooltipAddr = /^Go to address\s+(.+)$/.exec(link.tooltip || '')?.[1]?.trim();
                    const addr = tooltipAddr || decodeSymbolSnapshotId(link.target);
                    if (isNavigableMemoryAddress(addr)) {
                        link.target = goToAddressCommandUri(link.target.authority, addr);
                    }
                }
            }
            return links;
        },
        provideReferences: async (document, position, context, token, next) => {
            const locations = await next(document, position, context, token);
            const refs = deps.references();
            return locations && refs ? refs.locations(locations, token, document.uri) : locations;
        },
        provideCodeActions: async (document, range, context, token, next) => {
            const actions = await next(document, range, context, token);
            return actions?.filter(action => !deps.nativeNavigationCommands.has(typeof action.command === 'string' ? action.command : action.command?.command || ''));
        },
        provideCodeLenses: async (document, token, next) => {
            const lenses = await next(document, token);
            return lenses?.filter(lens => !lens.command || !deps.nativeNavigationCommands.has(lens.command.command));
        },
        provideRenameEdits: async (document, position, name, token, next) => {
            const edit = await next(document, position, name, token);
            deps.renames()?.schedule(document.uri.authority);
            return edit;
        },
    };
}
