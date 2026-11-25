// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

import * as vscode from 'vscode';

/** Regular expression that matches VS Code codicon tokens such as `$(edit)` or `$(sync~spin)`. */
const codiconPattern = /\$\([a-z0-9-]+(?:~[a-z0-9-]+)?\)\s*/gi;

/** Plural forms for symbol group names returned by `ghidra-mcp`. */
const groupNouns: Readonly<Record<string, readonly [string, string]>> = {
    function: ['function', 'functions'],
    functions: ['function', 'functions'],
    label: ['label', 'labels'],
    labels: ['label', 'labels'],
    global: ['global', 'globals'],
    globals: ['global', 'globals'],
    constant: ['constant', 'constants'],
    constants: ['constant', 'constants'],
    parameter: ['parameter', 'parameters'],
    parameters: ['parameter', 'parameters'],
    local: ['local', 'locals'],
    'local var': ['local', 'locals'],
    namespace: ['namespace', 'namespaces'],
    class: ['class', 'classes'],
};

/** Remove VS Code `$(icon)` tokens and collapse whitespace into one line. */
export function stripCodicons(text: string): string {
    return text.replace(codiconPattern, '').replace(/\s+/g, ' ').trim();
}

/** Collapse whitespace and truncate long inline metadata to `maxLength` characters on one line. */
export function inlineText(value: string | undefined, maxLength = 48): string {
    if (!value) { return ''; }
    const singleLine = stripCodicons(value);
    if (singleLine.length <= maxLength) { return singleLine; }
    return `${singleLine.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

/** Format `count` with an explicit singular or plural count noun. */
export function countLabel(count: number, singular: string, plural = `${singular}s`): string {
    return `${count} ${count === 1 ? singular : plural}`;
}

/** Format a symbol group count with a domain-specific singular or plural noun. */
export function groupCountLabel(group: string, count: number): string {
    const pair = groupNouns[group.trim().toLowerCase()] || ['symbol', 'symbols'];
    return countLabel(count, pair[0], pair[1]);
}

/** Return the platform keyboard shortcut label for saving a pending rename. */
export function saveShortcut(platform: NodeJS.Platform = process.platform): string {
    return platform === 'darwin' ? 'Cmd+S' : 'Ctrl+S';
}

/** Extract the plain visible text from a `TreeItem.label` value. */
function plainTreeLabel(label: string | vscode.TreeItemLabel | undefined): string {
    if (typeof label === 'string') { return label; }
    return label ? label.label : '';
}

/** Join unique, non-empty accessible name parts while keeping the visible label first. */
function joinAccessibleParts(lead: string, parts: ReadonlyArray<string | boolean | undefined>): string {
    const head = stripCodicons(lead);
    const seen = new Set<string>(head ? [head.toLowerCase()] : []);
    const items = head ? [head] : [];
    for (const part of parts) {
        if (typeof part !== 'string') { continue; }
        const clean = stripCodicons(part);
        if (!clean) { continue; }
        const key = clean.toLowerCase();
        if (seen.has(key)) { continue; }
        seen.add(key);
        items.push(clean);
    }
    return items.join(', ');
}

/** Build button `AccessibilityInformation` starting with the codicon-free visible status text. */
export function statusAccessibility(
    visibleText: string,
    ...notes: ReadonlyArray<string | undefined>
): vscode.AccessibilityInformation {
    return {
        label: joinAccessibleParts(visibleText, notes),
        role: 'button',
    };
}

/** Build tree-row `AccessibilityInformation` starting with the visible `TreeItem.label`. */
export function treeAccessibility(
    label: string | vscode.TreeItemLabel | undefined,
    ...details: ReadonlyArray<string | boolean | undefined>
): vscode.AccessibilityInformation {
    return {
        label: joinAccessibleParts(plainTreeLabel(label), details),
    };
}
