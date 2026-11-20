// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

import * as vscode from 'vscode';
import { ProgramContext } from './context';
import { Call } from './memory';
import { symbolName } from './names';
import { bytesExtension, listingExtension, withoutExtension } from './virtual-files';
import { stringAddress, stringScheme } from './string-files';

/** Disambiguated display descriptor for one open virtual resource. */
export interface NamedResource { uri: vscode.Uri; name: string; program: string; address?: string }
/** Server symbol payload fields used to build tab labels. */
interface NamedSymbol { name?: string; namespace?: string; demangled_name?: string; address?: string; entry?: string }
/** Base display name and optional address for a resource URI. */
interface ResourceName { name: string; address?: string }

/** Labels name their program only when the window works with several, or when these resources span several. */
export function resourceLabels(resources: NamedResource[], multiple = true): Map<string, string> {
    const qualify = multiple || new Set(resources.map(resource => resource.uri.authority)).size > 1;
    const base = (resource: NamedResource): string => qualify ? `${resource.name} · ${resource.program}` : resource.name;
    const labels = new Map(resources.map(resource => [resource.uri.toString(), base(resource)]));
    for (const resource of resources) {
        const label = base(resource);
        // Optional query hints can name the same view twice. Only different objects need a suffix.
        const duplicates = resources.filter(other => base(other) === label
            && (other.uri.scheme !== resource.uri.scheme || other.uri.authority !== resource.uri.authority
                || other.uri.path !== resource.uri.path || other.address !== resource.address));
        if (!duplicates.length) { continue; }
        const address = resource.address || resource.uri.path.slice(resource.uri.path.indexOf('/', 1) + 1);
        const sameAddress = duplicates.filter(other => other.uri.path === resource.uri.path && other.address === resource.address);
        const prefix = resource.uri.authority.slice(0, 8);
        const program = sameAddress.some(other => other.uri.authority.startsWith(prefix)) ? resource.uri.authority : prefix;
        const identity = sameAddress.length ? `${address} · ${program}` : address;
        labels.set(resource.uri.toString(), `${resource.name} @ ${identity}${qualify ? ` · ${resource.program}` : ''}`);
    }
    return labels;
}

/** Synchronizes VS Code editor tab titles for open Ghidra virtual documents. */
export class DocumentLabels implements vscode.Disposable {
    /** Memoized resource label queries keyed by URI string. */
    private readonly names = new Map<string, Promise<ResourceName>>();
    /** Event subscriptions owned by this label manager. */
    private readonly disposables: vscode.Disposable[];
    /** Debounce timer handle for tab label updates. */
    private timer?: ReturnType<typeof setTimeout>;
    /** Generation counter used to cancel superseded updates. */
    private generation = 0;
    /** Whether this manager has been disposed. */
    private disposed = false;

    /** Register listeners for tab, document, and active-program changes. */
    constructor(private readonly call: Call, private readonly context: ProgramContext,
        private readonly viewName: (uri: vscode.Uri) => string | undefined = () => undefined,
        private readonly viewMode: (uri: vscode.Uri) => 'listing' | 'bytes' = uri => uri.scheme === 'ghidra-listing' ? 'listing' : 'bytes') {
        this.disposables = [
            vscode.window.onDidChangeActiveTextEditor(() => this.refresh()),
            vscode.window.onDidChangeVisibleTextEditors(() => this.refresh()),
            vscode.window.tabGroups.onDidChangeTabs(event => {
                if (event.opened.length || event.closed.length) { this.refresh(); }
            }),
            vscode.workspace.onDidChangeTextDocument(event => {
                if (['ghidra-listing', 'ghidra-memory', stringScheme].includes(event.document.uri.scheme)) { this.refresh(); }
            }),
            context.onDidChange(() => this.refresh()),
            context.onDidChangeScope(() => this.refresh()),
        ];
        this.refresh();
    }

    /** Schedule a debounced tab-label refresh, clearing cached names for `md5` if given. */
    refresh(md5?: string): void {
        if (this.disposed) { return; }
        if (md5) {
            for (const key of this.names.keys()) {
                if (vscode.Uri.parse(key).authority === md5) { this.names.delete(key); }
            }
        }
        const generation = ++this.generation;
        if (this.timer) { clearTimeout(this.timer); }
        this.timer = setTimeout(() => {
            this.timer = undefined;
            void this.update(generation).catch(console.error);
        }, 100);
    }

    /** Resolve the display metadata and owning program name for `uri`. */
    async describe(uri: vscode.Uri): Promise<NamedResource> {
        return { uri, ...await this.name(uri), program: this.context.name(uri.authority) };
    }

    /** Compute or query the base display name and address for `uri`. */
    private async name(uri: vscode.Uri): Promise<ResourceName> {
        if (uri.scheme === 'ghidra-listing' || uri.scheme === 'ghidra-memory') {
            const extension = uri.scheme === 'ghidra-listing' ? listingExtension : bytesExtension;
            let address = decodeURIComponent(withoutExtension(uri.path.split('/').pop() || '', extension));
            try {
                const query = JSON.parse(uri.query);
                if (typeof query?.address === 'string' && query.address) { address = query.address; }
            } catch { /* A restored view can have only an address in its path. */ }
            const kind = this.viewMode(uri) === 'listing' ? 'Listing' : 'Bytes';
            // Use the loaded view's metadata; naming a tab must not query Ghidra.
            return { name: `${kind} · ${this.viewName(uri) || address}`, address };
        }
        if (uri.scheme === stringScheme) {
            // Name the tab by the text already loaded for it; naming must not query Ghidra.
            const address = stringAddress(uri);
            const text = vscode.workspace.textDocuments.find(document => document.uri.toString() === uri.toString())?.getText() ?? '';
            const line = text.split(/\r?\n/, 1)[0].trim();
            const preview = line.length > 32 ? `${line.slice(0, 31)}…` : line;
            return { name: `String · ${preview ? `"${preview}"` : address}`, address };
        }
        const key = uri.toString();
        const known = this.names.get(key);
        if (known) { return known; }
        const request = (async () => {
            const [, kind, ...segments] = uri.path.split('/');
            const identity = segments.join('/');
            const domain = kind === 'function' ? 'function' : kind === 'type' ? 'data_type' : 'symbol';
            const selector = kind === 'function' ? { entry: identity }
                : kind === 'type' ? { path: identity.replace(/\.md$/, '') } : { id: identity };
            const symbol = await this.call<NamedSymbol>('ghidra.query', { md5: uri.authority, domain, operation: 'get', params: { selector } });
            const qualified = symbolName(symbol, true) || identity;
            return { name: kind === 'references' ? `References: ${qualified}` : kind === 'type' ? `Type: ${qualified}` : qualified,
                address: symbol.address || symbol.entry };
        })();
        this.names.set(key, request);
        try { return await request; }
        catch (error) {
            if (this.names.get(key) === request) { this.names.delete(key); }
            throw error;
        }
    }

    /** Recompute and apply disambiguated labels across open Ghidra editor tabs. */
    private async update(generation: number): Promise<void> {
        const tabs = vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab => tab.input instanceof vscode.TabInputText
            && ['ghidra', 'ghidra-listing', 'ghidra-memory', stringScheme].includes(tab.input.uri.scheme) && !this.context.isClosing(tab.input.uri.authority));
        const uris = new Map(tabs.map(tab => { const uri = (tab.input as vscode.TabInputText).uri; return [uri.toString(), uri]; }));
        // A restored tab belongs to a program this window works with even before that program is focused.
        for (const uri of uris.values()) { this.context.track(uri.authority); }
        if (generation !== this.generation) { return; }
        for (const key of this.names.keys()) { if (!uris.has(key)) { this.names.delete(key); } }
        const resources = await Promise.all([...uris.values()].map(async uri => {
            try { return await this.describe(uri); }
            catch { return undefined; }
        }));
        if (this.disposed || generation !== this.generation) { return; }
        const labels = resourceLabels(resources.filter((resource): resource is NamedResource => !!resource), this.context.multiple);
        for (const tab of tabs) {
            if (this.disposed || generation !== this.generation) { return; }
            const uri = (tab.input as vscode.TabInputText).uri;
            const label = labels.get(uri.toString());
            if (!label || tab.label === label || this.context.isClosing(uri.authority) || !tab.group.tabs.includes(tab)) { continue; }
            await vscode.commands.executeCommand('vscode.open', uri, {
                viewColumn: tab.group.viewColumn, preserveFocus: true, preview: tab.isPreview, background: true,
            }, label);
        }
    }

    /** Cancel pending timers and release label caches and subscriptions. */
    dispose(): void {
        this.disposed = true;
        if (this.timer) { clearTimeout(this.timer); }
        this.names.clear();
        for (const disposable of this.disposables) { disposable.dispose(); }
    }
}
