// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

import * as vscode from 'vscode';
import { Call } from './memory';
import { ProgramContext } from './context';
import { Data, object, rows, escape, reference, text, page, section, properties, button, iconButton, actionsMenu, code, PageExtras } from './web';
import { callIcon } from './call-graph-icons';
import { symbolName, symbolTooltip, fullSymbolName, displayTemplates } from './names';
import { formatFriendlyError } from './error';
import { highlightName } from './syntax';
import { postBusy, reportWebviewError } from './webview-focus';

/** Inspector webview category identifier. */
type PanelKind = 'program' | 'type' | 'symbol' | 'function';
/** Serialized navigation target for one inspector webview panel. */
type PanelState = { kind: PanelKind; md5: string; name?: string; path?: string; id?: string; entry?: string; typeCount?: number; };
/** Back/forward history stack entry inside an inspector panel. */
type HistoryEntry = { state: PanelState; title: string };
/** Live inspector webview panel state and history stacks. */
interface Panel { key: string; state: PanelState; panel: vscode.WebviewPanel; generation: number; title: string; back: HistoryEntry[]; forward: HistoryEntry[]; /** The object whose content is on screen, if any. */ shown?: PanelState; }
/** Maximum back/forward entries retained per inspector panel. */
const historyLimit = 50;
/** Eyebrow headings displayed for each inspector kind. */
const eyebrows: Record<PanelKind, string> = { program: 'Program overview', type: 'Data type', symbol: 'Symbol inspector', function: 'Function inspector' };
/** Codicon names used for inspector tab icons. */
const tabIcons: Record<PanelKind, string> = { program: 'file-binary', type: 'symbol-structure', symbol: 'symbol-variable', function: 'symbol-method' };
/** Pattern matching backend errors that indicate a deleted or missing resource. */
const notFound = /not found|not_found|does not exist|no such|no longer exists/i;
/** Format a numeric offset or unknown value as an uppercase hexadecimal string. */
const address = (value: unknown): string => typeof value === 'number' && value >= 0 ? `0x${value.toString(16).toUpperCase()}` : text(value);
/** Format an inclusive `[start, end]` address pair as inline HTML code spans. */
const range = (start: unknown, end: unknown): string => `${code(start)} → ${code(end)}`;
/** Omit the namespace when it is already part of a qualified title. */
const scope = (namespace: unknown, fullTitle: string): string => { const ns = text(namespace); return ns === '—' || ns === 'Global' || fullTitle.startsWith(`${ns}::`) ? '' : displayTemplates(ns); };
/** Build plain-text and HTML subtitle representations for a namespace and address pair. */
const located = (namespace: string, at: unknown): { subtitle: string; subtitleHtml: string } => ({ subtitle: [namespace, text(at)].filter(Boolean).join(' · '), subtitleHtml: [escape(namespace), code(at)].filter(Boolean).join(' · ') });
/** Return true when two panel states refer to the same inspected object. */
const sameTarget = (a: PanelState, b: PanelState): boolean => (['kind', 'md5', 'path', 'id', 'entry'] as const).every(key => a[key] === b[key]);
/** A provisional title while the first query is running; never an invented name. */
const pendingTitle = (state: PanelState): string => state.name || (state.path ? state.path.split('/').filter(Boolean).pop() : undefined) || state.entry || eyebrows[state.kind];
/** Type links read as the type's name; a non-root category follows in muted text and the full path stays in the tooltip and link value. */
function linkedType(value: unknown, home = ''): string {
    const full = reference(value);
    const suffix = /(?:\s*\*|\[[0-9]+\])+$/.exec(full)?.[0] ?? '';
    const base = full.slice(0, full.length - suffix.length);
    const slash = base.lastIndexOf('/');
    const name = slash >= 0 ? base.slice(slash + 1) : base, category = slash > 0 ? base.slice(0, slash) : '';
    if (!name) { return escape(full); }
    const label = `${escape(name)}${escape(suffix.replace(/\s+\*/g, '\u00a0*'))}`;
    return `<button class="link type-link" type="button" data-action="type" data-value="${escape(full)}" title="${escape(full)}">${label}</button>${category && category !== home ? ` <span class="type-category">${escape(category)}</span>` : ''}`;
}
/** Ghidra enum names such as USER_DEFINED read as words; the raw value stays in the tooltip. */
const enumLabel = (value: unknown): string => typeof value === 'string' && /^[A-Z][A-Z0-9_]*$/.test(value) ? `<span title="${escape(value)}">${escape(value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' '))}</span>` : escape(value ?? '—');
/** Render a definition list whose values already contain sanitized HTML. */
function linkedProperties(values: [string, string][]): string {
    return `<dl>${values.map(([label, value]) => `<div><dt>${escape(label)}</dt><dd>${value}</dd></div>`).join('')}</dl>`;
}
/** Render a table whose cells already contain sanitized HTML. */
function linkedTable(headers: string[], contents: string[][], className = ''): string { return `<div class="table-wrap ${className}"><table><thead><tr>${headers.map(label => `<th scope="col">${escape(label)}</th>`).join('')}</tr></thead><tbody>${contents.map(cells => `<tr>${cells.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`; }
/** Render the Program Overview property grid for `data` and `typeCount`. */
function programBody(data: Data, typeCount: number): string {
    return `<div id="program-project" class="program-overview">${linkedProperties([
            ['Architecture', escape(data.language_id ?? '—')], ['Compiler', escape(data.compiler_spec_id ?? '—')], ['Image base', code(data.image_base)],
            ['Address range', range(data.min_address, data.max_address)],
            ['Functions', escape(data.function_count ?? '—')], ['Symbols', escape(data.symbol_count ?? '—')], ['Data types', escape(typeCount)],
            ['Project name', escape(data.name ?? '—')], ['Imported binary', code(data.executable_path)],
        ])}</div>`;
}
/** Return true when `field` is an unnamed undefined padding byte entry. */
const isFiller = (field: Data): boolean => field.is_undefined === true && !field.name && !field.comment && typeof field.offset === 'number' && typeof field.length === 'number' && /(?:^|\/)undefined\d*$/i.test(reference(field.data_type));
/** Runs of anonymous undefined filler collapse into one row, so large structs stay readable and keyboard-traversable. */
function fieldRows(fields: Data[], hasNotes: boolean, notes: string[], home = ''): string[][] {
    const result: string[][] = [];
    for (let index = 0; index < fields.length;) {
        let end = index;
        while (end + 1 < fields.length && isFiller(fields[index]) && isFiller(fields[end + 1]) && Number(fields[end + 1].offset) === Number(fields[end].offset) + Number(fields[end].length)) { end++; }
        if (end > index) {
            const start = Number(fields[index].offset), length = Number(fields[end].offset) + Number(fields[end].length) - start;
            result.push([`<span class="nowrap">${code(address(start))}–${code(address(start + length - 1))}</span>`, escape(length), '', `<span class="hint">${end - index + 1} × undefined</span>`, ...(hasNotes ? [''] : [])]);
        } else {
            const field = fields[index];
            result.push([code(address(field.offset)), escape(field.length), escape(field.name || (field.is_undefined === true ? '' : '(unnamed)')), linkedType(field.data_type, home), ...(hasNotes ? [escape(notes[index])] : [])]);
        }
        index = end + 1;
    }
    return result;
}
/** Return true when `data` represents a type kind supported by the bridge editors. */
const isEditable = (data: Data): boolean => ['struct', 'structure', 'union', 'enum', 'function', 'function_definition'].includes(String(data.kind).toLowerCase());
/** Format a data type's byte length or variable-size description. */
function typeSize(data: Data): string {
    const length = data.length ?? data.size;
    return typeof length === 'number' && length >= 0 ? `${length} bytes` : length == null ? 'Unknown size' : 'Variable / unknown size';
}
/** Render the body HTML sections for a data type inspector panel. */
function typeBody(data: Data): string {
    const kind = String(data.kind).toLowerCase();
    // Types in the inspected type's own category need no category hint.
    const path = text(data.path), home = path.lastIndexOf('/') > 0 ? path.slice(0, path.lastIndexOf('/')) : '';
    let body = '';
    const genericSignatureDescription = ['function', 'function_definition'].includes(kind) && /^function signature data type$/i.test(String(data.description ?? '').trim());
    if (data.description && !genericSignatureDescription) { body += `<details><summary>Description</summary><div class="description">${escape(data.description)}</div></details>`; }
    if (data.base_type) { body += `<div class="type-base">${linkedProperties([['Base type', linkedType(data.base_type, home)]])}</div>`; }
    const fields = rows(data.fields);
    if (fields.length) {
        const notes = fields.map(field => String(field.comment || (field.is_undefined === true && !/(?:^|\/)undefined\d*$/i.test(reference(field.data_type)) ? 'Undefined' : '')));
        const hasNotes = notes.some(Boolean);
        body += `<section class="type-members" aria-label="Fields">${linkedTable(
            ['Offset', 'Bytes', 'Name', 'Type', ...(hasNotes ? ['Notes'] : [])],
            fieldRows(fields, hasNotes, notes, home),
            'type-fields',
        )}</section>`;
    }
    const values = rows(data.values);
    if (values.length) { const hasComments = values.some(value => value.comment); body += linkedTable(['Name', 'Value', ...(hasComments ? ['Comment'] : [])], values.map(value => [escape(value.name), code(value.value), ...(hasComments ? [escape(value.comment || '')] : [])])); }
    if (data.signature) {
        if (typeof data.signature === 'string') { body += section('Function signature', `<p>${escape(data.signature)}</p>`); }
        else {
            const signature = object(data.signature);
            const parameters = rows(signature.parameters);
            body += section('Function signature', linkedProperties([['Return type', linkedType(signature.return_type)], ...(parameters.length ? [] : [['Parameters', 'None'] as [string, string]])])
                + (parameters.length ? linkedTable(['Parameter', 'Type'], parameters.map(param => [escape(param.name || '(unnamed)'), linkedType(param.data_type)])) : ''))
                + `<details><summary>Signature details</summary>${properties([
                    ['Calling convention', signature.calling_convention ?? '—'],
                    ['Variadic', signature.has_var_args === true ? 'Yes' : 'No'], ['No return', signature.has_no_return === true ? 'Yes' : 'No'],
                ])}</details>`;
        }
    }
    return body;
}

/** Graphical inspectors retain their program identity across focus changes and restarts. */
export class Details implements vscode.Disposable {
    /** Active inspector panels keyed by `kind:md5`. */
    private readonly panels = new Map<string, Panel>();
    /** Registered serializers, commands, and context listeners. */
    private readonly disposables: vscode.Disposable[] = [];
    /** Register panel serializers, title-scope listeners, and type/function detail commands. */
    constructor(private readonly call: Call, private readonly context: ProgramContext) {
        for (const viewType of ['ghidra.programOverview', 'ghidra.dataType', 'ghidra.symbolDetails', 'ghidra.functionDetails']) {
            this.disposables.push(vscode.window.registerWebviewPanelSerializer(viewType, { deserializeWebviewPanel: async (panel, raw) => {
                const data = object(raw);
                if (!['program', 'type', 'symbol', 'function'].includes(String(data.kind)) || typeof data.md5 !== 'string' || !/^[0-9a-f]{32}$/i.test(data.md5)) { panel.dispose(); return; }
                const state = data as unknown as PanelState;
                const item = this.attach(panel, state);
                try { await this.render(item); if (panel.active) { await context.activate(state.md5); } } catch (error) { this.failure(item, error); }
            } }));
        }
        this.disposables.push(
            this.context.onDidChangeScope(() => {
                for (const item of this.panels.values()) {
                    item.panel.title = this.context.titled(item.title, item.state.md5);
                }
            }),
            vscode.commands.registerCommand('ghidraLsp.inspectType', async (candidate?: unknown) => {
            try {
                const resource = object(candidate);
                const editor = vscode.window.activeTextEditor;
                const scopedUri = resource.uri instanceof vscode.Uri ? resource.uri : typeof resource.uri === 'string' ? vscode.Uri.parse(resource.uri) : undefined;
                const uri = scopedUri || editor?.document.uri;
                if (!uri || uri.scheme !== 'ghidra') { throw new Error('Place the cursor on a variable or type in a Ghidra function.'); }
                if (typeof resource.md5 === 'string' && resource.md5.toLowerCase() !== uri.authority.toLowerCase()) { throw new Error('The type inspection resource belongs to a different Ghidra program.'); }
                let position: { line: number; character: number };
                if (scopedUri) {
                    const scoped = object(resource.position);
                    if (typeof scoped.line !== 'number' || !Number.isSafeInteger(scoped.line) || scoped.line < 0 || typeof scoped.character !== 'number' || !Number.isSafeInteger(scoped.character) || scoped.character < 0) { throw new Error('The type inspection resource has no valid source position.'); }
                    position = { line: scoped.line, character: scoped.character };
                } else {
                    if (!editor) { throw new Error('Place the cursor on a variable or type in a Ghidra function.'); }
                    position = { line: editor.selection.active.line, character: editor.selection.active.character };
                }
                const result = await call<{ md5: string; type: Data } | null>('ghidra.typeAtPosition', { uri: uri.toString(), position });
                if (!result || typeof result.type.path !== 'string') { throw new Error('No resolved data type is available at this position.'); }
                if (result.md5.toLowerCase() !== uri.authority.toLowerCase()) { throw new Error('The resolved data type belongs to a different Ghidra program.'); }
                await vscode.commands.executeCommand('ghidraLsp.browseType', result.md5, result.type.path);
            } catch (error) { void vscode.window.showErrorMessage(formatFriendlyError(error)); }
        }), vscode.commands.registerCommand('ghidraLsp.functionDetails', async (candidate?: unknown, entry?: string) => {
            try {
                const md5 = this.context.require(candidate);
                const editor = vscode.window.activeTextEditor;
                entry ||= typeof object(candidate).entry === 'string' ? String(object(candidate).entry) : undefined;
                entry ||= editor?.document.uri.scheme === 'ghidra' && editor.document.uri.authority === md5 && editor.document.uri.path.startsWith('/function/') ? decodeURIComponent(editor.document.uri.path.slice('/function/'.length)) : undefined;
                if (!entry) { throw new Error('Open a function or select it in the program browser first.'); }
                await this.function(md5, entry);
            } catch (error) { void vscode.window.showErrorMessage(formatFriendlyError(error)); }
        }));
    }
    /** Execute a backend read query for `md5` through `ghidra.query`. */
    private query<T = Data>(md5: string, domain: string, operation: string, params: Data = {}, all = false): Promise<T> { return this.call<T>('ghidra.query', { md5, domain, operation, params, all }); }
    /** One inspector tab per kind and program; following links navigates inside it with Back/Forward history. */
    private key(state: PanelState): string { return `${state.kind}:${state.md5}`; }
    /** Wire webview options, lifecycle hooks, and message handlers onto `panel`. */
    private attach(panel: vscode.WebviewPanel, state: PanelState): Panel {
        panel.webview.options = { enableScripts: true, localResourceRoots: [] };
        try { panel.iconPath = new vscode.ThemeIcon(tabIcons[state.kind]); } catch { /* Older hosts accept only URI icons; the tab keeps its default. */ }
        const item: Panel = { key: this.key(state), panel, state, generation: 0, title: pendingTitle(state), back: [], forward: [] };
        this.panels.set(item.key, item);
        panel.onDidDispose(() => { if (this.panels.get(item.key) === item) { this.panels.delete(item.key); } });
        panel.onDidChangeViewState(event => { if (event.webviewPanel.active) { void this.context.activate(item.state.md5).catch(error => vscode.window.showErrorMessage(formatFriendlyError(error))); } });
        panel.webview.onDidReceiveMessage(async raw => {
            const message = object(raw);
            this.origin = item;
            try { await this.action(item, String(message.action), typeof message.value === 'string' ? message.value : undefined); }
            catch (error) { await reportWebviewError(panel, formatFriendlyError(error), msg => void vscode.window.showErrorMessage(msg)); }
            finally { if (this.origin === item) { this.origin = undefined; } }
        });
        return item;
    }
    /** The inspector that triggered the current navigation, if any. */
    private origin: Panel | undefined;
    /** Inspectors open beside the code, grouped with any existing inspector of the same program; the overview is the landing view. */
    private column(state: PanelState): vscode.ViewColumn {
        if (state.kind === 'program') { return vscode.ViewColumn.Active; }
        if (this.origin?.panel.viewColumn) { return this.origin.panel.viewColumn; }
        for (const item of this.panels.values()) { if (item.state.md5 === state.md5 && item.state.kind !== 'program' && item.panel.viewColumn) { return item.panel.viewColumn; } }
        return vscode.ViewColumn.Beside;
    }
    /** Reveal an existing inspector panel or create a new one for `state`. */
    private async show(state: PanelState): Promise<void> {
        const fromCode = !this.origin;
        const existing = this.panels.get(this.key(state));
        if (existing) {
            if (!sameTarget(existing.state, state)) { existing.back = [...existing.back, { state: existing.state, title: existing.title }].slice(-historyLimit); existing.forward = []; }
            await this.navigate(existing, state);
            existing.panel.reveal(existing.panel.viewColumn, fromCode && existing !== this.origin);
            return;
        }
        const viewType = { program: 'ghidra.programOverview', type: 'ghidra.dataType', symbol: 'ghidra.symbolDetails', function: 'ghidra.functionDetails' }[state.kind];
        const panel = vscode.window.createWebviewPanel(viewType, this.context.titled(pendingTitle(state), state.md5), { viewColumn: this.column(state), preserveFocus: fromCode && state.kind !== 'program' }, { enableScripts: true, localResourceRoots: [], retainContextWhenHidden: true });
        const item = this.attach(panel, state);
        panel.webview.html = page(item.title, eyebrows[state.kind], '', '', '', {}, '', { busy: true });
        // Failures render in the panel itself; a toast on top would report the same problem twice.
        try { await this.render(item); } catch (error) { this.failure(item, error); return; }
        await this.context.activate(state.md5);
    }
    /** Keep the current content visible while the next object loads, then swap it in. */
    private async navigate(item: Panel, state: PanelState): Promise<void> {
        item.state = state;
        postBusy(item.panel);
        try { await this.render(item); } catch (error) { this.failure(item, error); }
    }
    /** Move backward or forward one step in the inspector panel's history stack. */
    private async travel(item: Panel, direction: 'back' | 'forward'): Promise<void> {
        const from = direction === 'back' ? item.back : item.forward, to = direction === 'back' ? item.forward : item.back;
        const entry = from.pop();
        if (!entry) { return; }
        to.push({ state: item.state, title: item.title });
        await this.navigate(item, entry.state);
    }
    /** Render Back/Forward navigation buttons when history entries exist. */
    private nav(item: Panel): string {
        const back = item.back.at(-1), forward = item.forward.at(-1);
        if (!back && !forward) { return ''; }
        const control = (action: 'back' | 'forward', entry: HistoryEntry | undefined): string => {
            const verb = action === 'back' ? 'Back' : 'Forward', key = action === 'back' ? 'Alt+Left' : 'Alt+Right';
            const label = entry ? `${verb} to ${entry.title}` : `${verb} (no history)`;
            return `<button class="icon-button" type="button" data-action="${action}" aria-label="${escape(label)}" title="${escape(entry ? `${label} (${key})` : label)}"${entry ? '' : ' disabled'}>${callIcon(action)}</button>`;
        };
        return control('back', back) + control('forward', forward);
    }
    /** Display a non-destructive error banner or full recovery page when loading `item` fails. */
    private failure(item: Panel, error: unknown): void {
        const state = item.state, program = this.context.name(state.md5);
        const missing = state.kind !== 'program' && notFound.test(String(error));
        // A failed refresh of the object already on screen keeps its content and reports above it.
        if (!missing && item.shown && sameTarget(item.shown, state)) { void reportWebviewError(item.panel, formatFriendlyError(error), msg => void vscode.window.showErrorMessage(msg)); return; }
        // The heading names the object that failed, never the one navigated away from.
        item.shown = undefined;
        item.title = pendingTitle(state); item.panel.title = this.context.titled(item.title, state.md5);
        const message = missing ? `This ${eyebrows[state.kind].replace(/ inspector$/, '').toLowerCase()} no longer exists in ${program}.` : formatFriendlyError(error);
        const recovery = missing ? (item.back.length ? button(`Back to ${item.back.at(-1)!.title}`, 'back', undefined, 'primary') : '') : button('Retry', 'refresh', undefined, 'primary');
        const where = state.path || state.entry || '';
        item.panel.webview.html = page(item.title, eyebrows[state.kind], where ? `${program} · ${where}` : program, recovery ? `<div class="recovery">${recovery}</div>` : '', '', state, '', { nav: this.nav(item), error: message, subtitleHtml: where ? `${escape(program)} · ${code(where)}` : escape(program) });
    }
    /** Query the server for `item.state` and render its inspector webview HTML. */
    private async render(item: Panel): Promise<void> {
        const generation = ++item.generation; const state = item.state; let title: string, subtitle = '', body: string, actions = '';
        const extras: PageExtras = {};
        const eyebrow = eyebrows[state.kind];
        if (state.kind === 'program') {
            const data = await this.call<Data>('ghidra.program', { md5: state.md5 });
            const typeCount = typeof data.data_type_count === 'number' ? data.data_type_count
                : typeof state.typeCount === 'number' && state.typeCount >= 0 ? state.typeCount
                : (await this.call<{ items: unknown[] }>('ghidra.types', { md5: state.md5 })).items.length;
            title = state.name || String(data.name); body = programBody(data, typeCount);
        } else if (state.kind === 'type') {
            const data = await this.call<Data>('ghidra.type', { md5: state.md5, path: state.path });
            title = String(data.name); body = typeBody(data);
            // One line carries category, kind, size and access; the full path stays in the tooltip.
            const path = text(data.path), slash = path.lastIndexOf('/'), category = slash > 0 ? path.slice(0, slash) : '';
            const meta = [escape(data.kind ?? '—'), escape(typeSize(data)), ...(isEditable(data) ? [] : ['Read-only'])];
            subtitle = [category, ...meta].filter(Boolean).join(' · ');
            extras.subtitleHtml = [category ? `<span title="${escape(path)}">${escape(category)}</span>` : '', ...meta].filter(Boolean).join(' · ');
            const editable = ['struct', 'structure', 'union', 'enum', 'function', 'function_definition'].includes(String(data.kind).toLowerCase());
            actions = (editable ? iconButton('edit', 'Edit type', 'editType') : iconButton('type', 'Apply to data', 'applyType')) + actionsMenu(iconButton('refresh', 'Refresh', 'refresh') + (editable ? iconButton('type', 'Apply to data', 'applyType') : '') + iconButton('trash', 'Delete type', 'deleteType', undefined, 'danger'));
        } else if (state.kind === 'symbol') {
            const symbol = await this.query(state.md5, 'symbol', 'get', { selector: { id: state.id } });
            title = symbolName(symbol, true); extras.titleHtml = highlightName(title);
            ({ subtitle, subtitleHtml: extras.subtitleHtml } = located(scope(symbol.namespace, fullSymbolName(symbol, true)), symbol.address)); if (text(symbol.namespace) === 'Global') { subtitle = `Global · ${text(symbol.address)}`; }
            if (symbol.demangled_name || fullSymbolName(symbol, true) !== title) { extras.titleHint = symbolTooltip(symbol); }
            const isFunction = String(symbol.type).toLowerCase() === 'function';
            actions = iconButton('edit', 'Edit symbol', 'editSymbol') + actionsMenu((isFunction ? iconButton('decompile', 'Decompile function', 'decompile', symbol.address) : '') + iconButton('refresh', 'Refresh', 'refresh') + iconButton('type', 'Apply type', 'applyType', symbol.address) + iconButton('comment', 'Edit comment', 'comment', symbol.address));
            const symbolProperties: [string, string][] = [['Kind', escape(symbol.type ?? '—')], ['Source', enumLabel(symbol.source_type)], ['Primary', symbol.primary === true ? 'Yes' : 'No']];
            if (symbol.demangled_name) { symbolProperties.push(['Mangled name', code(symbol.name)]); }
            body = '';
            let symbolDetails = linkedProperties(symbolProperties);
            let global: Data | undefined;
            try { global = await this.query(state.md5, 'global_variable', 'get', { selector: { address: symbol.address } }); }
            catch (error) { body += `<p class="hint">${escape(/not found|not_found|does not exist|not a defined|not defined/i.test(String(error)) ? 'No defined data starts at this symbol.' : `Data unavailable: ${formatFriendlyError(error)}`)}</p>`; }
            if (global) {
                const dataProperties: [string, string][] = [
                    ...(global.representation != null && global.value != null && String(global.representation) !== String(global.value) ? [['Representation', code(global.representation)] as [string, string]] : []),
                    ['Length', escape(`${text(global.length)} bytes`)],
                ];
                try {
                    const memory = await this.query(state.md5, 'memory', 'read', { selector: { address: symbol.address }, length: Math.max(1, Math.min(Number(global.length) || 32, 256)), encoding: 'hex' });
                    const bytes = object(memory.bytes);
                    const partial = bytes.length != null && global.length != null && Number.isFinite(Number(bytes.length)) && Number.isFinite(Number(global.length)) && Number(bytes.length) < Number(global.length);
                    dataProperties.push(['Memory bytes', `<span class="hex" title="Analysis memory">${escape(String(bytes.data || '').replace(/(.{2})/g, '$1 ').trim())}</span>${partial ? `<span class="hint"> (first ${escape(bytes.length)} bytes)</span>` : ''}`]);
                } catch (error) { dataProperties.push(['Memory bytes', `<span class="hint">Unavailable: ${escape(formatFriendlyError(error))}</span>`]); }
                const shown = code(global.value ?? global.representation);
                body += `<div class="symbol-value">${linkedProperties([['Data type', linkedType(global.data_type)], ['Value', shown]])}</div>`;
                symbolDetails += `<h2 class="detail-heading">Data</h2>${linkedProperties(dataProperties)}`;
            }
            body += `<details id="symbol-details"><summary>Symbol details</summary>${symbolDetails}</details>`;
        } else {
            const fn = await this.query(state.md5, 'function', 'get', { selector: { entry: state.entry } });
            title = symbolName(fn, true); extras.titleHtml = highlightName(title);
            ({ subtitle, subtitleHtml: extras.subtitleHtml } = located(scope(fn.namespace, fullSymbolName(fn, true)), fn.entry)); if (text(fn.namespace) === 'Global') { subtitle = `Global · ${text(fn.entry)}`; }
            if (fn.demangled_name || fullSymbolName(fn, true) !== title) { extras.titleHint = symbolTooltip(fn); }
            actions = iconButton('decompile', 'Decompile', 'decompile', fn.entry) + actionsMenu(iconButton('refresh', 'Refresh', 'refresh') + iconButton('function', 'Edit signature', 'editFunction') + iconButton('symbol', 'Edit variables', 'editVariables') + iconButton('comment', 'Edit comment', 'comment', fn.entry));
            const params = rows(fn.parameters);
            const locals = rows(fn.local_variables);
            const storage = (variable: Data): string => { const raw = object(variable.storage), name = raw.register || raw.serialization; return `<code class="mono"${raw.register && raw.serialization ? ` title="${escape(raw.serialization)}"` : ''}>${escape(text(name))}</code>`; };
            body = `<div class="function-definition">${linkedProperties([['Return type', linkedType(fn.return_type)], ...(params.length ? [] : [['Parameters', 'None'] as [string, string]])])}</div>`
                + (params.length ? section('Parameters', `<div class="parameters">${linkedProperties(params.map(param => [escape(param.name), `${linkedType(param.data_type)}<span class="param-storage"> · ${storage(param)}</span>`]))}</div>`) : '')
                + `<details id="function-details"><summary>Function details</summary>${linkedProperties([
                    ...(fn.demangled_name ? [['Mangled name', code(fn.name)] as [string, string]] : []),
                    ['Calling convention', escape(fn.calling_convention ?? '—')],
                    ['Body', range(object(fn.body).start, object(fn.body).end)],
                    ['Variadic', fn.has_var_args === true ? 'Yes' : 'No'],
                    ['Does not return', fn.has_no_return === true ? 'Yes' : 'No'], ['Inline', fn.is_inline === true ? 'Yes' : 'No'],
                ])}
                ${locals.length ? section('Local variables', linkedTable(['Name', 'Type', 'Storage'], locals.map(variable => [escape(variable.name), linkedType(variable.data_type), storage(variable)]))) : ''}</details>`;
            if (fn.comment) { body += section('Comment', `<div class="description">${escape(fn.comment)}</div>`); }
        }
        if (generation !== item.generation) { return; }
        item.title = title; item.shown = state;
        item.panel.title = this.context.titled(title, state.md5);
        item.panel.webview.html = page(title, eyebrow, subtitle, body, '', state, actions, { ...extras, nav: this.nav(item) });
    }
    /** Dispatch button, link, and history actions posted by an inspector webview. */
    private async action(item: Panel, action: string, value?: string): Promise<void> {
        const state = item.state; const md5 = state.md5;
        if (action === 'back' || action === 'forward') { await this.travel(item, action); return; }
        if (action === 'refresh') { await this.navigate(item, state); return; }
        if (action === 'type' && value) {
            // Follow nested array/pointer types to the named base type without guessing among ambiguous names.
            const base = value.replace(/\[[0-9]+\]/g, '').replace(/\*/g, '').trim();
            // A category path is already an exact identity; open it without listing every type.
            if (base.startsWith('/')) { await vscode.commands.executeCommand('ghidraLsp.browseType', md5, base); return; }
            const result = await this.call<{ items: Data[] }>('ghidra.types', { md5 });
            const exact = result.items.find(type => type.path === base);
            const candidates = exact ? [exact] : result.items.filter(type => type.name === base);
            const target = candidates.length === 1 ? candidates[0] : (await vscode.window.showQuickPick(candidates.map(type => ({ label: String(type.name), description: String(type.path), type })), { title: 'Choose referenced data type' }))?.type;
            if (!target) { throw new Error(`The bridge did not expose a unique type for ${base}.`); }
            await vscode.commands.executeCommand('ghidraLsp.browseType', md5, String(target.path)); return;
        }
        if (action === 'decompile' && value) { await vscode.commands.executeCommand('ghidraLsp.browseFunction', md5, value); return; }
        const commands: Record<string, [string, unknown[]]> = {
            editType: ['editType', [md5, state.path]], deleteType: ['deleteType', [md5, state.path]],
            applyType: ['applyType', [md5, state.path, value]], editSymbol: ['editSymbol', [md5, state.id]], editFunction: ['editFunction', [md5, state.entry]], editVariables: ['editVariables', [md5, state.entry]], comment: ['editComment', [md5, value]],
        };
        const command = commands[action]; if (command) { await vscode.commands.executeCommand(`ghidraLsp.${command[0]}`, ...command[1]); }
    }
    /** Open or focus the Program Overview panel for `md5`. */
    async program(md5: string, name: string, typeCount: number): Promise<void> { await this.show({ kind: 'program', md5, name, typeCount }); }
    /** Open or focus the Data Type inspector panel for `path`. */
    async type(md5: string, path: string): Promise<void> { await this.show({ kind: 'type', md5, path }); }
    /** Open or focus the Symbol inspector panel for symbol `id`. */
    async symbol(md5: string, id: string): Promise<void> { await this.show({ kind: 'symbol', md5, id }); }
    /** Open or focus the Function inspector panel for function `entry`. */
    async function(md5: string, entry: string): Promise<void> { await this.show({ kind: 'function', md5, entry }); }
    /** Reload all open inspector panels belonging to program `md5`. */
    async refresh(md5: string, typeCount?: number): Promise<void> {
        for (const item of this.panels.values()) {
            if (item.state.md5 === md5) {
                if (item.state.kind === 'program') {
                    item.state = { ...item.state, typeCount: typeof typeCount === 'number' && typeCount >= 0 ? typeCount : undefined };
                }
                try { await this.render(item); } catch (error) { this.failure(item, error); }
            }
        }
    }
    /** Dispose all inspector panels belonging to closed program `md5`. */
    close(md5: string): void { for (const item of this.panels.values()) { if (item.state.md5 === md5) { item.panel.dispose(); } } }
    /** Dispose all open inspector panels and command registrations. */
    dispose(): void { this.panels.forEach(item => item.panel.dispose()); this.panels.clear(); this.disposables.forEach(item => item.dispose()); }
}
