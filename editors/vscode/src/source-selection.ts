// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

import * as vscode from 'vscode';
import { CodeLocation } from './location';
import { Call } from './memory';
import { AddressRange, addressRange, addressText, intersects } from './view-ranges';

/** Cached token spans and resolved address promises for one document version. */
interface SourceMap {
    version: number;
    spans: vscode.Range[];
    locations: Map<string, Promise<AddressRange | undefined>>;
}

/** One native position-to-instruction relation, used in both selection directions. */
export class SourceSelection {
    /** Per-document cached span-to-address maps. */
    private readonly maps = new WeakMap<vscode.TextDocument, SourceMap>();
    /** Create a bidirectional source-selection mapper backed by `call`. */
    constructor(private readonly call: Call) {}

    /** Return or build the tokenized span map for the current document version. */
    private map(document: vscode.TextDocument): SourceMap {
        const known = this.maps.get(document);
        if (known?.version === document.version) { return known; }
        const spans: vscode.Range[] = [];
        for (let line = 0; line < document.lineCount; line++) {
            // Keep punctuation and whitespace too: they can carry native locations of their own.
            for (const token of document.lineAt(line).text.matchAll(/\s+|[\p{L}\p{N}_$]+|[^\s]/gu)) {
                spans.push(new vscode.Range(line, token.index!, line, token.index! + token[0].length));
            }
        }
        const map = { version: document.version, spans, locations: new Map<string, Promise<AddressRange | undefined>>() };
        this.maps.set(document, map);
        return map;
    }
    /** Query and memoize the machine address at one document position. */
    private location(document: vscode.TextDocument, map: SourceMap, position: vscode.Position): Promise<AddressRange | undefined> {
        const key = `${position.line}:${position.character}`;
        const known = map.locations.get(key);
        if (known) { return known; }
        const request = this.call<CodeLocation>('ghidra.location', {
            uri: document.uri.toString(), version: map.version,
            position: { line: position.line, character: position.character },
        }).then(location => {
            const address = location.code_unit_address || location.address;
            return address ? addressRange(address) : undefined;
        }).catch(error => { map.locations.delete(key); throw error; });
        map.locations.set(key, request);
        return request;
    }
    /** Resolve machine addresses for `spans` using bounded concurrency. */
    private async resolve(document: vscode.TextDocument, map: SourceMap, spans: vscode.Range[], current: () => boolean): Promise<(AddressRange | undefined)[]> {
        const addresses: (AddressRange | undefined)[] = new Array(spans.length);
        let next = 0;
        let failed = false;
        await Promise.all(Array.from({ length: Math.min(8, spans.length) }, async () => {
            while (!failed && next < spans.length && current() && document.version === map.version) {
                const index = next++;
                try { addresses[index] = await this.location(document, map, spans[index].start); }
                catch (error) { failed = true; throw error; }
            }
        }));
        return addresses;
    }
    /** Return deduplicated machine addresses covered by editor `selections`. */
    async addresses(document: vscode.TextDocument, selections: readonly vscode.Selection[], current: () => boolean): Promise<AddressRange[]> {
        const map = this.map(document);
        const spans = map.spans.filter(span => selections.some(selection => {
            const overlap = selection.intersection(span);
            return overlap && !overlap.isEmpty;
        }));
        spans.push(...selections.filter(selection => selection.isEmpty).map(selection => new vscode.Range(selection.active, selection.active)));
        const addresses = await this.resolve(document, map, spans, current);
        return [...new Map(addresses.filter((address): address is AddressRange => !!address).map(address => [addressText(address), address])).values()];
    }
    /** Return merged document ranges in `document` matching `addresses`. */
    async ranges(document: vscode.TextDocument, addresses: AddressRange[], current: () => boolean): Promise<vscode.Range[]> {
        if (!addresses.length) { return []; }
        const map = this.map(document);
        const locations = await this.resolve(document, map, map.spans, current);
        if (!current() || document.version !== map.version) { return []; }
        const ranges: vscode.Range[] = [];
        for (let i = 0; i < map.spans.length; i++) {
            const location = locations[i];
            if (!location || !addresses.some(address => intersects(location, address))) { continue; }
            const span = map.spans[i], previous = ranges[ranges.length - 1];
            // Join adjacent pieces of an expression, but never fill a gap containing unrelated code.
            if (previous && /^\s*$/.test(document.getText(new vscode.Range(previous.end, span.start)))) {
                ranges[ranges.length - 1] = previous.union(span);
            } else { ranges.push(span); }
        }
        return ranges;
    }
}
