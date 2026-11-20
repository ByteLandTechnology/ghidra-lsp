// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

import { displayAddress } from './names';
import * as vscode from 'vscode';
import { Call } from './memory';
import { ProgramContext, viewDescription } from './context';
import { formatFriendlyError } from './error';
import { definedStrings } from './strings';
import { StringFiles } from './string-files';

/** A lazy, session-scoped native list. Hidden views never scan program data. */
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
    /** Number of defined strings loaded for the active program. */
    private count?: number;
    /** Generation counter used to discard stale string list loads. */
    private generation = 0;
    /** True when the string list must reload the next time the view is visible. */
    private dirty = true;
    /** In-flight string list loading promise, if any. */
    private loading?: Promise<void>;

    /** Update the tree view header description with count and optional program name. */
    private syncDescription(): void {
        this.view.description = viewDescription(this.context, this.md5, this.count);
    }

    /** Create the Strings sidebar tree view and bind visibility and session listeners. */
    constructor(private readonly call: Call, private readonly context: ProgramContext, private readonly files: StringFiles) {
        this.view = vscode.window.createTreeView('ghidra.strings', { treeDataProvider: this });
        this.disposables = [this.changed, this.view,
            this.view.onDidChangeVisibility(event => { if (event.visible) { void this.load(); } }),
            ...(context.onDidChangeScope ? [context.onDidChangeScope(() => this.syncDescription())] : []),
            context.onDidChange(md5 => {
                this.md5 = md5;
                this.count = undefined;
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
            vscode.commands.registerCommand('ghidraLsp.openString', (md5: string, address: string) =>
                // The view's own progress bar answers the click until the editor appears.
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

    /** Mark `md5` dirty and reload defined strings when the view is visible. */
    async refresh(md5?: string): Promise<void> {
        if (!md5 || md5 !== this.md5) { return; }
        this.dirty = true;
        await this.load();
    }

    /** Fetch defined strings from the server when the Strings view is visible and dirty. */
    private async load(): Promise<void> {
        const md5 = this.md5;
        if (!this.view.visible || !md5 || this.context.isClosing(md5) || !this.dirty) { return; }
        if (this.loading) { await this.loading; return; }
        const generation = this.generation;
        const loading = Promise.resolve(vscode.window.withProgress({ location: { viewId: 'ghidra.strings' } }, async () => {
            try {
                const result = await definedStrings(this.call, md5);
                if (generation !== this.generation) { return; }
                this.nodes = result.items.map(item => {
                    const label = item.value.replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\t/g, '\\t') || '""';
                    const node = new vscode.TreeItem(label);
                    node.id = `string:${md5}:${item.address}`;
                    node.description = displayAddress(item.address);
                    node.tooltip = `${item.value}\n\n${item.address} · ${item.length} bytes · ${item.type}`;
                    node.iconPath = new vscode.ThemeIcon('symbol-string');
                    node.contextValue = 'ghidra.string';
                    // Keep ownership on the item for native context-menu commands as well.
                    Object.assign(node, { md5, address: item.address });
                    node.command = { command: 'ghidraLsp.openString', title: 'Open string', arguments: [md5, item.address] };
                    return node;
                });
                this.count = result.items.length;
                this.syncDescription();
                this.view.message = undefined;
                if (!this.nodes.length) {
                    const empty = new vscode.TreeItem('No defined strings');
                    empty.iconPath = new vscode.ThemeIcon('info');
                    empty.tooltip = 'Ghidra has not defined any strings in the default address space. Analyze the program, then refresh this view.';
                    this.nodes = [empty];
                }
                this.dirty = false;
            } catch (error) {
                if (generation !== this.generation) { return; }
                this.count = undefined;
                this.syncDescription();
                this.view.message = `Could not load strings: ${formatFriendlyError(error)}`;
                const retry = new vscode.TreeItem('Retry loading strings');
                retry.iconPath = new vscode.ThemeIcon('refresh');
                retry.command = { command: 'ghidraLsp.refreshStrings', title: 'Retry loading strings' };
                this.nodes = [retry];
            }
            if (generation === this.generation) { this.changed.fire(); }
        }));
        this.loading = loading;
        try { await loading; } finally { if (this.loading === loading) { this.loading = undefined; } }
    }

    /** Cancel pending updates and dispose the tree view and listeners. */
    dispose(): void { ++this.generation; this.disposables.forEach(item => item.dispose()); }
}
