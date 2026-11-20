// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

import * as vscode from 'vscode';

/** Inclusive machine-address range. Keep the space so overlays never alias RAM. */
export interface AddressRange { space: string; start: bigint; end: bigint }

/** Parse an address string and byte length into an inclusive address range. */
export function addressRange(address: string, length = 1): AddressRange | undefined {
    const match = /^(?:(.*):)?(?:0x)?([0-9a-fA-F]+)$/.exec(address);
    if (!match) { return undefined; }
    const start = BigInt(`0x${match[2]}`);
    return { space: match[1] || '', start, end: start + BigInt(Math.max(1, length) - 1) };
}

/** Return true when two address ranges share a space and overlap. */
export function intersects(a: AddressRange, b: AddressRange): boolean {
    return a.space === b.space && a.start <= b.end && b.start <= a.end;
}

/** Format the start address of a range as uppercase hex with optional space prefix. */
export function addressText(range: AddressRange): string {
    return `${range.space ? range.space + ':' : ''}${range.start.toString(16).toUpperCase()}`;
}

/** Sort and merge overlapping or adjacent VS Code document ranges. */
export function mergeRanges(ranges: vscode.Range[]): vscode.Range[] {
    const sorted = [...ranges].sort((a, b) => a.start.compareTo(b.start) || a.end.compareTo(b.end));
    const result: vscode.Range[] = [];
    for (const range of sorted) {
        const previous = result[result.length - 1];
        if (previous && previous.end.isAfterOrEqual(range.start)) { result[result.length - 1] = previous.union(range); }
        else { result.push(range); }
    }
    return result;
}

/** Return zero-based line numbers covered by the given editor selections. */
export function selectedLines(document: vscode.TextDocument, selections: readonly vscode.Selection[]): number[] {
    const lines = new Set<number>();
    for (const selection of selections) {
        const end = !selection.isEmpty && selection.end.character === 0 ? selection.end.line - 1 : selection.end.line;
        for (let line = selection.start.line; line <= end && line < document.lineCount; line++) { lines.add(line); }
    }
    return [...lines];
}
