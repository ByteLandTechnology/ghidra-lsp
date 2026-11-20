// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

/** Pure formatting for the byte view: a classic hex dump. */

import { object, stringOf } from './web';

/** Decode a server byte payload into lowercase space-separated hex pairs. */
export const bytesOf = (value: unknown): string => {
    const bytes = object(value), data = stringOf(bytes.data);
    if (!data) { return ''; }
    const hex = bytes.encoding === 'base64' ? Buffer.from(data, 'base64').toString('hex') : data.replace(/\s/g, '');
    return hex.match(/.{1,2}/g)?.join(' ').toLowerCase() || '';
};

/** Ghidra prints plain hex addresses in the byte view, like in the listing. */
const offset = (address: string, delta: number): string => {
    const match = /^(?:(.*):)?(?:0x)?([0-9a-fA-F]+)$/.exec(address.trim());
    if (!match) { return address; }
    const value = BigInt(`0x${match[2]}`) + BigInt(delta);
    const width = Math.max(match[2].length, 8);
    return value.toString(16).toUpperCase().padStart(width, '0');
};

/** One hex dump line: address, sixteen bytes, printable ASCII. */
export function formatHexDump(address: string, hex: string, columns = 16): string {
    const values = hex ? hex.split(' ').filter(Boolean) : [];
    const lines: string[] = [];
    for (let index = 0; index < values.length; index += columns) {
        const chunk = values.slice(index, index + columns);
        const gap = chunk.length < columns ? '   ' : '  ';
        const text = chunk.map(value => {
            const byte = parseInt(value, 16);
            return byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.';
        }).join('');
        lines.push(`${offset(address, index)}  ${chunk.join(' ').padEnd(columns * 3 - 1, ' ')}${gap}|${text}|`);
    }
    return lines.join('\n');
}
