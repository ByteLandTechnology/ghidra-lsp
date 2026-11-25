// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

import { displayAddress } from './names';
import * as vscode from 'vscode';
import { countLabel, inlineText, treeAccessibility } from './a11y';
import { Call } from './memory';
import { ProgramContext, viewDescription } from './context';
import { formatFriendlyError } from './error';
import { searchStrings, StringFilterOptions } from './strings';
import { StringFiles } from './string-files';

/** Session-scoped Strings tree view backed by `ghidra_search` (`strings`). */
export class StringsView implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.Disposable {
    /** Emitter for VS Code tree refresh events. */
    private readonly changed = new vscode.EventEmitter<void>();
    /** Event fired when the Strings tree items update. */
    readonly onDidChangeTreeData = this.changed.event;
    /** VS Code tree view instance for `ghidra.strings`. */
    private readonly view: vscode.TreeView<vscode.TreeItem>;
    /** Listeners and commands owned by this tree view. */
    private readonly disposables: vscode.Disposable[];
    /** Cached tree items for the active program. */
    private nodes: vscode.TreeItem[] = [];
    /** Program MD5 currently bound to the Strings tree. */
    private md5?: string;
    /** Number of matched strings loaded for the active program. */
    private count?: number;
    /** Total strings indexed in the active program when reported by the backend. */
    private totalIndexed?: number;
    /** Active interactive search filter applied to `ghidra.strings`. */
    private filter: StringFilterOptions = {};
    /** Debounce timer used during live interactive filter typing. */
    private filterTimer?: ReturnType<typeof setTimeout>;
    /** Generation counter used to discard stale string list loads. */
    private generation = 0;
    /** True when the string list must reload the next time the view is visible. */
    private dirty = true;
    /** In-flight string list loading promise, if any. */
    private loading?: Promise<void>;

    /** Return true when any interactive string filter criterion is active. */
    private hasActiveFilter(): boolean {
        return Boolean(this.filter.query || this.filter.encoding || this.filter.defined !== undefined);
    }

    /** Format a short badge summarizing the active filter in the view header. */
    private filterSummary(): string | undefined {
        const parts: string[] = [];
        if (this.filter.query) {
            parts.push(this.filter.regex ? `/${this.filter.query}/${this.filter.caseSensitive ? '' : 'i'}` : `"${this.filter.query}"`);
        }
        if (this.filter.encoding) { parts.push(this.filter.encoding); }
        if (this.filter.defined === true) { parts.push('defined'); }
        if (!parts.length) { return undefined; }
        const ratio = this.count !== undefined && this.totalIndexed !== undefined && this.totalIndexed > this.count
            ? `${this.count}/${this.totalIndexed}` : undefined;
        return [ratio, ...parts].filter(Boolean).join(' · ');
    }

    /** Update the tree view header description and filter context key. */
    private syncDescription(): void {
        const active = this.hasActiveFilter();
        void vscode.commands.executeCommand('setContext', 'ghidra.stringsFiltered', active);
        const base = viewDescription(this.context, this.md5, active ? undefined : this.count, 'string');
        const summary = this.filterSummary();
        this.view.description = [base, summary].filter(Boolean).join(' · ') || undefined;
    }

    /** Create the Strings sidebar tree view and bind visibility, filter, and session listeners. */
    constructor(private readonly call: Call, private readonly context: ProgramContext, private readonly files: StringFiles) {
        this.view = vscode.window.createTreeView('ghidra.strings', { treeDataProvider: this });
        this.disposables = [this.changed, this.view,
            this.view.onDidChangeVisibility(event => { if (event.visible) { void this.load(); } }),
            ...(context.onDidChangeScope ? [context.onDidChangeScope(() => this.syncDescription())] : []),
            context.onDidChange(md5 => {
                this.md5 = md5;
                this.count = undefined;
                this.totalIndexed = undefined;
                this.filter = {};
                void vscode.commands.executeCommand('setContext', 'ghidra.stringsHasProgram', !!md5);
                ++this.generation;
                this.loading = undefined;
                this.dirty = true;
                this.nodes = [];
                this.view.message = undefined;
                this.syncDescription();
                this.changed.fire();
                void this.load();
            }),
            vscode.commands.registerCommand('ghidraLsp.refreshStrings', () => this.refresh(this.context.current)),
            vscode.commands.registerCommand('ghidraLsp.filterStrings', (arg?: unknown) => this.promptFilter(arg)),
            vscode.commands.registerCommand('ghidraLsp.clearStringsFilter', () => this.applyFilter({})),
            vscode.commands.registerCommand('ghidraLsp.openString', (md5: string, address: string) =>
                vscode.window.withProgress({ location: { viewId: 'ghidra.strings' } }, async () => {
                    try { await this.context.activate(md5); await this.files.open(md5, address); }
                    catch (error) { void vscode.window.showErrorMessage(formatFriendlyError(error)); }
                })),
        ];
        this.md5 = context.current;
        this.syncDescription();
        void vscode.commands.executeCommand('setContext', 'ghidra.stringsHasProgram', !!this.md5);
        void this.load();
    }

    /** Return the VS Code tree item representation for `node`. */
    getTreeItem(node: vscode.TreeItem): vscode.TreeItem { return node; }
    /** Return the current list of string or placeholder tree items. */
    getChildren(): vscode.TreeItem[] { return this.nodes; }

    /** Apply `next` filter options and reload strings from the cached search service. */
    async applyFilter(next: StringFilterOptions): Promise<void> {
        this.filter = {
            ...(next.query ? { query: next.query } : {}),
            ...(next.regex ? { regex: true } : {}),
            ...(next.caseSensitive ? { caseSensitive: true } : {}),
            ...(next.encoding ? { encoding: next.encoding } : {}),
            ...(next.defined !== undefined ? { defined: next.defined } : {}),
            ...(next.minLength !== undefined ? { minLength: next.minLength } : {}),
        };
        ++this.generation;
        this.loading = undefined;
        this.dirty = true;
        this.syncDescription();
        await this.load();
    }

    /** Open a live interactive input box that filters strings via `ghidra_search` as the user types. */
    private async promptFilter(arg?: unknown): Promise<void> {
        if (typeof arg === 'string') {
            await this.applyFilter({ ...this.filter, query: arg || undefined });
            return;
        }
        if (arg && typeof arg === 'object' && ('query' in arg || 'encoding' in arg || 'defined' in arg || 'regex' in arg)) {
            await this.applyFilter(arg as StringFilterOptions);
            return;
        }
        if (!this.md5) { return; }
        const input = vscode.window.createInputBox();
        let regex = Boolean(this.filter.regex);
        let caseSensitive = Boolean(this.filter.caseSensitive);
        let definedOnly = this.filter.defined === true;
        const regexButton: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('regex'), tooltip: 'Toggle regular expression' };
        const caseButton: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('case-sensitive'), tooltip: 'Toggle case sensitivity' };
        const definedButton: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('symbol-constant'), tooltip: 'Toggle defined strings only' };
        const clearButton: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('clear-all'), tooltip: 'Clear string filter' };
        const syncPrompt = (): void => {
            const flags = [
                regex ? 'Regex' : 'Substring',
                caseSensitive ? 'Case-sensitive' : 'Case-insensitive',
                definedOnly ? 'Defined only' : 'Defined + undefined',
            ];
            input.prompt = `${flags.join(' · ')} (cached ghidra_search)`;
            input.buttons = [regexButton, caseButton, definedButton, clearButton];
        };
        input.title = `Filter Strings · ${this.context.name(this.md5)}`;
        input.placeholder = 'Type text or regex to filter cached strings…';
        input.value = this.filter.query || '';
        syncPrompt();
        const schedule = (immediate = false): void => {
            if (this.filterTimer) { clearTimeout(this.filterTimer); this.filterTimer = undefined; }
            const run = (): void => {
                void this.applyFilter({
                    query: input.value.trim() || undefined,
                    regex,
                    caseSensitive,
                    encoding: this.filter.encoding,
                    defined: definedOnly ? true : undefined,
                });
            };
            if (immediate) { run(); } else { this.filterTimer = setTimeout(run, 120); }
        };
        input.onDidChangeValue(() => schedule(false));
        input.onDidTriggerButton(button => {
            if (button === regexButton) { regex = !regex; syncPrompt(); schedule(true); }
            else if (button === caseButton) { caseSensitive = !caseSensitive; syncPrompt(); schedule(true); }
            else if (button === definedButton) { definedOnly = !definedOnly; syncPrompt(); schedule(true); }
            else if (button === clearButton) {
                input.value = '';
                regex = false;
                caseSensitive = false;
                definedOnly = false;
                syncPrompt();
                schedule(true);
            }
        });
        input.onDidAccept(() => { schedule(true); input.hide(); });
        input.onDidHide(() => {
            if (this.filterTimer) { clearTimeout(this.filterTimer); this.filterTimer = undefined; }
            input.dispose();
        });
        input.show();
    }

    /** Mark `md5` dirty and reload strings when the view is visible. */
    async refresh(md5?: string): Promise<void> {
        if (!md5 || md5 !== this.md5) { return; }
        this.dirty = true;
        await this.load();
    }

    /** Fetch cached strings from `ghidra.strings` when the Strings view is visible and dirty. */
    private async load(): Promise<void> {
        const md5 = this.md5;
        if (!this.view.visible || !md5 || this.context.isClosing(md5) || !this.dirty) { return; }
        if (this.loading) { await this.loading; return; }
        const generation = this.generation;
        const activeFilter = { ...this.filter };
        const loading = Promise.resolve(vscode.window.withProgress({ location: { viewId: 'ghidra.strings' } }, async () => {
            try {
                const result = await searchStrings(this.call, md5, activeFilter);
                if (generation !== this.generation) { return; }
                this.nodes = result.items.map(item => {
                    const label = item.value.replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\t/g, '\\t') || '""';
                    const node = new vscode.TreeItem(label);
                    node.id = `string:${md5}:${item.address}`;
                    const parsedLength = Number(item.length);
                    const lengthLabel = item.length
                        ? (Number.isFinite(parsedLength) ? countLabel(parsedLength, 'byte') : `${item.length} bytes`)
                        : '';
                    const encLabel = item.encoding && item.encoding !== 'ascii' ? item.encoding : '';
                    node.description = [displayAddress(item.address), encLabel, lengthLabel].filter(Boolean).join(' · ');
                    node.tooltip = `${item.value}\n\n${[item.address, encLabel || item.encoding, lengthLabel, item.type, item.symbol].filter(Boolean).join(' · ')}`;
                    node.iconPath = new vscode.ThemeIcon('symbol-string');
                    node.contextValue = 'ghidra.string';
                    Object.assign(node, { md5, address: item.address });
                    node.command = { command: 'ghidraLsp.openString', title: 'Open string', arguments: [md5, item.address] };
                    node.accessibilityInformation = treeAccessibility(label, node.description, 'Open string');
                    return node;
                });
                this.count = result.items.length;
                this.totalIndexed = result.totalIndexed;
                this.syncDescription();
                this.view.message = result.indexComplete
                    ? undefined
                    : 'Analysis is running; string results reflect the partial index.';
                if (!this.nodes.length) {
                    const filtered = this.hasActiveFilter();
                    const emptyTitle = filtered ? 'No matching strings' : 'No strings found';
                    const empty = new vscode.TreeItem(emptyTitle);
                    empty.id = `strings:empty:${md5}`;
                    empty.description = filtered ? 'Clear or adjust filter' : undefined;
                    empty.iconPath = new vscode.ThemeIcon(filtered ? 'search-stop' : 'info');
                    empty.tooltip = filtered
                        ? 'No cached strings matched the current filter. Clear or adjust the filter.'
                        : 'No ASCII or UTF-16 strings were indexed in initialized program memory.';
                    if (filtered) {
                        empty.command = { command: 'ghidraLsp.clearStringsFilter', title: 'Clear string filter' };
                    }
                    empty.accessibilityInformation = treeAccessibility(
                        emptyTitle,
                        empty.description,
                        filtered ? 'No cached strings matched the current filter' : 'No ASCII or UTF-16 strings were indexed',
                    );
                    this.nodes = [empty];
                }
                this.dirty = false;
            } catch (error) {
                if (generation !== this.generation) { return; }
                const cause = formatFriendlyError(error);
                this.count = undefined;
                this.syncDescription();
                this.view.message = `Could not load strings: ${cause}`;
                const retry = new vscode.TreeItem('Retry loading strings');
                retry.id = `strings:retry:${md5}`;
                retry.description = inlineText(cause, 48);
                retry.tooltip = `Could not load strings: ${cause}\nClick to retry loading strings.`;
                retry.iconPath = new vscode.ThemeIcon('refresh');
                retry.command = { command: 'ghidraLsp.refreshStrings', title: 'Retry loading strings' };
                retry.accessibilityInformation = treeAccessibility('Retry loading strings', retry.description, cause, 'Click to refresh strings');
                this.nodes = [retry];
            }
            if (generation === this.generation) { this.changed.fire(); }
        }));
        this.loading = loading;
        try { await loading; } finally { if (this.loading === loading) { this.loading = undefined; } }
    }

    /** Cancel pending updates and dispose the tree view and listeners. */
    dispose(): void {
        ++this.generation;
        if (this.filterTimer) { clearTimeout(this.filterTimer); this.filterTimer = undefined; }
        this.disposables.forEach(item => item.dispose());
    }
}
