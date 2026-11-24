// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

import * as vscode from 'vscode';
import { Call } from './memory';
import { ProgramContext } from './context';
import { DataTypeFiles, typePath, typeScheme } from './type-files';
import { Data, object, reference, typeReference, integer, page } from './web';
import { formatFriendlyError } from './error';
import { CodeLocation, cursorLocation } from './location';
import { commentKinds, CommentKind, InlineComments } from './inline-comments';
import { FieldSchema, FormSchema, GridSchema, maxInt32 } from './form-schema';
import { bindRpcFormPanel, FormSubmission, mutationFormScript, renderDeclarativeForm, RpcSaveResult } from './form-controller';

/** Single backend mutation operation sent to `ghidra.mutate`. */
interface Mutation {
    /** Dotted MCP method name such as `data_type.create` or `symbol.patch`. */
    method: string;
    /** Operation arguments object. */
    arguments: Data;
}

/** Prototype snapshot returned by `ghidra.functionPrototype`. */
interface FunctionPrototypeSnapshot {
    /** Canonical entry address of the function. */
    entry: string;
    /** Raw backend function object used for optimistic conflict detection. */
    original: Data;
    /** Current function symbol name. */
    name: string;
    /** Formatted C-like return data type. */
    returnType?: string;
    /** Calling convention name. */
    callingConvention?: string;
    /** Whether the function accepts variadic arguments. */
    hasVarArgs?: boolean;
    /** Whether the function is marked noreturn. */
    hasNoReturn?: boolean;
    /** Whether the function is marked inline. */
    isInline?: boolean;
    /** Function plate comment text. */
    comment?: string;
    /** Ordered function parameters. */
    parameters?: { ordinal: number; name: string; type: string; storage?: string }[];
    /** Local variables declared in the function. */
    locals?: { name: string; type: string; storage?: string }[];
}

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
            createType: this.createType.bind(this),
            editType: this.editType.bind(this),
            deleteType: this.deleteType.bind(this),
            applyType: this.applyType.bind(this),
            editFunction: this.editFunction.bind(this),
            editVariables: this.editVariables.bind(this),
            editComment: this.editComment.bind(this),
            editSymbol: this.editSymbol.bind(this),
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
    private resource(candidate: unknown, key: string): string | undefined {
        const item = object(candidate);
        return typeof item[key] === 'string' ? item[key] as string : undefined;
    }

    /** Execute a read query against `ghidra.query`. */
    private query<T = Data>(md5: string, domain: string, operation: string, params: Data = {}, all = false): Promise<T> {
        return this.call<T>('ghidra.query', { md5, domain, operation, params, all });
    }

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
            await this.call('ghidra.mutate', {
                md5,
                domain: 'batch',
                operation: 'execute',
                params: { transaction_mode: 'all_or_none', items: operations.map((op, index) => ({ id: String(index), ...op })) },
            });
        }
        await this.refreshBrowser(md5);
    }

    /** Verify that the backend resource has not changed since the last baseline snapshot. */
    private async unchanged(md5: string, domain: string, selector: Data, original: Data): Promise<void> {
        const current = await this.query(md5, domain, 'get', { selector });
        if (!equal(current, original)) {
            throw new Error('The analysis changed while this form was open. Close and reopen the form to review current data before saving.');
        }
    }

    /** Fetch selectable data type names and paths for type-picker datalists. */
    private async types(md5: string): Promise<string[]> {
        const result = await this.query<{ items: Data[] }>(md5, 'data_type', 'list', {}, true);
        return [...new Set(['void', 'pointer', 'int', 'char', 'byte', 'undefined1', 'undefined4', 'uint', 'long', ...result.items.flatMap(item => [String(item.path), String(item.name)])])].sort();
    }

    /** Open a declarative webview form panel and wire validation, focus retention, and RPC persistence. */
    private async form(
        md5: string,
        title: string,
        subtitle: string,
        fields: FieldSchema[],
        grids: GridSchema[],
        save: (submission: FormSubmission) => Promise<void | RpcSaveResult>,
        hint = '',
    ): Promise<void> {
        const usesTypes = fields.some(field => field.kind === 'type')
            || grids.some(grid => grid.columns.some(column => column.kind === 'type'));
        const typeOptions = usesTypes ? await this.types(md5) : [];
        await this.context.activate(md5);
        const panel = vscode.window.createWebviewPanel('ghidra.edit', title, vscode.ViewColumn.Active, {
            enableScripts: true,
            localResourceRoots: [],
            retainContextWhenHidden: true,
        });
        this.panels.set(panel, md5);
        panel.onDidDispose(() => this.panels.delete(panel));
        panel.onDidChangeViewState(event => {
            if (event.webviewPanel.active) {
                void this.context.activate(md5).catch(error => vscode.window.showErrorMessage(formatFriendlyError(error)));
            }
        });
        const submitLabel = title === 'Delete data type' ? 'Delete type' : title.startsWith('Create ') ? 'Create type' : 'Save changes';
        const submitIcon = submitLabel === 'Delete type' ? 'trash' : submitLabel === 'Create type' ? 'plus' : 'save';
        const schema: FormSchema = {
            id: 'edit-form',
            mode: 'submit',
            fields,
            grids,
            hint: hint || undefined,
            submitLabel,
            submitIcon,
            danger: submitLabel === 'Delete type',
            renderActionsBar: true,
            disclosureLabel: 'Advanced options',
            disclosureClass: 'advanced-fields',
            checkGroupLegend: title === 'Delete data type' ? 'Confirm deletion' : 'Behavior',
            typeOptions,
            emptyMessage: !fields.length && !grids.length ? 'No editable fields.' : undefined,
        };
        panel.webview.html = page(
            title,
            'Edit analysis',
            subtitle,
            renderDeclarativeForm(schema),
            mutationFormScript({ schema }),
        );
        bindRpcFormPanel(panel, schema, async submission => {
            const result = await save(submission);
            if (result?.title) { panel.title = result.title; }
            return result;
        });
    }

    /** Return `path` or prompt the user to select a project data type. */
    private async chooseType(md5: string, path?: string): Promise<string | undefined> {
        if (path) { return path; }
        const types = await this.query<{ items: Data[] }>(md5, 'data_type', 'list', {}, true);
        return (await vscode.window.showQuickPick(
            types.items.map(type => ({ label: String(type.name), description: String(type.kind), detail: String(type.path), path: String(type.path) })),
            { title: 'Select a data type', matchOnDetail: true },
        ))?.path;
    }

    /** Resolve a function entry from arguments, the active editor, or a QuickPick list. */
    private async entry(md5: string, entry?: string): Promise<string | undefined> {
        if (entry) { return entry; }
        const editor = vscode.window.activeTextEditor;
        if (editor?.document.uri.scheme === 'ghidra' && editor.document.uri.authority === md5 && editor.document.uri.path.startsWith('/function/')) {
            return decodeURIComponent(editor.document.uri.path.slice('/function/'.length));
        }
        const result = await this.call<{ items: Data[] }>('ghidra.functions', { md5 });
        return (await vscode.window.showQuickPick(
            result.items.map(fn => ({ label: String(fn.name), description: String(fn.entry), entry: String(fn.entry) })),
            { title: 'Choose a function' },
        ))?.entry;
    }

    /** Prompt for a kind and open a declarative form to create a new Ghidra data type. */
    async createType(candidate?: unknown, kindArg?: string): Promise<void> {
        const md5 = this.md5(candidate);
        const kind = kindArg || await vscode.window.showQuickPick(['struct', 'union', 'enum', 'typedef', 'function'], { title: 'Create data type' });
        if (!kind || !['struct', 'union', 'enum', 'typedef', 'function'].includes(kind)) { return; }
        const fields: FieldSchema[] = [
            {
                key: 'name',
                label: 'Type name',
                hint: 'Unique data type name within the selected category.',
                rules: { required: true, requiredMessage: 'Type name is required.' },
            },
            {
                key: 'category',
                label: 'Category path',
                value: '/',
                hint: 'Category folder path starting with /.',
                advanced: true,
            },
        ];
        if (kind === 'struct') {
            fields.push({
                key: 'size',
                label: 'Initial size in bytes',
                kind: 'number',
                value: 0,
                hint: 'Enter 0 for an empty structure or a non-negative byte size.',
                advanced: true,
                rules: {
                    required: true,
                    requiredMessage: `Size must be an integer between 0 and ${maxInt32}.`,
                    integer: { min: 0, max: maxInt32, message: `Size must be an integer between 0 and ${maxInt32}.` },
                },
            });
        }
        if (kind === 'enum') {
            fields.push({
                key: 'size',
                label: 'Size in bytes (1–8)',
                kind: 'number',
                value: 4,
                hint: 'Storage width in bytes between 1 and 8.',
                rules: {
                    required: true,
                    requiredMessage: 'Size must be an integer between 1 and 8.',
                    integer: { min: 1, max: 8, message: 'Size must be an integer between 1 and 8.' },
                },
            });
        }
        if (kind === 'typedef') {
            fields.push({
                key: 'base',
                label: 'Base type',
                kind: 'type',
                value: 'int',
                hint: 'Target data type such as int, char *, or byte[16].',
                rules: { required: true, typeRef: true },
            });
        }
        if (kind === 'function') {
            fields.push(...this.signatureFields({}));
        }
        const grids = kind === 'function' ? [this.parameterGrid([], false)] : [];
        await this.form(md5, `Create ${kind}`, this.context.name(md5), fields, grids, async ({ values, tables }) => {
            const resource: Data = { kind, name: required(values, 'name', 'Type name'), category_path: value(values, 'category') || '/' };
            if (kind === 'struct' || kind === 'enum') {
                resource.size = integer(values.size, 'Size', kind === 'enum' ? 1 : 0, kind === 'enum' ? 8 : maxInt32);
            }
            if (kind === 'typedef') { resource.base_type = typeReference(values.base); }
            if (kind === 'function') { resource.signature = this.signature(values, tables.parameters || []); }
            await this.mutations(md5, [{ method: 'data_type.create', arguments: { resource } }]);
        });
    }

    /** Build declarative schema fields for function signature creation. */
    private signatureFields(data: Data): FieldSchema[] {
        const convention = String(data.calling_convention || 'default');
        return [
            {
                key: 'returnType',
                label: 'Return type',
                kind: 'type',
                value: reference(data.return_type || { kind: 'named', name: 'void' }),
                hint: 'Return data type such as void, int, or pointer.',
                rules: { required: true, typeRef: true },
            },
            {
                key: 'convention',
                label: 'Calling convention',
                value: convention,
                hint: 'Known calling convention such as default or __cdecl (cannot be unknown).',
                advanced: ['default', '__cdecl'].includes(convention),
                rules: {
                    required: true,
                    requiredMessage: 'Calling convention is required.',
                    disallowed: {
                        values: ['unknown'],
                        ignoreCase: true,
                        message: 'Choose a known calling convention, such as default, for a function data type.',
                    },
                },
            },
            {
                key: 'varargs',
                label: 'Variadic arguments',
                kind: 'checkbox',
                value: data.has_var_args === true,
                advanced: data.has_var_args !== true,
            },
            {
                key: 'noreturn',
                label: 'Does not return',
                kind: 'checkbox',
                value: data.has_no_return === true,
                advanced: data.has_no_return !== true,
            },
        ];
    }

    /** Build a declarative parameter table schema for function signatures or prototypes. */
    private parameterGrid(parameters: Data[], requireName: boolean): GridSchema {
        return {
            key: 'parameters',
            label: 'Parameters',
            singular: 'parameter',
            addMode: 'button',
            removable: true,
            variant: 'edit-grid',
            newRowDefaults: { name: '', type: '' },
            columns: [
                {
                    key: 'name',
                    label: 'Name',
                    kind: 'text',
                    hint: requireName ? 'Required parameter name.' : 'Optional parameter name.',
                    rules: requireName ? { required: true, requiredMessage: 'Parameter name is required.' } : undefined,
                },
                {
                    key: 'type',
                    label: 'Data type',
                    kind: 'type',
                    hint: 'Parameter data type such as int or char *.',
                    rules: { required: true, typeRef: true },
                },
            ],
            rows: parameters.map((param, index) => ({
                _original: String(index),
                name: param.name ?? '',
                type: param.type !== undefined ? param.type : reference(param.data_type),
            })),
        };
    }

    /** Parse and validate function signature fields and parameter rows into a payload. */
    private signature(values: Data, parameters: Data[]): Data {
        if (value(values, 'convention').toLowerCase() === 'unknown') {
            throw new Error('Choose a known calling convention, such as default, for a function data type.');
        }
        return {
            return_type: typeReference(values.returnType),
            calling_convention: required(values, 'convention', 'Calling convention'),
            has_var_args: checked(values, 'varargs'),
            has_no_return: checked(values, 'noreturn'),
            parameters: parameters.map(param => ({ name: value(param, 'name'), data_type: typeReference(param.type) })),
        };
    }

    /** Open an editable JSONC `ghidra-type://` document for the selected data type. */
    async editType(candidate?: unknown, pathArg?: string): Promise<void> {
        const uri = candidate instanceof vscode.Uri ? candidate : vscode.window.activeTextEditor?.document.uri;
        const scoped = uri?.scheme === typeScheme && !candidate ? uri : candidate;
        const md5 = this.md5(scoped);
        const path = await this.chooseType(
            md5,
            pathArg || this.resource(candidate, 'path') || (uri?.scheme === typeScheme && uri.authority === md5 ? typePath(uri) : undefined),
        );
        if (path) { await this.typeFiles.open(md5, path); }
    }

    /** Open a declarative confirmation form to delete a project data type. */
    async deleteType(candidate?: unknown, pathArg?: string): Promise<void> {
        const md5 = this.md5(candidate);
        const path = await this.chooseType(md5, pathArg || this.resource(candidate, 'path'));
        if (!path) { return; }
        const original = await this.query(md5, 'data_type', 'get', { selector: { path } });
        let deleted = false;
        await this.form(md5, 'Delete data type', path, [
            {
                key: 'confirmed',
                label: 'Delete this type from the analysis project (uses may become undefined)',
                kind: 'checkbox',
                hint: 'Check this box to confirm permanent deletion of the data type.',
                rules: { mustBeChecked: true, requiredMessage: 'Select the deletion checkbox to continue.' },
            },
        ], [], async ({ values }) => {
            if (!checked(values, 'confirmed')) { throw new Error('Select the deletion checkbox to continue.'); }
            if (deleted) { throw new Error('This data type has already been deleted from the project.'); }
            await this.unchanged(md5, 'data_type', { path }, original);
            await this.mutations(md5, [{ method: 'data_type.delete', arguments: { selector: { path } } }]);
            deleted = true;
        });
    }

    /** Open a declarative form to apply a data type at a global data address. */
    async applyType(candidate?: unknown, pathArg?: string, addressArg?: string): Promise<void> {
        const md5 = this.md5(candidate);
        const path = pathArg || this.resource(candidate, 'path') || await this.chooseType(md5);
        if (!path) { return; }
        await this.form(md5, 'Apply data type', this.context.name(md5), [
            {
                key: 'address',
                label: 'Data address',
                value: addressArg,
                hint: 'Memory address such as 00401000 or ram:00401000.',
                rules: { required: true, requiredMessage: 'Address is required.' },
            },
            {
                key: 'name',
                label: 'Variable name (for new data)',
                hint: 'Required when creating data at an undefined address; optional when updating an existing global variable.',
            },
            {
                key: 'type',
                label: 'Data type',
                kind: 'type',
                value: path,
                hint: 'Ghidra data type to apply at the address.',
                rules: { required: true, typeRef: true },
            },
        ], [], async ({ values }) => {
            const address = required(values, 'address', 'Address');
            const dataType = typeReference(values.type);
            let existing: Data | undefined;
            try {
                existing = await this.query(md5, 'global_variable', 'get', { selector: { address } });
            } catch (error) {
                if (!/not found|not_found|no .*data|does not exist|not a defined|not defined/i.test(String(error))) {
                    throw error;
                }
            }
            await this.mutations(md5, [{
                method: existing ? 'global_variable.patch' : 'global_variable.create',
                arguments: existing
                    ? { selector: { address }, patch: { data_type: dataType, ...(value(values, 'name') ? { name: value(values, 'name') } : {}) } }
                    : { resource: { address, name: required(values, 'name', 'Variable name'), data_type: dataType } },
            }]);
        });
    }

    /** Open a declarative form to edit a function prototype, flags, comment, and parameters. */
    async editFunction(candidate?: unknown, entryArg?: string): Promise<void> {
        const md5 = this.md5(candidate);
        const entry = await this.entry(md5, entryArg || this.resource(candidate, 'entry'));
        if (!entry) { return; }
        let baseline = await this.call<FunctionPrototypeSnapshot>('ghidra.functionPrototype', { md5, entry });
        const convention = baseline.callingConvention ?? 'default';
        const paramGrid = this.parameterGrid(
            (baseline.parameters || []).map(param => ({ name: param.name, type: param.type })),
            true,
        );
        await this.form(md5, `Edit ${String(baseline.name)}`, entry, [
            {
                key: 'name',
                label: 'Function name',
                value: baseline.name,
                rules: { required: true, requiredMessage: 'Function name is required.' },
            },
            {
                key: 'returnType',
                label: 'Return type',
                kind: 'type',
                value: baseline.returnType || 'void',
                hint: 'Return data type such as void, int, or char *.',
                rules: { required: true, typeRef: true },
            },
            {
                key: 'convention',
                label: 'Calling convention',
                value: convention,
                hint: 'Function calling convention such as default, __cdecl, or __fastcall.',
                advanced: ['default', 'unknown', '__cdecl', ''].includes(String(convention)),
                rules: { required: true, requiredMessage: 'Calling convention is required.' },
            },
            {
                key: 'varargs',
                label: 'Variadic arguments',
                kind: 'checkbox',
                value: baseline.hasVarArgs === true,
                advanced: baseline.hasVarArgs !== true,
            },
            {
                key: 'noreturn',
                label: 'Does not return',
                kind: 'checkbox',
                value: baseline.hasNoReturn === true,
                advanced: baseline.hasNoReturn !== true,
            },
            {
                key: 'inline',
                label: 'Inline function',
                kind: 'checkbox',
                value: baseline.isInline === true,
                advanced: baseline.isInline !== true,
            },
            {
                key: 'comment',
                label: 'Function comment',
                kind: 'textarea',
                value: baseline.comment || '',
                hint: 'Optional plate comment displayed above the function.',
                advanced: !baseline.comment,
            },
        ], [paramGrid], async ({ values, tables }) => {
            const targetEntry = baseline.entry || entry;
            await this.call('ghidra.saveFunctionPrototype', {
                md5,
                entry: targetEntry,
                original: baseline.original,
                name: required(values, 'name', 'Function name'),
                returnType: required(values, 'returnType', 'Return type'),
                callingConvention: required(values, 'convention', 'Calling convention'),
                hasVarArgs: checked(values, 'varargs'),
                hasNoReturn: checked(values, 'noreturn'),
                isInline: checked(values, 'inline'),
                comment: String(values.comment ?? ''),
                parameters: tables.parameters || [],
            });
            await this.refreshBrowser(md5);
            const refreshed = await this.call<FunctionPrototypeSnapshot>('ghidra.functionPrototype', { md5, entry: targetEntry }).catch(() => undefined);
            if (refreshed && refreshed.original) {
                baseline = refreshed;
                return {
                    title: `Edit ${String(refreshed.name)}`,
                    rowOriginals: {
                        parameters: (refreshed.parameters || []).map((_, idx) => String(idx)),
                    },
                };
            }
            return undefined;
        });
    }

    /** Open a declarative form to rename or retype function parameters and local variables. */
    async editVariables(candidate?: unknown, entryArg?: string): Promise<void> {
        const md5 = this.md5(candidate);
        const entry = await this.entry(md5, entryArg || this.resource(candidate, 'entry'));
        if (!entry) { return; }
        let baseline = await this.call<FunctionPrototypeSnapshot>('ghidra.functionPrototype', { md5, entry });
        const variableGrid = (key: string, label: string, singular: string, vars: { name: string; type: string }[]): GridSchema => ({
            key,
            label,
            singular,
            addMode: 'none',
            removable: false,
            variant: 'edit-grid',
            columns: [
                {
                    key: 'name',
                    label: 'Name',
                    kind: 'text',
                    hint: 'Variable identifier.',
                    rules: { required: true, requiredMessage: 'Variable name is required.' },
                },
                {
                    key: 'type',
                    label: 'Data type',
                    kind: 'type',
                    hint: 'Variable data type such as int or void *.',
                    rules: { required: true, typeRef: true },
                },
            ],
            rows: vars.map((variable, index) => ({ _original: String(index), name: variable.name, type: variable.type })),
        });
        await this.form(md5, `Variables · ${String(baseline.name)}`, entry, [], [
            variableGrid('parameters', 'Parameters', 'parameter', baseline.parameters || []),
            variableGrid('locals', 'Local variables', 'local variable', baseline.locals || []),
        ], async ({ tables }) => {
            const targetEntry = baseline.entry || entry;
            await this.call('ghidra.saveVariables', {
                md5,
                entry: targetEntry,
                original: baseline.original,
                parameters: tables.parameters || [],
                locals: tables.locals || [],
            });
            await this.refreshBrowser(md5);
            const refreshed = await this.call<FunctionPrototypeSnapshot>('ghidra.functionPrototype', { md5, entry: targetEntry }).catch(() => undefined);
            if (refreshed && refreshed.original) {
                baseline = refreshed;
                return {
                    rowOriginals: {
                        parameters: (refreshed.parameters || []).map((_, idx) => String(idx)),
                        locals: (refreshed.locals || []).map((_, idx) => String(idx)),
                    },
                };
            }
            return undefined;
        });
    }

    /** Open the inline five-kind comment widget at the resolved CodeUnit address. */
    async editComment(candidate?: unknown, addressArg?: string, typeArg?: string): Promise<void> {
        const md5 = this.md5(candidate);
        const location = await this.commentAddress(md5, candidate, addressArg);
        if (!location) { return; }
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
                uri: uri.toString(),
                position,
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
        address ||= await vscode.window.showInputBox({
            title: 'Choose comment address — not comment text',
            prompt: 'Enter an address in an open function; edit the comment beside its code.',
            placeHolder: 'ram:00401106',
            ignoreFocusOut: true,
            validateInput: input => /^(?:[^:\s]+:)*(?:0x)?[a-f\d]+$/i.test(input.trim()) ? undefined : 'Enter an address such as ram:00401106.',
        });
        if (!address) { return; }
        const resolved = await this.query(md5, 'address', 'resolve', { selector: { address: address.trim() } });
        const unit = object(resolved.code_unit);
        if (typeof unit.address !== 'string') {
            throw new Error('The backend did not report a CodeUnit at this address. Upgrade ghidra-mcp or select a code or data unit in Listing.');
        }
        return { address: unit.address, entry: this.resource(resolved.function, 'entry') };
    }

    /** Open a declarative form to rename a global symbol and optionally retype its backing global variable. */
    async editSymbol(candidate?: unknown, idArg?: string): Promise<void> {
        const md5 = this.md5(candidate);
        let id = idArg || this.resource(candidate, 'symbolId');
        if (!id) {
            const all = await this.call<{ items: Data[] }>('ghidra.symbols', { md5 });
            id = (await vscode.window.showQuickPick(
                all.items.map(sym => ({ label: String(sym.name), description: String(sym.address), id: String(sym.id) })),
                { title: 'Select symbol' },
            ))?.id;
        }
        if (!id) { return; }
        let symbolBaseline = await this.query(md5, 'symbol', 'get', { selector: { id } });
        let globalBaseline: Data | undefined;
        try {
            globalBaseline = await this.query(md5, 'global_variable', 'get', { selector: { address: symbolBaseline.address } });
        } catch (error) {
            if (!/not found|not_found|no .*data|does not exist|not a defined|not defined/i.test(String(error))) {
                throw error;
            }
        }
        const fields: FieldSchema[] = [
            {
                key: 'name',
                label: 'Symbol name',
                value: symbolBaseline.name,
                rules: { required: true, requiredMessage: 'Symbol name is required.' },
            },
            ...(globalBaseline ? [{
                key: 'type',
                label: 'Data type',
                kind: 'type' as const,
                value: reference(globalBaseline.data_type),
                hint: 'Data type of the global variable at this symbol address.',
                rules: { required: true, typeRef: true },
            }] : []),
        ];
        await this.form(md5, `Edit ${String(symbolBaseline.name)}`, String(symbolBaseline.address), fields, [], async ({ values }) => {
            await this.unchanged(md5, 'symbol', { id }, symbolBaseline);
            if (globalBaseline) {
                await this.unchanged(md5, 'global_variable', { address: symbolBaseline.address }, globalBaseline);
            }
            const name = required(values, 'name', 'Symbol name');
            const operations: Mutation[] = [];
            // A non-primary alias shares data with its primary symbol; rename the selected symbol identity only.
            if (name !== symbolBaseline.name) {
                operations.push({ method: 'symbol.patch', arguments: { selector: { id }, patch: { name } } });
            }
            if (globalBaseline) {
                const dataType = typeReference(values.type);
                if (!equal(dataType, globalBaseline.data_type)) {
                    operations.push({ method: 'global_variable.patch', arguments: { selector: { address: symbolBaseline.address }, patch: { data_type: dataType } } });
                }
            }
            await this.mutations(md5, operations);
            const refreshedSymbol = await this.query(md5, 'symbol', 'get', { selector: { id } }).catch(() => undefined);
            if (refreshedSymbol && Object.keys(refreshedSymbol).length > 0) {
                symbolBaseline = refreshedSymbol;
            }
            if (globalBaseline) {
                const refreshedGlobal = await this.query(md5, 'global_variable', 'get', { selector: { address: symbolBaseline.address } }).catch(() => undefined);
                if (refreshedGlobal && Object.keys(refreshedGlobal).length > 0) {
                    globalBaseline = refreshedGlobal;
                }
            }
            return { title: `Edit ${String(symbolBaseline.name)}` };
        });
    }

    /** Close inline comments and edit panels belonging to program `md5`. */
    close(md5: string): void {
        this.comments.close(md5);
        for (const [panel, owner] of this.panels) {
            if (owner === md5) { panel.dispose(); }
        }
    }

    /** Dispose the comment controller, open form panels, and registered commands. */
    dispose(): void {
        this.comments.dispose();
        this.panels.forEach((_md5, panel) => panel.dispose());
        this.disposables.forEach(item => item.dispose());
    }
}
