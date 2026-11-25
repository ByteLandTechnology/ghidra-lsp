// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

import * as vscode from 'vscode';
import { LocationSnapshot, LocationSpan } from './location';
import { Call } from './memory';
import { AddressRange, addressRange, addressText } from './view-ranges';

/** End UTF-16 column and address of one located span on a line. */
interface LinePoint {
    end: number;
    address: AddressRange | undefined;
}

/** Non-empty single-line span with its machine address. */
interface IndexedSpan {
    line: number;
    start: number;
    end: number;
    address: AddressRange;
    key: string;
}

/** Indexed span snapshot for one clean document version. */
interface SourceIndex {
    points: (LinePoint[] | undefined)[];
    lineSpans: (IndexedSpan[] | undefined)[];
    spans: IndexedSpan[];
}

/** Cached snapshot promise for one `TextDocument` version. */
interface SnapshotEntry {
    version: number;
    promise: Promise<SourceIndex>;
}

/** Group and merge target address ranges by address space. */
function indexTargetAddresses(addresses: readonly AddressRange[]): Map<string, AddressRange[]> {
    const grouped = new Map<string, AddressRange[]>();
    for (const range of addresses) {
        if (range.start > range.end) { continue; }
        let bucket = grouped.get(range.space);
        if (!bucket) { bucket = []; grouped.set(range.space, bucket); }
        bucket.push(range);
    }
    const merged = new Map<string, AddressRange[]>();
    for (const [space, bucket] of grouped) {
        bucket.sort((a, b) => a.start < b.start ? -1 : a.start > b.start ? 1 : a.end < b.end ? -1 : a.end > b.end ? 1 : 0);
        const out: AddressRange[] = [];
        for (const range of bucket) {
            const previous = out[out.length - 1];
            if (previous && previous.end + 1n >= range.start) {
                if (range.end > previous.end) { previous.end = range.end; }
            } else {
                out.push({ space, start: range.start, end: range.end });
            }
        }
        merged.set(space, out);
    }
    return merged;
}

/** Return true when `location` overlaps a merged range in `targets`. */
function matchesTarget(location: AddressRange, targets: Map<string, AddressRange[]>): boolean {
    const bucket = targets.get(location.space);
    if (!bucket?.length) { return false; }
    let low = 0, high = bucket.length;
    while (low < high) {
        const mid = (low + high) >>> 1;
        if (bucket[mid].start <= location.end) { low = mid + 1; } else { high = mid; }
    }
    return low > 0 && location.start <= bucket[low - 1].end;
}

/** Add one non-empty span on `line`, or join it with the previous span at the same address. */
function pushIndexedSpan(
    line: number, start: number, end: number,
    parsed: { address: AddressRange; key: string } | undefined,
    lineOut: IndexedSpan[], allOut: IndexedSpan[],
): void {
    if (!parsed || start >= end) { return; }
    const previous = lineOut[lineOut.length - 1];
    if (previous && previous.end === start && previous.key === parsed.key) {
        previous.end = end;
        return;
    }
    const entry: IndexedSpan = { line, start, end, address: parsed.address, key: parsed.key };
    lineOut.push(entry);
    allOut.push(entry);
}

/** Build an in-memory span and cursor index from a `ghidra.location` snapshot. */
function buildSourceIndex(document: vscode.TextDocument, rawSpans: readonly LocationSpan[]): SourceIndex {
    const parsedAddresses = new Map<string, { address: AddressRange; key: string } | null>();
    const parse = (raw?: string): { address: AddressRange; key: string } | undefined => {
        if (!raw) { return undefined; }
        let cached = parsedAddresses.get(raw);
        if (cached === undefined) {
            const address = addressRange(raw);
            cached = address ? { address, key: addressText(address) } : null;
            parsedAddresses.set(raw, cached);
        }
        return cached || undefined;
    };
    const lineCount = document.lineCount;
    const points = new Array<LinePoint[] | undefined>(lineCount);
    const lineSpans = new Array<IndexedSpan[] | undefined>(lineCount);
    const spans: IndexedSpan[] = [];
    let cursor = 0;
    while (cursor < rawSpans.length) {
        const line = rawSpans[cursor].line;
        let lineEnd = cursor + 1;
        while (lineEnd < rawSpans.length && rawSpans[lineEnd].line === line) { lineEnd++; }
        if (line >= 0 && line < lineCount) {
            const lineLength = document.lineAt(line).text.length;
            const linePoints: LinePoint[] = [];
            const lineOut: IndexedSpan[] = [];
            let prevEnd = 0;
            let lastParsed: { address: AddressRange; key: string } | undefined;
            for (let i = cursor; i < lineEnd; i++) {
                const raw = rawSpans[i];
                const parsed = parse(raw.address);
                linePoints.push({ end: raw.end, address: parsed?.address });
                // Map leading spaces and gaps without a span to the next located span, as in `Document::code_location`.
                if (prevEnd < raw.start) {
                    pushIndexedSpan(line, prevEnd, raw.start, parsed, lineOut, spans);
                    prevEnd = raw.start;
                }
                if (raw.start < raw.end) {
                    const start = Math.max(prevEnd, raw.start);
                    pushIndexedSpan(line, start, raw.end, parsed, lineOut, spans);
                    if (raw.end > prevEnd) { prevEnd = raw.end; }
                }
                lastParsed = parsed;
            }
            if (prevEnd < lineLength) {
                pushIndexedSpan(line, prevEnd, lineLength, lastParsed, lineOut, spans);
            }
            points[line] = linePoints;
            if (lineOut.length) { lineSpans[line] = lineOut; }
        }
        cursor = lineEnd;
    }
    return { points, lineSpans, spans };
}

/** Find the address at `position` with leading-space and end-of-line rules. */
function locationAt(index: SourceIndex, position: vscode.Position): AddressRange | undefined {
    const linePoints = index.points[position.line];
    if (!linePoints?.length) { return undefined; }
    let low = 0, high = linePoints.length;
    while (low < high) {
        const mid = (low + high) >>> 1;
        if (linePoints[mid].end <= position.character) { low = mid + 1; } else { high = mid; }
    }
    return linePoints[low < linePoints.length ? low : linePoints.length - 1].address;
}

/** Maps positions and machine addresses in both selection directions. */
export class SourceSelection {
    /** Cached snapshot promises keyed by `TextDocument`. */
    private readonly snapshots = new WeakMap<vscode.TextDocument, SnapshotEntry>();
    /** Create a selection mapper that uses `call`. */
    constructor(private readonly call: Call) {}

    /** Get or request the indexed span snapshot for the current document version. */
    private snapshot(document: vscode.TextDocument): SnapshotEntry {
        const known = this.snapshots.get(document);
        if (known?.version === document.version) { return known; }
        const version = document.version;
        let entry: SnapshotEntry | undefined;
        let request: Promise<LocationSnapshot>;
        try {
            request = Promise.resolve(this.call<LocationSnapshot>('ghidra.location', {
                uri: document.uri.toString(),
                version,
            }));
        } catch (error) {
            request = Promise.reject(error);
        }
        const promise = request.then(snapshot => {
            if (document.version !== version) {
                if (this.snapshots.get(document) === entry) { this.snapshots.delete(document); }
                return { points: [], lineSpans: [], spans: [] };
            }
            return buildSourceIndex(document, snapshot.spans || []);
        }).catch(error => {
            if (this.snapshots.get(document) === entry) { this.snapshots.delete(document); }
            throw error;
        });
        entry = { version, promise };
        this.snapshots.set(document, entry);
        return entry;
    }
    /** Return unique machine addresses for editor `selections`. */
    async addresses(document: vscode.TextDocument, selections: readonly vscode.Selection[], current: () => boolean): Promise<AddressRange[]> {
        if (!selections.length || !current()) { return []; }
        const entry = this.snapshot(document);
        const index = await entry.promise;
        if (!current() || document.version !== entry.version) { return []; }
        const deduped = new Map<string, AddressRange>();
        const nonEmpty = selections.filter(selection => !selection.isEmpty);
        if (nonEmpty.length) {
            let minLine = document.lineCount, maxLine = -1;
            for (const selection of nonEmpty) {
                if (selection.start.line < minLine) { minLine = selection.start.line; }
                const endLine = selection.end.character === 0 && selection.end.line > selection.start.line
                    ? selection.end.line - 1 : selection.end.line;
                if (endLine > maxLine) { maxLine = endLine; }
            }
            for (let line = Math.max(0, minLine), stop = Math.min(document.lineCount - 1, maxLine); line <= stop; line++) {
                const candidates = index.lineSpans[line];
                if (!candidates) { continue; }
                for (const span of candidates) {
                    if (deduped.has(span.key)) { continue; }
                    const range = new vscode.Range(span.line, span.start, span.line, span.end);
                    const hits = nonEmpty.some(selection => {
                        const overlap = selection.intersection(range);
                        return overlap && !overlap.isEmpty;
                    });
                    if (hits) { deduped.set(span.key, span.address); }
                }
            }
        }
        for (const selection of selections) {
            if (!selection.isEmpty) { continue; }
            const address = locationAt(index, selection.active);
            if (address) {
                const key = addressText(address);
                if (!deduped.has(key)) { deduped.set(key, address); }
            }
        }
        return [...deduped.values()];
    }
    /** Return merged document ranges in `document` that match `addresses`. */
    async ranges(document: vscode.TextDocument, addresses: AddressRange[], current: () => boolean): Promise<vscode.Range[]> {
        if (!addresses.length || !current()) { return []; }
        const entry = this.snapshot(document);
        const index = await entry.promise;
        if (!current() || document.version !== entry.version) { return []; }
        const targets = indexTargetAddresses(addresses);
        if (!targets.size) { return []; }
        const ranges: vscode.Range[] = [];
        for (const item of index.spans) {
            if (!matchesTarget(item.address, targets)) { continue; }
            const span = new vscode.Range(item.line, item.start, item.line, item.end);
            const previous = ranges[ranges.length - 1];
            // Join adjacent parts of an expression, and do not include unrelated code between them.
            if (previous && (previous.end.isEqual(span.start)
                || /^\s*$/.test(document.getText(new vscode.Range(previous.end, span.start))))) {
                ranges[ranges.length - 1] = previous.union(span);
            } else {
                ranges.push(span);
            }
        }
        return ranges;
    }
}
