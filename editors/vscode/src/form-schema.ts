// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

import { Data, object, rows, typeReference } from './web';
import { TypeEditError } from './type-model';
import { formatFriendlyError } from './error';

/** Maximum signed 32-bit integer accepted by Ghidra sizes, offsets, and array counts. */
export const maxInt32 = 2147483647;

/** JSON path segment array addressing one scalar field or table cell inside a form. */
export type FormPath = (string | number)[];

/** Validation rules declared on a scalar form field or a table column. */
export interface FieldRule {
    /** Require a non-empty trimmed string or number value. */
    required?: boolean;
    /** Custom message shown when a required value is missing. */
    requiredMessage?: string;
    /** Require a checkbox control to be checked before submission. */
    mustBeChecked?: boolean;
    /** Require an integer within inclusive `[min, max]` bounds when present. */
    integer?: {
        /** Minimum allowed integer value. */
        min: number;
        /** Maximum allowed integer value. */
        max: number;
        /** Optional custom range validation message. */
        message?: string;
    };
    /** Require a valid C-like Ghidra data type reference when present. */
    typeRef?: boolean;
    /** Reject specific string values such as `unknown` calling conventions. */
    disallowed?: {
        /** Disallowed string literals. */
        values: string[];
        /** Compare values without case sensitivity when true. */
        ignoreCase?: boolean;
        /** Actionable message explaining what value to choose instead. */
        message: string;
    };
}

/** Declarative schema for one scalar input, checkbox, or textarea control. */
export interface FieldSchema {
    /** Form value key submitted for this field. */
    key: string;
    /** Canonical JSON path for error mapping; defaults to `[key]`. */
    path?: FormPath;
    /** Accessible visible label text. */
    label: string;
    /** Initial control value. */
    value?: unknown;
    /** Control input presentation kind. */
    kind?: 'text' | 'number' | 'textarea' | 'checkbox' | 'type';
    /** Render the control as read-only when true. */
    readonly?: boolean;
    /** Focus this control when the form first opens. */
    autofocus?: boolean;
    /** Optional placeholder text shown when empty. */
    placeholder?: string;
    /** Optional title tooltip text on the input control. */
    title?: string;
    /** Instructional or conditional hint linked through `aria-describedby`. */
    hint?: string;
    /** Place in a collapsible disclosure section when the initial value is valid. */
    advanced?: boolean;
    /** Declarative validation rules evaluated synchronously. */
    rules?: FieldRule;
}

/** Declarative schema for one column in an editable form table. */
export interface ColumnSchema {
    /** Property key inside each table row object. */
    key: string;
    /** Column header and accessible cell label suffix. */
    label: string;
    /** Cell input presentation kind. */
    kind?: 'text' | 'number' | 'type';
    /** Optional placeholder text for cells in this column. */
    placeholder?: string;
    /** Optional title tooltip on cells in this column. */
    title?: string;
    /** Instructional hint linked to cells in this column via `aria-describedby`. */
    hint?: string;
    /** Enable interactive ascending/descending header sort buttons when true. */
    sortable?: boolean;
    /** Format and sort cell values numerically when true. */
    numeric?: boolean;
    /** Enforce distinct values across all committed rows in this column. */
    unique?: {
        /** Allow multiple blank values when true (for example anonymous struct fields). */
        ignoreEmpty?: boolean;
        /** Error message shown on duplicate cells. */
        message: string;
    };
    /** Declarative validation rules evaluated for each committed row cell. */
    rules?: FieldRule;
}

/** Declarative schema for an editable member, parameter, or variable table. */
export interface GridSchema {
    /** Table identifier key. */
    key: string;
    /** Base JSON path for rows in this table; defaults to `[key]`. */
    path?: FormPath;
    /** Section heading text; omit section heading when `hideHeading` is true. */
    label: string;
    /** Omit the `<h2>` section heading above the table when true. */
    hideHeading?: boolean;
    /** Singular noun used in row button and cell accessible labels. */
    singular: string;
    /** Column definitions rendered in order. */
    columns: ColumnSchema[];
    /** Committed row values rendered on load. */
    rows: Data[];
    /** Row creation UI pattern. */
    addMode?: 'button' | 'inline-new' | 'none';
    /** Default cell values used for new rows or trailing inline-add rows. */
    newRowDefaults?: Data;
    /** Show a per-row remove button when true. */
    removable?: boolean;
    /** Show a keyboard and pointer drag reorder handle when true. */
    movable?: boolean;
    /** Data type kind tag (`struct`, `union`, `enum`, or `function`) for layout rules. */
    tableKind?: string;
    /** Visual table variant (`edit-grid` for modal forms, `type-table` for custom editors). */
    variant?: 'edit-grid' | 'type-table';
}

/** Declarative schema governing one mutation form across `EditingUI` or `DataTypeEditorView`. */
export interface FormSchema {
    /** HTML `<form>` element ID (`edit-form` or `type-editor-form`). */
    id: string;
    /** Persistence interaction mode (`submit` for RPC forms, `live-document` for `TextDocument` sync). */
    mode: 'submit' | 'live-document';
    /** Disable mutations across the entire form when read-only. */
    readonly?: boolean;
    /** Scalar form fields. */
    fields: FieldSchema[];
    /** Editable member or variable tables. */
    grids: GridSchema[];
    /** Optional form-level instructional hint paragraph. */
    hint?: string;
    /** Accessible label and tooltip for `#submit`. */
    submitLabel?: string;
    /** Icon name rendered inside `#submit`. */
    submitIcon?: 'save' | 'plus' | 'trash';
    /** Style `#submit` as a destructive action when true. */
    danger?: boolean;
    /** Render `#submit` and `#status` in a bottom `.form-actions` bar when true. */
    renderActionsBar?: boolean;
    /** Summary label for the collapsible `<details>` disclosure block. */
    disclosureLabel?: string;
    /** CSS class applied to the collapsible `<details>` disclosure block. */
    disclosureClass?: string;
    /** Legend text for the checkbox fieldset in `submit` forms. */
    checkGroupLegend?: string;
    /** Candidate type names and paths for the shared `#type-options` datalist. */
    typeOptions?: string[];
    /** Empty-state message shown when a form has no fields or tables. */
    emptyMessage?: string;
}

/** Structured validation error bound to one form control path and DOM ID. */
export interface FormValidationError {
    /** Canonical JSON path to the invalid field or cell. */
    path: FormPath;
    /** Deterministic HTML element ID of the invalid control. */
    controlId: string;
    /** Human-readable field or row-cell label shown in the error summary link. */
    label: string;
    /** Actionable validation message shown inline and in the error summary. */
    message: string;
}

/** Mapped summary and field-level errors produced from synchronous or server failures. */
export interface MappedFormErrors {
    /** Top-level error message when no field path matched, or summary prefix. */
    summary: string;
    /** Field-specific validation errors with resolved control IDs. */
    fieldErrors: FormValidationError[];
}

/** Return the canonical path of a scalar {@link FieldSchema}. */
export function fieldPath(field: FieldSchema): FormPath {
    return field.path ?? [field.key];
}

/** Return the canonical base path of a {@link GridSchema}. */
export function gridBasePath(grid: GridSchema): FormPath {
    return grid.path ?? [grid.key];
}

/** Compute a deterministic HTML element ID from a canonical {@link FormPath}. */
export function controlIdForPath(path: FormPath): string {
    const encoded = path.map(part => String(part).replace(/[^a-zA-Z0-9_-]/g, ch => `_${ch.charCodeAt(0).toString(16)}_`)).join('-');
    return `field-${encoded || 'root'}`;
}

/** Validate a C-like data type reference string and return an error message when invalid. */
export function validateTypeSyntax(raw: unknown, requiredFlag: boolean): string | undefined {
    const trimmed = String(raw ?? '').trim();
    if (!trimmed) {
        return requiredFlag ? 'Choose a data type.' : undefined;
    }
    try {
        typeReference(trimmed);
        return undefined;
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
}

/** Validate one raw control value synchronously against a {@link FieldRule}. */
export function validateFieldValue(raw: unknown, rules: FieldRule | undefined, label: string): string | undefined {
    if (!rules) { return undefined; }
    if (rules.mustBeChecked) {
        return raw === true ? undefined : (rules.requiredMessage || `${label} is required.`);
    }
    const text = typeof raw === 'boolean' ? (raw ? 'true' : '') : String(raw ?? '').trim();
    if (rules.required && !text) {
        if (rules.typeRef) { return 'Choose a data type.'; }
        return rules.requiredMessage || `${label} is required.`;
    }
    if (!text) { return undefined; }
    if (rules.disallowed) {
        const probe = rules.disallowed.ignoreCase ? text.toLowerCase() : text;
        const blocked = rules.disallowed.values.some(item => (rules.disallowed!.ignoreCase ? item.toLowerCase() : item) === probe);
        if (blocked) { return rules.disallowed.message; }
    }
    if (rules.integer) {
        const parsed = typeof raw === 'number' ? raw : (/^-?\d+$/.test(text) ? Number(text) : NaN);
        if (!Number.isSafeInteger(parsed) || parsed < rules.integer.min || parsed > rules.integer.max) {
            return rules.integer.message || `${label} must be an integer between ${rules.integer.min} and ${rules.integer.max}.`;
        }
    }
    if (rules.typeRef) {
        return validateTypeSyntax(text, Boolean(rules.required));
    }
    return undefined;
}

/** Validate all scalar fields and table rows in `values` and `tables` against `schema`. */
export function validateFormModel(schema: FormSchema, values: Data, tables: Record<string, Data[]>): FormValidationError[] {
    if (schema.readonly) { return []; }
    const errors: FormValidationError[] = [];
    for (const field of schema.fields) {
        if (field.readonly) { continue; }
        const path = fieldPath(field);
        const raw = field.path && field.path.length > 1
            ? readNestedValue(values, field.path) ?? values[field.key]
            : values[field.key];
        const message = validateFieldValue(raw, field.rules, field.label);
        if (message) {
            errors.push({ path, controlId: controlIdForPath(path), label: field.label, message });
        }
    }
    for (const grid of schema.grids) {
        const base = gridBasePath(grid);
        const list = tables[grid.key] || [];
        const seenByCol = new Map<string, Map<string, number[]>>();
        for (const col of grid.columns) {
            if (col.unique) { seenByCol.set(col.key, new Map()); }
        }
        list.forEach((row, rowIndex) => {
            if (row._new === true) { return; }
            for (const col of grid.columns) {
                const cellPath: FormPath = [...base, rowIndex, col.key];
                const cellLabel = `${capitalize(grid.singular)} ${rowIndex + 1} ${col.label.toLowerCase()}`;
                const raw = row[col.key];
                const message = validateFieldValue(raw, col.rules, cellLabel);
                if (message) {
                    errors.push({ path: cellPath, controlId: controlIdForPath(cellPath), label: cellLabel, message });
                    continue;
                }
                if (col.unique) {
                    const normalized = col.numeric && String(raw ?? '').trim() !== ''
                        ? String(Number(String(raw).trim()))
                        : String(raw ?? '').trim();
                    if (col.unique.ignoreEmpty && !normalized) { continue; }
                    const bucket = seenByCol.get(col.key)!;
                    const listIndices = bucket.get(normalized) || [];
                    listIndices.push(rowIndex);
                    bucket.set(normalized, listIndices);
                }
            }
        });
        for (const col of grid.columns) {
            if (!col.unique) { continue; }
            const bucket = seenByCol.get(col.key)!;
            for (const indices of bucket.values()) {
                if (indices.length < 2) { continue; }
                for (const dupIndex of indices.slice(1)) {
                    const cellPath: FormPath = [...base, dupIndex, col.key];
                    const cellLabel = `${capitalize(grid.singular)} ${dupIndex + 1} ${col.label.toLowerCase()}`;
                    if (!errors.some(err => sameFormPath(err.path, cellPath))) {
                        errors.push({ path: cellPath, controlId: controlIdForPath(cellPath), label: cellLabel, message: col.unique.message });
                    }
                }
            }
        }
    }
    return errors;
}

/** Build the declarative {@link FormSchema} for a parsed `.ghidra-type` JSONC model. */
export function typeEditorSchema(model: Data, readonly: boolean, typeOptions: string[]): FormSchema {
    const rawKind = typeof model.kind === 'string' ? model.kind : 'type';
    const kind = ({ structure: 'struct', function_definition: 'function' }[rawKind] || rawKind).toLowerCase();
    const fields: FieldSchema[] = [];
    const grids: GridSchema[] = [];

    if (Array.isArray(model.fields)) {
        const isStruct = kind === 'struct';
        const columns: ColumnSchema[] = [
            ...(isStruct ? [{
                key: 'offset',
                label: 'Offset',
                kind: 'text' as const,
                sortable: true,
                numeric: true,
                hint: 'Non-negative byte offset; each structure field needs a distinct offset.',
                unique: { message: 'Structure fields must have distinct offsets.' },
                rules: {
                    required: true,
                    requiredMessage: `Expected an integer from 0 to ${maxInt32}.`,
                    integer: { min: 0, max: maxInt32, message: `Expected an integer from 0 to ${maxInt32}.` },
                },
            }] : []),
            {
                key: 'name',
                label: 'Name',
                kind: 'text',
                sortable: true,
                hint: isStruct ? 'Optional field name; non-empty names must be unique.' : 'Required unique union field name.',
                unique: { ignoreEmpty: isStruct, message: 'Member names must be unique.' },
                rules: isStruct ? undefined : { required: true, requiredMessage: 'Expected a non-empty string.' },
            },
            {
                key: 'type',
                label: 'Type',
                kind: 'type',
                sortable: true,
                hint: 'C-like Ghidra data type such as int, char *, or byte[16].',
                rules: { required: true, typeRef: true },
            },
            {
                key: 'length',
                label: 'Length',
                kind: 'text',
                placeholder: 'Auto',
                title: 'Leave empty to use the natural size',
                sortable: true,
                numeric: true,
                hint: 'Leave empty to use the natural type size, or enter a positive byte length.',
                rules: {
                    integer: { min: 1, max: maxInt32, message: `Expected an integer from 1 to ${maxInt32}.` },
                },
            },
        ];
        const rawRows = rows(model.fields);
        const nextOffset = rawRows.reduce<number>((end, item) => Math.max(end, Number(item.offset || 0) + Number(item.length || 1)), 0);
        grids.push({
            key: 'fields',
            path: ['fields'],
            label: 'Fields',
            hideHeading: true,
            singular: 'field',
            columns,
            rows: rawRows,
            addMode: readonly ? 'none' : 'inline-new',
            newRowDefaults: { ...(isStruct ? { offset: nextOffset } : {}), name: '', type: 'undefined1', length: '' },
            removable: !readonly,
            movable: !readonly,
            tableKind: kind,
            variant: 'type-table',
        });
    }

    if (Array.isArray(model.values)) {
        const rawValues = rows(model.values);
        grids.push({
            key: 'values',
            path: ['values'],
            label: 'Values',
            hideHeading: true,
            singular: 'value',
            columns: [
                {
                    key: 'name',
                    label: 'Name',
                    kind: 'text',
                    sortable: true,
                    hint: 'Unique enumerator name.',
                    unique: { message: 'Member names must be unique.' },
                    rules: { required: true, requiredMessage: 'Expected a non-empty string.' },
                },
                {
                    key: 'value',
                    label: 'Value',
                    kind: 'text',
                    sortable: true,
                    numeric: true,
                    hint: 'Exact integer value for this enumerator.',
                    rules: {
                        required: true,
                        requiredMessage: `Expected an integer from ${Number.MIN_SAFE_INTEGER} to ${Number.MAX_SAFE_INTEGER}.`,
                        integer: {
                            min: Number.MIN_SAFE_INTEGER,
                            max: Number.MAX_SAFE_INTEGER,
                            message: `Expected an integer from ${Number.MIN_SAFE_INTEGER} to ${Number.MAX_SAFE_INTEGER}.`,
                        },
                    },
                },
            ],
            rows: rawValues,
            addMode: readonly ? 'none' : 'inline-new',
            newRowDefaults: { name: '', value: 0 },
            removable: !readonly,
            movable: false,
            tableKind: kind,
            variant: 'type-table',
        });
    }

    if (model.signature && typeof model.signature === 'object' && !Array.isArray(model.signature)) {
        const sig = object(model.signature);
        if ('return_type' in sig) {
            fields.push({
                key: 'return_type',
                path: ['signature', 'return_type'],
                label: 'Return type',
                kind: 'type',
                value: sig.return_type,
                readonly,
                hint: 'Return data type such as void, int, or char *.',
                rules: { required: true, typeRef: true },
            });
        }
        if ('calling_convention' in sig) {
            fields.push({
                key: 'calling_convention',
                path: ['signature', 'calling_convention'],
                label: 'Calling convention',
                kind: 'text',
                value: sig.calling_convention,
                readonly,
                hint: 'Known calling convention such as default or __cdecl (cannot be unknown).',
                advanced: ['default', 'unknown'].includes(String(sig.calling_convention).toLowerCase()),
                rules: {
                    required: true,
                    requiredMessage: 'Expected a non-empty string.',
                    disallowed: {
                        values: ['unknown'],
                        ignoreCase: true,
                        message: 'Choose a known calling convention, such as default.',
                    },
                },
            });
        }
        if ('has_var_args' in sig) {
            fields.push({
                key: 'has_var_args',
                path: ['signature', 'has_var_args'],
                label: 'Variadic arguments',
                kind: 'checkbox',
                value: sig.has_var_args,
                readonly,
                advanced: sig.has_var_args === false,
            });
        }
        if ('has_no_return' in sig) {
            fields.push({
                key: 'has_no_return',
                path: ['signature', 'has_no_return'],
                label: 'Does not return',
                kind: 'checkbox',
                value: sig.has_no_return,
                readonly,
                advanced: sig.has_no_return === false,
            });
        }
        if (Array.isArray(sig.parameters)) {
            grids.push({
                key: 'parameters',
                path: ['signature', 'parameters'],
                label: 'Parameters',
                singular: 'parameter',
                columns: [
                    {
                        key: 'name',
                        label: 'Name',
                        kind: 'text',
                        sortable: true,
                        hint: 'Optional parameter name.',
                    },
                    {
                        key: 'type',
                        label: 'Type',
                        kind: 'type',
                        sortable: true,
                        hint: 'Parameter data type such as int or void *.',
                        rules: { required: true, typeRef: true },
                    },
                ],
                rows: rows(sig.parameters),
                addMode: readonly ? 'none' : 'inline-new',
                newRowDefaults: { name: '', type: 'int' },
                removable: !readonly,
                movable: !readonly,
                tableKind: kind,
                variant: 'type-table',
            });
        }
    }

    return {
        id: 'type-editor-form',
        mode: 'live-document',
        readonly,
        fields,
        grids,
        submitLabel: 'Save data type',
        submitIcon: 'save',
        renderActionsBar: false,
        disclosureLabel: 'Signature options',
        disclosureClass: 'signature-options',
        typeOptions,
        emptyMessage: 'No editable fields.',
    };
}

/** Extract current scalar field values and row arrays from a parsed `.ghidra-type` JSONC model. */
export function extractTypeEditorData(model: Data): { values: Data; tables: Record<string, Data[]> } {
    const values: Data = {};
    const tables: Record<string, Data[]> = {};
    if (Array.isArray(model.fields)) { tables.fields = rows(model.fields); }
    if (Array.isArray(model.values)) { tables.values = rows(model.values); }
    if (model.signature && typeof model.signature === 'object' && !Array.isArray(model.signature)) {
        const sig = object(model.signature);
        values.signature = sig;
        for (const key of ['return_type', 'calling_convention', 'has_var_args', 'has_no_return']) {
            if (key in sig) { values[key] = sig[key]; }
        }
        if (Array.isArray(sig.parameters)) { tables.parameters = rows(sig.parameters); }
    }
    return { values, tables };
}

/** Map a `TypeEditError`, validation failure, or backend RPC error onto form controls. */
export function mapFormError(
    error: unknown,
    schema: FormSchema,
    currentTables: Record<string, Data[]> = {},
    explicitPath?: FormPath,
    currentValues: Data = {},
): MappedFormErrors {
    const friendly = formatFriendlyError(error);
    const candidatePath = explicitPath && explicitPath.length
        ? explicitPath
        : error instanceof TypeEditError && error.path.length
            ? error.path
            : inferErrorPath(friendly, schema, currentTables, currentValues);
    if (candidatePath && candidatePath.length) {
        const resolved = resolveErrorTarget(candidatePath, friendly, schema, currentTables);
        if (resolved) {
            return { summary: friendly, fieldErrors: [resolved] };
        }
    }
    return { summary: friendly, fieldErrors: [] };
}

/** Read a nested property from `root` along `path`. */
function readNestedValue(root: Data, path: FormPath): unknown {
    let cursor: unknown = root;
    for (const part of path) {
        if (!cursor || typeof cursor !== 'object') { return undefined; }
        cursor = (cursor as Record<string, unknown>)[String(part)];
    }
    return cursor;
}

/** Compare two {@link FormPath} arrays for exact segment equality. */
export function sameFormPath(left: FormPath, right: FormPath): boolean {
    return left.length === right.length && left.every((part, idx) => String(part) === String(right[idx]));
}

/** Capitalize the first character of a non-empty word. */
function capitalize(word: string): string {
    return word ? word[0].toUpperCase() + word.slice(1) : word;
}

/** Resolve a candidate JSON path to a concrete control in `schema` when one exists. */
function resolveErrorTarget(
    path: FormPath,
    message: string,
    schema: FormSchema,
    currentTables: Record<string, Data[]>,
): FormValidationError | undefined {
    for (const field of schema.fields) {
        const fp = fieldPath(field);
        if (sameFormPath(fp, path)) {
            return { path: fp, controlId: controlIdForPath(fp), label: field.label, message };
        }
    }
    for (const grid of schema.grids) {
        const base = gridBasePath(grid);
        if (path.length === base.length + 2 && base.every((seg, i) => String(seg) === String(path[i]))) {
            const rowIndex = Number(path[base.length]);
            const colKey = String(path[base.length + 1]);
            const col = grid.columns.find(item => item.key === colKey) || grid.columns[0];
            if (Number.isInteger(rowIndex) && rowIndex >= 0 && col) {
                const resolvedPath: FormPath = [...base, rowIndex, col.key];
                const label = `${capitalize(grid.singular)} ${rowIndex + 1} ${col.label.toLowerCase()}`;
                return { path: resolvedPath, controlId: controlIdForPath(resolvedPath), label, message };
            }
        }
        if (sameFormPath(base, path)) {
            const list = currentTables[grid.key] || grid.rows;
            const col = grid.columns[0];
            if (list.length > 0 && col) {
                const resolvedPath: FormPath = [...base, 0, col.key];
                const label = `${capitalize(grid.singular)} 1 ${col.label.toLowerCase()}`;
                return { path: resolvedPath, controlId: controlIdForPath(resolvedPath), label, message };
            }
        }
    }
    return undefined;
}

/** Infer a field or grid cell path from known backend validation messages in `prototype.rs` and `editing.ts`. */
function inferErrorPath(message: string, schema: FormSchema, tables: Record<string, Data[]>, values: Data): FormPath | undefined {
    const lower = message.toLowerCase();
    const findField = (...keys: string[]): FormPath | undefined => {
        const hit = schema.fields.find(field => keys.includes(field.key));
        return hit ? fieldPath(hit) : undefined;
    };
    if (/deletion checkbox/.test(lower)) { return findField('confirmed'); }
    if (/^address is required|enter an address|invalid address|\baddress\b.*not found/.test(lower)) { return findField('address'); }
    if (/^(function|type|symbol) name is required|duplicate.*name|already exists/.test(lower)) { return findField('name'); }
    if (/\breturn[_ ]type\b/.test(lower)) { return findField('returnType', 'return_type'); }
    if (/\bbase[_ ]type\b/.test(lower)) { return findField('base', 'base_type'); }
    if (/\bcategory[_ ]path\b/.test(lower)) { return findField('category', 'category_path'); }
    if (/calling[_ ]convention/.test(lower)) { return findField('convention', 'calling_convention'); }
    if (/^(initial )?size\b/.test(lower)) { return findField('size'); }
    const indexedMatch = /\b(parameter|parameters|local|locals|field|fields|value|values)\b.*?(?:\[\s*(\d+)\s*\]|\bindex\s*[=:]?\s*(\d+))/.exec(lower);
    if (indexedMatch) {
        const rawGroup = indexedMatch[1];
        const gridKey = rawGroup.startsWith('param') ? 'parameters' : rawGroup.startsWith('local') ? 'locals' : rawGroup.startsWith('field') ? 'fields' : 'values';
        const grid = schema.grids.find(g => g.key === gridKey);
        const idx = Number(indexedMatch[2] ?? indexedMatch[3]);
        if (grid && Number.isInteger(idx) && idx >= 0) {
            const wantsType = /\btype\b/.test(lower) && grid.columns.some(c => c.key === 'type');
            const wantsOffset = /\boffset\b/.test(lower) && grid.columns.some(c => c.key === 'offset');
            const colKey = wantsOffset ? 'offset' : wantsType ? 'type' : grid.columns[0]?.key || 'name';
            return [...gridBasePath(grid), idx, colKey];
        }
    }
    if (/\b(data[_ ]type|unknown type)\b/.test(lower)) {
        const directType = findField('type', 'base', 'returnType', 'return_type');
        if (directType) { return directType; }
    }
    if (/^parameter (name is required|variable identity|identity)/.test(lower)) {
        const grid = schema.grids.find(g => g.key === 'parameters');
        if (grid) {
            const list = tables.parameters || grid.rows;
            const idx = Math.max(0, list.findIndex(r => !String(r.name ?? '').trim()));
            return [...gridBasePath(grid), idx, 'name'];
        }
    }
    if (/^local variable identity/.test(lower)) {
        const grid = schema.grids.find(g => g.key === 'locals');
        if (grid) {
            const list = tables.locals || grid.rows;
            const idx = Math.max(0, list.findIndex(r => !String(r.name ?? '').trim()));
            return [...gridBasePath(grid), idx, 'name'];
        }
    }
    if (/^variable (name is required|identity)/.test(lower)) {
        const scalarName = findField('name');
        if (scalarName) { return scalarName; }
        for (const grid of schema.grids) {
            const list = tables[grid.key] || grid.rows;
            const idx = list.findIndex(r => !String(r.name ?? '').trim());
            if (idx >= 0) { return [...gridBasePath(grid), idx, 'name']; }
        }
    }
    if (/choose a data type|array length must be/.test(lower)) {
        for (const field of schema.fields) {
            if (field.kind !== 'type' && !field.rules?.typeRef) { continue; }
            const raw = field.path && field.path.length > 1 ? readNestedValue(values, field.path) ?? values[field.key] : values[field.key];
            if (validateFieldValue(raw, field.rules, field.label)) { return fieldPath(field); }
        }
        for (const grid of schema.grids) {
            const typeCol = grid.columns.find(c => c.kind === 'type' || c.rules?.typeRef);
            if (!typeCol) { continue; }
            const list = tables[grid.key] || grid.rows;
            const idx = list.findIndex(r => Boolean(validateFieldValue(r[typeCol.key], typeCol.rules, typeCol.label)));
            if (idx >= 0) { return [...gridBasePath(grid), idx, typeCol.key]; }
        }
        for (const field of schema.fields) {
            if (field.kind === 'type' || field.rules?.typeRef) { return fieldPath(field); }
        }
        for (const grid of schema.grids) {
            const typeCol = grid.columns.find(c => c.kind === 'type' || c.rules?.typeRef);
            if (typeCol && (tables[grid.key] || grid.rows).length > 0) { return [...gridBasePath(grid), 0, typeCol.key]; }
        }
    }
    return undefined;
}
