// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

import type { Call } from './memory';

/** One defined program string entry returned by `ghidra.strings`. */
export interface DefinedString { address: string; value: string; length: string; type: string }

/** The sidebar and table use the same Ghidra-defined strings, not a raw byte scan. */
export async function definedStrings(call: Call, md5: string): Promise<{ items: DefinedString[]; scanned: number }> {
    const result = await call<{ items?: Array<Record<string, unknown>>; scanned?: number }>('ghidra.strings', { md5 });
    const items: DefinedString[] = (result.items || [])
        .filter(item => typeof item.address === 'string' && item.address)
        .map(item => ({
            address: String(item.address),
            value: String(item.value ?? ''),
            length: String(item.length ?? ''),
            type: String(item.type ?? ''),
        }));
    return { items, scanned: typeof result.scanned === 'number' ? result.scanned : items.length };
}
