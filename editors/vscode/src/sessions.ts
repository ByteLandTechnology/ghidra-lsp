// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

import * as vscode from 'vscode';
import { ProgramContext } from './context';
import { Call } from './memory';
import { formatFriendlyError } from './error';

/** Active import or analysis operation tracked by the Sessions view. */
export interface ActiveTask {
    token: string;
    name: string;
    md5?: string;
    stage: string;
    detail?: string;
    percentage?: number;
    startTime: number;
    cancellable: boolean;
    background?: boolean;
    cancel?: () => void;
}

/** Tracks in-flight binary import and Ghidra analysis tasks. */
export class AnalysisTracker implements vscode.Disposable {
    /** Active tasks keyed by operation token. */
    private readonly tasks = new Map<string, ActiveTask>();
    /** Emitter fired when tracked tasks start, update, or finish. */
    private readonly changed = new vscode.EventEmitter<void>();
    /** Event fired when the active task list changes. */
    readonly onDidChange = this.changed.event;

    /** Register a new active analysis task. */
    start(task: ActiveTask): void {
        this.tasks.set(task.token, task);
        this.changed.fire();
    }

    /** Apply partial progress fields to an existing tracked task. */
    update(token: string, update: Partial<ActiveTask>): void {
        const existing = this.tasks.get(token);
        if (existing) {
            Object.assign(existing, update);
            this.changed.fire();
        }
    }

    /** Remove a finished or canceled task from the tracker. */
    finish(token: string): void {
        if (this.tasks.delete(token)) {
            this.changed.fire();
        }
    }

    /** Return all currently active analysis tasks. */
    get active(): ActiveTask[] {
        return [...this.tasks.values()];
    }

    /** Return true when at least one task is in progress. */
    get hasActive(): boolean {
        return this.tasks.size > 0;
    }

    /** Trigger cancellation callbacks on all cancellable active tasks. */
    cancelAll(): void {
        for (const task of this.tasks.values()) {
            if (task.cancellable && task.cancel) {
                task.cancel();
            }
        }
    }

    /** Clear tracked tasks and dispose the change emitter. */
    /** Dispose event emitters and listeners owned by the Sessions view. */
    dispose(): void {
        this.tasks.clear();
        this.changed.dispose();
    }
}

/** Server session summary returned by `ghidra.sessions`. */
export interface SessionInfo {
    md5: string;
    status: string;
    fileName?: string;
    name?: string;
    path?: string;
}

/** Return true when `session` is still open or active on the backend. */
export function isOpenSession(session: SessionInfo): boolean {
    return !['closed', 'killed', 'failed', 'error'].includes(session.status);
}

/** Tree item representing a running task, program session, or placeholder entry. */
export class SessionNode extends vscode.TreeItem {
    /** Construct one tree node for the Sessions sidebar view. */
    constructor(
        label: string,
        collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None,
        readonly nodeType: 'task' | 'session' | 'empty',
        readonly md5?: string,
        readonly task?: ActiveTask,
        readonly filePath?: string,
    ) {
        super(label, collapsibleState);
    }
}

/** Sidebar tree provider showing active tasks, open sessions, and recent programs. */
export class SessionsView implements vscode.TreeDataProvider<SessionNode>, vscode.Disposable {
    /** Emitter for VS Code tree refresh events. */
    private readonly changed = new vscode.EventEmitter<SessionNode | undefined | null | void>();
    /** Event fired when the Sessions tree contents change. */
    readonly onDidChangeTreeData = this.changed.event;
    /** Event subscriptions owned by this view provider. */
    private readonly disposables: vscode.Disposable[] = [];
    /** Bound VS Code tree view handle used to update header counts. */
    private view?: { title?: string; description?: string };
    /** Latest session entries retrieved from `ghidra.sessions`. */
    private serverSessions: SessionInfo[] = [];

    /** Subscribe to tracker and program-context updates. */
    constructor(
        private readonly call: Call,
        private readonly context: ProgramContext,
        private readonly tracker: AnalysisTracker,
    ) {
        this.disposables.push(
            this.changed,
            this.tracker.onDidChange(() => this.refresh()),
            this.context.onDidChange(() => this.refresh()),
        );
    }

    /** Bind the VS Code tree view handle so the header count stays current. */
    bind(view: { title?: string; description?: string }): void {
        this.view = view;
        this.syncCount();
    }

    /** Update the tree view description badge with `count`. */
    private applyCount(count: number): void {
        if (!this.view) { return; }
        this.view.description = count > 0 ? String(count) : undefined;
    }

    /** Recompute and apply the session and task count in the view header. */
    private syncCount(): void {
        if (!this.view) { return; }
        const ids = new Set<string>();
        for (const program of this.context.recent) {
            ids.add(program.md5.toLowerCase());
        }
        for (const session of this.serverSessions) {
            const md5 = session.md5.toLowerCase();
            if (['failed', 'error'].includes(session.status) && !ids.has(md5)) { continue; }
            ids.add(md5);
        }
        const tasked = new Set<string>();
        let extra = 0;
        for (const task of this.tracker.active) {
            const md5 = task.md5?.toLowerCase();
            if (!md5) { extra++; continue; }
            ids.add(md5);
            if (tasked.has(md5)) { extra++; }
            else { tasked.add(md5); }
        }
        this.applyCount(ids.size + extra);
    }

    /** Refresh the session count badge and notify the tree view to reload. */
    refresh(): void {
        this.syncCount();
        this.changed.fire();
    }

    /** Return the VS Code tree item representation for `element`. */
    getTreeItem(element: SessionNode): vscode.TreeItem {
        return element;
    }

    /** Load active tasks, server sessions, and recent programs as root tree items. */
    async getChildren(element?: SessionNode): Promise<SessionNode[]> {
        if (element) { return []; }

        type Entry = { md5: string; name: string; path?: string; lastUsed: number; status: string; task?: ActiveTask };
        const entries = new Map<string, Entry>();
        for (const program of this.context.recent) {
            const md5 = program.md5.toLowerCase();
            entries.set(md5, { ...program, md5, status: 'saved' });
        }

        let failure: unknown;
        try {
            const result = await this.call<{ sessions: SessionInfo[] }>('ghidra.sessions');
            this.serverSessions = result.sessions || [];
            for (const session of this.serverSessions) {
                const md5 = session.md5.toLowerCase();
                const entry = entries.get(md5);
                // Failed imports without a saved program should not become permanent entries.
                if (['failed', 'error'].includes(session.status) && !entry) { continue; }
                entries.set(md5, {
                    md5,
                    name: entry?.name && entry.name.toLowerCase() !== md5 ? entry.name : session.fileName || session.name || entry?.name || md5,
                    path: entry?.path || session.path,
                    lastUsed: entry?.lastUsed || 0,
                    status: session.status,
                });
            }
        } catch (error) { failure = error; }

        const extraTasks: ActiveTask[] = [];
        for (const task of this.tracker.active) {
            const md5 = task.md5?.toLowerCase();
            if (!md5) { extraTasks.push(task); continue; }
            let entry = entries.get(md5);
            if (!entry) {
                entry = { md5, name: task.name, lastUsed: task.startTime, status: 'opening' };
                entries.set(md5, entry);
            }
            if (entry.task) { extraTasks.push(task); }
            else { entry.task = task; }
        }

        const taskDescription = (task: ActiveTask): string => {
            const stage = task.stage === 'import' ? (task.background ? 'Background import' : 'Importing') : (task.background ? 'Background' : 'Analyzing');
            const percent = typeof task.percentage === 'number' ? ` ${Math.round(task.percentage)}%` : '';
            return `${stage}${percent}`;
        };
        const taskTooltip = (task: ActiveTask): string => {
            const elapsed = Math.max(1, Math.floor((Date.now() - task.startTime) / 1000));
            return `${taskDescription(task)}${task.detail ? ` · ${task.detail}` : ''}\nElapsed: ${elapsed}s\nStopping the wait does not stop the background task.`;
        };
        const taskNode = (task: ActiveTask): SessionNode => {
            const node = new SessionNode(task.name, vscode.TreeItemCollapsibleState.None, 'task', task.md5, task);
            node.id = `task:${task.token}`;
            node.description = taskDescription(task);
            node.iconPath = new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('progressBar.background'));
            node.tooltip = `Program: ${task.name}\n${taskTooltip(task)}`;
            node.contextValue = task.cancellable ? 'ghidra.activeTask' : 'ghidra.backgroundTask';
            return node;
        };

        const current = this.context.current?.toLowerCase();
        const rank = (entry: Entry): number => entry.task ? 0 : entry.status === 'ready' && entry.md5 === current ? 1
            : entry.status === 'ready' ? 2 : ['closed', 'killed', 'stale', 'disconnected', 'saved', 'failed', 'error'].includes(entry.status) ? 4 : 3;
        const names = new Map<string, Entry[]>();
        for (const entry of entries.values()) {
            const key = entry.name.toLowerCase();
            names.set(key, [...(names.get(key) || []), entry]);
        }
        const nodes = extraTasks.map(taskNode);
        for (const entry of [...entries.values()].sort((a, b) => rank(a) - rank(b) || b.lastUsed - a.lastUsed)) {
            const ready = entry.status === 'ready';
            const active = ready && entry.md5 === current;
            const recoverable = ['closed', 'killed', 'stale', 'disconnected', 'saved', 'failed', 'error'].includes(entry.status);
            const status = ({ ready: active ? 'Current' : 'Open', closed: 'Closed', killed: 'Stopped', stale: 'Disconnected',
                disconnected: 'Disconnected', saved: failure ? 'Unknown' : 'Not open', failed: 'Error', error: 'Error' } as Record<string, string>)[entry.status] || entry.status;
            const node = new SessionNode(entry.name, vscode.TreeItemCollapsibleState.None, 'session', entry.md5, entry.task, entry.path);
            node.id = `session:${entry.md5}`;
            const sameName = names.get(entry.name.toLowerCase()) || [];
            let idLength = 8;
            while (idLength < entry.md5.length && sameName.some(other => other.md5 !== entry.md5 && other.md5.slice(0, idLength) === entry.md5.slice(0, idLength))) { idLength += 4; }
            const description = entry.task ? `${active ? 'Current · ' : ''}${taskDescription(entry.task)}` : status;
            node.description = sameName.length > 1 ? `${entry.md5.slice(0, idLength)} · ${description}` : description;
            node.iconPath = entry.task || (!ready && !recoverable)
                ? new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('progressBar.background'))
                : active ? new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed')) : new vscode.ThemeIcon('file-binary');
            const action = ready ? 'Click to switch sessions' : recoverable && !entry.task ? 'Click to reopen' : 'Waiting for analysis';
            node.tooltip = `Program: ${entry.name}\nStatus: ${status}\nMD5: ${entry.md5}${entry.path ? `\nPath: ${entry.path}` : ''}${entry.task ? `\n${taskTooltip(entry.task)}` : ''}\n${action}`;
            if (ready) {
                node.contextValue = active ? 'ghidra.activeSession' : 'ghidra.session';
                if (entry.task?.cancellable) { node.contextValue += 'Task'; }
                node.command = { command: 'ghidraLsp.selectSessionItem', title: 'Switch session', arguments: [entry.md5, entry.name] };
            } else if (entry.task) {
                node.contextValue = entry.task.cancellable ? 'ghidra.activeTask' : 'ghidra.backgroundTask';
            } else if (recoverable) {
                node.contextValue = 'ghidra.recentItem';
                node.command = { command: 'ghidraLsp.openRecentItem', title: 'Reopen session', arguments: [entry.md5] };
            } else { node.contextValue = 'ghidra.analyzingSession'; }
            nodes.push(node);
        }
        if (failure) {
            const error = new SessionNode('Unable to load sessions', vscode.TreeItemCollapsibleState.None, 'empty');
            error.iconPath = new vscode.ThemeIcon('warning');
            error.tooltip = formatFriendlyError(failure);
            error.command = { command: 'ghidraLsp.refreshSessions', title: 'Retry' };
            nodes.unshift(error);
        }
        if (!nodes.length) {
            const empty = new SessionNode('Open binary', vscode.TreeItemCollapsibleState.None, 'empty');
            empty.iconPath = new vscode.ThemeIcon('add');
            empty.command = { command: 'ghidraLsp.openBinary', title: 'Open binary' };
            nodes.push(empty);
        }
        this.applyCount(nodes.filter(node => node.nodeType !== 'empty').length);
        return nodes;
    }

    /** Dispose event emitters and listeners owned by the Sessions view. */
    dispose(): void {
        this.disposables.forEach(d => d.dispose());
    }
}
