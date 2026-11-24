// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

import * as vscode from 'vscode';
import { ProgramContext } from './context';
import { ListingFiles, listingScheme } from './listing';
import { Workbench, ControlFlowData } from './workbench';
import { escapeHtml, page } from './workbench-page';
import { AddressRange, addressRange, intersects } from './view-ranges';
import { object } from './web';

/** Custom editor viewType identifier for Control Flow Graph panels. */
export const controlFlowViewType = 'ghidra.analysisControlFlow';
/** Active representation mode for a shared `ghidra-listing://` resource tab. */
export type AnalysisMode = 'listing' | 'bytes' | 'controlFlow';
/** Cached highlight address ranges for one listing resource. */
interface Highlight { addresses: AddressRange[]; selected: boolean }
/** Per-URI graph data, selection ranges, and open custom-editor webviews. */
interface GraphState {
    uri: vscode.Uri;
    entry: string;
    data: ControlFlowData;
    addresses: AddressRange[];
    selected: boolean;
    panels: Set<vscode.WebviewPanel>;
}
/** Selection event payload emitted when a user selects or opens a CFG basic block. */
export interface GraphSelection { uri: vscode.Uri; entry: string; addresses: AddressRange[]; focus: boolean }

/** The graph representation of the same readonly analysis resource. */
export class ControlFlowView implements vscode.CustomTextEditorProvider, vscode.Disposable {
    /** Active graph states keyed by listing URI string. */
    private readonly states = new Map<string, GraphState>();
    /** Most recent highlight ranges keyed by listing URI string. */
    private readonly highlights = new Map<string, Highlight>();
    /** Emitter for CFG block selection events. */
    private readonly selections = new vscode.EventEmitter<GraphSelection>();
    /** Event fired when a basic block is selected or double-clicked in the CFG. */
    readonly onDidSelect = this.selections.event;
    /** Emitter fired when a CFG custom editor opens. */
    private readonly opened = new vscode.EventEmitter<{ uri: vscode.Uri; entry: string }>();
    /** Event fired after resolving a CFG custom editor tab. */
    readonly onDidOpen = this.opened.event;
    /** Emitter fired when the last panel for a CFG custom editor closes. */
    private readonly closed = new vscode.EventEmitter<{ uri: vscode.Uri; viewColumn?: vscode.ViewColumn; highlight: Highlight }>();
    /** Event fired when a CFG custom editor panel disposes. */
    readonly onDidClose = this.closed.event;
    /** VS Code custom editor provider registration handle. */
    private readonly registration: vscode.Disposable;
    /** Listener for window multi-program scope changes. */
    private readonly scope: vscode.Disposable;

    /** Register the Control Flow custom editor provider and title-scope listener. */
    constructor(private readonly files: ListingFiles, private readonly workbench: Workbench, private readonly context: ProgramContext) {
        this.registration = vscode.window.registerCustomEditorProvider(controlFlowViewType, this, {
            webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: true,
        });
        this.scope = context.onDidChangeScope(() => {
            for (const state of this.states.values()) { for (const panel of state.panels) { panel.title = this.title(state); } }
        });
    }
    /** Compute the qualified or unqualified tab title for `state`. */
    private title(state: GraphState): string { return this.context.titled(`Control Flow · ${state.data.name}`, state.uri.authority); }
    /** Fetch and cache CFG graph data for listing resource `uri`. */
    private async load(uri: vscode.Uri): Promise<GraphState> {
        if (this.context.isClosing(uri.authority)) { throw new Error('This analysis session is closing.'); }
        if (uri.scheme !== listingScheme) { throw new Error('Open a Ghidra analysis view to show its control flow.'); }
        const entry = this.files.entry(uri)?.window.entry;
        if (!entry) { throw new Error('This address is outside a function. Control Flow requires a function body.'); }
        const known = this.states.get(uri.toString());
        if (known?.entry === entry) { return known; }
        const data = await this.workbench.controlFlow(uri.authority, entry);
        if (this.context.isClosing(uri.authority)) { throw new Error('This analysis session is closing.'); }
        const highlight = this.highlights.get(uri.toString()) || { addresses: [], selected: false };
        const state: GraphState = { uri, entry, data, ...highlight, panels: new Set() };
        this.states.set(uri.toString(), state);
        return state;
    }
    /** Populate and wire a VS Code custom text editor webview panel for `document`. */
    async resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): Promise<void> {
        panel.webview.options = { enableScripts: true, localResourceRoots: [] };
        this.workbench.shortcuts.attach(panel, 'controlFlow');
        try {
            const state = await this.load(document.uri);
            state.panels.add(panel);
            let viewColumn = panel.viewColumn;
            panel.onDidChangeViewState(() => { viewColumn = panel.viewColumn ?? viewColumn; });
            panel.onDidDispose(() => {
                state.panels.delete(panel);
                if (!state.panels.size && this.states.get(state.uri.toString()) === state) {
                    this.states.delete(state.uri.toString());
                }
                this.closed.fire({ uri: state.uri, viewColumn, highlight: { addresses: state.addresses, selected: state.selected } });
            });
            panel.webview.onDidReceiveMessage(message => {
                void this.message(state, panel, message).catch(error => void vscode.window.showErrorMessage(String(error)));
            });
            this.render(state, panel);
            this.opened.fire({ uri: state.uri, entry: state.entry });
        } catch (error) {
            this.workbench.shortcuts.resetPanel(panel);
            panel.webview.html = page({ title: 'Control Flow', subtitle: this.context.name(document.uri.authority), body: `<p class="error">${escapeHtml(String(error))}</p>` });
        }
    }
    /** Render the CFG HTML document into `panel`. */
    private render(state: GraphState, panel: vscode.WebviewPanel): void {
        this.context.track(state.uri.authority);
        panel.title = this.title(state);
        this.workbench.shortcuts.resetPanel(panel);
        panel.webview.html = page({ title: 'Control Flow', subtitle: `${state.data.name} · ${this.context.name(state.uri.authority)}`,
            body: state.data.body, scope: state.data.scope, graph: true, controlFlow: true,
            state: { kind: 'controlFlow', md5: state.uri.authority, entry: state.entry, analysisUri: state.uri.toString() } });
    }
    /** Handle selection, refresh, and decompile messages posted by the CFG webview. */
    private async message(state: GraphState, panel: vscode.WebviewPanel, message: { action?: string; address?: string }): Promise<void> {
        if (this.workbench.shortcuts.handleMessage(panel, object(message))) { return; }
        if (this.context.isClosing(state.uri.authority)) { return; }
        if (message.action === 'ready') { await this.highlight(state.uri, state.addresses, state.selected); return; }
        if (!panel.active) { return; }
        if (message.action === 'refresh') { await this.refresh(state.uri.authority); return; }
        if (message.action !== 'select' && message.action !== 'decompile') { return; }
        const block = state.data.blocks.find(block => block.address === message.address);
        if (!block) { return; }
        const addresses = block.instructions.map(instruction => addressRange(instruction.address, instruction.length)).filter((range): range is AddressRange => !!range);
        state.addresses = addresses;
        state.selected = true;
        this.selections.fire({ uri: state.uri, entry: state.entry, addresses, focus: message.action === 'decompile' });
    }
    /** Return true when a CFG panel for `uri` currently has editor focus. */
    isActive(uri: vscode.Uri): boolean { return [...this.states.get(uri.toString())?.panels || []].some(panel => panel.active); }
    /** Return true when at least one CFG panel is open for `uri`. */
    isOpen(uri: vscode.Uri): boolean { return !!this.states.get(uri.toString())?.panels.size; }
    /** Return the current block highlight state for `uri`. */
    selection(uri: vscode.Uri): { addresses: AddressRange[]; selected: boolean } | undefined { return this.states.get(uri.toString()); }
    /** Highlight CFG basic blocks intersecting `addresses` in all visible panels for `uri`. */
    async highlight(uri: vscode.Uri, addresses: AddressRange[], selected: boolean): Promise<void> {
        // Native Reopen With bypasses open(), so remember the last native selection before a graph exists.
        this.highlights.set(uri.toString(), { addresses, selected });
        const state = this.states.get(uri.toString());
        if (!state) { return; }
        state.addresses = addresses;
        state.selected = selected;
        const blocks = state.data.blocks.filter(block => block.instructions.some(instruction => {
            const range = addressRange(instruction.address, instruction.length);
            return range && addresses.some(address => intersects(range, address));
        }));
        await Promise.all([...state.panels].filter(panel => panel.visible).map(panel => panel.webview.postMessage({ action: 'highlight', addresses: blocks.map(block => block.address) })));
    }
    /** Focus an existing CFG panel for `uri`. */
    reveal(uri: vscode.Uri, preserveFocus = true): void {
        const panels = [...this.states.get(uri.toString())?.panels || []];
        const panel = panels.find(panel => panel.visible) || panels[0];
        panel?.reveal(panel.viewColumn, preserveFocus);
    }
    /** Switch an active listing/bytes text editor tab to its Control Flow custom editor representation. */
    async open(editor: vscode.TextEditor, addresses: AddressRange[], selected: boolean): Promise<void> {
        const state = await this.load(editor.document.uri); // Failed loads leave the native view intact.
        state.addresses = addresses;
        state.selected = selected;
        await vscode.window.showTextDocument(editor.document, { viewColumn: editor.viewColumn, preview: false });
        // VS Code's own image preview uses this command to replace the current editor representation.
        await vscode.commands.executeCommand('reopenActiveEditorWith', controlFlowViewType);
        const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
        if (!(tab?.input instanceof vscode.TabInputCustom) || tab.input.viewType !== controlFlowViewType
            || tab.input.uri.toString() !== editor.document.uri.toString()) {
            throw new Error('VS Code could not switch this analysis tab to Control Flow.');
        }
        // Some host versions retain a text input after replacement. Read the current group because
        // the original API tab object may no longer be the one in its collection.
        const uri = tab.input.uri.toString();
        const replaced = tab.group.tabs.filter(item => !item.isDirty && item.input instanceof vscode.TabInputText
            && item.input.uri.toString() === uri);
        if (replaced.length) { await vscode.window.tabGroups.close(replaced, true); }
    }
    /** Switch an active Control Flow custom editor tab back to the default text editor. */
    async textEditor(uri: vscode.Uri): Promise<vscode.TextEditor> {
        const state = this.states.get(uri.toString());
        const panels = [...state?.panels || []];
        const panel = panels.find(panel => panel.visible) || panels[0];
        if (!panel) { throw new Error('Open the analysis view before switching its representation.'); }
        const viewColumn = panel.viewColumn;
        panel.reveal(viewColumn, false);
        await vscode.commands.executeCommand('reopenActiveEditorWith', 'default');
        const document = await vscode.workspace.openTextDocument(uri);
        return vscode.window.showTextDocument(document, { viewColumn, preview: false });
    }
    /** Reload open Control Flow Graph panels for program `md5`. */
    async refresh(md5: string): Promise<void> {
        if (this.context.isClosing(md5)) { return; }
        for (const state of this.states.values()) {
            if (state.uri.authority !== md5) { continue; }
            if (!state.panels.size) { this.states.delete(state.uri.toString()); continue; }
            state.data = await this.workbench.controlFlow(md5, state.entry);
            for (const panel of state.panels) { this.render(state, panel); }
        }
    }
    /** Dispose all CFG panels and cached highlights belonging to `md5`. */
    close(md5: string): void {
        const target = md5.toLowerCase();
        for (const key of [...this.highlights.keys()]) { if (vscode.Uri.parse(key).authority.toLowerCase() === target) { this.highlights.delete(key); } }
        for (const [key, state] of this.states) {
            if (state.uri.authority.toLowerCase() !== target) { continue; }
            for (const panel of state.panels) { panel.dispose(); }
            this.states.delete(key);
        }
    }
    /** Dispose all CFG panels, emitters, and custom editor registrations. */
    dispose(): void {
        for (const state of this.states.values()) { for (const panel of state.panels) { panel.dispose(); } }
        this.states.clear(); this.highlights.clear(); this.selections.dispose(); this.opened.dispose(); this.closed.dispose(); this.registration.dispose(); this.scope.dispose();
    }
}
