// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

import type { CallDirection, CallFunction, CallRecord } from './call-graph';
import { callIcon } from './call-graph-icons';
import { displayAddress } from './names';
import { escapeHtml } from './workbench-page';

/** Maximum call-column depth allowed for one exploration path. */
export const columnPathLimit = 20;
/** Maximum number of function rows displayed in a single call column. */
const rowLimit = 200;
/** Normalize a function entry address for case-insensitive map keys. */
const key = (entry: string): string => {
    const split = entry.lastIndexOf(':') + 1;
    return entry.slice(0, split) + entry.slice(split).toLowerCase();
};
/** One row in a call column representing a caller or callee function. */
export interface CallColumnRow extends CallFunction { sites: string[]; cycleAt?: number }
/** One column of caller or callee rows for a selected source function. */
export interface CallColumn { source: CallFunction; rows: CallColumnRow[]; selected?: string; error?: string; limited: boolean }
/** Full Miller-column model for recursive caller or callee browsing. */
export interface CallColumns { root: CallFunction; direction: CallDirection; path: string[]; columns: CallColumn[] }

/** Follow one real call path; siblings share a column and cycles return to an existing source. */
export async function collectColumns(root: CallFunction, direction: CallDirection, path: string[],
    read: (entry: string, direction: CallDirection) => Promise<CallRecord[]>, current: () => boolean = () => true): Promise<CallColumns> {
    const model: CallColumns = { root, direction, path: [], columns: [] };
    const trail = [root];
    for (let index = 0; index <= Math.min(path.length, columnPathLimit) && current(); index++) {
        const source = trail[index];
        let records: CallRecord[];
        try { records = await read(source.entry, direction); }
        catch (error) { model.columns.push({ source, rows: [], error: String(error), limited: false }); break; }
        if (!current()) { break; }
        const unique = new Map<string, CallColumnRow>();
        for (const record of records) {
            if (!record.entry) { continue; }
            const id = key(record.entry);
            let row = unique.get(id);
            if (!row) {
                const cycleAt = trail.findIndex(fn => key(fn.entry) === id);
                row = { entry: record.entry, name: record.name || record.entry, sites: [], ...(cycleAt >= 0 ? { cycleAt } : {}) };
                unique.set(id, row);
            }
            if (record.callSite && !row.sites.includes(record.callSite)) { row.sites.push(record.callSite); }
        }
        const rows = [...unique.values()].sort((a, b) => a.name.localeCompare(b.name) || a.entry.localeCompare(b.entry)).slice(0, rowLimit);
        const next = path[index] && rows.find(row => key(row.entry) === key(path[index]));
        const selected = next && next.cycleAt === undefined && index < columnPathLimit ? next : undefined;
        model.columns.push({ source, rows, selected: selected?.entry, limited: unique.size > rowLimit });
        if (!selected) { break; }
        model.path.push(selected.entry); trail.push(selected);
    }
    return model;
}

/** Render the call-column Miller browser HTML for a collected call path. */
export function callColumns(model: CallColumns): string {
    const e = escapeHtml, noun = model.direction === 'callers' ? 'Callers' : 'Callees';
    const rowId = (index: number, entry: string): string => `call-column-row-${index}-${encodeURIComponent(entry)}`;
    const trail = [model.root, ...model.columns.slice(1).map(column => column.source)];
    return `<div class="call-columns" data-call-columns data-root="${e(model.root.entry)}" data-direction="${model.direction}" data-path="${e(JSON.stringify(model.path))}">
    <div class="call-column-navigation"><div class="call-direction" role="group" aria-label="Call direction">${(['callers', 'callees'] as const).map(direction => {
        const label = direction === 'callers' ? 'Callers' : 'Callees';
        return `<button id="call-direction-${direction}" data-column-direction="${direction}" aria-pressed="${direction === model.direction}" aria-label="${label}" title="${label}">${callIcon(direction === 'callers' ? 'callIncoming' : 'callOutgoing')}<span>${label}</span></button>`;
    }).join('')}</div><nav class="call-column-trail" aria-label="Call path">${trail.map((fn, index) => `${index ? callIcon('right') : ''}<button data-column-trail="${index}" title="${e(fn.name)} · ${e(fn.entry)}" ${index === trail.length - 1 ? 'aria-current="location"' : ''}>${e(fn.name)}</button>`).join('')}</nav></div>
    <div class="call-column-strip" tabindex="-1" aria-label="Function call columns">${model.columns.map((column, index) => `<section class="call-column" data-column="${index}" data-source="${e(column.source.entry)}" aria-label="${e(`${noun} of ${column.source.name}`)}"><header class="call-column-heading"><h2 title="${e(column.source.name)}">${e(column.source.name)}</h2><button id="call-column-source-${index}" tabindex="-1" class="call-column-source-code" data-entry="${e(column.source.entry)}" data-label="${e(column.source.name)}" aria-label="${e(`Decompile ${column.source.name}`)}" title="${e(`Decompile ${column.source.name}`)}">${callIcon('decompile')}</button><span>${column.error ? 'Could not load calls' : `${column.rows.length}${column.limited ? '+' : ''} ${column.rows.length === 1 ? noun.toLowerCase().slice(0, -1) : noun.toLowerCase()}`}</span></header><div class="call-column-list" role="group" aria-label="${e(`${noun} of ${column.source.name}`)}">${column.rows.map(row => `<div class="call-column-row${column.selected === row.entry ? ' is-selected' : ''}" data-entry="${e(row.entry)}" data-label="${e(row.name)}"><button id="${rowId(index, row.entry)}" tabindex="-1" class="call-column-pick" ${index >= columnPathLimit && row.cycleAt === undefined ? 'disabled ' : ''}aria-pressed="${column.selected === row.entry}" data-column-index="${index}" data-entry="${e(row.entry)}" ${row.cycleAt !== undefined ? `data-cycle-at="${row.cycleAt}"` : ''} title="${e(`${row.name}\n${row.entry}${row.sites.length ? `\nCall sites: ${row.sites.join(', ')}` : ''}${row.cycleAt !== undefined ? '\nRecursive path — return to this function' : ''}`)}">${callIcon('function')}<span class="call-column-name">${e(row.name)}</span><span class="call-column-addr">${e(displayAddress(row.sites[0] || row.entry))}</span>${callIcon(row.cycleAt !== undefined ? 'back' : 'right', 'call-column-chevron')}<span class="sr-only">${row.cycleAt !== undefined ? 'Return to function already in this path' : `Browse ${column.rows.length === 1 ? noun.toLowerCase().slice(0, -1) : noun.toLowerCase()}`}</span></button><button id="call-column-code-${index}-${encodeURIComponent(row.entry)}" tabindex="-1" class="call-column-code" aria-label="${e(`Decompile ${row.name}`)}" title="${e(`Decompile ${row.name}`)}">${callIcon('decompile')}</button></div>`).join('')}${column.error ? `<div class="call-column-empty" role="alert"><p>Could not load ${noun.toLowerCase()}.</p><p>${e(column.error)}</p><button id="call-column-retry-${index}" tabindex="-1" data-action="refresh">Retry</button></div>` : !column.rows.length ? `<div class="call-column-empty"><p>No ${noun.toLowerCase()}</p></div>` : ''}<p class="call-column-no-matches" hidden>No matching functions in this column.</p></div>${column.limited ? '<p class="call-column-limit" role="status">Showing the first 200 functions.</p>' : ''}</section>`).join('')}</div>${model.path.length === columnPathLimit ? '<p class="call-column-limit" role="status">Path limit reached. Choose an earlier function to explore another branch.</p>' : ''}</div>`;
}
