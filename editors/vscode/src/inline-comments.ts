// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

import * as vscode from 'vscode';
import { Call } from './memory';
import { formatFriendlyError } from './error';

/** Supported Ghidra comment categories displayed in the inline comment thread. */
export const commentKinds = ['plate', 'pre', 'eol', 'post', 'repeatable'] as const;
/** One Ghidra comment category name. */
export type CommentKind = typeof commentKinds[number];
/** Target decompiler document and line/character anchor for a comment thread. */
interface Anchor {
    /** Virtual `ghidra://` pseudocode document URI. */
    uri: vscode.Uri;
    /** Target line and character offset inside the pseudocode document. */
    position: vscode.Position;
}
/** State for one open five-kind comment thread at an instruction or data address. */
interface State {
    /** Active binary MD5 identifier. */
    md5: string;
    /** Target canonical Ghidra CodeUnit address. */
    address: string;
    /** Native VS Code comment thread displaying the tab bar and active comment editor. */
    thread: vscode.CommentThread;
    /** Ordered comment draft objects for all five Ghidra comment categories. */
    comments: Draft[];
    /** Currently active comment category selected via the horizontal tab bar. */
    selected: CommentKind;
    /** Count of in-flight asynchronous save calls for this thread. */
    busy: number;
    /** True once the thread has been disposed. */
    closed: boolean;
    /** True when a prior save failure left persistence state ambiguous. */
    uncertain: boolean;
    /** Sequential promise chain serializing saves on the same CodeUnit. */
    queue: Promise<void>;
}

/** Build trusted Markdown that holds the five comment category command links. */
function buildTabBarMarkdown(state: State, stateKey: string): vscode.MarkdownString {
    const links = commentKinds.map(kind => {
        const draft = state.comments.find(item => item.kind === kind);
        const baseLabel = kind === 'repeatable' ? 'REPEATABLE (ext)' : kind.toUpperCase();
        const states: string[] = [];
        if (kind === state.selected) {
            states.push('selected');
        }
        if (draft !== undefined && draft.saved.trim() !== '') {
            states.push('saved');
        }
        if (draft !== undefined && draft.body !== draft.saved) {
            states.push('unsaved');
        }
        const label = states.length > 0 ? `${baseLabel} (${states.join(', ')})` : baseLabel;
        const args = encodeURIComponent(JSON.stringify([stateKey, kind]));
        return `[${label}](command:ghidraLsp.selectCommentKind?${args})`;
    });
    const markdown = new vscode.MarkdownString(links.join(' | '));
    markdown.isTrusted = { enabledCommands: ['ghidraLsp.selectCommentKind'] };
    return markdown;
}

/** Read-only header comment displaying the horizontal category tab strip inside a thread. */
class TabStrip implements vscode.Comment {
    /** Keep the tab strip non-editable in preview mode. */
    mode = vscode.CommentMode.Preview;
    /** Distinct context value so edit/save actions stay hidden on the tab strip row. */
    contextValue = 'ghidraCommentTabs';
    /** Section header label shown beside the horizontal category links. */
    author: vscode.CommentAuthorInformation = { name: 'Comment type' };
    /** Optional status badge indicating uncertain persistence after a write failure. */
    label?: string;
    /** Markdown body that holds the horizontal category command links. */
    body: vscode.MarkdownString;
    /** Construct the tab strip comment for the active thread state. */
    constructor(body: vscode.MarkdownString, uncertain: boolean) {
        this.body = body;
        if (uncertain) {
            this.label = 'save outcome unknown · reopen before retrying';
        }
    }
}

// Keep internal ownership off Comment.state, which is a proposed VS Code field.
/** Editable comment entry representing one Ghidra comment category inside a thread. */
class Draft implements vscode.Comment {
    /** Current VS Code comment display mode (preview or editing). */
    mode = vscode.CommentMode.Preview;
    /** Context menu key matching `package.json` comment actions. */
    contextValue = 'ghidraComment';
    /** Author header displaying the comment category name. */
    author: vscode.CommentAuthorInformation;
    /** Status label showing empty, extension, saving, or error state. */
    label?: string;
    /** Last persisted comment text confirmed by the server. */
    saved: string;
    /** True while an asynchronous save request for this draft is running. */
    saving = false;
    /** Construct one draft entry for comment category `kind` under `owner`. */
    constructor(public body: string, readonly kind: CommentKind, readonly owner: State) {
        this.saved = body;
        this.author = { name: kind.toUpperCase() };
        this.describe();
    }
    /** Recompute the status label from the comment category and saved text. */
    describe(): void {
        this.label = [this.kind === 'repeatable' ? 'extension' : '', this.saved ? '' : 'empty'].filter(Boolean).join(' · ');
    }
}

/** Native comment widgets keep multiline edits beside the readonly pseudocode. */
export class InlineComments implements vscode.Disposable {
    /** VS Code comment controller managing active Ghidra comment threads. */
    private readonly controller = vscode.comments.createCommentController('ghidra-comments', 'Ghidra Comments');
    /** Open comment thread states keyed by `md5:address`. */
    private readonly states = new Map<string, State>();
    /** Debounced re-anchor timer handles keyed by document URI string. */
    private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();
    /** Registered comment commands and workspace listeners. */
    private readonly disposables: vscode.Disposable[] = [];
    /** Register inline comment editor commands and document re-anchor listeners. */
    constructor(private readonly call: Call) {
        const commands: Record<string, (...args: any[]) => unknown> = {
            editCommentText: (draft: Draft) => this.edit(draft),
            selectCommentKind: (first: unknown, second?: unknown) => this.select(first, second),
            cancelCommentEdit: (draft: Draft) => { this.live(draft); draft.body = draft.saved; draft.mode = vscode.CommentMode.Preview; this.render(draft.owner); },
            saveComment: (draft: Draft) => this.save(draft),
            closeCommentEditor: (thread: vscode.CommentThread) => this.remove(thread),
        };
        for (const [name, run] of Object.entries(commands)) {
            this.disposables.push(vscode.commands.registerCommand(`ghidraLsp.${name}`, async (...args: unknown[]) => {
                try { await run(...args); } catch (error) { void vscode.window.showErrorMessage(formatFriendlyError(error)); }
            }));
        }
        this.disposables.push(vscode.workspace.onDidChangeTextDocument(event => {
            const uri = event.document.uri.toString();
            if (!event.contentChanges.length || ![...this.states.values()].some(state => state.thread.uri.toString() === uri)) { return; }
            const old = this.pending.get(uri); if (old) { clearTimeout(old); }
            this.pending.set(uri, setTimeout(() => {
                this.pending.delete(uri);
                for (const state of this.states.values()) {
                    if (state.thread.uri.toString() === uri) { void this.reanchor(state); }
                }
            }, 0));
        }));
    }
    /** Build the map key for a program MD5 and address pair. */
    private key(md5: string, address: string): string { return `${md5}:${address}`; }
    /** Fetch all five comment strings at `address` from the server. */
    private async read(md5: string, address: string): Promise<Record<CommentKind, string>> {
        const result = await this.call<{ comments?: Partial<Record<CommentKind, string>> }>('ghidra.commentsAt', { md5, address });
        const comments = result.comments || {};
        return Object.fromEntries(commentKinds.map(kind => [kind, String(comments[kind] ?? '')])) as Record<CommentKind, string>;
    }
    /** Open or reveal the inline comment thread at `anchor` and edit `selected` kind. */
    async open(md5: string, address: string, selected: CommentKind, anchor: Anchor): Promise<void> {
        const key = this.key(md5, address);
        let state = this.states.get(key);
        const document = await vscode.workspace.openTextDocument(anchor.uri);
        const group = vscode.window.tabGroups.all.find(group => group.tabs.some(tab => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === anchor.uri.toString()));
        const editor = await vscode.window.showTextDocument(document, { preview: false, viewColumn: group?.viewColumn });
        const range = new vscode.Range(anchor.position, anchor.position);
        editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        if (!state) {
            const current = await this.read(md5, address);
            state = this.states.get(key);
            if (!state) {
                const thread = this.controller.createCommentThread(anchor.uri, range, []);
                thread.canReply = false;
                thread.label = `Ghidra comments · ${address}`;
                state = { md5, address, thread, comments: [], selected, busy: 0, closed: false, uncertain: false, queue: Promise.resolve() };
                state.comments = commentKinds.map(kind => new Draft(current[kind], kind, state!));
                this.states.set(key, state);
            }
        }
        const draft = state.comments.find(draft => draft.kind === selected)!;
        this.live(draft);
        state.selected = selected;
        state.thread.range = range;
        state.thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
        this.edit(draft);
    }
    /** Switch the active comment category shown beneath the horizontal tab strip. */
    private select(first: unknown, second?: unknown): void {
        const [key, kind] = Array.isArray(first) ? first : [first, second];
        if (typeof key !== 'string' || typeof kind !== 'string' || !commentKinds.includes(kind as CommentKind)) { return; }
        const state = this.states.get(key);
        if (!state || state.closed) { return; }
        const target = state.comments.find(item => item.kind === kind);
        if (!target) { return; }
        this.live(target);
        state.selected = target.kind;
        this.edit(target);
    }
    /** Verify that `draft` belongs to an active, unblocked comment thread. */
    private live(draft: Draft): void {
        if (!(draft instanceof Draft) || draft.owner.closed) { throw new Error('Reopen the comment Code Action before editing.'); }
        if (draft.saving) { throw new Error('Wait for this comment save to finish.'); }
        if (draft.owner.uncertain) { throw new Error('The previous save has an uncertain outcome. Close and reopen the comments before saving again.'); }
    }
    /** Switch one comment draft in the thread into edit mode. */
    private edit(draft: Draft): void {
        this.live(draft);
        const state = draft.owner;
        state.selected = draft.kind;
        const current = state.comments.find(item => item.kind === draft.kind)!;
        if (current.mode !== vscode.CommentMode.Editing) {
            // Native buttons can close an input before its Preview update reaches the UI.
            const replacement = new Draft(current.body, current.kind, state);
            replacement.saved = current.saved;
            replacement.mode = vscode.CommentMode.Editing;
            state.comments[state.comments.indexOf(current)] = replacement;
        }
        this.render(state);
    }
    /** Push the horizontal tab strip and active comment slot onto the VS Code comment thread. */
    private render(state: State): void {
        const active = state.comments.find(item => item.kind === state.selected) ?? state.comments[0];
        if (!active) {
            state.thread.comments = [];
            return;
        }
        const tabs = new TabStrip(buildTabBarMarkdown(state, this.key(state.md5, state.address)), state.uncertain);
        state.thread.comments = [tabs, active];
    }
    /** Persist one edited comment draft sequentially through `ghidra.saveComment`. */
    private async save(draft: Draft): Promise<void> {
        this.live(draft);
        const state = draft.owner;
        const text = draft.body;
        if (text === draft.saved) { draft.mode = vscode.CommentMode.Preview; this.render(state); return; }
        state.busy++;
        draft.saving = true;
        draft.mode = vscode.CommentMode.Preview;
        draft.label = 'Saving…';
        this.render(state);
        const previous = state.queue;
        let release!: () => void;
        state.queue = new Promise<void>(done => { release = done; });
        await previous;
        try {
            if (state.closed) { return; }
            if (state.uncertain) { throw new Error('The previous save has an uncertain outcome. Close and reopen the comments before saving again.'); }
            const saved = await this.call<{ text?: string }>('ghidra.saveComment', {
                md5: state.md5,
                address: state.address,
                kind: draft.kind,
                text,
                expected: draft.saved,
            });
            if (state.closed) { return; }
            draft.saved = typeof saved.text === 'string' ? saved.text : (text.trim() ? text : '');
            draft.body = draft.saved;
            draft.mode = vscode.CommentMode.Preview;
            draft.describe();
            try { await vscode.commands.executeCommand('ghidraLsp.refreshBrowser', state.md5); }
            catch (error) { void vscode.window.showWarningMessage(`The comment was saved, but refreshing views failed: ${formatFriendlyError(error)}`); }
        } catch (error) {
            state.uncertain ||= /may have reached|Modification reached|persistence failed|saving.*failed|saved.*failed|regeneration failed|editor rejected|outcome.*unknown|not persisted/i.test(String(error));
            // Native comment buttons close their editor before the async command finishes.
            // A fresh comment identity restores the failed draft, including an empty deletion.
            const replacement = new Draft(text, draft.kind, state);
            replacement.saved = draft.saved;
            replacement.mode = state.uncertain ? vscode.CommentMode.Preview : vscode.CommentMode.Editing;
            replacement.label = state.uncertain ? 'save outcome unknown · reopen before retrying' : 'not saved';
            state.comments[state.comments.indexOf(draft)] = replacement;
            throw error;
        } finally {
            state.busy--;
            draft.saving = false;
            release();
            if (!state.closed) { this.render(state); }
        }
    }
    /** Move a comment thread anchor to match updated pseudocode line positions. */
    private async reanchor(state: State): Promise<void> {
        try {
            const location = await this.call<{ position?: { line: number; character: number } }>('ghidra.location', {
                uri: state.thread.uri.toString(), address: state.address,
            });
            if (!state.closed && location.position) {
                const point = new vscode.Position(location.position.line, location.position.character);
                state.thread.range = new vscode.Range(point, point);
            }
        } catch { /* A pending rename has no current native layout; the next refresh restores the anchor. */ }
    }
    /** Close a single comment thread after any queued save operations finish. */
    private async remove(thread: vscode.CommentThread): Promise<void> {
        for (const [key, state] of this.states) {
            if (state.thread !== thread) { continue; }
            while (state.busy) { await state.queue; }
            if (state.comments.some(draft => draft.body !== draft.saved)) {
                const choice = await vscode.window.showWarningMessage('Discard unsaved comment drafts?', { modal: true }, 'Discard');
                if (choice !== 'Discard') { return; }
            }
            state.closed = true; state.thread.dispose(); this.states.delete(key);
        }
    }
    /** Dispose all comment threads belonging to closed program `md5`. */
    close(md5: string): void {
        for (const [key, state] of this.states) {
            if (state.md5 === md5) { state.closed = true; state.thread.dispose(); this.states.delete(key); }
        }
    }
    /** Clear timers and dispose all comment threads and controllers. */
    dispose(): void {
        for (const state of this.states.values()) { state.closed = true; }
        for (const timer of this.pending.values()) { clearTimeout(timer); }
        this.states.clear(); this.pending.clear();
        this.disposables.forEach(item => item.dispose()); this.controller.dispose();
    }
}
