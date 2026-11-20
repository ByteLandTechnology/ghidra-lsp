// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

import * as vscode from 'vscode';
import { ProgramContext } from './context';
import { DocumentLabels, NamedResource, resourceLabels } from './labels';
import { Call, VirtualDocument } from './memory';

/** URI scheme for virtual listing documents. */
const listingScheme = 'ghidra-listing';

/** URI scheme for readable cross-reference preview locations. */
export const referenceScheme = 'ghidra-reference';
/** Summary of unmapped binary references shown in the status bar. */
interface AddressReferences { count: number; name: string; address?: string }

/** Extract and validate the underlying source document URI from a `ghidra-reference://` URI. */
export function referenceSource(uri: vscode.Uri): vscode.Uri | undefined {
    if (uri.scheme !== referenceScheme) { return undefined; }
    try {
        const value: unknown = JSON.parse(uri.query);
        const source = value && typeof value === 'object' ? (value as { source?: unknown }).source : undefined;
        if (typeof source !== 'string') { return undefined; }
        const parsed = vscode.Uri.parse(source);
        if (parsed.authority !== uri.authority || !/^[a-f\d]{32}$/i.test(parsed.authority) || parsed.fragment) { return undefined; }
        if (parsed.scheme === 'ghidra' && /^\/(function|symbol|references|type)\//.test(parsed.path) && !parsed.query) { return parsed; }
        // Listing rows stand in for references without an exact pseudocode token.
        if (parsed.scheme === listingScheme && parsed.path.startsWith('/listing/')) { return parsed; }
    } catch {}
    return undefined;
}

/** Provides human-readable `ghidra-reference://` previews and redirects activated tabs to their source documents. */
export class ReferenceViews implements vscode.TextDocumentContentProvider, vscode.Disposable {
    /** Map from `ghidra-reference://` URI string to underlying source URI. */
    private readonly sources = new Map<string, vscode.Uri>();
    /** Emitter for VS Code text document content refresh events. */
    private readonly changes = new vscode.EventEmitter<vscode.Uri>();
    /** Event fired when a reference preview document changes. */
    readonly onDidChange = this.changes.event;
    /** Unmapped reference summaries keyed by program MD5. */
    private readonly summaries = new Map<string, AddressReferences>();
    /** Latest location-query generation per program MD5. */
    private readonly generations = new Map<string, number>();
    /** Status bar item linking to unmapped binary address references. */
    private readonly status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 9);
    /** Event subscriptions and status bar item owned by this provider. */
    private readonly disposables: vscode.Disposable[];
    /** Monotonic counter for ordering location resolution updates. */
    private serial = 0;
    /** Whether this provider has been disposed. */
    private disposed = false;

    /** Register the `ghidra-reference://` content provider and editor reveal listeners. */
    constructor(
        private readonly call: Call,
        private readonly labels: DocumentLabels,
        private readonly context: ProgramContext,
        private readonly prepare: (document: vscode.TextDocument) => Promise<vscode.TextDocument>,
    ) {
        this.status.name = 'Ghidra binary address references';
        this.disposables = [this.changes, this.status, vscode.workspace.registerTextDocumentContentProvider(referenceScheme, this),
            context.onDidChange(() => this.updateStatus()),
            vscode.workspace.onDidOpenTextDocument(document => {
                const source = referenceSource(document.uri);
                if (source) {
                    this.sources.set(document.uri.toString(), source);
                    const language = source.scheme === listingScheme ? listingScheme : source.path.endsWith('.md') ? 'markdown' : 'ghidra-decompiled';
                    if (document.languageId !== language) { void Promise.resolve(vscode.languages.setTextDocumentLanguage(document, language)).catch(console.error); }
                }
            }),
            vscode.workspace.onDidCloseTextDocument(document => { this.sources.delete(document.uri.toString()); }),
            vscode.workspace.onDidChangeTextDocument(event => {
                if (event.document.uri.scheme === 'ghidra' && event.contentChanges.length) { this.refresh(event.document.uri.authority); }
            }),
            vscode.window.onDidChangeActiveTextEditor(editor => { if (editor) { void this.reveal(editor).catch(console.error); } }),
        ];
    }

    /** Rewrite server reference locations into readable `ghidra-reference://` URIs and track unmapped address references. */
    async locations(locations: vscode.Location[], token: vscode.CancellationToken, origin: vscode.Uri): Promise<vscode.Location[]> {
        const sourceLocations = locations.filter(location => location.uri.scheme !== 'ghidra'
            || !/^\/(references|symbol)\//.test(location.uri.path));
        const binaryLocations = locations.filter(location => location.uri.scheme === 'ghidra' && location.uri.path.startsWith('/references/'));
        const named = (uri: vscode.Uri): boolean => uri.scheme === 'ghidra' || uri.scheme === listingScheme;
        const md5 = (referenceSource(origin) || origin).authority;
        const generation = ++this.serial;
        this.generations.set(md5, generation);
        const uris = new Map(locations.filter(location => named(location.uri)).map(location => [location.uri.toString(), location.uri]));
        if (token.isCancellationRequested) { return sourceLocations; }
        const descriptions = await Promise.all([...uris.values()].map(async uri => {
            try { return await this.labels.describe(uri); } catch { return undefined; }
        }));
        if (this.disposed || token.isCancellationRequested) { return sourceLocations; }
        const resources = descriptions.filter((resource): resource is NamedResource => !!resource);
        if (this.generations.get(md5) === generation) {
            if (binaryLocations.length) {
                const metadata = resources.find(resource => resource.uri.toString() === binaryLocations[0].uri.toString());
                this.summaries.set(md5, { count: binaryLocations.length, name: metadata?.name.replace(/^References:\s*/, '') || 'Address references', address: metadata?.address });
            } else { this.summaries.delete(md5); }
            this.updateStatus();
        }
        const labels = resourceLabels(resources, this.context.multiple);
        const addresses = new Map(resources.map(resource => [resource.uri.toString(), resource.address]));
        return sourceLocations.map(location => {
            const source = location.uri;
            const label = labels.get(source.toString());
            if (!label) { return location; }
            const identity = addresses.get(source.toString()) || source.path.slice(source.path.indexOf('/', 1) + 1);
            const uri = vscode.Uri.from({ scheme: referenceScheme, authority: source.authority,
                path: `/${identity}/${label.replace(/[\/\\]/g, '∕')}`, query: JSON.stringify({ source: source.toString() }) });
            return new vscode.Location(uri, location.range);
        });
    }

    /** Provide virtual document text for a `ghidra-reference://` peek preview. */
    async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
        const source = referenceSource(uri);
        if (!source || this.context.isClosing(source.authority)) { throw vscode.FileSystemError.FileNotFound(uri); }
        this.sources.set(uri.toString(), source);
        if (source.scheme === listingScheme) { return (await vscode.workspace.openTextDocument(source)).getText(); }
        const document = await this.call<VirtualDocument>('ghidra.document', { uri: source.toString(), includePending: true });
        return document.text;
    }

    /** Fire change events for cached reference previews belonging to `md5`. */
    refresh(md5: string): void {
        if (this.disposed || this.context.isClosing(md5)) { return; }
        for (const [key, source] of this.sources) {
            if (source.authority === md5) { this.changes.fire(vscode.Uri.parse(key)); }
        }
    }

    /** Clear cached reference state and status summaries for closed program `md5`. */
    close(md5: string): void {
        for (const [key, source] of this.sources) { if (source.authority === md5) { this.sources.delete(key); } }
        this.summaries.delete(md5);
        this.generations.delete(md5);
        this.updateStatus();
    }

    /** Refresh the status bar indicator for unmapped binary address references. */
    private updateStatus(): void {
        const md5 = this.context.current;
        const summary = md5 && !this.context.isClosing(md5) ? this.summaries.get(md5) : undefined;
        if (!md5 || !summary) { this.status.hide(); return; }
        this.status.text = `$(references) ${summary.count} address references`;
        this.status.tooltip = `${summary.name}${summary.address ? ` · ${summary.address}` : ''}\nThese binary references cannot be mapped precisely to decompiled text. Click to view their addresses and types.`;
        this.status.accessibilityInformation = { label: `Ghidra: ${summary.count} binary address references, ${summary.name}`, role: 'button' };
        this.status.command = { command: 'ghidraLsp.showAddressReferences', title: 'Show binary address references', arguments: [{ md5, address: summary.address }] };
        this.status.show();
    }

    /** Replace a newly opened `ghidra-reference://` editor tab with its underlying source document. */
    private async reveal(editor: vscode.TextEditor): Promise<void> {
        const source = referenceSource(editor.document.uri);
        if (!source || this.disposed || this.context.isClosing(source.authority)) { return; }
        const tab = vscode.window.tabGroups.all.flatMap(group => group.tabs).find(item => item.isActive
            && item.group.viewColumn === editor.viewColumn && item.input instanceof vscode.TabInputText && item.input.uri.toString() === editor.document.uri.toString());
        if (!tab) { return; }
        const opened = await vscode.workspace.openTextDocument(source);
        const document = source.scheme === listingScheme ? opened : await this.prepare(opened);
        if (this.disposed || vscode.window.activeTextEditor !== editor || this.context.isClosing(source.authority)) { return; }
        await vscode.window.showTextDocument(document, { viewColumn: editor.viewColumn, selection: editor.selection, preview: tab?.isPreview ?? true });
        if (tab?.group.tabs.includes(tab)) { await vscode.window.tabGroups.close(tab, true); }
    }

    /** Dispose event emitters, status bar items, and cached reference maps. */
    dispose(): void {
        this.disposed = true;
        this.sources.clear();
        this.summaries.clear();
        this.generations.clear();
        for (const disposable of this.disposables) { disposable.dispose(); }
    }
}
