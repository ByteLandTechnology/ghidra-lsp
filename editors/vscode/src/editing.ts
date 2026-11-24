// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

import * as vscode from 'vscode';
import { Call } from './memory';
import { ProgramContext } from './context';
import { DataTypeFiles, typePath, typeScheme } from './type-files';
import { Data, object, rows, escape, reference, typeReference, integer, page, section } from './web';
import { formatFriendlyError } from './error';
import { CodeLocation, cursorLocation } from './location';
import { commentKinds, CommentKind, InlineComments } from './inline-comments';
import { callIcon } from './call-graph-icons';

/** Input control descriptor inside a graphical edit form. */
interface Field { key: string; label: string; value?: unknown; placeholder?: string; kind?: 'text' | 'number' | 'textarea' | 'checkbox' | 'type'; readonly?: boolean; autofocus?: boolean; }
/** Column descriptor for an editable table grid inside a form. */
interface Column { key: string; label: string; kind?: 'number' | 'type'; }
/** Editable table specification inside a graphical edit form. */
interface Grid { key: string; label: string; columns: Column[]; values: Data[]; add?: boolean; remove?: boolean; reorder?: boolean; }
/** Form values and table rows posted back from the edit webview. */
interface Submission { values: Data; tables: Record<string, Data[]>; }
/** Single backend mutation operation sent to `ghidra.mutate`. */
interface Mutation { method: string; arguments: Data; }
/** Read and trim a string field value from form data. */
const value = (data: Data, key: string): string => String(data[key] ?? '').trim();
/** Read a non-empty trimmed string field or throw a validation error naming `label`. */
const required = (data: Data, key: string, label: string): string => {
    const result = value(data, key);
    if (!result) { throw new Error(`${label} is required.`); }
    return result;
};
/** Return true when checkbox field `key` is checked. */
const checked = (data: Data, key: string): boolean => data[key] === true;
/** Compare two JSON-serializable values for equality. */
const equal = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
/** Render one labeled HTML form control from a {@link Field} descriptor. */
function input(field: Field): string {
    const attrs = `name="${escape(field.key)}"${field.placeholder ? ` placeholder="${escape(field.placeholder)}"` : ''}${field.readonly ? ' readonly' : ''}${field.autofocus ? ' autofocus' : ''}`;
    if (field.kind === 'checkbox') { return `<label class="checkbox"><input ${attrs} type="checkbox"${field.value === true ? ' checked' : ''}>${escape(field.label)}</label>`; }
    const control = field.kind === 'textarea' ? `<textarea ${attrs}>${escape(field.value)}</textarea>` : `<input ${attrs} type="${field.kind === 'number' ? 'number' : 'text'}" value="${escape(field.value)}"${field.kind === 'type' ? ' list="type-options"' : ''}>`;
    return `<label${field.kind === 'textarea' || field.key === 'signature' ? ' class="full"' : ''}>${escape(field.label)}${control}</label>`;
}
/** Render an editable table grid section with optional row reorder and add/remove buttons. */
function grid(spec: Grid): string {
    const singular = spec.key === 'parameters' ? 'parameter' : 'row';
    const hasActions = spec.reorder === true || spec.remove !== false;
    const actionsCell = (): string => !hasActions ? '' : `<td><div class="row-actions">${spec.reorder ? `<button type="button" class="row-move secondary" data-move-row="up" aria-label="Move ${singular} up" title="Move ${singular} up">${callIcon('up')}</button><button type="button" class="row-move secondary" data-move-row="down" aria-label="Move ${singular} down" title="Move ${singular} down">${callIcon('down')}</button>` : ''}${spec.remove === false ? '' : `<button type="button" class="row-remove secondary" data-remove-row aria-label="Remove ${singular}" title="Remove ${singular}">${callIcon('trash')}</button>`}</div></td>`;
    const row = (data: Data): string => `<tr data-original="${escape(data._original ?? '')}">${spec.columns.map(column => `<td><input data-column="${escape(column.key)}" aria-label="${escape(column.label)}" type="${column.kind === 'number' ? 'number' : 'text'}" value="${escape(data[column.key])}"${column.kind === 'type' ? ' list="type-options"' : ''}></td>`).join('')}${actionsCell()}</tr>`;
    return section(spec.label, `<div class="table-wrap"><table class="editable" data-table="${escape(spec.key)}"><thead><tr>${spec.columns.map(column => `<th scope="col">${escape(column.label)}</th>`).join('')}${hasActions ? '<th></th>' : ''}</tr></thead><tbody>${spec.values.map(row).join('')}</tbody></table></div>${spec.add === false ? '' : `<template data-row-template="${escape(spec.key)}">${row({})}</template><button type="button" class="secondary icon-add" data-add-row="${escape(spec.key)}" aria-label="Add ${singular}" title="Add ${singular}">${callIcon('plus')}</button>`}`);
}
/** Client-side webview script for table row edits, reordering, submission, and initial focus. */
const formScript = `
document.addEventListener('click', event => {
    const move = event.target.closest('[data-move-row]');
    if (move) {
        const row = move.closest('tr'), dir = move.dataset.moveRow;
        if (dir === 'up' && row.previousElementSibling) { row.parentNode.insertBefore(row, row.previousElementSibling); move.focus(); }
        else if (dir === 'down' && row.nextElementSibling) { row.parentNode.insertBefore(row.nextElementSibling, row); move.focus(); }
    }
    const remove = event.target.closest('[data-remove-row]');
    if (remove) {
        const row = remove.closest('tr'), table = row.closest('table');
        const next = row.nextElementSibling?.querySelector('input') || row.previousElementSibling?.querySelector('input')
            || [...document.querySelectorAll('[data-add-row]')].find(button => button.dataset.addRow === table.dataset.table);
        row.remove();
        next?.focus();
    }
    const add = event.target.closest('[data-add-row]');
    if (add) {
        const key = add.dataset.addRow, body = document.querySelector('[data-table="' + key + '"] tbody');
        body.append(document.querySelector('[data-row-template="' + key + '"]').content.cloneNode(true));
        body.lastElementChild?.querySelector('input')?.focus();
    }
});
document.getElementById('edit-form').addEventListener('submit', event => {
    event.preventDefault();
    const values = {};
    for (const el of event.target.querySelectorAll('[name]')) { values[el.name] = el.type === 'checkbox' ? el.checked : el.value; }
    const tables = {};
    for (const table of event.target.querySelectorAll('[data-table]')) {
        tables[table.dataset.table] = Array.from(table.tBodies[0].rows).map(row => {
            const data = { _original: row.dataset.original };
            for (const el of row.querySelectorAll('[data-column]')) { data[el.dataset.column] = el.value; }
            return data;
        });
    }
    document.getElementById('submit').disabled = true;
    document.getElementById('error').textContent = '';
    document.getElementById('status').textContent = 'Saving analysis…';
    vscode.postMessage({ action: 'submit', values, tables });
});
window.addEventListener('message', event => {
    const message = event.data;
    if (message.action === 'result') {
        document.getElementById('submit').disabled = !message.error || message.uncertain === true;
        document.getElementById('error').textContent = message.error || '';
        document.getElementById('status').textContent = message.error ? '' : message.message || 'Saved to the Ghidra project.';
    }
});
const initialFocus = document.querySelector('[autofocus]') || document.querySelector('#edit-form input:not([readonly])');
if (initialFocus) {
    initialFocus.focus();
    window.addEventListener('focus', () => { if (document.activeElement === document.body) { initialFocus.focus(); } }, { once: true });
}`;

/** Explicit graphical editing forms. Nothing is written until their Save button is pressed. */
export class EditingUI implements vscode.Disposable {
    /** Registered editing commands owned by this UI manager. */
    private readonly disposables: vscode.Disposable[] = [];
    /** Open webview panels mapped to their owning program MD5. */
    private readonly panels = new Map<vscode.WebviewPanel, string>();
    /** Inline five-kind comment controller for decompiled views. */
    private readonly comments: InlineComments;
    /** Register editing commands and initialize the inline comment controller. */
    constructor(private readonly call: Call, private readonly context: ProgramContext, private readonly typeFiles: DataTypeFiles) {
        this.comments = new InlineComments(call);
        const commands: Record<string, (...args: any[]) => Promise<unknown>> = {
            createType: this.createType.bind(this), editType: this.editType.bind(this), deleteType: this.deleteType.bind(this), applyType: this.applyType.bind(this),
            editFunction: this.editFunction.bind(this), editVariables: this.editVariables.bind(this), editComment: this.editComment.bind(this), editSymbol: this.editSymbol.bind(this),
        };
        for (const [name, run] of Object.entries(commands)) {
            this.disposables.push(vscode.commands.registerCommand(`ghidraLsp.${name}`, async (...args: unknown[]) => {
                try { return await run(...args); } catch (error) { void vscode.window.showErrorMessage(formatFriendlyError(error)); return undefined; }
            }));
        }
    }
    /** Resolve the active program MD5 from `candidate` or the current context. */
    private md5(candidate?: unknown): string { return this.context.require(candidate); }
    /** Extract string property `key` from a command argument object. */
    private resource(candidate: unknown, key: string): string | undefined { const item = object(candidate); return typeof item[key] === 'string' ? item[key] as string : undefined; }
    /** Execute a read query against `ghidra.query`. */
    private query<T = Data>(md5: string, domain: string, operation: string, params: Data = {}, all = false): Promise<T> { return this.call<T>('ghidra.query', { md5, domain, operation, params, all }); }
    /** Refresh the sidebar browser and open virtual documents after a mutation. */
    private async refreshBrowser(md5: string): Promise<void> {
        try { await vscode.commands.executeCommand('ghidraLsp.refreshBrowser', md5); }
        catch (error) { void vscode.window.showWarningMessage(`Changes were saved, but refreshing views failed: ${String(error)}. Run Ghidra: Refresh Program Browser.`); }
    }
    /** Execute one or more backend mutations atomically and refresh views. */
    private async mutations(md5: string, operations: Mutation[]): Promise<void> {
        if (!operations.length) { throw new Error('No changes to save.'); }
        if (operations.length === 1) {
            const [domain, operation] = operations[0].method.split('.');
            await this.call('ghidra.mutate', { md5, domain, operation, params: operations[0].arguments });
        } else {
            await this.call('ghidra.mutate', { md5, domain: 'batch', operation: 'execute', params: { transaction_mode: 'all_or_none', items: operations.map((op, index) => ({ id: String(index), ...op })) } });
        }
        await this.refreshBrowser(md5);
    }
    /** Verify that the backend resource has not changed since the form opened. */
    private async unchanged(md5: string, domain: string, selector: Data, original: Data): Promise<void> {
        const current = await this.query(md5, domain, 'get', { selector });
        if (!equal(current, original)) { throw new Error('The analysis changed while this form was open. Close and reopen the form to review current data before saving.'); }
    }
    /** Fetch selectable data type names and paths for type-picker datalists. */
    private async types(md5: string): Promise<string[]> { const result = await this.query<{ items: Data[] }>(md5, 'data_type', 'list', {}, true); return [...new Set(['void', 'pointer', 'int', 'char', 'byte', 'undefined1', 'undefined4', 'uint', 'long', ...result.items.flatMap(item => [String(item.path), String(item.name)])])].sort(); }
    /** Open a webview form panel and wire submission validation and save feedback. */
    private async form(md5: string, title: string, subtitle: string, fields: Field[], grids: Grid[], save: (submission: Submission) => Promise<void | Data>, hint = ''): Promise<void> {
        const usesTypes = fields.some(field => field.kind === 'type') || grids.some(grid => grid.columns.some(column => column.kind === 'type'));
        const types = usesTypes ? await this.types(md5) : [];
        await this.context.activate(md5);
        const panel = vscode.window.createWebviewPanel('ghidra.edit', title, vscode.ViewColumn.Active, { enableScripts: true, localResourceRoots: [], retainContextWhenHidden: true });
        this.panels.set(panel, md5); panel.onDidDispose(() => this.panels.delete(panel));
        panel.onDidChangeViewState(event => { if (event.webviewPanel.active) { void this.context.activate(md5).catch(error => vscode.window.showErrorMessage(formatFriendlyError(error))); } });
        const advanced = fields.filter(field => (field.kind === 'checkbox' && field.key !== 'confirmed' && field.value !== true) || (field.kind === 'textarea' && !field.value && field.key !== 'source') || (field.key === 'category' && (!field.value || field.value === '/') && title !== 'Import C header') || (field.key === 'size' && !field.value) || (field.key === 'convention' && ['default', 'unknown', '__cdecl'].includes(String(field.value))));
        const visibleFields = fields.filter(field => !advanced.includes(field));
        const controls = visibleFields.filter(field => field.kind !== 'checkbox' && field.kind !== 'textarea');
        const flags = visibleFields.filter(field => field.kind === 'checkbox');
        const notes = visibleFields.filter(field => field.kind === 'textarea');
        const label = title === 'Delete data type' ? 'Delete type' : title === 'Import C header' ? 'Import C header' : title.startsWith('Create ') ? 'Create type' : 'Save changes';
        const fieldBody = (controls.length ? `<div class="form-grid">${controls.map(input).join('')}</div>` : '')
            + (flags.length ? `<fieldset class="check-group"><legend>${title === 'Delete data type' ? 'Confirm deletion' : 'Behavior'}</legend>${flags.map(input).join('')}</fieldset>` : '')
            + (notes.length ? `<div class="form-grid form-notes">${notes.map(input).join('')}</div>` : '');
        panel.webview.html = page(title, 'Edit analysis', subtitle, `<form id="edit-form">${fieldBody ? `<section class="form-fields">${fieldBody}</section>` : ''}${hint ? `<p class="form-hint">${escape(hint)}</p>` : ''}${grids.map(grid).join('')}${advanced.length ? `<details class="advanced-fields"><summary>Advanced options</summary><div class="form-grid">${advanced.map(input).join('')}</div></details>` : ''}<datalist id="type-options">${types.map(type => `<option value="${escape(type)}"></option>`).join('')}</datalist><div class="toolbar form-actions"><button class="primary icon-submit${label === 'Delete type' ? ' danger' : ''}" id="submit" type="submit" aria-label="${label}" title="${label}">${callIcon(label === 'Delete type' ? 'trash' : label === 'Import C header' ? 'import' : label === 'Create type' ? 'plus' : 'save')}</button></div><p id="status" class="success" role="status"></p></form>`, formScript);
        let busy = false;
        panel.webview.onDidReceiveMessage(async (message: unknown) => {
            const data = object(message);
            if (data.action === 'cancel') { panel.dispose(); return; }
            if (data.action !== 'submit' || busy) { return; }
            busy = true;
            try {
                const savedValues = await save({ values: object(data.values), tables: Object.fromEntries(Object.entries(object(data.tables)).map(([key, values]) => [key, rows(values)])) });
                await panel.webview.postMessage({ action: 'result', savedValues, message: 'Saved to the Ghidra project.' });
            } catch (error) {
                const message = String(error);
                const uncertain = /may have reached|Modification reached|persistence failed|saving.*failed|saved.*failed|regeneration failed|editor rejected|outcome.*unknown|not persisted/i.test(message);
                await panel.webview.postMessage({ action: 'result', error: formatFriendlyError(error), uncertain });
            }
            finally { busy = false; }
        });
    }
    /** Return `path` or prompt the user to select a project data type. */
    private async chooseType(md5: string, path?: string): Promise<string | undefined> {
        if (path) { return path; }
        const types = await this.query<{ items: Data[] }>(md5, 'data_type', 'list', {}, true);
        return (await vscode.window.showQuickPick(types.items.map(type => ({ label: String(type.name), description: String(type.kind), detail: String(type.path), path: String(type.path) })), { title: 'Select a data type', matchOnDetail: true }))?.path;
    }
    /** Resolve a function entry from arguments, the active editor, or a QuickPick list. */
    private async entry(md5: string, entry?: string): Promise<string | undefined> {
        if (entry) { return entry; }
        const editor = vscode.window.activeTextEditor;
        if (editor?.document.uri.scheme === 'ghidra' && editor.document.uri.authority === md5 && editor.document.uri.path.startsWith('/function/')) { return decodeURIComponent(editor.document.uri.path.slice('/function/'.length)); }
        const result = await this.call<{ items: Data[] }>('ghidra.functions', { md5 });
        return (await vscode.window.showQuickPick(result.items.map(fn => ({ label: String(fn.name), description: String(fn.entry), entry: String(fn.entry) })), { title: 'Choose a function' }))?.entry;
    }
    /** Prompt for a kind and open a form to create or import Ghidra data types. */
    async createType(candidate?: unknown, kindArg?: string): Promise<void> {
        const md5 = this.md5(candidate);
        const picked = kindArg || (await vscode.window.showQuickPick([
            { label: 'struct', description: 'Structure layout' },
            { label: 'union', description: 'Union layout' },
            { label: 'enum', description: 'Enumeration constants' },
            { label: 'typedef', description: 'Type alias' },
            { label: 'function', description: 'Function signature definition' },
            { label: 'c_header', description: 'Import multi-type C header declarations (data_type.parse_c)' },
        ], { title: 'Create or import data types' }))?.label;
        if (!picked || !['struct', 'union', 'enum', 'typedef', 'function', 'c_header'].includes(picked)) { return; }
        if (picked === 'c_header') {
            await this.form(md5, 'Import C header', this.context.name(md5), [
                { key: 'category', label: 'Category path', value: '/' },
                { key: 'source', label: 'C declarations', kind: 'textarea', placeholder: 'struct Packet {\n    const char *payload;\n    uint32_t length;\n};', autofocus: true },
            ], [], async ({ values }) => {
                await this.mutations(md5, [{ method: 'data_type.parse_c', arguments: { source: required(values, 'source', 'C declarations'), category_path: value(values, 'category') || '/' } }]);
            }, 'Enter self-contained C structs, unions, enums, typedefs, and function prototypes without #include directives.');
            return;
        }
        const kind = picked;
        const fields: Field[] = [{ key: 'name', label: 'Type name' }, { key: 'category', label: 'Category path', value: '/' }];
        if (kind === 'struct' || kind === 'enum') { fields.push({ key: 'size', label: kind === 'enum' ? 'Size in bytes (1–8)' : 'Initial size in bytes', kind: 'number', value: kind === 'enum' ? 4 : 0 }); }
        if (kind === 'typedef') { fields.push({ key: 'base', label: 'Base type', kind: 'type', value: 'int' }); }
        if (kind === 'function') { fields.push(...this.signatureFields({})); }
        await this.form(md5, `Create ${kind}`, this.context.name(md5), fields, kind === 'function' ? [this.parameterGrid([])] : [], async ({ values, tables }) => {
            const resource: Data = { kind, name: required(values, 'name', 'Type name'), category_path: value(values, 'category') || '/' };
            if (kind === 'struct' || kind === 'enum') { resource.size = integer(values.size, 'Size', kind === 'enum' ? 1 : 0, kind === 'enum' ? 8 : 2147483647); }
            if (kind === 'typedef') { resource.base_type = typeReference(values.base); }
            if (kind === 'function') { resource.signature = this.signature(values, tables.parameters || []); }
            await this.mutations(md5, [{ method: 'data_type.create', arguments: { resource } }]);
        });
    }
    /** Build form fields for function signature creation. */
    private signatureFields(data: Data): Field[] { return [
        { key: 'returnType', label: 'Return type', kind: 'type', value: reference(data.return_type || { kind: 'named', name: 'void' }) },
        { key: 'convention', label: 'Calling convention', value: data.calling_convention || 'default' },
        { key: 'varargs', label: 'Variadic arguments', kind: 'checkbox', value: data.has_var_args }, { key: 'noreturn', label: 'Does not return', kind: 'checkbox', value: data.has_no_return },
    ]; }
    /** Build an editable parameter table grid for function data types. */
    private parameterGrid(parameters: Data[]): Grid { return { key: 'parameters', label: 'Parameters', reorder: true, columns: [{ key: 'name', label: 'Name' }, { key: 'type', label: 'Data type', kind: 'type' }], values: parameters.map((param, index) => ({ _original: String(index), name: param.name, type: reference(param.data_type) })) }; }
    /** Parse and validate function signature fields and parameter rows into a payload. */
    private signature(values: Data, parameters: Data[]): Data {
        if (value(values, 'convention').toLowerCase() === 'unknown') { throw new Error('Choose a known calling convention, such as default, for a function data type.'); }
        return { return_type: typeReference(values.returnType), calling_convention: required(values, 'convention', 'Calling convention'), has_var_args: checked(values, 'varargs'), has_no_return: checked(values, 'noreturn'), parameters: parameters.map(param => ({ name: value(param, 'name'), data_type: typeReference(param.type) })) }; }
    /** Open an editable JSONC `ghidra-type://` document for the selected data type. */
    async editType(candidate?: unknown, pathArg?: string): Promise<void> {
        const uri = candidate instanceof vscode.Uri ? candidate : vscode.window.activeTextEditor?.document.uri;
        const scoped = uri?.scheme === typeScheme && !candidate ? uri : candidate;
        const md5 = this.md5(scoped);
        const path = await this.chooseType(md5, pathArg || this.resource(candidate, 'path')
            || (uri?.scheme === typeScheme && uri.authority === md5 ? typePath(uri) : undefined));
        if (path) { await this.typeFiles.open(md5, path); }
    }
    /** Open a confirmation form to delete a project data type. */
    async deleteType(candidate?: unknown, pathArg?: string): Promise<void> {
        const md5 = this.md5(candidate); const path = await this.chooseType(md5, pathArg || this.resource(candidate, 'path')); if (!path) { return; }
        const original = await this.query(md5, 'data_type', 'get', { selector: { path } });
        await this.form(md5, 'Delete data type', path, [{ key: 'confirmed', label: 'Delete this type from the analysis project (uses may become undefined)', kind: 'checkbox' }], [], async ({ values }) => {
            if (!checked(values, 'confirmed')) { throw new Error('Select the deletion checkbox to continue.'); }
            await this.unchanged(md5, 'data_type', { path }, original);
            await this.mutations(md5, [{ method: 'data_type.delete', arguments: { selector: { path } } }]);
        });
    }
    /** Open a form to apply a data type at a global data address. */
    async applyType(candidate?: unknown, pathArg?: string, addressArg?: string): Promise<void> {
        const md5 = this.md5(candidate); const path = pathArg || this.resource(candidate, 'path') || await this.chooseType(md5); if (!path) { return; }
        await this.form(md5, 'Apply data type', this.context.name(md5), [{ key: 'address', label: 'Data address', value: addressArg }, { key: 'name', label: 'Variable name (for new data)' }, { key: 'type', label: 'Data type', kind: 'type', value: path }], [], async ({ values }) => {
            const address = required(values, 'address', 'Address'); const dataType = typeReference(values.type);
            let existing: Data | undefined;
            try { existing = await this.query(md5, 'global_variable', 'get', { selector: { address } }); } catch (error) { if (!/not found|not_found|no .*data|does not exist|not a defined|not defined/i.test(String(error))) { throw error; } }
            await this.mutations(md5, [{ method: existing ? 'global_variable.patch' : 'global_variable.create', arguments: existing ? { selector: { address }, patch: { data_type: dataType, ...(value(values, 'name') ? { name: value(values, 'name') } : {}) } } : { resource: { address, name: required(values, 'name', 'Variable name'), data_type: dataType } } }]);
        });
    }
    /** Open a form to edit a function prototype, flags, comment, and parameters. */
    async editFunction(candidate?: unknown, entryArg?: string): Promise<void> {
        const md5 = this.md5(candidate); const entry = await this.entry(md5, entryArg || this.resource(candidate, 'entry')); if (!entry) { return; }
        const proto = await this.call<{
            entry: string;
            original: Data;
            name: string;
            returnType: string;
            callingConvention: string;
            hasVarArgs: boolean;
            hasNoReturn: boolean;
            isInline: boolean;
            comment: string;
            parameters: { ordinal: number; name: string; type: string; storage?: unknown }[];
        }>('ghidra.functionPrototype', { md5, entry });
        const paramGrid: Grid = {
            key: 'parameters',
            label: 'Parameters',
            reorder: true,
            columns: [{ key: 'name', label: 'Name' }, { key: 'type', label: 'Data type', kind: 'type' }],
            values: (proto.parameters || []).map((param, index) => ({ _original: String(index), name: param.name, type: param.type })),
        };
        await this.form(md5, `Edit ${String(proto.name)}`, entry, [
            { key: 'name', label: 'Function name', value: proto.name },
            { key: 'returnType', label: 'Return type', kind: 'type', value: proto.returnType || 'void' },
            { key: 'signature', label: 'C signature (optional one-line prototype)', placeholder: 'int process(const char *buf, int (*matrix)[4], void (*cb)(int))' },
            { key: 'convention', label: 'Calling convention', value: proto.callingConvention || 'default' },
            { key: 'varargs', label: 'Variadic arguments', kind: 'checkbox', value: proto.hasVarArgs },
            { key: 'noreturn', label: 'Does not return', kind: 'checkbox', value: proto.hasNoReturn },
            { key: 'inline', label: 'Inline function', kind: 'checkbox', value: proto.isInline },
            { key: 'comment', label: 'Function comment', kind: 'textarea', value: proto.comment || '' },
        ], [paramGrid], async ({ values, tables }) => {
            const cSignature = value(values, 'signature');
            if (cSignature) {
                const newName = value(values, 'name');
                await this.call('ghidra.saveFunctionPrototype', {
                    md5,
                    entry: proto.entry || entry,
                    original: proto.original,
                    signature: cSignature,
                    ...(newName && newName !== proto.name ? { name: newName } : {}),
                    hasVarArgs: checked(values, 'varargs'),
                    hasNoReturn: checked(values, 'noreturn'),
                    isInline: checked(values, 'inline'),
                    comment: String(values.comment ?? ''),
                });
            } else {
                await this.call('ghidra.saveFunctionPrototype', {
                    md5,
                    entry: proto.entry || entry,
                    original: proto.original,
                    name: required(values, 'name', 'Function name'),
                    returnType: typeReference(values.returnType),
                    callingConvention: required(values, 'convention', 'Calling convention'),
                    hasVarArgs: checked(values, 'varargs'),
                    hasNoReturn: checked(values, 'noreturn'),
                    isInline: checked(values, 'inline'),
                    comment: String(values.comment ?? ''),
                    parameters: (tables.parameters || []).map(row => ({
                        _original: row._original,
                        name: required(row, 'name', 'Parameter name'),
                        type: typeReference(row.type),
                    })),
                });
            }
            await this.refreshBrowser(md5);
        }, 'Enter C types directly (such as const char *, int (*)[4], or void (*)(int)), reorder rows, or supply a full C signature.');
    }
    /** Open a form to rename or retype function parameters and local variables. */
    async editVariables(candidate?: unknown, entryArg?: string): Promise<void> {
        const md5 = this.md5(candidate); const entry = await this.entry(md5, entryArg || this.resource(candidate, 'entry')); if (!entry) { return; }
        const proto = await this.call<{
            entry: string;
            original: Data;
            name: string;
            parameters: { ordinal: number; name: string; type: string; storage?: unknown }[];
            locals: { name: string; type: string; storage?: unknown }[];
        }>('ghidra.functionPrototype', { md5, entry });
        const spec = (key: string, label: string, vars: { name: string; type: string }[]): Grid => ({
            key,
            label,
            add: false,
            remove: false,
            columns: [{ key: 'name', label: 'Name' }, { key: 'type', label: 'Data type', kind: 'type' }],
            values: vars.map((variable, index) => ({ _original: String(index), name: variable.name, type: variable.type })),
        });
        await this.form(md5, `Variables · ${String(proto.name)}`, entry, [], [
            spec('parameters', 'Parameters', proto.parameters || []),
            spec('locals', 'Local variables', proto.locals || []),
        ], async ({ tables }) => {
            await this.call('ghidra.saveVariables', {
                md5,
                entry: proto.entry || entry,
                original: proto.original,
                parameters: tables.parameters || [],
                locals: tables.locals || [],
            });
            await this.refreshBrowser(md5);
        });
    }
    /** Open the inline five-kind comment widget at the resolved CodeUnit address. */
    async editComment(candidate?: unknown, addressArg?: string, typeArg?: string): Promise<void> {
        const md5 = this.md5(candidate);
        const location = await this.commentAddress(md5, candidate, addressArg); if (!location) { return; }
        const { address, entry } = location;
        const type = typeArg && commentKinds.includes(typeArg as CommentKind) ? typeArg as CommentKind : address === entry ? 'plate' : 'pre';
        let { uri, position } = location;
        if (!uri) {
            const tab = vscode.window.tabGroups.all.flatMap(group => group.tabs).find(tab => tab.input instanceof vscode.TabInputText
                && tab.input.uri.scheme === 'ghidra' && tab.input.uri.authority === md5
                && tab.input.uri.path.startsWith('/function/')
                && decodeURIComponent(tab.input.uri.path.slice('/function/'.length)) === entry);
            if (tab?.input instanceof vscode.TabInputText) { uri = tab.input.uri; }
        }
        if (!uri) { throw new Error('Open the corresponding function before editing comments inline.'); }
        if (!position) {
            const mapped = await this.call<{ position?: { line: number; character: number } }>('ghidra.location', { uri: uri.toString(), address });
            if (mapped.position) { position = new vscode.Position(mapped.position.line, mapped.position.character); }
        }
        if (!position) { throw new Error('This address has no native location in the open pseudocode. Select a code token to edit comments inline.'); }
        await this.context.activate(md5);
        await this.comments.open(md5, address, type, { uri, position });
    }
    /** Resolve the CodeUnit address, function entry, and editor anchor for comment editing. */
    private async commentAddress(md5: string, candidate?: unknown, explicit?: string): Promise<{ address: string; entry?: string; uri?: vscode.Uri; position?: vscode.Position } | undefined> {
        const selection = object(candidate);
        if (!explicit && selection.position !== undefined) {
            const position = object(selection.position);
            const uri = typeof selection.uri === 'string' ? vscode.Uri.parse(selection.uri) : undefined;
            if (!uri || uri.scheme !== 'ghidra' || uri.authority !== md5 || !uri.path.startsWith('/function/')
                || !Number.isInteger(position.line) || Number(position.line) < 0
                || !Number.isInteger(position.character) || Number(position.character) < 0) {
                throw new Error('The comment Code Action has no valid function selection. Request Code Actions again.');
            }
            const location = await this.call<CodeLocation>('ghidra.location', {
                uri: uri.toString(), position,
                ...(selection.version === undefined ? {} : { version: selection.version }),
            });
            if (!location.native) { throw new Error('Upgrade ghidra-mcp and ghidra-lsp for native GUI comment locations.'); }
            if (!location.code_unit_address) { throw new Error('The selected position has no CodeUnit. Select a code token before editing comments.'); }
            return { address: location.code_unit_address, entry: location.entry, uri, position: new vscode.Position(Number(position.line), Number(position.character)) };
        }
        let address = explicit || this.resource(candidate, 'address') || this.resource(candidate, 'entry');
        const resource = candidate instanceof vscode.Uri ? candidate : undefined;
        if (!address) {
            const editor = vscode.window.activeTextEditor;
            const position = editor?.selection.active;
            const location = await cursorLocation(this.call, md5, resource);
            if (location) {
                if (!location.native) { throw new Error('Upgrade ghidra-mcp and ghidra-lsp for native GUI comment locations.'); }
                if (!location.address) { throw new Error('The cursor has no valid code context. Select a code token before editing comments.'); }
                if (location.code_unit_address) { return { address: location.code_unit_address, entry: location.entry, uri: editor?.document.uri, position }; }
                address = location.address;
            }
        }
        if (!address && resource?.scheme === 'ghidra' && resource.authority === md5 && resource.path.startsWith('/function/')) {
            throw new Error('Open the function and select a code token before editing comments.');
        }
        address ||= await vscode.window.showInputBox({ title: 'Choose comment address — not comment text',
            prompt: 'Enter an address in an open function; edit the comment beside its code.', placeHolder: 'ram:00401106', ignoreFocusOut: true,
            validateInput: input => /^(?:[^:\s]+:)*(?:0x)?[a-f\d]+$/i.test(input.trim()) ? undefined : 'Enter an address such as ram:00401106.',
        });
        if (!address) { return; }
        const resolved = await this.query(md5, 'address', 'resolve', { selector: { address: address.trim() } });
        const unit = object(resolved.code_unit);
        if (typeof unit.address !== 'string') { throw new Error('The backend did not report a CodeUnit at this address. Upgrade ghidra-mcp or select a code or data unit in Listing.'); }
        return { address: unit.address, entry: this.resource(resolved.function, 'entry') };
    }
    /** Open a form to rename a global symbol and optionally retype its backing global variable. */
    async editSymbol(candidate?: unknown, idArg?: string): Promise<void> {
        const md5 = this.md5(candidate); let id = idArg || this.resource(candidate, 'symbolId');
        if (!id) { const all = await this.call<{ items: Data[] }>('ghidra.symbols', { md5 }); id = (await vscode.window.showQuickPick(all.items.map(symbol => ({ label: String(symbol.name), description: String(symbol.address), id: String(symbol.id) })), { title: 'Select symbol' }))?.id; }
        if (!id) { return; }
        const symbol = await this.query(md5, 'symbol', 'get', { selector: { id } });
        let global: Data | undefined;
        try { global = await this.query(md5, 'global_variable', 'get', { selector: { address: symbol.address } }); } catch (error) { if (!/not found|not_found|no .*data|does not exist|not a defined|not defined/i.test(String(error))) { throw error; } }
        await this.form(md5, `Edit ${String(symbol.name)}`, String(symbol.address), [{ key: 'name', label: 'Symbol name', value: symbol.name }, ...(global ? [{ key: 'type', label: 'Data type', kind: 'type' as const, value: reference(global.data_type) }] : [])], [], async ({ values }) => {
            await this.unchanged(md5, 'symbol', { id }, symbol);
            if (global) { await this.unchanged(md5, 'global_variable', { address: symbol.address }, global); }
            const name = required(values, 'name', 'Symbol name'); const operations: Mutation[] = [];
            // A non-primary alias shares data with its primary symbol; rename the selected symbol identity only.
            if (name !== symbol.name) { operations.push({ method: 'symbol.patch', arguments: { selector: { id }, patch: { name } } }); }
            if (global) { const dataType = typeReference(values.type); if (dataType !== reference(global.data_type)) { operations.push({ method: 'global_variable.patch', arguments: { selector: { address: symbol.address }, patch: { data_type: dataType } } }); } }
            await this.mutations(md5, operations);
        });
    }
    /** Close inline comments and edit panels belonging to program `md5`. */
    close(md5: string): void { this.comments.close(md5); for (const [panel, owner] of this.panels) { if (owner === md5) { panel.dispose(); } } }
    /** Dispose the comment controller, open form panels, and registered commands. */
    dispose(): void { this.comments.dispose(); this.panels.forEach((_md5, panel) => panel.dispose()); this.disposables.forEach(item => item.dispose()); }
}
