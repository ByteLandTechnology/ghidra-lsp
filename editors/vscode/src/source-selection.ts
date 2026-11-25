// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

import * as vscode from 'vscode';
import { Call } from './memory';
import { AddressRange, addressRange, addressText } from './view-ranges';

/** LSP UTF-16 range payload returned by batch `ghidra.location` queries. */
interface LocationRange {
    start: { line: number; character: number };
    end: { line: number; character: number };
}

/** Batch response returned by `ghidra.location` for `selections` or `addressRanges`. */
interface BatchLocation {
    addresses?: string[];
    ranges?: LocationRange[];
}

/** Bidirectional mapper between pseudocode selections and machine addresses via batch `ghidra.location`. */
export class SourceSelection {
    /** Create a bidirectional source-selection mapper backed by `call`. */
    constructor(private readonly call: Call) {}

    /** Return deduplicated machine addresses covered by editor `selections`. */
    async addresses(document: vscode.TextDocument, selections: readonly vscode.Selection[], current: () => boolean): Promise<AddressRange[]> {
        if (!selections.length || !current()) { return []; }
        const version = document.version;
        const result = await this.call<BatchLocation>('ghidra.location', {
            uri: document.uri.toString(),
            version,
            selections: selections.map(selection => selection.isEmpty
                ? {
                    start: { line: selection.active.line, character: selection.active.character },
                    end: { line: selection.active.line, character: selection.active.character },
                }
                : {
                    start: { line: selection.start.line, character: selection.start.character },
                    end: { line: selection.end.line, character: selection.end.character },
                }),
        });
        if (!current() || document.version !== version) { return []; }
        const resolved = (result.addresses || [])
            .map(address => addressRange(address))
            .filter((address): address is AddressRange => !!address);
        return [...new Map(resolved.map(address => [addressText(address), address])).values()];
    }

    /** Return merged document ranges in `document` matching `addresses`. */
    async ranges(document: vscode.TextDocument, addresses: AddressRange[], current: () => boolean): Promise<vscode.Range[]> {
        if (!addresses.length || !current()) { return []; }
        const version = document.version;
        const result = await this.call<BatchLocation>('ghidra.location', {
            uri: document.uri.toString(),
            version,
            addressRanges: addresses.map(address => ({
                start: addressText(address),
                end: addressText({ ...address, start: address.end }),
            })),
        });
        if (!current() || document.version !== version) { return []; }
        return (result.ranges || []).map(range => new vscode.Range(
            range.start.line, range.start.character,
            range.end.line, range.end.character,
        ));
    }
}
