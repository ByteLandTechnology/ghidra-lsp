// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

import { definedStrings } from './strings';
import { symbolName, displayAddress } from './names';
import * as vscode from 'vscode';
import { Call } from './memory';
import { ProgramContext } from './context';
import { escapeHtml, GraphEdge, GraphNode, page, Row, table } from './workbench-page';
import { controlFlowGraph } from './control-flow-graph';
import { CallDirection, CallExpansion, CallGraph, CallRecord, callGraph } from './call-graph';
import { callIcon } from './call-graph-icons';
import { CallColumns, callColumns, collectColumns, columnPathLimit } from './call-columns';
import { formatFriendlyError } from './error';
import { cursorLocation } from './location';
import { ProgramPanelState, ProgramViewsController } from './program-views-controller';
import { ProgramEndian } from './hex-model';
import { parseAddress, sameAddress } from './address-math';
import { Data, object, rows as items, stringOf } from './web';

/** Extract the `items` array from a paginated server query response. */
const collection = (value: unknown): Data[] => items(object(value).items ?? value);
/** Identifier for each graphical workbench webview panel type. */
export type WorkbenchKind = 'listing' | 'memory' | 'strings' | 'imports' | 'exports' | 'callGraph' | 'controlFlow' | 'callers' | 'callees' | 'references';
/** Live state for one open workbench webview panel. */
interface PanelState extends ProgramPanelState {
    kind: WorkbenchKind; md5: string; address?: string; entry?: string; displayAddress?: string;
    cursor?: string; previous: (string | undefined)[]; next?: string; selected?: string;
    callExpansion?: CallExpansion; callRecords?: Map<string, CallRecord[]>;
    callNodeNames?: Map<string, string>;
    callRoots?: Map<string, CallExpansion>; callHistory?: string[];
    callView?: 'graph' | 'columns'; callColumnDirection?: CallDirection; callColumnPath?: string[];
    callColumnPaths?: Map<string, string[]>; callColumnModel?: CallColumns;
    generation: number; panel: vscode.WebviewPanel;
}
/** Rendered control-flow SVG markup and basic-block instruction map. */
export interface ControlFlowData { body: string; scope: string; name: string; blocks: { address: string; instructions: { address: string; length: number }[] }[] }
/** Binary import and export metadata returned by `ghidra.binaryInterface`. */
interface BinaryInterface { imports?: Data[]; exports?: Data[]; format?: string; source?: string; limitations?: string[] }
/** Reveal payload returned by `ghidra.reveal`. */
interface Reveal { uri: string; exact?: boolean; range?: { start: { line: number; character: number }; end: { line: number; character: number } } }
/** Human-readable titles for each {@link WorkbenchKind}. */
const names: Record<WorkbenchKind, string> = { listing: 'Listing', memory: 'Memory & bytes', strings: 'Defined strings', imports: 'Imports', exports: 'Exports', callGraph: 'Call graph', controlFlow: 'Control flow', callers: 'Callers', callees: 'Callees', references: 'Binary address references' };

/** Graphical browsing of real program data, always scoped to its owning session. */
export class Workbench implements vscode.Disposable {
    /** Open workbench panels keyed by `kind:md5:entry` (plus serial for call graphs). */
    private readonly panels = new Map<string, PanelState>();
    /** Registered commands, serializers, and selection listeners. */
    private readonly disposables: vscode.Disposable[] = [];
    /** Controller for full-program Listing and Memory Hex panels. */
    private readonly programViews: ProgramViewsController;
    /** Debounce timer for cursor synchronization from text editors to open panels. */
    private syncTimer?: ReturnType<typeof setTimeout>;
    /** Generation counter used to discard stale cursor-sync requests. */
    private syncGeneration = 0;
    /** Monotonic suffix ensuring independent Call Graph tabs keep unique keys. */
    private callGraphSerial = 0;
    /** Register workbench commands, panel serializers, and editor selection listeners. */
    constructor(
        private readonly call: Call,
        private readonly context: ProgramContext,
        private readonly editorCursorAddress?: (editor: vscode.TextEditor) => string | undefined,
    ) {
        this.programViews = new ProgramViewsController({
            context: this.context,
            call: this.call,
            reveal: (md5, address, preserveFocus) => this.reveal(md5, address, preserveFocus),
            navigate: (md5, address, requireFunction) => this.navigate(md5, address, requireFunction),
            openBeside: (kind, md5, address) => this.open(kind, md5, address || undefined, vscode.ViewColumn.Beside),
            openWorkbench: (kind, md5, address) => this.open(kind, md5, address),
            getPanels: () => this.panels.values(),
        });
        const commands: [string, WorkbenchKind][] = [
            ['browseListing', 'listing'], ['showMemory', 'memory'],
            ['showStrings', 'strings'], ['showImports', 'imports'],
            ['showExports', 'exports'], ['showCallGraph', 'callGraph'],
            ['showControlFlow', 'controlFlow'], ['showCallers', 'callers'], ['showCallees', 'callees']
        ];
        for (const [command, kind] of commands) {
            this.disposables.push(vscode.window.registerWebviewPanelSerializer(`ghidra.${kind}`, {
                deserializeWebviewPanel: async (panel, state: unknown) => { await this.restore(kind, panel, object(state)); },
            }));
            this.disposables.push(vscode.commands.registerCommand(`ghidraLsp.${command}`, async (resource?: unknown, address?: string) => {
                try { await this.open(kind, this.context.resolve(resource), await this.browseAddress(kind, resource, address)); }
                catch (error) { void vscode.window.showErrorMessage(formatFriendlyError(error)); }
            }));
        }
        for (const kind of ['references'] as WorkbenchKind[]) {
            this.disposables.push(vscode.window.registerWebviewPanelSerializer(`ghidra.${kind}`, {
                deserializeWebviewPanel: async (panel, state: unknown) => { await this.restore(kind, panel, object(state)); },
            }));
        }
        const callHierarchyHandler = async (resource?: unknown, address?: string) => {
            try { await this.triggerCallHierarchy(resource, address); }
            catch (error) { void vscode.window.showErrorMessage(formatFriendlyError(error)); }
        };
        this.disposables.push(
            vscode.commands.registerCommand('ghidraLsp.showCallHierarchy', callHierarchyHandler),
            vscode.commands.registerCommand('ghidraLsp.showReferences', async (resource?: unknown, address?: string) => {
                try { await this.triggerReferences(resource, address); }
                catch (error) { void vscode.window.showErrorMessage(formatFriendlyError(error)); }
            }),
            vscode.commands.registerCommand('ghidraLsp.showAddressReferences', async (resource?: unknown, address?: string) => {
                try { await this.open('references', this.context.resolve(resource), await this.browseAddress('references', resource, address)); }
                catch (error) { void vscode.window.showErrorMessage(formatFriendlyError(error)); }
            })
        );
        this.disposables.push(context.onDidChangeScope(() => {
            for (const state of this.panels.values()) { state.panel.title = this.context.titled(names[state.kind], state.md5); }
        }));
        this.disposables.push(vscode.commands.registerCommand('ghidraLsp.goToAddress', async (resource?: unknown, initial?: string) => {
            try {
                const md5 = this.context.resolve(resource) || this.context.require();
                const address = initial || this.resourceAddress(resource) || await vscode.window.showInputBox({ title: 'Go to Ghidra address', prompt: `Address in ${this.context.name(md5)}`, placeHolder: 'ram:00401000 or 00401000', ignoreFocusOut: true });
                if (address) { await this.navigate(md5, address); }
            } catch (error) { void vscode.window.showErrorMessage(formatFriendlyError(error)); }
        }));
        this.disposables.push(vscode.window.onDidChangeTextEditorSelection(event => {
            const docUri = event.textEditor.document.uri;
            const isDecomp = docUri.scheme === 'ghidra' && docUri.path.startsWith('/function/');
            const isCompanion = docUri.scheme === 'ghidra-listing' || docUri.scheme === 'ghidra-memory';
            if (!isDecomp && !isCompanion) { return; }
            if (!Array.from(this.panels.values()).some(state => state.md5 === docUri.authority && state.panel.visible)) { return; }
            if (this.syncTimer) { clearTimeout(this.syncTimer); }
            const generation = ++this.syncGeneration;
            this.syncTimer = setTimeout(() => { void this.synchronize(event.textEditor, generation); }, 180);
        }));
    }
    /** Show native VS Code Call Hierarchy when in pseudocode, or fall back to the Callers view. */
    private async triggerCallHierarchy(resource?: unknown, address?: string): Promise<void> {
        const editor = await this.resolveEditor(resource, address);
        if (editor) {
            await vscode.commands.executeCommand('editor.showCallHierarchy');
            return;
        }
        await this.open('callers', this.context.resolve(resource), address || this.resourceAddress(resource));
    }
    /** Show native VS Code References when in pseudocode, or fall back to the References view. */
    private async triggerReferences(resource?: unknown, address?: string): Promise<void> {
        const editor = await this.resolveEditor(resource, address);
        if (editor) {
            await vscode.commands.executeCommand('editor.action.findReferences');
            return;
        }
        await this.open('references', this.context.resolve(resource), address || this.resourceAddress(resource));
    }
    /** Open and focus the decompiler editor matching `resource` or `address` if available. */
    private async resolveEditor(resource?: unknown, address?: string): Promise<vscode.TextEditor | undefined> {
        let uri: vscode.Uri | undefined;
        let position: vscode.Position | undefined;
        if (resource instanceof vscode.Uri) {
            uri = resource;
        } else if (typeof resource === 'string' && resource.startsWith('ghidra:')) {
            try { uri = vscode.Uri.parse(resource); } catch {}
        } else if (resource && typeof resource === 'object') {
            const obj = resource as Record<string, unknown>;
            if (typeof obj.uri === 'string') {
                try { uri = vscode.Uri.parse(obj.uri); } catch {}
            }
            if (obj.position && typeof obj.position === 'object') {
                const p = obj.position as { line?: number; character?: number };
                if (typeof p.line === 'number' && typeof p.character === 'number') {
                    position = new vscode.Position(p.line, p.character);
                }
            }
        }
        if (!uri) {
            const md5 = this.context.resolve(resource) || this.context.current;
            const targetAddress = address || this.resourceAddress(resource);
            if (md5 && targetAddress) {
                try {
                    const result = await this.call<{ uri: string }>('ghidra.openFunction', { entry: targetAddress, md5 });
                    uri = vscode.Uri.parse(result.uri);
                } catch { return undefined; }
            }
        }
        let editor = vscode.window.activeTextEditor;
        if (uri) {
            const doc = await vscode.workspace.openTextDocument(uri);
            editor = await vscode.window.showTextDocument(doc);
        }
        if (editor && editor.document.uri.scheme === 'ghidra' && editor.document.uri.authority === this.context.resolve(resource)) {
            if (position) {
                editor.selection = new vscode.Selection(position, position);
                editor.revealRange(new vscode.Range(position, position));
            }
            return editor;
        }
        return undefined;
    }
    /** Extract an address or function entry hint from a command resource argument. */
    private resourceAddress(resource?: unknown): string | undefined {
        let uri: vscode.Uri | undefined;
        if (resource instanceof vscode.Uri) { uri = resource; }
        else if (typeof resource === 'string' && resource.startsWith('ghidra:')) {
            try { uri = vscode.Uri.parse(resource); } catch {}
        }
        if (uri && uri.scheme === 'ghidra' && uri.path.startsWith('/function/')) {
            return decodeURIComponent(uri.path.slice('/function/'.length));
        }
        const node = object(resource);
        return stringOf(node.address || node.entry) || undefined;
    }
    /** Execute a backend read query for `md5` through `ghidra.query`. */
    private query(md5: string, domain: string, operation: string, params: Data = {}, all = false): Promise<Data> {
        return this.call<Data>('ghidra.query', { md5, domain, operation, params, all });
    }
    /** Return the function entry address of the active decompiler editor if it belongs to `md5`. */
    private currentEntry(md5: string): string | undefined {
        const uri = vscode.window.activeTextEditor?.document.uri;
        return uri?.scheme === 'ghidra' && uri.authority === md5 && uri.path.startsWith('/function/') ? decodeURIComponent(uri.path.slice('/function/'.length)) : undefined;
    }
    /** Determine the initial address to open for a listing, memory, or references panel. */
    private async browseAddress(kind: WorkbenchKind, resource?: unknown, explicit?: string): Promise<string | undefined> {
        if (explicit) { return explicit; }
        if (!['listing', 'memory', 'references'].includes(kind)) { return this.resourceAddress(resource); }
        if (resource && !(resource instanceof vscode.Uri)) {
            const address = this.resourceAddress(resource);
            if (address) { return address; }
        }
        const md5 = this.context.resolve(resource) || this.context.require();
        const uri = resource instanceof vscode.Uri ? resource : undefined;
        const activeEditor = vscode.window.activeTextEditor;
        if ((kind === 'listing' || kind === 'memory') && activeEditor && activeEditor.document.uri.authority === md5) {
            const companionAddr = this.editorCursorAddress?.(activeEditor);
            if (companionAddr) { return companionAddr; }
        }
        const location = await cursorLocation(this.call, md5, uri);
        if (location) {
            if (location.address) { return location.code_unit_address || location.address; }
            if (kind === 'references') { throw new Error('The cursor has no valid code context. Select a code token.'); }
        }
        if (kind === 'references' && uri?.scheme === 'ghidra' && uri.path.startsWith('/function/')) {
            throw new Error('Open the function and select a code token to choose an address.');
        }
        return this.resourceAddress(resource) || (kind === 'listing' || kind === 'memory' ? this.currentEntry(md5) : undefined);
    }
    /** Resolve a function entry from `address`, the active editor, or a QuickPick list. */
    private async chooseEntry(md5: string, address?: string): Promise<string | undefined> {
        if (address) {
            const resolved = await this.query(md5, 'address', 'resolve', { selector: { address } });
            const fn = object(resolved.function);
            if (fn.entry) { return stringOf(fn.entry); }
            throw new Error(`No function contains ${address}. Use Listing or bytes to inspect this address.`);
        }
        const current = this.currentEntry(md5);
        if (current) { return current; }
        return this.pickEntry(md5);
    }
    /** Prompt the user to select a function entry from the program's function table. */
    private async pickEntry(md5: string, current?: string): Promise<string | undefined> {
        const functions = this.call<{ items: Data[] }>('ghidra.functions', { md5 }).then(result => result.items.map(fn => ({
            label: `$(symbol-method) ${symbolName(fn, true)}`, description: stringOf(fn.entry),
            ...(stringOf(fn.entry) === current ? { detail: 'Current function' } : {}), entry: stringOf(fn.entry),
        })));
        return (await vscode.window.showQuickPick(functions, { title: `Jump to function · ${this.context.name(md5)}`, placeHolder: 'Search function name or address', matchOnDescription: true }))?.entry;
    }
    /** Open or focus a graphical workbench panel of `kind` for `md5` at `address`. */
    async open(kind: WorkbenchKind, md5?: string, address?: string, viewColumn = vscode.ViewColumn.Active): Promise<void> {
        md5 ||= this.context.require();
        let entry: string | undefined;
        if (['callGraph', 'controlFlow', 'callers', 'callees'].includes(kind)) {
            entry = await this.chooseEntry(md5, address);
            if (!entry) { return; }
            address = entry;
        } else if (['listing', 'memory', 'references'].includes(kind) && !address) { address = await this.browseAddress(kind); }
        if (kind === 'references' && !address) { address = await vscode.window.showInputBox({ title: 'References at address', prompt: `Address in ${this.context.name(md5)}`, ignoreFocusOut: true }); if (!address) { return; } }
        const key = `${kind}:${md5}:${entry || ''}`;
        const existing = kind === 'callGraph' ? [...this.panels.values()].find(panel => panel.kind === kind && panel.md5 === md5 && panel.entry === entry) : this.panels.get(key);
        if (existing) {
            if (address) {
                if (kind === 'listing' || kind === 'memory') {
                    const resolved = await this.programViews.prepareNavigation(existing, address, true);
                    await this.render(existing);
                    existing.panel.reveal(viewColumn);
                    await this.programViews.broadcastCursorSync(existing, resolved, 1);
                    return;
                }
                existing.address = address; existing.cursor = undefined; existing.previous = []; existing.pvWindowStart = undefined; existing.pvPrevStarts = [];
            }
            await this.render(existing); existing.panel.reveal(viewColumn); return;
        }
        this.context.track(md5);
        const panel = vscode.window.createWebviewPanel(`ghidra.${kind}`, this.context.titled(names[kind], md5), viewColumn, { enableScripts: true, localResourceRoots: [], retainContextWhenHidden: true });
        const state: PanelState = { kind, md5, address, entry, previous: [], generation: 0, panel, ...(kind === 'callGraph' ? { callView: 'graph' as const } : {}) };
        this.attach(kind === 'callGraph' ? `${key}:${++this.callGraphSerial}` : key, state);
        await this.context.activate(md5);
        try { await this.render(state); }
        catch (error) { panel.webview.html = page({ title: names[kind], subtitle: this.context.name(md5), body: `<p class="error">${escapeHtml(String(error))}</p>`, state: this.snapshot(state) }); throw error; }
    }
    /** Register lifecycle, focus, and message listeners for a workbench panel. */
    private attach(key: string, state: PanelState): void {
        this.panels.set(key, state);
        state.panel.onDidDispose(() => { state.generation++; if (this.panels.get(key) === state) { this.panels.delete(key); } });
        state.panel.onDidChangeViewState(event => { if (event.webviewPanel.active) { void this.context.activate(state.md5).catch(error => void vscode.window.showErrorMessage(formatFriendlyError(error))); } });
        state.panel.webview.onDidReceiveMessage((message: unknown) => { void this.message(state, object(message)).catch(error => { void vscode.window.showErrorMessage(formatFriendlyError(error)); }); });
    }
    /** Build the serializable state snapshot stored inside webview HTML for VS Code reload. */
    private snapshot(state: PanelState): Data {
        return { kind: state.kind, md5: state.md5, address: state.kind === 'listing' ? state.displayAddress || state.address : state.address, entry: state.entry, cursor: state.cursor, previous: state.previous,
            ...(state.kind === 'listing' || state.kind === 'memory' ? { selected: state.selected, syncEnabled: state.syncEnabled, bytesPerRow: state.pvBytesPerRow, endian: state.pvEndian } : {}),
            ...(state.kind === 'callGraph' ? { selected: state.entry, selectedEntry: state.entry, callExpansion: state.callExpansion || { callers: [state.entry!], callees: [state.entry!] }, callHistory: state.callHistory || [], callView: state.callView || 'graph', callColumnDirection: state.callColumnDirection || 'callees', callColumnPath: state.callColumnPath || [] } : {}) };
    }
    /** Rehydrate a persisted workbench webview panel after a VS Code window reload. */
    private async restore(kind: WorkbenchKind, panel: vscode.WebviewPanel, saved: Data): Promise<void> {
        if (!/^[a-f\d]{32}$/i.test(stringOf(saved.md5)) || saved.kind !== kind) { panel.dispose(); return; }
        const md5 = stringOf(saved.md5).toLowerCase();
        this.context.track(md5);
        panel.title = this.context.titled(names[kind], md5);
        const state: PanelState = { kind, md5, address: stringOf(saved.address) || undefined, entry: stringOf(saved.entry) || undefined, previous: [], generation: 0, panel };
        if (kind === 'listing' || kind === 'memory') {
            state.selected = stringOf(saved.selected) || state.address;
            if (typeof saved.syncEnabled === 'boolean') { state.syncEnabled = saved.syncEnabled; }
            if (Number(saved.bytesPerRow) === 8 || Number(saved.bytesPerRow) === 16) { state.pvBytesPerRow = Number(saved.bytesPerRow) as 8 | 16; }
            if (saved.endian === 'big' || saved.endian === 'little') { state.pvEndian = saved.endian as ProgramEndian; }
        }
        if (kind === 'callGraph') {
            state.callView = saved.callView === 'columns' ? 'columns' : 'graph';
            state.callColumnDirection = saved.callColumnDirection === 'callers' ? 'callers' : 'callees';
            state.callColumnPath = Array.isArray(saved.callColumnPath) ? saved.callColumnPath.filter((value): value is string => typeof value === 'string').slice(0, columnPathLimit) : [];
            const expansion = object(saved.callExpansion);
            state.callExpansion = { callers: Array.isArray(expansion.callers) ? expansion.callers.filter((value): value is string => typeof value === 'string').slice(0, 80) : [state.entry!], callees: Array.isArray(expansion.callees) ? expansion.callees.filter((value): value is string => typeof value === 'string').slice(0, 80) : [state.entry!] };
            state.callHistory = Array.isArray(saved.callHistory) ? saved.callHistory.filter((value): value is string => typeof value === 'string').slice(-20) : [];
        }
        // Cursors include backend revision state and cannot be reused after a reload.
        const key = `${kind}:${md5}:${state.entry || ''}`;
        panel.webview.options = { enableScripts: true, localResourceRoots: [] };
        this.attach(kind === 'callGraph' ? `${key}:${++this.callGraphSerial}` : key, state);
        try {
            if (panel.active) { await this.context.activate(md5); }
            await this.render(state);
        } catch (error) {
            panel.webview.html = page({ title: names[kind], subtitle: this.context.name(md5), body: `<p class="error">${escapeHtml(String(error))}</p>`, state: this.snapshot(state) });
        }
    }
    /** Refresh open workbench panels globally or for program `md5`. */
    async refresh(md5?: string): Promise<void> {
        if (md5) { this.programViews.invalidate(md5); }
        for (const state of this.panels.values()) { if (!md5 || state.md5 === md5) { await this.refreshPanel(state); } }
    }
    /** Clear cached view state and re-render a single workbench panel. */
    private async refreshPanel(state: PanelState): Promise<void> {
        if (state.kind === 'callGraph') {
            state.callRecords = new Map();
            state.callNodeNames = new Map();
        }
        if (state.kind === 'listing') {
            this.programViews.invalidate(state.md5);
            state.address = state.pvWindowStart || state.displayAddress || state.address;
            state.cursor = undefined;
        }
        if (state.kind === 'memory') {
            this.programViews.invalidate(state.md5);
        }
        await this.render(state, true);
    }
    /** Query backend data and render HTML into the workbench panel `owner`. */
    private async render(owner: PanelState, forceRefresh = false): Promise<void> {
        if (owner.kind === 'listing') {
            owner.generation++;
            await this.programViews.renderListing(owner, 'full');
            return;
        }
        if (owner.kind === 'memory') {
            owner.generation++;
            await this.programViews.renderHex(owner, 'full');
            return;
        }
        const generation = ++owner.generation;
        const state: PanelState = { ...owner, previous: [...owner.previous] };
        const title = names[state.kind];
        let subtitle = `${this.context.name(state.md5)}${state.entry ? ` · ${displayAddress(state.entry)}` : ''}`;
        let body = '', scope = '', scopeSummary: string | undefined, next = false, address: string | undefined;
        let callTools: string | undefined, callName: string | undefined;
        if (state.kind === 'strings') {
            const { items: strings, scanned } = await definedStrings(this.call, state.md5);
            body = table(['Address', 'Length', 'Data type', 'String'], strings.map(unit => ({ cells: [unit.address, unit.length, unit.type, unit.value], address: unit.address, kind: 'data', detail: unit.type })), 'Defined strings');
            scopeSummary = `${strings.length} strings`;
            scope = `${strings.length} strings recognized by Ghidra among ${scanned} defined data units in the default address space. Raw bytes are not scanned for strings.`;
            if (!strings.length) { body += '<p class="empty">Ghidra has not defined any strings in this program.</p>'; }
        } else if (state.kind === 'imports' || state.kind === 'exports') {
            const result = await this.call<BinaryInterface>('ghidra.binaryInterface', { md5: state.md5 });
            const symbols = items(result[state.kind]);
            body = table(state.kind === 'imports' ? ['Name', 'Library', 'Address', 'Kind'] : ['Name', 'Address', 'Ordinal', 'Forwarded target', 'Kind'], symbols.map(symbol => ({ cells: state.kind === 'imports' ? [symbolName(symbol, true), stringOf(symbol.library), stringOf(symbol.address), stringOf(symbol.kind)] : [symbolName(symbol, true), stringOf(symbol.address), stringOf(symbol.ordinal), stringOf(symbol.forward), stringOf(symbol.kind)], address: stringOf(symbol.address) || undefined, label: symbolName(symbol, true), kind: 'symbol' })), state.kind === 'imports' ? 'Imports' : 'Exports');
            scopeSummary = `${symbols.length} ${state.kind} · ${result.format || 'binary'}`;
            scope = `${symbols.length} ${state.kind} · ${result.format || 'binary'}${result.source ? ` · ${result.source}` : ''}${result.limitations?.length ? `. ${result.limitations.join(' ')}` : ''}`;
            if (!symbols.length) { body += `<p class="empty">No ${state.kind} reported.</p>`; }
        } else if (state.kind === 'references') {
            for (const direction of ['to', 'from'] as const) {
                const references = collection(await this.query(state.md5, 'reference', 'list', { filter: { direction, [direction]: state.address } }, true));
                body += `<section><h2>${direction === 'to' ? 'Incoming' : 'Outgoing'} (${references.length})</h2>${table(['From', 'To', 'Kind', 'Operand', 'Source', 'Navigation'], references.map(ref => {
                    const target = stringOf(direction === 'to' ? ref.from : ref.to);
                    const navigable = parseAddress(target) !== undefined;
                    return { cells: [stringOf(ref.from), stringOf(ref.to), stringOf(ref.type), stringOf(ref.operand_index), stringOf(ref.source_type), navigable ? direction === 'to' ? 'Open source' : 'Open destination' : 'Non-memory reference'], ...(navigable ? { address: target } : {}), kind: direction === 'to' ? 'reference-source' : 'reference-destination' };
                }), direction === 'to' ? 'Incoming references' : 'Outgoing references')}</section>`;
            }
            address = state.address;
            scope = '';
        } else if (state.kind === 'callers' || state.kind === 'callees') {
            const rows = collection(await this.query(state.md5, 'function', 'call.list', { filter: { entry: state.entry, direction: state.kind } }, true));
            body = table(['Function', 'Entry', 'Call site'], rows.map(fn => ({ cells: [symbolName(fn, true), stringOf(fn.entry), stringOf(fn.call_site) || 'Not reported'], entry: stringOf(fn.entry), address: stringOf(fn.call_site || fn.entry), label: symbolName(fn, true), kind: 'function' })), state.kind === 'callers' ? 'Callers' : 'Callees');
            scopeSummary = `${rows.length} ${state.kind}`;
            scope = scopeSummary;
        } else if (state.kind === 'callGraph') {
            const expansion = owner.callExpansion ||= { callers: [state.entry!], callees: [state.entry!] };
            const recordKey = (entry: string, direction: CallDirection): string => JSON.stringify([entry.toLowerCase(), direction]);
            if (state.callView === 'columns') {
                const cachedName = !forceRefresh ? owner.callNodeNames?.get(state.entry!.toLowerCase()) : undefined;
                const rootTitle = cachedName || symbolName(await this.query(state.md5, 'function', 'get', { selector: { entry: state.entry }, projection: { fields: ['entry', 'name', 'namespace', 'demangled_name'] } }), true);
                const cache = owner.callRecords ||= new Map<string, CallRecord[]>();
                const readCalls = async (entry: string, direction: CallDirection): Promise<CallRecord[]> => {
                    const key = recordKey(entry, direction);
                    if (!cache.has(key)) {
                        if (cache.size >= 128) {
                            const oldest = cache.keys().next().value;
                            if (oldest !== undefined) { cache.delete(oldest); }
                        }
                        cache.set(key, collection(await this.query(state.md5, 'function', 'call.list', { filter: { entry, direction } }, true)).map(item => ({ entry: stringOf(item.entry), name: symbolName(item, true), callSite: stringOf(item.call_site) || undefined })));
                    }
                    return cache.get(key)!;
                };
                const model = await collectColumns({ entry: state.entry!, name: rootTitle }, state.callColumnDirection || 'callees', state.callColumnPath || [], readCalls, () => generation === owner.generation);
                if (generation !== owner.generation) { return; }
                owner.callColumnPath = state.callColumnPath = model.path; owner.callColumnModel = model;
                body = callColumns(model);
                callTools = `<div class="call-controls call-icon-row" role="group" aria-label="Column view options"><button id="call-column-home" aria-label="Return to current function" title="Return to current function">${callIcon('back')}</button><button data-action="refresh" aria-label="Refresh calls" title="Refresh calls">${callIcon('refresh')}</button></div>`;
                callName = rootTitle;
            } else {
                const res = await this.call<CallGraph & {
                    rootName?: string;
                    nodes?: (CallGraph['nodes'][number] & { branches?: { callers?: { expanded?: boolean }; callees?: { expanded?: boolean } } })[];
                }>('ghidra.callGraph', {
                    md5: state.md5,
                    entry: state.entry,
                    callersDepth: 1,
                    calleesDepth: 1,
                    expansion,
                    ...(forceRefresh ? { refresh: true } : {}),
                });
                if (generation !== owner.generation) { return; }
                const resNodes = res.nodes || [];
                const model: CallGraph = {
                    root: res.root,
                    nodes: resNodes,
                    edges: res.edges || [],
                    limited: Boolean(res.limited),
                    warnings: res.warnings || [],
                };
                const names = new Map(model.nodes.map(node => [node.id, node]));
                const nodeNames = owner.callNodeNames ||= new Map<string, string>();
                for (const node of model.nodes) { nodeNames.set(node.entry.toLowerCase(), node.name); }
                if (!model.limited) {
                    const cache = owner.callRecords ||= new Map<string, CallRecord[]>();
                    for (const node of resNodes) {
                        for (const dir of ['callers', 'callees'] as const) {
                            if (!node.branches?.[dir]?.expanded) { continue; }
                            const key = recordKey(node.entry, dir);
                            if (cache.has(key)) { continue; }
                            const rows: CallRecord[] = [];
                            for (const edge of model.edges) {
                                const peerId = dir === 'callers' ? (edge.to === node.id ? edge.from : '') : (edge.from === node.id ? edge.to : '');
                                if (!peerId) { continue; }
                                const peer = names.get(peerId);
                                if (!peer) { continue; }
                                if (edge.sites.length) {
                                    for (const site of edge.sites) { rows.push({ entry: peer.entry, name: peer.name, callSite: site }); }
                                } else {
                                    rows.push({ entry: peer.entry, name: peer.name });
                                }
                            }
                            cache.set(key, rows);
                        }
                    }
                }
                const rows: Row[] = model.edges.flatMap(edge => (edge.sites.length ? edge.sites : ['']).map(site => ({
                    cells: [names.get(edge.from)!.name, names.get(edge.to)!.name, site || 'Not reported'],
                    entry: names.get(edge.to)!.entry, address: site || names.get(edge.to)!.entry, label: names.get(edge.to)!.name, kind: 'function',
                })));
                body = await callGraph(model) + `<details class="call-details" hidden><summary>Call relationships and sites (${model.edges.length})</summary>${table(['Caller', 'Callee', 'Call site'], rows, 'Call relationships and sites')}</details>`;
                callTools = `<div class="call-controls call-icon-row" role="group" aria-label="Call graph exploration"><button id="call-center" aria-label="Center current function" title="Center current function">${callIcon('center')}</button><button id="call-focus" data-action="focusCallGraph" aria-label="Focus selected function" title="Focus selected function">${callIcon('focus')}</button><span class="call-divider" aria-hidden="true"></span><button id="call-menu-overview" aria-pressed="true" aria-label="Overview" title="Overview">${callIcon('overview')}</button><button id="call-details-toggle" aria-pressed="false" aria-label="Call sites" title="Call sites">${callIcon('details')}</button><span class="call-divider" aria-hidden="true"></span><button data-action="refresh" aria-label="Refresh graph" title="Refresh graph">${callIcon('refresh')}</button></div>`;
                scope = `${model.limited ? 'Graph limit reached; fold branches for a smaller neighborhood. ' : ''}${model.warnings.length ? `${model.warnings.length} functions could not be expanded; refresh to retry.` : ''}`;
                callName = res.rootName || names.get(model.root)?.name || displayAddress(state.entry || '');
                nodeNames.set(state.entry!.toLowerCase(), callName);
            }
        } else {
            const rendered = await this.controlFlow(state.md5, state.entry!);
            subtitle = `${rendered.name} · ${this.context.name(state.md5)}`;
            body = rendered.body; scope = rendered.scope;
        }
        if (generation !== owner.generation) { return; }
        owner.address = state.address; owner.displayAddress = state.displayAddress; owner.next = state.next;
        state.panel.webview.html = page({ title, subtitle, body, scope, scopeSummary, address, callTools, callName, callBack: !!state.callHistory?.length, state: this.snapshot(state), actions: true, graph: ['callGraph', 'controlFlow'].includes(state.kind), controlFlow: state.kind === 'controlFlow', callGraph: state.kind === 'callGraph', callView: state.callView || 'graph', viewKind: state.kind, ...(['listing', 'memory'].includes(state.kind) ? { next, previous: state.previous.length > 0 } : {}) });
    }
    /** Fetch and render the basic-block Control Flow Graph HTML for function `entry`. */
    async controlFlow(md5: string, entry: string): Promise<ControlFlowData> {
        const res = await this.call<{
            name: string;
            hasBody: boolean;
            emptyReason?: string;
            scope?: string;
            blocks?: { address: string; instructions: { address: string; length: number }[] }[];
            nodes?: GraphNode[];
            edges?: GraphEdge[];
        }>('ghidra.controlFlowGraph', { md5, entry });
        if (!res.hasBody) {
            return {
                name: res.name,
                blocks: [],
                body: `<p class="empty">${escapeHtml(res.emptyReason || 'This function has no instruction body.')}</p>`,
                scope: res.scope || '',
            };
        }
        return {
            name: res.name,
            blocks: res.blocks || [],
            body: await controlFlowGraph(res.nodes || [], res.edges || []),
            scope: res.scope || '',
        };
    }
    /** Handle interactive navigation, filtering, and graph actions posted by a workbench webview. */
    private async message(state: PanelState, message: Data): Promise<void> {
        if (await this.programViews.handleMessage(state, message)) { return; }
        const action = stringOf(message.action), address = stringOf(message.address), entry = stringOf(message.entry);
        if (address) { state.selected = address; }
        if (state.kind === 'callGraph' && ['listing', 'memory', 'references', 'controlFlow'].includes(action)) { return; }
        if (state.kind === 'callGraph' && action === 'decompile' && entry) {
            const result = await this.call<{ uri: string }>('ghidra.openFunction', { md5: state.md5, entry });
            await vscode.window.showTextDocument(vscode.Uri.parse(result.uri), { preview: false }); return;
        }

        if (state.kind === 'callGraph' && action === 'pickCallGraphFunction') {
            const chosen = await this.pickEntry(state.md5, state.entry);
            if (chosen && Array.from(this.panels.values()).includes(state)) { await this.message(state, { action: 'focusCallGraph', entry: chosen }); }
            return;
        }
        if (state.kind === 'callGraph' && action === 'callGraphView') {
            if (message.view !== 'graph' && message.view !== 'columns') { return; }
            if ((state.callView || 'graph') === message.view) { return; }
            state.callView = message.view; await this.render(state); return;
        }
        if (state.kind === 'callGraph' && state.callView === 'columns' && ['callColumnSelect', 'callColumnTrail', 'callColumnDirection'].includes(action)) {
            if (message.graphRoot !== state.entry) { return; }
            const direction = state.callColumnDirection || 'callees';
            if (action === 'callColumnDirection') {
                if (message.direction !== 'callers' && message.direction !== 'callees' || message.direction === direction) { return; }
                state.callColumnPaths ||= new Map();
                state.callColumnPaths.set(JSON.stringify([state.entry, direction]), state.callColumnPath || []);
                state.callColumnDirection = message.direction;
                state.callColumnPath = state.callColumnPaths.get(JSON.stringify([state.entry, message.direction])) || [];
            } else {
                if (message.direction !== direction) { return; }
                const index = Number(message.index), path = state.callColumnPath || [];
                if (!Number.isInteger(index) || index < 0 || index > path.length) { return; }
                if (action === 'callColumnTrail') { state.callColumnPath = path.slice(0, index); }
                else {
                    const column = state.callColumnModel?.columns[index];
                    const row = column?.rows.find(row => sameAddress(row.entry, entry));
                    if (!row || index >= columnPathLimit && row.cycleAt === undefined) { return; }
                    state.callColumnPath = row.cycleAt !== undefined ? path.slice(0, row.cycleAt) : [...path.slice(0, index), row.entry];
                }
            }
            await this.render(state); return;
        }
        if (state.kind === 'callGraph' && action === 'callGraphToggle') {
            const direction = stringOf(message.direction);
            if (!entry || message.graphRoot !== state.entry || !['callers', 'callees'].includes(direction)) { return; }
            state.callExpansion ||= { callers: [state.entry!], callees: [state.entry!] };
            const side = direction as 'callers' | 'callees';
            const values = state.callExpansion[side];
            state.callExpansion[side] = values.some(value => sameAddress(value, entry)) ? values.filter(value => !sameAddress(value, entry)) : [...values, entry];
            await this.render(state); return;
        }
        if (state.kind === 'callGraph' && ['focusCallGraph', 'callGraphBack'].includes(action)) {
            const oldRoot = state.entry!;
            state.callColumnPaths ||= new Map(); state.callColumnPaths.set(JSON.stringify([oldRoot, state.callColumnDirection || 'callees']), state.callColumnPath || []);
            state.callRoots ||= new Map(); state.callRoots.set(oldRoot, state.callExpansion || { callers: [oldRoot], callees: [oldRoot] });
            if (action === 'callGraphBack') {
                const previous = state.callHistory?.pop(); if (!previous) { return; }
                state.entry = previous; state.address = previous;
            } else {
                if (!entry || entry === state.entry) { return; }
                state.callHistory = [...(state.callHistory || []), state.entry!].slice(-20);
                state.entry = entry; state.address = entry;
            }
            state.callColumnPath = state.callColumnPaths.get(JSON.stringify([state.entry, state.callColumnDirection || 'callees'])) || [];
            state.callExpansion = state.callRoots.get(state.entry!) || { callers: [state.entry!], callees: [state.entry!] };
            await this.render(state); return;
        }
        if (action === 'refresh') { await this.refreshPanel(state); return; }
        if (action === 'next' && state.next) {
            if (state.kind === 'memory') { state.previous.push(state.address); state.address = state.next; }
            else { state.previous.push(state.displayAddress || state.address); state.cursor = state.next; }
            await this.render(state); return;
        }
        if (action === 'previous' && state.previous.length) {
            if (state.kind === 'memory') { state.address = state.previous.pop(); }
            else { state.address = state.previous.pop(); state.cursor = undefined; }
            await this.render(state); return;
        }
        if (action === 'goto') {
            if (!address.trim()) { return; }
            const resolved = await this.query(state.md5, 'address', 'resolve', { selector: { address: address.trim() } });
            if (resolved.valid === false || state.kind !== 'references' && resolved.in_memory === false) { throw new Error(`Address ${address} is not in program memory`); }
            state.address = stringOf(resolved.address) || address.trim(); state.cursor = undefined; state.previous = []; await this.render(state); return;
        }
        if (action === 'select' && address) {
            // Selecting bytes or data remains in this graphical view. Instruction/CFG selections
            // can move an already visible native decompilation editor without stealing focus.
            if (state.kind === 'listing' && message.kind === 'instruction' || state.kind === 'controlFlow' && message.kind === 'block') { await this.reveal(state.md5, address, true); }
            return;
        }
        // A call row can carry both a call-site address and a different function entry.
        // Location tools use the former; function tools use the explicit function identity.
        if (action === 'decompile' && (entry || address)) { await this.navigate(state.md5, entry || address, !!entry || message.kind === 'instruction'); return; }
        // The listing is a native virtual file; the webview table stays the program-wide browser.
        if (action === 'listing' && (address || entry)) { await vscode.commands.executeCommand('ghidraLsp.showListing', state.md5, address || entry); return; }
        if (['memory', 'references'].includes(action) && (address || entry)) { await this.open(action as WorkbenchKind, state.md5, address || entry); return; }
        if (['callGraph', 'controlFlow'].includes(action) && (entry || address)) { await this.open(action as WorkbenchKind, state.md5, entry || address); }
    }
    /** Resolve `address` and open its containing decompiler function or fallback Listing view. */
    private async navigate(md5: string, address: string, requireFunction = false): Promise<void> {
        const resolved = await this.query(md5, 'address', 'resolve', { selector: { address } });
        if (resolved.valid === false || resolved.in_memory === false) { throw new Error(`Address ${address} is not in program memory`); }
        if (object(resolved.function).entry) { await this.reveal(md5, stringOf(resolved.address) || address, false); }
        else if (requireFunction) { throw new Error(`No function contains ${address}. Use Listing or bytes to inspect this address.`); }
        else { await vscode.commands.executeCommand('ghidraLsp.showListing', md5, stringOf(resolved.address) || address); }
    }
    /** Reveal `address` inside the decompiler editor, or fall back to Listing when unmapped. */
    private async reveal(md5: string, address: string, preserveFocus: boolean): Promise<void> {
        if (preserveFocus && !vscode.window.visibleTextEditors.some(editor => editor.document.uri.scheme === 'ghidra' && editor.document.uri.authority === md5 && editor.document.uri.path.startsWith('/function/'))) { return; }
        const result = await this.call<Reveal>('ghidra.reveal', { md5, address });
        if (result.exact === false) {
            // Optimized instructions can have no source token. Keep selection-only
            // updates in place; explicit navigation must show the actual instruction.
            if (!preserveFocus) {
                await vscode.commands.executeCommand('ghidraLsp.showListing', md5, address);
                vscode.window.setStatusBarMessage(`No exact pseudocode location; showing Listing at ${address}`, 8000);
            }
            return;
        }
        const uri = vscode.Uri.parse(result.uri);
        const existing = vscode.window.visibleTextEditors.find(editor => editor.document.uri.toString() === uri.toString());
        const editor = existing || await vscode.window.showTextDocument(uri, { preserveFocus, preview: false, ...(preserveFocus ? { viewColumn: vscode.ViewColumn.Beside } : {}) });
        if (result.range) {
            const range = new vscode.Range(result.range.start.line, result.range.start.character, result.range.end.line, result.range.end.character);
            editor.selection = new vscode.Selection(range.start, range.end); editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        }
        if (!preserveFocus && existing) { await vscode.window.showTextDocument(existing.document, { viewColumn: existing.viewColumn, preview: false }); }
    }
    /** Synchronize the active text editor cursor address to visible workbench panels. */
    private async synchronize(editor: vscode.TextEditor, generation: number): Promise<void> {
        try {
            const uri = editor.document.uri;
            if (uri.scheme === 'ghidra-listing' || uri.scheme === 'ghidra-memory') {
                const companionAddr = this.editorCursorAddress?.(editor);
                if (generation === this.syncGeneration && companionAddr) {
                    await this.programViews.syncFromCodeAddress(uri.authority, companionAddr);
                }
                return;
            }
            const result = await this.call<{ md5: string; address?: string; code_unit_address?: string }>('ghidra.location', { uri: uri.toString(), position: { line: editor.selection.active.line, character: editor.selection.active.character } });
            if (generation !== this.syncGeneration || !result.address) { return; }
            await this.programViews.syncFromCodeAddress(result.md5, result.code_unit_address || result.address);
        } catch { /* Tokens without a machine address have no trustworthy selection mapping. */ }
    }
    /** Dispose all workbench panels belonging to closed program `md5`. */
    close(md5: string): void {
        for (const [key, state] of this.panels) { if (state.md5 === md5) { state.generation++; state.panel.dispose(); this.panels.delete(key); } }
    }
    /** Cancel sync timers and dispose all workbench panels and subscriptions. */
    dispose(): void {
        if (this.syncTimer) { clearTimeout(this.syncTimer); }
        this.syncGeneration++;
        for (const state of this.panels.values()) { state.panel.dispose(); }
        this.panels.clear(); this.disposables.forEach(item => item.dispose());
    }
}
