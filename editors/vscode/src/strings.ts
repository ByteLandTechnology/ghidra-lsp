// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

import type { Call } from './memory';

/** Interactive filter parameters accepted by `ghidra.strings` (`ghidra_search` `strings`). */
export interface StringFilterOptions {
    query?: string;
    regex?: boolean;
    caseSensitive?: boolean;
    encoding?: 'all' | 'ascii' | 'utf16' | 'utf16le' | 'utf16be';
    defined?: boolean;
    minLength?: number;
    limit?: number;
    maxItems?: number;
}

/** One cached program string entry returned by `ghidra.strings`. */
export interface ProgramString {
    address: string;
    displayAddress: string;
    value: string;
    length: string;
    type: string;
    encoding: string;
    defined: boolean;
    symbol?: string;
}

/** Backward-compatible alias for {@link ProgramString}. */
export type DefinedString = ProgramString;

/** Response payload returned by {@link searchStrings}. */
export interface StringSearchResult {
    items: ProgramString[];
    scanned: number;
    totalIndexed: number;
    indexComplete: boolean;
    truncated: boolean;
}

/** Query cached program strings via `ghidra.strings` (`ghidra_search` `strings`). */
export async function searchStrings(call: Call, md5: string, filter: StringFilterOptions = {}): Promise<StringSearchResult> {
    const args: Record<string, unknown> = { md5 };
    if (filter.query) { args.query = filter.query; }
    if (filter.regex !== undefined) { args.regex = filter.regex; }
    if (filter.caseSensitive !== undefined) { args.caseSensitive = filter.caseSensitive; }
    if (filter.encoding) { args.encoding = filter.encoding; }
    if (filter.defined !== undefined) { args.defined = filter.defined; }
    if (filter.minLength !== undefined) { args.minLength = filter.minLength; }
    if (filter.limit !== undefined) { args.limit = filter.limit; }
    if (filter.maxItems !== undefined) { args.maxItems = filter.maxItems; }
    const result = await call<{
        items?: Array<Record<string, unknown>>;
        scanned?: number;
        totalIndexed?: number;
        indexComplete?: boolean;
        truncated?: boolean;
    }>('ghidra.strings', args);
    const items: ProgramString[] = (result.items || [])
        .filter(item => typeof item.address === 'string' && item.address)
        .map(item => ({
            address: String(item.address),
            displayAddress: String(item.displayAddress ?? item.address),
            value: String(item.value ?? ''),
            length: String(item.length ?? ''),
            type: String(item.type ?? ''),
            encoding: String(item.encoding ?? 'ascii'),
            defined: Boolean(item.defined),
            symbol: typeof item.symbol === 'string' && item.symbol ? item.symbol : undefined,
        }));
    const scanned = typeof result.scanned === 'number' ? result.scanned : items.length;
    const totalIndexed = typeof result.totalIndexed === 'number' ? result.totalIndexed : scanned;
    return {
        items,
        scanned,
        totalIndexed,
        indexComplete: result.indexComplete !== false,
        truncated: Boolean(result.truncated),
    };
}

/** Alias preserving compatibility with existing workbench callers. */
export const definedStrings = searchStrings;
