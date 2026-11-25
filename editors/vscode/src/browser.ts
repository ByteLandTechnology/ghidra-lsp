// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

import * as vscode from 'vscode';
import {
    canonicalTreeSegment,
    functionNodeAccessibility,
    namespaceFolderAccessibility,
    symbolGroupAccessibility,
    symbolNodeAccessibility,
    typeCategoryAccessibility,
    typeNodeAccessibility,
} from './a11y';
import { symbolName, symbolTooltip, splitScope, displayTemplates, displayAddress } from './names';
import { Call } from './memory';
import { Details } from './details';
import { ProgramContext, viewDescription } from './context';
import { formatFriendlyError } from './error';

/** Program symbol summary returned by `ghidra.symbols`. */
interface SymbolInfo { demangled_name?: string; id: string; name: string; namespace: string; address: string; type: string }
/** Data type summary returned by `ghidra.types`. */
interface TypeInfo { name: string; path: string; category_path?: string; kind: string }
/** Sidebar tree item node representing a namespace, function, symbol, or data type. */
class Node extends vscode.TreeItem {
    /** Parent namespace or category folder node. */
    parent?: Node;
    /** Canonical identity segment preserved when visual labels elide C++ template arguments. */
    key?: string;
    /** Construct one sidebar tree item with optional child nodes and Ghidra target metadata. */
    constructor(label: string, readonly children?: Node[], readonly md5?: string, readonly entry?: string, readonly path?: string, readonly symbolId?: string, readonly namespace?: string) {
        super(label, children ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
    }
}
/** Group symbol or function nodes into nested C++ namespace folder nodes. */
function namespaces(nodes: Node[]): Node[] {
    const roots: Node[] = [];
    const scopes = new Map<Node, { segment: string; parentScope: string }>();
    for (const node of nodes) {
        let siblings = roots;
        let parentScope = '';
        for (const segment of splitScope(node.namespace || '').filter(part => part && part !== 'Global')) {
            const key = canonicalTreeSegment('namespace', segment);
            // Folders keep the full segment as identity, so distinct instantiations never merge under one `Name<…>` label.
            let folder = siblings.find(item => item.key === key && item.children);
            if (!folder) {
                folder = new Node(displayTemplates(segment), []);
                folder.key = key;
                folder.tooltip = segment;
                folder.iconPath = new vscode.ThemeIcon('symbol-namespace');
                folder.contextValue = 'ghidra.namespace';
                scopes.set(folder, { segment, parentScope });
                siblings.push(folder);
            }
            parentScope = parentScope ? `${parentScope}::${segment}` : segment;
            siblings = folder.children!;
        }
        siblings.push(node);
    }
    const sort = (children: Node[]): void => {
        children.sort((a, b) => Number(!!b.children) - Number(!!a.children)
            || String(a.label).localeCompare(String(b.label))
            || (a.key || a.id || '').localeCompare(b.key || b.id || ''));
        for (const child of children) {
            if (child.children) {
                const scope = scopes.get(child);
                if (scope) { child.accessibilityInformation = namespaceFolderAccessibility(scope.segment, scope.parentScope, child.children.length); }
                sort(child.children);
            }
        }
    };
    sort(roots);
    return roots;
}
/** In-memory tree data provider backing the Symbols and Data Types views. */
class Tree implements vscode.TreeDataProvider<Node> {
    /** Emitter for tree refresh notifications. */
    private readonly changed = new vscode.EventEmitter<void>();
    /** Event fired when the tree root nodes update. */
    readonly onDidChangeTreeData = this.changed.event;
    /** Top-level tree nodes for this provider. */
    roots: Node[] = [];
    /** Return the VS Code tree item representation for `node`. */
    getTreeItem(node: Node): vscode.TreeItem { return node; }
    /** Return the children of `node`, or top-level roots when `node` is omitted. */
    getChildren(node?: Node): Node[] { return node ? (node.children || []) : this.roots; }
    /** Return the parent folder node of `node` so `TreeView.reveal` can expand ancestors. */
    getParent(node: Node): Node | undefined { return node.parent; }
    /** Attach parent pointers, ensure unique node IDs, and refresh the tree view. */
    update(nodes: Node[]): void {
        const used = new Map<string, number>();
        const attach = (children: Node[], parent?: Node): void => {
            for (const node of children) {
                node.parent = parent;
                const base = node.id || `${parent?.id || ''}/${node.key ?? encodeURIComponent(String(node.label))}`;
                const count = (used.get(base) || 0) + 1;
                used.set(base, count);
                node.id = count === 1 ? base : `${base}#${count}`;
                if (node.children) { attach(node.children, node); }
            }
        };
        attach(nodes);
        this.roots = nodes; this.changed.fire();
    }
    /** Dispose the tree change emitter. */
    dispose(): void { this.changed.dispose(); }
}

/** Whole-program navigation with graphical program and type details. */
/** A sidebar click shows the view's native progress bar until its editor opens, and reports failures. */
async function busy(viewId: string, task: () => Promise<void>): Promise<void> {
    await vscode.window.withProgress({ location: { viewId } }, async () => {
        try { await task(); } catch (error) { void vscode.window.showErrorMessage(formatFriendlyError(error)); }
    });
}

/** Ghidra prints non-memory locations as `EXTERNAL:…`, `Stack[…]` or register names. */
function isMemoryAddress(address?: string): address is string {
    return !!address && !/^(?:EXTERNAL|Stack|register|const|unique|OTHER):/i.test(address) && /[\da-f]{2,}$/i.test(address);
}

/** Coordinates the Symbols and Data Types sidebar trees and inspector details panels. */
export class ProgramBrowser implements vscode.Disposable {
    /** Tree provider for functions and symbols. */
    private readonly symbols = new Tree();
    /** Tree provider for project data types. */
    private readonly types = new Tree();
    /** Registered tree views, commands, and event subscriptions. */
    private readonly disposables: vscode.Disposable[] = [];
    /** Program MD5 currently displayed in the sidebar trees. */
    private md5?: string;
    /** Webview inspector manager for program, symbol, and type details. */
    private readonly details: Details;
    /** Loaded data type count for the current program. */
    private typeCount = 0;
    /** Loaded `[symbolCount, typeCount]` tuple shown in tree view descriptions. */
    private loadedCounts?: [number, number];
    /** Generation counter used to discard stale tree loads. */
    private generation = 0;
    /** In-flight tree loading promise, if any. */
    private loading?: Promise<void>;
    /** Emitter fired before refreshing program views and documents. */
    private readonly willRefresh = new vscode.EventEmitter<string>();
    /** Event fired when a program refresh starts. */
    readonly onWillRefresh = this.willRefresh.event;
    /** In-flight refresh promises keyed by lowercase MD5. */
    private readonly refreshing = new Map<string, Promise<void>>();
    /** Update symbol and type tree header descriptions with counts and program names. */
    private syncDescriptions(): void {
        this.views[0].description = viewDescription(this.context, this.md5, this.loadedCounts?.[0]);
        this.views[1].description = viewDescription(this.context, this.md5, this.loadedCounts?.[1]);
    }
    /** Create the Symbols and Data Types tree views and register browser commands. */
    constructor(private readonly call: Call, private readonly context: ProgramContext, private readonly refreshDocuments: (md5: string) => Promise<void> = async () => {}) {
        void vscode.commands.executeCommand('setContext', 'ghidra.browserHasProgram', !!context.current);
        this.details = new Details(call, context);
        const symbolView = vscode.window.createTreeView('ghidra.symbols', { treeDataProvider: this.symbols, showCollapseAll: true });
        const typeView = vscode.window.createTreeView('ghidra.types', { treeDataProvider: this.types, showCollapseAll: true });
        this.disposables.push(this.symbols, this.types, this.willRefresh, symbolView, typeView,
            this.details,
            ...(context.onDidChangeScope ? [context.onDidChangeScope(() => this.syncDescriptions())] : []),
            vscode.window.onDidChangeActiveTextEditor(() => { void this.revealActiveFunction().catch(console.error); }),
            symbolView.onDidChangeVisibility(event => { if (event.visible) { void this.revealActiveFunction().catch(console.error); } }),
            vscode.commands.registerCommand('ghidraLsp.browseFunction', (md5: string, entry: string) => busy('ghidra.symbols', async () => {
                await context.activate(md5);
                const result = await call<{ uri: string }>('ghidra.openFunction', { md5, entry });
                await vscode.window.showTextDocument(vscode.Uri.parse(result.uri), { preview: false });
            })),
            vscode.commands.registerCommand('ghidraLsp.browseAddress', (md5: string, address: string) => busy('ghidra.symbols', async () => {
                await context.activate(md5);
                await vscode.commands.executeCommand('ghidraLsp.goToAddress', md5, address);
            })),
            vscode.commands.registerCommand('ghidraLsp.browseSymbol', async (resource: string | Node, symbolId?: string) => {
                // Tree context menus pass the node; links pass (md5, id).
                const md5 = resource instanceof Node ? resource.md5! : resource;
                const id = resource instanceof Node ? resource.symbolId! : symbolId!;
                await busy('ghidra.symbols', async () => { await context.activate(md5); await this.details.symbol(md5, id); });
            }),
            vscode.commands.registerCommand('ghidraLsp.browseType', (md5: string, path: string) => busy('ghidra.types', async () => {
                await context.activate(md5); await vscode.commands.executeCommand('ghidraLsp.editType', md5, path);
            })),
            vscode.commands.registerCommand('ghidraLsp.showTypeDetails', async (md5: string, path: string) => {
                try { await context.activate(md5); await this.details.type(md5, path); }
                catch (error) { void vscode.window.showErrorMessage(formatFriendlyError(error)); }
            }),
            vscode.commands.registerCommand('ghidraLsp.refreshBrowser', async (resource?: unknown) => {
                try { const md5 = context.resolve(resource); if (md5) { await this.refresh(md5); } }
                catch (error) { void vscode.window.showErrorMessage(formatFriendlyError(error)); }
            }),
            context.onDidChange(md5 => {
                if (!md5) { this.clear(); return; }
                void this.load(md5).catch(error => console.error('Ghidra program browser', error));
            }),
        );
        this.views = [symbolView, typeView];
    }
    /** Bound VS Code tree views `[symbolView, typeView]`. */
    private readonly views: vscode.TreeView<Node>[];
    /** Select the active decompiled function node in the Symbols tree when visible. */
    private async revealActiveFunction(): Promise<void> {
        const uri = vscode.window.activeTextEditor?.document.uri;
        const view = this.views[0];
        const activeMd5 = uri?.authority.toLowerCase();
        if (!view.visible || uri?.scheme !== 'ghidra' || !activeMd5 || activeMd5 !== this.md5?.toLowerCase() || !uri.path.startsWith('/function/')) { return; }
        const entry = decodeURIComponent(uri.path.slice('/function/'.length));
        const find = (nodes: Node[]): Node | undefined => {
            for (const node of nodes) {
                if (node.md5?.toLowerCase() === activeMd5 && node.entry === entry) { return node; }
                const child = node.children && find(node.children);
                if (child) { return child; }
            }
            return undefined;
        };
        const node = find(this.symbols.roots);
        if (node) { await view.reveal(node, { select: true, focus: false }); }
    }
    /** Activate program `md5`, load its sidebar trees, and open its Program Overview. */
    async open(md5: string, name: string): Promise<void> {
        await this.context.activate(md5, name);
        await this.load(md5);
        await this.details.program(md5, name, this.typeCount);
        await vscode.commands.executeCommand('workbench.view.extension.ghidra');
    }
    /** Refresh virtual documents, sidebar trees, and details panels for `md5`. */
    async refresh(md5: string): Promise<void> {
        md5 = md5.toLowerCase();
        if (this.context.isClosing(md5)) { return; }
        this.willRefresh.fire(md5);
        const existing = this.refreshing.get(md5);
        if (existing) { return existing; }
        const task = (async () => {
            await this.refreshDocuments(md5);
            if (md5 === this.context.current) { await this.load(md5, true); }
            await this.details.refresh(md5, md5 === this.md5 && this.typeCount >= 0 ? this.typeCount : undefined);
        })();
        this.refreshing.set(md5, task);
        try { await task; } finally { if (this.refreshing.get(md5) === task) { this.refreshing.delete(md5); } }
    }
    /** Clear sidebar trees and close details panels if `md5` is currently displayed. */
    close(md5: string): void {
        this.details.close(md5);
        if (this.md5 === md5) { this.clear(); }
    }
    /** Reset sidebar tree items, counts, and context keys when no program is active. */
    private clear(): void {
        this.md5 = undefined;
        this.loadedCounts = undefined;
        void vscode.commands.executeCommand('setContext', 'ghidra.browserHasProgram', false);
        ++this.generation;
        this.symbols.update([]); this.types.update([]);
        for (const view of this.views) { view.message = undefined; view.description = undefined; }
    }
    /** Fetch symbols, functions, and types for `md5` and populate both sidebar trees. */
    private async load(md5: string, force = false): Promise<void> {
        if (this.context.isClosing(md5)) { return; }
        if (this.md5 === md5 && !force) { await this.loading; return; }
        this.md5 = md5;
        void vscode.commands.executeCommand('setContext', 'ghidra.browserHasProgram', true);
        const generation = ++this.generation;
        if (!force) {
            this.symbols.update([]); this.types.update([]);
            this.loadedCounts = undefined;
            this.syncDescriptions();
            for (const view of this.views) { view.message = undefined; }
        }
        const loading = Promise.resolve(vscode.window.withProgress({ location: { viewId: 'ghidra.symbols' } }, () =>
            vscode.window.withProgress({ location: { viewId: 'ghidra.types' } }, async () => { try {
            const [symbols, functions, types] = await Promise.all([
                this.call<{ items: SymbolInfo[] }>('ghidra.symbols', { md5 }),
                this.call<{ items: { name: string; demangled_name?: string; entry: string; namespace?: string }[] }>('ghidra.functions', { md5 }),
                this.call<{ items: TypeInfo[] }>('ghidra.types', { md5 }),
            ]);
            if (generation !== this.generation) { return; }
            const groups = new Map<string, Node[]>();
            groups.set('Functions', functions.items.map(fn => {
                const node = new Node(symbolName(fn), undefined, md5, fn.entry, undefined, undefined, fn.namespace);
                node.id = `function:${md5}:${fn.entry}`;
                node.description = fn.namespace && fn.namespace !== 'Global' ? `${displayTemplates(fn.namespace)} · ${displayAddress(fn.entry)}` : displayAddress(fn.entry);
                node.tooltip = `${symbolTooltip(fn)}\n${fn.entry}`;
                node.accessibilityInformation = functionNodeAccessibility(fn);
                node.iconPath = new vscode.ThemeIcon('symbol-method');
                node.contextValue = 'ghidra.function';
                node.command = { command: 'ghidraLsp.browseFunction', title: 'Decompile function', arguments: [md5, fn.entry] };
                return node;
            }));
            for (const symbol of symbols.items) {
                if (symbol.type.toLowerCase() === 'function') { continue; }
                const group = symbol.type;
                const node = new Node(symbolName(symbol), undefined, md5, undefined, undefined, symbol.id, symbol.namespace);
                node.id = `symbol:${md5}:${symbol.id}`;
                node.description = symbol.namespace && symbol.namespace !== 'Global' ? `${symbol.namespace} · ${displayAddress(symbol.address)}` : displayAddress(symbol.address);
                node.tooltip = `${symbolTooltip(symbol)}\n${symbol.type} · ${symbol.address}`;
                node.accessibilityInformation = symbolNodeAccessibility(symbol);
                node.iconPath = new vscode.ThemeIcon(group === 'Functions' ? 'symbol-method' : 'symbol-variable');
                node.contextValue = 'ghidra.symbol';
                // A symbol with a memory address opens where it lives: its function's pseudocode, else Listing.
                // External and register symbols have no such location, so they keep the inspector.
                node.command = isMemoryAddress(symbol.address)
                    ? { command: 'ghidraLsp.browseAddress', title: 'Go to symbol', arguments: [md5, symbol.address] }
                    : { command: 'ghidraLsp.browseSymbol', title: 'Show symbol details', arguments: [md5, symbol.id] };
                const children = groups.get(group) || [];
                children.push(node); groups.set(group, children);
            }
            this.symbols.update([...groups].sort(([a], [b]) => a === 'Functions' ? -1 : b === 'Functions' ? 1 : a.localeCompare(b))
                .map(([name, children]) => {
                    const node = new Node(name, namespaces(children));
                    node.id = canonicalTreeSegment('group', `${md5}:${name}`);
                    node.description = String(children.length);
                    node.tooltip = 'Counted in scanned address spaces only';
                    node.accessibilityInformation = symbolGroupAccessibility(name, children.length);
                    if (name === 'Functions') { node.collapsibleState = vscode.TreeItemCollapsibleState.Expanded; }
                    return node;
                }));
            const root = new Node('Types', []);
            const categories = new Map<Node, { segment: string; categoryPath: string }>();
            for (const type of types.items) {
                let parent = root;
                let categoryPath = '';
                for (const segment of (type.category_path || '/').split('/').filter(Boolean)) {
                    categoryPath += `/${segment}`;
                    const key = canonicalTreeSegment('category', segment);
                    let folder = parent.children!.find(node => node.key === key && node.children);
                    if (!folder) {
                        folder = new Node(segment, []);
                        folder.key = key;
                        folder.id = canonicalTreeSegment('category', `${md5}:${categoryPath}`);
                        folder.tooltip = categoryPath;
                        folder.iconPath = new vscode.ThemeIcon('folder');
                        categories.set(folder, { segment, categoryPath });
                        parent.children!.push(folder);
                    }
                    parent = folder;
                }
                const node = new Node(type.name, undefined, md5, undefined, type.path);
                node.id = `type:${md5}:${type.path}`;
                node.description = type.kind; node.tooltip = type.path;
                node.accessibilityInformation = typeNodeAccessibility(type);
                node.iconPath = new vscode.ThemeIcon('symbol-structure');
                node.contextValue = 'ghidra.type';
                node.command = { command: 'ghidraLsp.browseType', title: 'Open data type', arguments: [md5, type.path] };
                parent.children!.push(node);
            }
            for (const [folder, meta] of categories) {
                folder.accessibilityInformation = typeCategoryAccessibility(meta.segment, meta.categoryPath, folder.children!.length);
            }
            this.typeCount = types.items.length;
            this.types.update(root.children!);
            let symbolCount = 0;
            for (const children of groups.values()) { symbolCount += children.length; }
            this.loadedCounts = [symbolCount, types.items.length];
            this.syncDescriptions();
            this.views[0].message = symbolCount ? undefined : 'No symbols in scanned address spaces';
            this.views[1].message = undefined;
            if (!force || this.views[0].selection.some(node => node.entry && node.entry === decodeURIComponent(vscode.window.activeTextEditor?.document.uri.path.slice('/function/'.length) || ''))) {
                await this.revealActiveFunction();
            }
        } catch (error) {
            if (generation === this.generation) {
                this.md5 = undefined;
                this.loadedCounts = undefined;
                for (const view of this.views) {
                    view.description = undefined;
                    view.message = `Load failed: ${formatFriendlyError(error)}`;
                }
            }
            throw error;
        } })));
        this.loading = loading;
        try { await loading; } finally { if (this.loading === loading) { this.loading = undefined; } }
    }
    /** Cancel pending loads and dispose all sidebar views and commands. */
    dispose(): void { ++this.generation; this.disposables.forEach(item => item.dispose()); }
}
