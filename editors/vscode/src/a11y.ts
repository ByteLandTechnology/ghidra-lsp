// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

/** Shared accessible-name and canonical tree-identity builders for VS Code status and tree controls. */

import type * as vscode from 'vscode';
import { displayAddress, fullSymbolName, SymbolName } from './names';

/** Human-readable status bar item names shown in VS Code status bar settings and menus. */
export const statusNames = {
    /** Status bar entry name for the active Ghidra program overview button. */
    programOverview: 'Ghidra program overview',
    /** Status bar entry name for background import and analysis progress. */
    analysisProgress: 'Ghidra analysis progress',
    /** Status bar entry name for uncommitted symbol rename previews. */
    pendingRename: 'Ghidra pending rename',
    /** Status bar entry name for unmapped binary address references. */
    addressReferences: 'Ghidra binary address references',
} as const;

/** Minimal task fields needed to announce background import or analysis progress. */
export interface AnalysisStatusTask {
    /** Program display name for the running task. */
    name: string;
    /** Task stage identifier such as `import` or `analysis`. */
    stage: string;
    /** Optional analyzer phase or step description. */
    detail?: string;
    /** Optional completion percentage from 0 to 100. */
    percentage?: number;
    /** True when the user dismissed the foreground progress wait. */
    background?: boolean;
    /** True when foreground waiting can still be stopped. */
    cancellable?: boolean;
}

/** Minimal pending-rename fields needed to announce uncommitted symbol renames. */
export interface RenameStatusPlan {
    /** Original symbol identifier before the pending rename. */
    oldName: string;
    /** New symbol identifier in the pending rename preview. */
    newName: string;
}

/** Metadata fields needed to build an accessible label for a row in the Sessions tree. */
export interface SessionEntrySummary {
    /** Program display name. */
    name: string;
    /** Raw backend or local session status key. */
    rawStatus: string;
    /** Human-readable status label shown in the row description and tooltip. */
    statusLabel: string;
    /** True when this session is ready and selected as the active program. */
    active: boolean;
    /** True when this session is open and ready on the backend. */
    ready: boolean;
    /** True when this session can be reopened from local or server state. */
    recoverable: boolean;
    /** Optional shortened MD5 prefix used to disambiguate duplicate binary names. */
    md5Prefix?: string;
    /** Optional binary file path on disk. */
    filePath?: string;
    /** Optional active import or analysis task running on this session. */
    task?: AnalysisStatusTask;
}

/** Remove VS Code `$(icon)` codicon tokens and collapse repeated whitespace. */
export function stripCodicons(value: string): string {
    return value.replace(/\$\([a-z0-9-]+(?:~[a-z0-9-]+)?\)/gi, '').replace(/\s+/g, ' ').trim();
}

/** Build `AccessibilityInformation` with a `button` role for a status bar control. */
export function statusAccessibility(label: string): vscode.AccessibilityInformation {
    return { label: stripCodicons(label), role: 'button' };
}

/** Build `AccessibilityInformation` with a `treeitem` role for a sidebar tree row. */
export function treeAccessibility(label: string): vscode.AccessibilityInformation {
    return { label: stripCodicons(label), role: 'treeitem' };
}

/** Format an integer count with a singular or plural unit noun. */
export function countLabel(count: number, singular: string, plural = `${singular}s`): string {
    return `${count} ${count === 1 ? singular : plural}`;
}

/** Build a canonical segment string for stable `TreeItem.id` derivation. */
export function canonicalTreeSegment(kind: string, value: string): string {
    return `${kind}:${encodeURIComponent(value)}`;
}

/** Return true when running on macOS or Apple browser platforms. */
function isMacPlatform(): boolean {
    const nodePlatform: string | undefined = typeof process !== 'undefined' ? process.platform : undefined;
    if (nodePlatform && nodePlatform !== 'browser') {
        return nodePlatform === 'darwin';
    }
    const nav = (globalThis as {
        navigator?: { userAgentData?: { platform?: string }; platform?: string; userAgent?: string };
    }).navigator;
    const platform = nav?.userAgentData?.platform || nav?.platform || nav?.userAgent || '';
    return /Mac|iPhone|iPad|iPod/i.test(platform);
}

/** Return the platform shortcut bound to `ghidraLsp.saveRename` in `package.json`. */
export function saveRenameShortcut(): string {
    return isMacPlatform() ? 'Cmd+S' : 'Ctrl+S';
}

/** Format a canonical Ghidra address with explicit `ram` or custom space context for speech. */
export function accessibleAddress(address: string): string {
    const shown = displayAddress(address);
    return shown !== address ? `ram address ${shown}` : `address ${address}`;
}

/** Format the human-readable stage and optional percentage for an import or analysis task. */
function formatTaskProgress(task: AnalysisStatusTask): string {
    const stage = task.stage === 'import'
        ? (task.background ? 'Background import' : 'Importing')
        : (task.background ? 'Background analysis' : 'Analyzing');
    const percent = typeof task.percentage === 'number' ? ` ${Math.round(task.percentage)}%` : '';
    const phase = task.detail ? `, phase ${task.detail}` : '';
    return `${stage}${percent}${phase}`;
}

/** Build the status bar accessible label for the active program overview item. */
export function programStatusAccessibility(program: string, entry?: string, address?: string): vscode.AccessibilityInformation {
    const parts = [`${statusNames.programOverview}: ${program}`];
    if (entry) { parts.push(entry); }
    if (address) { parts.push(`address ${address}`); }
    return statusAccessibility(parts.join(', '));
}

/** Build the status bar accessible label for active import and analysis tasks. */
export function analysisStatusAccessibility(tasks: readonly AnalysisStatusTask[]): vscode.AccessibilityInformation {
    if (!tasks.length) { return statusAccessibility(`Show ${statusNames.analysisProgress}`); }
    const latest = tasks[tasks.length - 1];
    const progress = formatTaskProgress(latest);
    if (tasks.length === 1) {
        return statusAccessibility(`Show ${statusNames.analysisProgress}: ${latest.name}, ${progress}`);
    }
    return statusAccessibility(
        `Show ${statusNames.analysisProgress}: ${countLabel(tasks.length, 'analysis task')}, latest ${latest.name}, ${progress}`,
    );
}

/** Build the status bar accessible label for uncommitted symbol rename previews. */
export function renameStatusAccessibility(plans: readonly RenameStatusPlan[]): vscode.AccessibilityInformation {
    const shortcut = saveRenameShortcut();
    if (!plans.length) {
        return statusAccessibility(`${statusNames.pendingRename}: press ${shortcut} in the origin view to save`);
    }
    const latest = plans[plans.length - 1];
    const prefix = plans.length === 1
        ? `${statusNames.pendingRename}: ${latest.oldName} to ${latest.newName}`
        : `Ghidra pending renames: ${countLabel(plans.length, 'pending rename')}, latest ${latest.oldName} to ${latest.newName}`;
    return statusAccessibility(`${prefix}. Activate to open origin view, then press ${shortcut} to save`);
}

/** Build the status bar accessible label for unmapped binary address references. */
export function referenceStatusAccessibility(count: number, name: string, address?: string): vscode.AccessibilityInformation {
    const target = address ? `${name}, ${accessibleAddress(address)}` : name;
    return statusAccessibility(`Ghidra: ${countLabel(count, 'binary address reference')}, ${target}`);
}

/** Build the accessible label for a top-level symbol group node in the Symbols tree. */
export function symbolGroupAccessibility(name: string, count: number): vscode.AccessibilityInformation {
    return treeAccessibility(`${name}, ${countLabel(count, 'item')}, counted in scanned address spaces only`);
}

/** Build the accessible label for a C++ namespace or template specialization folder node. */
export function namespaceFolderAccessibility(
    segment: string,
    parentScope: string,
    count: number,
): vscode.AccessibilityInformation {
    const scope = parentScope ? `namespace in ${parentScope}` : 'namespace';
    return treeAccessibility(`${segment}, ${scope}, ${countLabel(count, 'item')}`);
}

/** Append optional namespace and raw mangled symbol qualifiers to a symbol speech parts list. */
function appendSymbolQualifiers(parts: string[], full: string, symbol: SymbolName & { name: string; namespace?: string }): void {
    if (symbol.namespace && symbol.namespace !== 'Global' && full !== symbol.namespace && !full.startsWith(`${symbol.namespace}::`)) {
        parts.push(`namespace ${symbol.namespace}`);
    }
    if (typeof symbol.demangled_name === 'string' && symbol.demangled_name && symbol.name && symbol.name !== symbol.demangled_name) {
        parts.push(`mangled ${symbol.name}`);
    }
}

/** Build the accessible label for a function leaf node in the Symbols tree. */
export function functionNodeAccessibility(
    fn: SymbolName & { name: string; entry: string; namespace?: string },
): vscode.AccessibilityInformation {
    const full = fullSymbolName(fn, true);
    const parts = [full, 'Function'];
    appendSymbolQualifiers(parts, full, fn);
    parts.push(accessibleAddress(fn.entry));
    return treeAccessibility(parts.join(', '));
}

/** Build the accessible label for a non-function symbol leaf node in the Symbols tree. */
export function symbolNodeAccessibility(
    symbol: SymbolName & { name: string; type: string; address: string; namespace?: string },
): vscode.AccessibilityInformation {
    const full = fullSymbolName(symbol, true);
    const kind = /symbol$/i.test(symbol.type) ? symbol.type : `${symbol.type} symbol`;
    const parts = [full, kind];
    appendSymbolQualifiers(parts, full, symbol);
    parts.push(accessibleAddress(symbol.address));
    return treeAccessibility(parts.join(', '));
}

/** Build the accessible label for a folder node in the Data Types tree. */
export function typeCategoryAccessibility(
    segment: string,
    categoryPath: string,
    count: number,
): vscode.AccessibilityInformation {
    const pathDetail = categoryPath !== `/${segment}` ? ` ${categoryPath}` : '';
    return treeAccessibility(`${segment}, data type category${pathDetail}, ${countLabel(count, 'item')}`);
}

/** Build the accessible label for a data type leaf node in the Data Types tree. */
export function typeNodeAccessibility(type: { name: string; kind: string; path: string }): vscode.AccessibilityInformation {
    return treeAccessibility(`${type.name}, ${type.kind} data type, path ${type.path}`);
}

/** Build the accessible label for a standalone task row in the Sessions tree. */
export function sessionTaskAccessibility(task: AnalysisStatusTask, elapsedSeconds: number): vscode.AccessibilityInformation {
    const recovery = task.cancellable ? 'Stop waiting continues task in background' : 'Running in background';
    return treeAccessibility(
        `${task.name}, active task in progress, ${formatTaskProgress(task)}, elapsed ${countLabel(elapsedSeconds, 'second')}. ${recovery}`,
    );
}

/** Describe the icon state of a session row in the Sessions tree. */
function describeSessionState(entry: SessionEntrySummary): string {
    if (entry.active) { return 'active current session'; }
    if (entry.task || (!entry.ready && !entry.recoverable)) { return 'in progress'; }
    if (entry.ready) { return 'open session'; }
    switch (entry.rawStatus) {
        case 'failed':
        case 'error':
            return 'session error';
        case 'stale':
        case 'disconnected':
            return 'disconnected session';
        case 'closed':
            return 'closed session';
        case 'killed':
            return 'stopped session';
        default:
            return 'saved program';
    }
}

/** Build the accessible label for a program session row in the Sessions tree. */
export function sessionEntryAccessibility(entry: SessionEntrySummary): vscode.AccessibilityInformation {
    const parts = [entry.name, describeSessionState(entry), `status ${entry.statusLabel}`];
    if (entry.md5Prefix) { parts.push(`MD5 ${entry.md5Prefix}`); }
    if (entry.filePath) { parts.push(`path ${entry.filePath}`); }
    if (entry.task) { parts.push(formatTaskProgress(entry.task)); }
    const recovery = entry.ready
        ? 'Activate to switch session'
        : entry.recoverable && !entry.task
            ? 'Activate to reopen session'
            : entry.task?.cancellable
                ? 'Waiting for analysis; stop waiting continues task in background'
                : 'Waiting for analysis';
    return treeAccessibility(`${parts.join(', ')}. ${recovery}`);
}

/** Remove trailing periods from an error message before joining sentences. */
function trimPeriod(value: string): string {
    return value.trim().replace(/\.+$/, '');
}

/** Build the accessible label for the daemon error row in the Sessions tree. */
export function sessionErrorAccessibility(reason: string): vscode.AccessibilityInformation {
    return treeAccessibility(`Unable to load sessions, warning: ${trimPeriod(reason)}. Activate to retry loading sessions`);
}

/** Build the accessible label for the empty-state prompt row in the Sessions tree. */
export function sessionEmptyAccessibility(): vscode.AccessibilityInformation {
    return treeAccessibility('Open binary, empty state: no open or recent Ghidra sessions. Activate to choose a local binary');
}

/** Build the accessible label for a defined string row in the Strings tree. */
export function stringNodeAccessibility(
    label: string,
    item: { address: string; length: string; type: string },
): vscode.AccessibilityInformation {
    const text = label === '""' ? '"" empty string' : label;
    const kind = item.type ? `${item.type} string` : 'string';
    const lengthNumber = Number(item.length);
    const bytes = Number.isFinite(lengthNumber) && item.length.trim() !== ''
        ? countLabel(lengthNumber, 'byte')
        : item.length ? `${item.length} bytes` : '';
    const parts = [text, kind];
    if (bytes) { parts.push(bytes); }
    parts.push(accessibleAddress(item.address));
    return treeAccessibility(parts.join(', '));
}

/** Build the accessible label for the empty-state row in the Strings tree. */
export function stringEmptyAccessibility(): vscode.AccessibilityInformation {
    return treeAccessibility(
        'No defined strings, info: Ghidra has not defined any strings in the default address space. Analyze the program, then refresh this view',
    );
}

/** Build the accessible label for the load-failure retry row in the Strings tree. */
export function stringErrorAccessibility(reason: string): vscode.AccessibilityInformation {
    return treeAccessibility(`Retry loading strings, error: Could not load strings, ${trimPeriod(reason)}. Activate to refresh strings`);
}
