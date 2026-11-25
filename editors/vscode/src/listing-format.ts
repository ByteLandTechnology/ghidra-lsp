// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

/** Pure listing formatting: the Ghidra-like text of one code unit window. */

import { bytesOf } from './bytes-format';
import { Data, object, stringOf } from './web';

/** Extract the `items` array from a server listing response. */
const collection = (value: unknown): Data[] => {
    const items = object(value).items;
    return Array.isArray(items) ? items.map(object) : [];
};
/** Ghidra prints plain hex addresses; the address space prefix is transport only. */
export const plainAddress = (address: string): string => {
    const match = /^(?:.*:)?(?:0x)?([0-9a-fA-F]+)$/.exec(address.trim());
    return match ? match[1].toUpperCase() : address.trim();
};

/** Return true when formatted listing line `lineText` starts with the hex offset of `address`. */
export const sameListingRow = (lineText: string, address: string): boolean => {
    const match = /^\s*([0-9a-fA-F]+)\b/.exec(lineText);
    if (!match) { return false; }
    const normalize = (hex: string): string => hex.toUpperCase().replace(/^0+/, '') || '0';
    return normalize(plainAddress(address)) === normalize(match[1]);
};

/** Formatted fields for one instruction or data unit in a plain listing view. */
export interface ListingUnit {
    address: string;
    plain: string;
    bytes: string;
    body: string;
    kind: string;
}

/** One Ghidra-like listing row: address, bytes, then the instruction or data text. */
export function listingUnits(result: unknown): ListingUnit[] {
    return collection(result).map(unit => {
        const kind = stringOf(unit.kind).toLowerCase();
        const operands = Array.isArray(unit.operands) ? unit.operands.map(stringOf).filter(Boolean) : [];
        const mnemonic = stringOf(unit.mnemonic).toUpperCase();
        const dataType = stringOf(object(unit.data_type).name);
        const body = kind === 'instruction'
            ? [mnemonic, operands.join(',')].filter(Boolean).join(' ')
            : kind === 'data'
                ? [dataType, stringOf(unit.text) || stringOf(unit.representation)].filter(Boolean).join(' ')
                : '??';
        const address = stringOf(unit.address);
        return { address, plain: plainAddress(address), bytes: bytesOf(unit.bytes), body, kind };
    });
}

/**
 * Keep the address and instruction together, one code unit per logical line.
 * The trailing byte preview shows at most eight bytes. Long operands and byte
 * previews can wrap without pushing every instruction behind a padded column.
 */
export const listingByteWindow = 8;
/** Format a list of listing units into aligned plain-text lines. */
export function formatListing(units: ListingUnit[]): string {
    const width = Math.max(8, ...units.map(unit => unit.plain.length));
    const displayed = units.map(unit => {
        const parts = unit.bytes ? unit.bytes.split(' ').filter(Boolean) : [];
        const shown = parts.slice(0, listingByteWindow).join(' ');
        return { unit, bytes: parts.length > listingByteWindow ? `${shown} ..` : shown };
    });
    return displayed.map(({ unit, bytes }) => {
        const address = unit.plain.padStart(width, '0');
        return `${address}  ${unit.body}${bytes ? `  ; ${bytes}` : ''}`;
    }).join('\n');
}
