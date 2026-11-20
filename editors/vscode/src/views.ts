// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

import * as vscode from 'vscode';
import { Call } from './memory';
import { ProgramContext } from './context';
import { SourceSelection } from './source-selection';
import { ListingViews, ListingMode, listingScheme } from './listing';
import { AnalysisMode, ControlFlowView, GraphSelection } from './control-flow-view';
import { AddressRange, addressRange, addressText, mergeRanges } from './view-ranges';
import { listingExtension } from './virtual-files';

/** Query hints and URI escaping do not change a document's address identity. */
const documentKey = (uri: vscode.Uri): string => {
    let path = uri.path;
    try { path = decodeURIComponent(path); } catch { /* Keep the raw path. */ }
    let address = '';
    try { const query = JSON.parse(uri.query); if (typeof query?.address === 'string') { address = query.address; } }
    catch { /* Function documents do not need query hints. */ }
    return `${uri.scheme}://${uri.authority}${path}?${address}`;
};
/** Paired decompilation and listing URIs for one open function analysis set. */
interface ViewSet {
    md5: string;
    entry: string;
    source: vscode.Uri;
    listing: vscode.Uri;
}

/** Native decompilation beside one analysis tab with Listing, Bytes, and Control Flow views. */
export class ViewSets implements vscode.Disposable {
    /** Registered view pairs keyed by `md5:entry`. */
    private readonly sets = new Map<string, ViewSet>();
    /** Debounced selection-sync timers keyed by `md5:entry`. */
    private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
    /** Monotonic sync generation counters keyed by `md5:entry`. */
    private readonly generations = new Map<string, number>();
    /** Last programmatic selection signature applied to each editor to avoid echo loops. */
    private readonly applied = new WeakMap<vscode.TextEditor, string>();
    /** Pending selection restore payloads waiting for a native editor to reappear after closing CFG. */
    private readonly nativeRestores = new Map<string, { viewColumn?: vscode.ViewColumn; addresses: AddressRange[]; selected: boolean }>();
    /** Event subscriptions owned by this coordinator. */
    private readonly disposables: vscode.Disposable[];
    /** Bidirectional mapper between pseudocode positions and machine addresses. */
    private readonly sourceSelection: SourceSelection;

    /** Wire graph events, visibility changes, and selection synchronization listeners. */
    constructor(call: Call, private readonly context: ProgramContext, private readonly listing: ListingViews, private readonly graphs: ControlFlowView) {
        this.sourceSelection = new SourceSelection(call);
        this.disposables = [
            graphs.onDidOpen(({ uri, entry }) => this.linkGraph(uri, entry)),
            graphs.onDidSelect(selection => { void this.selectGraph(selection).catch(console.error); }),
            graphs.onDidClose(({ uri, viewColumn, highlight }) => {
                if (this.context.isClosing(uri.authority)) { return; }
                this.nativeRestores.set(uri.toString(), { viewColumn, ...highlight });
                this.restoreNative(vscode.window.visibleTextEditors);
            }),
            vscode.window.onDidChangeVisibleTextEditors(editors => this.restoreNative(editors)),
            vscode.window.onDidChangeTextEditorSelection(event => {
                const editor = event.textEditor;
                // Do not echo our own selection, even if focus changed while its event was in flight.
                if (this.applied.get(editor) === this.signature(event.selections) && event.kind === undefined) {
                    this.applied.delete(editor);
                    return;
                }
                this.applied.delete(editor);
                if (editor !== vscode.window.activeTextEditor || this.listing.isSwitching(editor.document.uri)) { return; }
                if (editor.document.uri.scheme === listingScheme) {
                    void graphs.highlight(editor.document.uri, this.listing.addresses(editor.document, event.selections), event.selections.some(selection => !selection.isEmpty));
                }
                const set = this.setFor(editor);
                if (!set) { return; }
                const key = this.key(set.md5, set.entry);
                const generation = this.cancel(key);
                this.timers.set(key, setTimeout(() => {
                    this.timers.delete(key);
                    void this.synchronize(set, editor, [...event.selections], generation, key).catch(console.error);
                }, 180));
            }),
        ];
    }
    /** Build the map key for a program MD5 and function entry pair. */
    private key(md5: string, entry: string): string { return `${md5}:${entry}`; }
    /** Serialize editor selections into a comparable signature string. */
    private signature(selections: readonly vscode.Selection[]): string {
        return selections.map(s => `${s.anchor.line}:${s.anchor.character}-${s.active.line}:${s.active.character}`).join(',');
    }
    /** Cancel any pending selection timer for `key` and advance its generation counter. */
    private cancel(key: string): number {
        if (this.timers.has(key)) { clearTimeout(this.timers.get(key)!); }
        this.timers.delete(key);
        const generation = (this.generations.get(key) || 0) + 1;
        this.generations.set(key, generation);
        return generation;
    }
    /** Find the active `ViewSet` owning `editor`, if any. */
    private setFor(editor: vscode.TextEditor): ViewSet | undefined {
        const key = documentKey(editor.document.uri);
        return [...this.sets.values()].find(set => documentKey(set.source) === key || documentKey(set.listing) === key);
    }
    /** Restore once after a graph closes; ordinary visibility changes must never overwrite selection. */
    private restoreNative(editors: readonly vscode.TextEditor[]): void {
        for (const editor of editors) {
            const uri = editor.document.uri, saved = this.nativeRestores.get(uri.toString());
            if (!saved || saved.viewColumn !== undefined && saved.viewColumn !== editor.viewColumn) { continue; }
            this.nativeRestores.delete(uri.toString());
            const signature = this.signature(editor.selections);
            void this.listing.ready(uri).then(() => {
                if (this.context.isClosing(uri.authority) || !vscode.window.visibleTextEditors.includes(editor)
                    || signature !== this.signature(editor.selections)) { return; }
                this.apply(editor, this.listing.ranges(editor.document, saved.addresses), saved.selected);
            }).catch(console.error);
        }
    }
    /** Open paired decompilation and analysis tabs for `entry` and highlight `address`. */
    async open(md5: string, entry: string, address: string): Promise<void> {
        const key = this.key(md5, entry);
        this.cancel(key);
        const sourceUri = vscode.Uri.from({ scheme: 'ghidra', authority: md5, path: `/function/${entry}` });
        const listingUri = this.sets.get(key)?.listing || vscode.Uri.from({ scheme: listingScheme, authority: md5,
            path: `/listing/${entry.replace(/^.*:/, '')}${listingExtension}`, query: JSON.stringify({ address: entry }) });
        const source = await vscode.workspace.openTextDocument(sourceUri);
        const sourceEditor = await vscode.window.showTextDocument(source, { preview: false });
        this.sets.set(key, { md5, entry, source: sourceUri, listing: listingUri });
        const range = addressRange(address);
        await this.graphs.highlight(listingUri, range ? [range] : [], false);
        if (this.graphs.isOpen(listingUri)) {
            this.graphs.reveal(listingUri);
        } else {
            const document = await vscode.workspace.openTextDocument(listingUri);
            const existing = this.editorFor(listingUri);
            const editor = await vscode.window.showTextDocument(document, { preview: false,
                viewColumn: existing?.viewColumn ?? vscode.ViewColumn.Beside, preserveFocus: true });
            this.apply(editor, range ? this.listing.ranges(document, [range]) : [], false);
        }
        await vscode.window.showTextDocument(source, { preview: false, viewColumn: sourceEditor.viewColumn });
    }
    /** Switch editor representations in the same resource tab, retaining its address selection. */
    async changeView(uri: vscode.Uri, mode: AnalysisMode): Promise<void> {
        const previous = vscode.window.activeTextEditor;
        const set = [...this.sets.values()].find(set => documentKey(set.listing) === documentKey(uri));
        if (set) { this.cancel(this.key(set.md5, set.entry)); }
        if (mode === 'controlFlow') {
            if (this.graphs.isOpen(uri)) { this.graphs.reveal(uri, false); return; }
            const editor = this.editorFor(uri);
            if (!editor) { throw new Error('Show the analysis tab before switching its view.'); }
            await this.graphs.open(editor, this.listing.addresses(editor.document, editor.selections), editor.selections.some(selection => !selection.isEmpty));
        } else if (this.graphs.isOpen(uri) && !this.editorFor(uri)) {
            const selection = this.graphs.selection(uri);
            const editor = await this.graphs.textEditor(uri);
            const address = selection?.addresses[0] ? addressText(selection.addresses[0]) : this.listing.addressAt(editor);
            if (!address) { return; }
            await this.listing.switchTo(editor, mode, address);
            this.apply(editor, this.listing.ranges(editor.document, selection?.addresses || []), !!selection?.selected);
        } else {
            const editor = this.editorFor(uri);
            const address = this.listing.addressAt(editor);
            if (!editor || !address) { throw new Error('Select a location in the analysis view first.'); }
            await this.switchTo(editor, mode, address);
        }
        if (previous && previous.document.uri.scheme === 'ghidra' && vscode.window.visibleTextEditors.includes(previous)) {
            await vscode.window.showTextDocument(previous.document, { viewColumn: previous.viewColumn, preview: false });
        }
    }
    /** Register or update the `ViewSet` linking a function source tab to a CFG tab. */
    private linkGraph(uri: vscode.Uri, entry: string): ViewSet {
        const key = this.key(uri.authority, entry);
        const set = this.sets.get(key) || { md5: uri.authority, entry,
            source: vscode.Uri.from({ scheme: 'ghidra', authority: uri.authority, path: `/function/${entry}` }), listing: uri };
        set.listing = uri;
        this.sets.set(key, set);
        return set;
    }
    /** Synchronize a CFG basic-block selection back into the paired decompiler editor. */
    private async selectGraph(selection: GraphSelection): Promise<void> {
        const set = this.linkGraph(selection.uri, selection.entry), key = this.key(set.md5, set.entry);
        const generation = this.cancel(key);
        const target = this.editorFor(set.source);
        if (!target) { return; }
        const version = target.document.version;
        const current = (): boolean => this.generations.get(key) === generation && this.graphs.isActive(selection.uri)
            && target.document.version === version && vscode.window.visibleTextEditors.includes(target) && !this.context.isClosing(set.md5);
        try {
            const ranges = await this.sourceSelection.ranges(target.document, selection.addresses, current);
            if (!current()) { return; }
            this.apply(target, ranges, true);
            if (selection.focus) { await vscode.window.showTextDocument(target.document, { viewColumn: target.viewColumn, preview: false }); }
        } catch { /* Pending edits invalidate the native mapping. */ }
    }
    /** Translate the current selection while changing the original tab's representation. */
    async switchTo(editor: vscode.TextEditor, kind: ListingMode, address: string): Promise<void> {
        const set = this.setFor(editor);
        if (set) { this.cancel(this.key(set.md5, set.entry)); }
        const selected = editor.selections.some(selection => !selection.isEmpty);
        const addresses = selected ? this.listing.addresses(editor.document, editor.selections) : [addressRange(address)!].filter(Boolean);
        await this.listing.switchTo(editor, kind, address);
        this.apply(editor, this.listing.ranges(editor.document, addresses), selected);
    }
    /** Propagate selection changes from `source` to its peer listing, bytes, CFG, or decompiler view. */
    private async synchronize(set: ViewSet, source: vscode.TextEditor, selections: readonly vscode.Selection[], generation: number, key: string): Promise<void> {
        const signature = this.signature(selections), version = source.document.version;
        const current = (): boolean => this.generations.get(key) === generation && vscode.window.activeTextEditor === source
            && source.document.version === version && this.signature(source.selections) === signature
            && !this.listing.isSwitching(source.document.uri) && !this.context.isClosing(set.md5);
        if (!current()) { return; }
        const selected = selections.some(selection => !selection.isEmpty);
        let addresses: AddressRange[];
        try {
            addresses = source.document.uri.scheme === 'ghidra'
                ? await this.sourceSelection.addresses(source.document, selections, current)
                : this.listing.addresses(source.document, selections);
        } catch { return; } // Pending edits or unavailable native mappings must not overwrite either buffer.
        if (!current()) { return; }
        if (source.document.uri.scheme === 'ghidra') {
            await this.graphs.highlight(set.listing, addresses, selected);
            if (!current()) { return; }
            const target = this.editorFor(set.listing);
            if (!target || target === source) { return; }
            await this.listing.ready(target.document.uri);
            if (!current()) { return; }
            const instructions = this.listing.instructionRanges(set.listing, addresses);
            const mapped = instructions.length ? instructions : addresses;
            let ranges = this.listing.ranges(target.document, mapped);
            if (!ranges.length && mapped.length) {
                await this.listing.switchTo(target, target.document.languageId === 'ghidra-memory' ? 'bytes' : 'listing', addressText(mapped[0]));
                if (!current()) { return; }
                ranges = this.listing.ranges(target.document, mapped);
            }
            if (current()) { this.apply(target, ranges, selected); }
        } else {
            const target = this.editorFor(set.source);
            if (!target || target === source) { return; }
            const targetVersion = target.document.version;
            const currentTarget = (): boolean => current() && target.document.version === targetVersion
                && vscode.window.visibleTextEditors.includes(target);
            const instructions = this.listing.instructionRanges(set.listing, addresses);
            try {
                const ranges = await this.sourceSelection.ranges(target.document, instructions.length ? instructions : addresses, currentTarget);
                if (currentTarget()) { this.apply(target, ranges, selected); }
            } catch { return; } // A pending edit or changed native layout invalidates this mapping.
        }
    }
    /** Find a currently visible text editor matching `uri` by normalized address key. */
    private editorFor(uri: vscode.Uri): vscode.TextEditor | undefined {
        return vscode.window.visibleTextEditors.find(editor => documentKey(editor.document.uri) === documentKey(uri));
    }
    /** Apply merged selections to `editor` and record their signature to prevent feedback loops. */
    private apply(editor: vscode.TextEditor, ranges: vscode.Range[], selected: boolean): void {
        const merged = mergeRanges(ranges);
        const selections = merged.length ? selected ? merged.map(range => new vscode.Selection(range.start, range.end))
            : [new vscode.Selection(merged[0].start, merged[0].start)]
            : [new vscode.Selection(editor.selection.active, editor.selection.active)];
        this.applied.set(editor, this.signature(selections));
        editor.selections = selections;
        if (merged.length) { editor.revealRange(merged[0], vscode.TextEditorRevealType.InCenterIfOutsideViewport); }
    }
    /** Cancel timers and dispose all view-set subscriptions. */
    dispose(): void {
        for (const timer of this.timers.values()) { clearTimeout(timer); }
        this.timers.clear();
        this.sets.clear();
        this.nativeRestores.clear();
        for (const disposable of this.disposables) { disposable.dispose(); }
    }
}
