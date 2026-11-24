// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

import * as vscode from 'vscode';
import { callIcon } from './call-graph-icons';
import { formatFriendlyError } from './error';
import { formRuntimeCoreScript } from './form-runtime-core';
import { formRuntimeEventsScript } from './form-runtime-events';
import {
    ColumnSchema,
    controlIdForPath,
    FieldSchema,
    fieldPath,
    FormPath,
    FormSchema,
    FormValidationError,
    gridBasePath,
    GridSchema,
    mapFormError,
    validateFieldValue,
    validateFormModel,
} from './form-schema';
import { Data, escape, object, rows } from './web';

/** Drag-handle grip SVG icon rendered inside movable member rows. */
const moveGripSvg = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 3h2v2H4zm6 0h2v2h-2zM4 7h2v2H4zm6 0h2v2h-2zM4 11h2v2H4zm6 0h2v2h-2z"/></svg>';

/** Pattern matching uncertain post-send persistence errors that require user inspection. */
const uncertainSavePattern = /may have reached|Modification reached|persistence failed|saving.*failed|saved.*failed|regeneration failed|editor rejected|outcome.*unknown|not persisted/i;

/** Active table sort column and direction preserved across form syncs. */
export interface GridSortState {
    /** Column key sorted by the user. */
    field: string;
    /** Active ARIA sort direction. */
    direction: 'ascending' | 'descending';
}

/** Focus descriptor preserved across form submissions, row edits, and document syncs. */
export interface ControllerFocus {
    /** Kind of focused element inside the form or header toolbar. */
    kind?: 'control' | 'move' | 'remove' | 'add' | 'sort' | 'submit' | 'open-jsonc' | 'disclosure';
    /** Canonical JSON path when a scalar input or grid cell is focused. */
    path?: FormPath;
    /** Explicit element ID fallback. */
    controlId?: string;
    /** Owning grid key for move, remove, add, or sort buttons. */
    gridKey?: string;
    /** Zero-based row index for move or remove buttons. */
    index?: number;
    /** Column key for sort header buttons. */
    field?: string;
    /** Selection range start offset for text inputs. */
    start?: number | null;
    /** Selection range end offset for text inputs. */
    end?: number | null;
}

/** Runtime configuration passed to {@link mutationFormScript}. */
export interface FormControllerOptions {
    /** Declarative form schema governing fields, grids, and validation rules. */
    schema: FormSchema;
    /** Active column sort map keyed by grid key. */
    sorts?: Record<string, GridSortState>;
    /** Initial `TextDocument.version` in `live-document` mode. */
    draftVersion?: number;
    /** Whether the backing `TextDocument` starts with unsaved changes. */
    draftDirty?: boolean;
    /** Start the controller in a busy state while an initial save completes. */
    initialBusy?: boolean;
    /** Initial focus restoration target. */
    initialFocus?: ControllerFocus | null;
    /** Initial field-level validation errors to display on load. */
    initialErrors?: FormValidationError[];
    /** Initial summary alert text when an error is not bound to one field. */
    initialSummaryError?: string;
}

/** Submission payload delivered from the webview to an RPC save adapter. */
export interface FormSubmission {
    /** Scalar control values keyed by field `key`. */
    values: Data;
    /** Committed row arrays keyed by grid `key`. */
    tables: Record<string, Data[]>;
}

/** Optional baseline update metadata returned from an RPC save callback. */
export interface RpcSaveResult {
    /** Status confirmation text announced in `#status`. */
    message?: string;
    /** Updated `_original` row tokens keyed by grid `key` after saving. */
    rowOriginals?: Record<string, string[]>;
    /** Updated heading title when the edited resource was renamed. */
    title?: string;
}

/** Escape a JSON value for safe interpolation inside an inline `<script>` block. */
function scriptJson(value: unknown): string {
    return JSON.stringify(value).replace(/</g, '\\u003c');
}

/** Compute the shared DOM ID for a column's instructional hint element. */
function columnHintId(gridKey: string, columnKey: string): string {
    return `hint-grid-${gridKey}-${columnKey}`.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/** Render one scalar field control with explicit `<label for>`, `required`, hint, and inline error slot. */
function renderScalarField(field: FieldSchema, formMode: 'submit' | 'live-document', formReadonly: boolean): string {
    const path = fieldPath(field);
    const id = controlIdForPath(path);
    const hintId = field.hint ? `${id}-hint` : '';
    const errorId = `${id}-error`;
    const locked = formReadonly || Boolean(field.readonly);
    const reqAttr = !locked && (field.rules?.required || field.rules?.mustBeChecked) ? ' required' : '';
    const descAttr = hintId ? ` aria-describedby="${escape(hintId)}"` : '';
    const hintAttr = hintId ? ` data-hint-id="${escape(hintId)}"` : '';
    const pathAttr = `data-path="${escape(JSON.stringify(path))}"`;
    const commonAttrs = `id="${escape(id)}" name="${escape(field.key)}" ${pathAttr}${hintAttr}${descAttr}${reqAttr}${field.autofocus ? ' autofocus' : ''}`;
    const hintHtml = field.hint ? `<p id="${escape(hintId)}" class="field-hint">${escape(field.hint)}</p>` : '';
    const errorHtml = `<p id="${escape(errorId)}" class="field-error" hidden></p>`;

    if (field.kind === 'checkbox') {
        const rowClass = formMode === 'live-document' ? 'type-flag' : 'checkbox';
        const lockAttrs = locked ? ' aria-disabled="true" data-readonly-lock="true"' : '';
        return `<div class="form-field form-field-check"><div class="${rowClass}"><input ${commonAttrs} type="checkbox"${field.value === true ? ' checked' : ''}${lockAttrs}><label for="${escape(id)}">${escape(field.label)}</label></div>${hintHtml}${errorHtml}</div>`;
    }

    const readonlyAttr = locked ? ' readonly' : '';
    const placeholderAttr = field.placeholder ? ` placeholder="${escape(field.placeholder)}"` : '';
    const titleAttr = field.title ? ` title="${escape(field.title)}"` : '';
    const listAttr = field.kind === 'type' ? ' list="type-options"' : '';
    const numAttr = field.kind === 'number' ? ' data-number="true"' : '';
    const control = field.kind === 'textarea'
        ? `<textarea ${commonAttrs}${readonlyAttr}${placeholderAttr}${titleAttr}>${escape(field.value ?? '')}</textarea>`
        : `<input ${commonAttrs} type="${field.kind === 'number' ? 'number' : 'text'}" value="${escape(field.value ?? '')}"${listAttr}${numAttr}${readonlyAttr}${placeholderAttr}${titleAttr}>`;
    return `<div class="form-field${field.kind === 'textarea' ? ' full' : ''}"><label for="${escape(id)}">${escape(field.label)}</label>${control}${hintHtml}${errorHtml}</div>`;
}

/** Render one cell inside a `type-table` or `edit-grid` row. */
function renderGridCell(
    grid: GridSchema,
    col: ColumnSchema,
    row: Data,
    rowIndex: number,
    formReadonly: boolean,
    isNewRow: boolean,
    isTemplateRow: boolean,
): string {
    const base = gridBasePath(grid);
    const cellPath: FormPath = [...base, rowIndex, col.key];
    const id = isTemplateRow ? '' : controlIdForPath(cellPath);
    const errorId = id ? `${id}-error` : '';
    const hintId = col.hint ? columnHintId(grid.key, col.key) : '';
    const locked = formReadonly;
    const isRequired = !locked && !isNewRow && Boolean(col.rules?.required || col.rules?.mustBeChecked);
    const isTypeTable = grid.variant === 'type-table';
    const isNewAnchor = isNewRow && col.key === 'name';
    const ariaLabel = isTypeTable
        ? (isNewAnchor ? `Add ${grid.singular}` : `${grid.singular} ${rowIndex + 1} ${col.key}`)
        : col.label;
    const placeholder = isNewAnchor
        ? `+ Add ${grid.singular}`
        : (col.placeholder || '');
    const numeric = Boolean(col.numeric || col.kind === 'number');
    const inputType = !isTypeTable && col.kind === 'number' ? 'number' : 'text';
    const idAttr = id ? `id="${escape(id)}" ` : '';
    const descAttr = !isNewRow && hintId ? ` aria-describedby="${escape(hintId)}"` : '';
    const hintAttr = hintId ? ` data-hint-id="${escape(hintId)}"` : '';
    const reqAttr = isRequired ? ' required' : '';
    const listAttr = col.kind === 'type' ? ' list="type-options"' : '';
    const numAttr = numeric ? ' data-number="true"' : '';
    const newAttr = isNewAnchor ? ` data-new-key="${escape(grid.key)}"` : '';
    const placeAttr = placeholder ? ` placeholder="${escape(placeholder)}"` : '';
    const titleAttr = !isNewRow && col.title ? ` title="${escape(col.title)}"` : '';
    const roAttr = locked ? ' readonly' : '';
    const inputHtml = `<input ${idAttr}data-column="${escape(col.key)}" data-path="${escape(JSON.stringify(cellPath))}" aria-label="${escape(ariaLabel)}" type="${inputType}" value="${escape(row[col.key] ?? '')}"${listAttr}${numAttr}${newAttr}${placeAttr}${titleAttr}${roAttr}${hintAttr}${descAttr}${reqAttr}>`;
    const errorHtml = `<p${errorId ? ` id="${escape(errorId)}"` : ''} class="field-error cell-error" hidden></p>`;
    const tdAttrs = isTypeTable
        ? ` data-field="${escape(col.key)}" data-label="${escape(col.label)}"`
        : ` data-field="${escape(col.key)}"`;
    return `<td${tdAttrs}>${inputHtml}${errorHtml}</td>`;
}

/** Render one editable table section for either `EditingUI` (`edit-grid`) or `DataTypeEditorView` (`type-table`). */
function renderGrid(grid: GridSchema, formReadonly: boolean): string {
    const base = gridBasePath(grid);
    const isTypeTable = grid.variant === 'type-table';
    const canMove = !formReadonly && Boolean(grid.movable);
    const canRemove = !formReadonly && grid.removable !== false;
    const colHints = grid.columns
        .filter(col => Boolean(col.hint))
        .map(col => `<span id="${escape(columnHintId(grid.key, col.key))}" class="sr-only-hint">${escape(col.hint)}</span>`)
        .join('');

    const renderRow = (row: Data, index: number, isNew = false, isTemplate = false): string => {
        const cells = grid.columns.map(col => renderGridCell(grid, col, row, index, formReadonly, isNew, isTemplate)).join('');
        const moveCell = canMove
            ? `<td class="type-row-handle"><button type="button" class="type-icon type-move" data-move aria-label="Move ${escape(grid.singular)} ${index + 1}" title="Drag or use arrow keys to move ${escape(grid.singular)}">${moveGripSvg}</button></td>`
            : '';
        const removeLabel = isTypeTable ? `Remove ${grid.singular} ${index + 1}` : `Remove ${grid.singular}`;
        const removeCell = !canRemove
            ? ''
            : isTypeTable
                ? `<td class="type-row-action"><button type="button" class="type-icon" data-remove-row data-action="remove" aria-label="${escape(removeLabel)}" title="Remove ${escape(grid.singular)}">${callIcon('trash')}</button></td>`
                : `<td><button type="button" class="row-remove secondary" data-remove-row aria-label="${escape(removeLabel)}" title="${escape(removeLabel)}">${callIcon('trash')}</button></td>`;
        const origAttr = !isTypeTable ? ` data-original="${escape(row._original ?? '')}"` : '';
        const newAttr = isNew ? ' data-new="true"' : '';
        return `<tr data-index="${index}"${origAttr}${newAttr}>${moveCell}${cells}${removeCell}</tr>`;
    };

    if (isTypeTable) {
        const indexed = grid.rows.map((item, index) => ({ item, index }));
        if (grid.key === 'fields' && grid.tableKind === 'struct') {
            indexed.sort((a, b) => Number(a.item.offset ?? 0) - Number(b.item.offset ?? 0));
        }
        const bodyRows = indexed.map(({ item, index }) => renderRow(item, index)).join('');
        const blankRow = !formReadonly && grid.addMode === 'inline-new'
            ? renderRow(grid.newRowDefaults || { name: '' }, grid.rows.length, true)
            : '';
        const heading = grid.hideHeading ? '' : `<h2>${escape(grid.label)}</h2>`;
        const headers = grid.columns.map(col => col.sortable
            ? `<th scope="col" data-field="${escape(col.key)}" aria-sort="none"><button type="button" class="type-sort" data-sort="${escape(col.key)}" aria-label="Sort by ${escape(col.key)}">${escape(col.label)}<span aria-hidden="true"></span></button></th>`
            : `<th scope="col" data-field="${escape(col.key)}">${escape(col.label)}</th>`).join('');
        return `<section class="type-list">${heading}${colHints}<div class="type-table-wrap"><table class="type-table" data-type-list="${escape(grid.key)}" data-grid-key="${escape(grid.key)}" data-base-path="${escape(JSON.stringify(base))}" data-kind="${escape(grid.tableKind || '')}" data-readonly="${formReadonly}"><thead><tr>${canMove ? '<th class="type-handle-col" scope="col"><span class="type-sr-only">Move</span></th>' : ''}${headers}${canRemove ? '<th class="type-action-col" scope="col"><span class="type-sr-only">Actions</span></th>' : ''}</tr></thead><tbody>${bodyRows}${blankRow}</tbody></table></div></section>`;
    }

    const bodyRows = grid.rows.map((item, index) => renderRow(item, index)).join('');
    const headers = grid.columns.map(col => `<th scope="col">${escape(col.label)}</th>`).join('');
    const addControls = !formReadonly && grid.addMode === 'button'
        ? `<template data-row-template="${escape(grid.key)}">${renderRow(grid.newRowDefaults || {}, 0, false, true)}</template><button type="button" class="secondary icon-add" data-add-row="${escape(grid.key)}" aria-label="Add ${escape(grid.singular)}" title="Add ${escape(grid.singular)}">${callIcon('plus')}</button>`
        : '';
    return `<section><h2>${escape(grid.label)}</h2>${colHints}<div class="table-wrap"><table class="editable" data-table="${escape(grid.key)}" data-grid-key="${escape(grid.key)}" data-base-path="${escape(JSON.stringify(base))}"><thead><tr>${headers}${canRemove ? '<th><span class="sr-only-hint">Actions</span></th>' : ''}</tr></thead><tbody>${bodyRows}</tbody></table></div>${addControls}</section>`;
}

/** Render the inner `#form-surface` markup for a {@link FormSchema}, promoting invalid initial fields out of `<details>`. */
export function renderFormSurface(schema: FormSchema): string {
    const readonly = Boolean(schema.readonly);
    const advancedFields = schema.fields.filter(field =>
        Boolean(field.advanced)
        && !readonly
        && !validateFieldValue(field.value, field.rules, field.label),
    );
    const visibleFields = schema.fields.filter(field => !advancedFields.includes(field));

    if (schema.mode === 'live-document') {
        let html = '';
        if (visibleFields.length) {
            const scalars = visibleFields.filter(field => field.kind !== 'checkbox');
            const flags = visibleFields.filter(field => field.kind === 'checkbox');
            html += `<section class="type-definition">`
                + (scalars.length ? `<div class="form-grid">${scalars.map(f => renderScalarField(f, 'live-document', readonly)).join('')}</div>` : '')
                + (flags.length ? `<div class="type-flags">${flags.map(f => renderScalarField(f, 'live-document', readonly)).join('')}</div>` : '')
                + `</section>`;
        }
        if (advancedFields.length) {
            const advScalars = advancedFields.filter(field => field.kind !== 'checkbox');
            const advFlags = advancedFields.filter(field => field.kind === 'checkbox');
            html += `<details class="${escape(schema.disclosureClass || 'signature-options')}"><summary>${escape(schema.disclosureLabel || 'Signature options')}</summary>`
                + (advScalars.length ? `<div class="form-grid">${advScalars.map(f => renderScalarField(f, 'live-document', readonly)).join('')}</div>` : '')
                + (advFlags.length ? `<div class="type-flags">${advFlags.map(f => renderScalarField(f, 'live-document', readonly)).join('')}</div>` : '')
                + `</details>`;
        }
        if (schema.hint) {
            html += `<p class="form-hint">${escape(schema.hint)}</p>`;
        }
        html += schema.grids.map(grid => renderGrid(grid, readonly)).join('');
        if (!html && schema.emptyMessage) {
            html = `<p class="type-empty">${escape(schema.emptyMessage)}</p>`;
        }
        return html;
    }

    const controls = visibleFields.filter(field => field.kind !== 'checkbox' && field.kind !== 'textarea');
    const flags = visibleFields.filter(field => field.kind === 'checkbox');
    const notes = visibleFields.filter(field => field.kind === 'textarea');
    const fieldBody = (controls.length ? `<div class="form-grid">${controls.map(f => renderScalarField(f, 'submit', readonly)).join('')}</div>` : '')
        + (flags.length ? `<fieldset class="check-group"><legend>${escape(schema.checkGroupLegend || 'Behavior')}</legend>${flags.map(f => renderScalarField(f, 'submit', readonly)).join('')}</fieldset>` : '')
        + (notes.length ? `<div class="form-grid form-notes">${notes.map(f => renderScalarField(f, 'submit', readonly)).join('')}</div>` : '');
    const hintHtml = schema.hint ? `<p class="form-hint">${escape(schema.hint)}</p>` : '';
    const gridsHtml = schema.grids.map(grid => renderGrid(grid, readonly)).join('');
    const disclosureHtml = advancedFields.length
        ? `<details class="${escape(schema.disclosureClass || 'advanced-fields')}"><summary>${escape(schema.disclosureLabel || 'Advanced options')}</summary><div class="form-grid">${advancedFields.map(f => renderScalarField(f, 'submit', readonly)).join('')}</div></details>`
        : '';
    const emptyHtml = !fieldBody && !gridsHtml && schema.emptyMessage
        ? `<p class="empty">${escape(schema.emptyMessage)}</p>`
        : '';
    return `${fieldBody ? `<section class="form-fields">${fieldBody}</section>` : ''}${hintHtml}${gridsHtml}${disclosureHtml}${emptyHtml}`;
}

/** Render a complete `<form novalidate>` wrapper, `#form-surface`, `#type-options` datalist, and optional `.form-actions` bar. */
export function renderDeclarativeForm(schema: FormSchema, surfaceHtmlOverride?: string): string {
    const submitLabel = schema.submitLabel || 'Save changes';
    const submitIcon = schema.submitIcon || 'save';
    const options = (schema.typeOptions || []).map(item => `<option value="${escape(item)}"></option>`).join('');
    const actionsHtml = schema.renderActionsBar === false
        ? ''
        : `<div class="toolbar form-actions"><button class="primary icon-submit${schema.danger ? ' danger' : ''}" id="submit" type="submit" aria-label="${escape(submitLabel)}" title="${escape(submitLabel)}">${callIcon(submitIcon)}</button></div><p id="status" class="success" role="status"></p>`;
    const surface = surfaceHtmlOverride ?? renderFormSurface(schema);
    return `<form id="${escape(schema.id)}" data-mutation-form="${escape(schema.mode)}" novalidate${schema.readonly ? ' data-readonly="true"' : ''}><div id="form-surface">${surface}</div><datalist id="type-options">${options}</datalist>${actionsHtml}</form>`;
}

/** Build the unified client-side declarative controller script shared by `EditingUI` and `DataTypeEditorView`. */
export function mutationFormScript(options: FormControllerOptions): string {
    const config = {
        schema: options.schema,
        sorts: options.sorts || {},
        draftVersion: options.draftVersion ?? 0,
        draftDirty: Boolean(options.draftDirty),
        initialBusy: Boolean(options.initialBusy),
        initialFocus: options.initialFocus ?? null,
        initialErrors: options.initialErrors || [],
        initialSummaryError: options.initialSummaryError || '',
    };
    return `(() => {
const cfg = ${scriptJson(config)};
let formSchema = cfg.schema;
let activeSorts = { ...cfg.sorts };
let draftVersion = cfg.draftVersion;
let draftDirty = cfg.draftDirty;
let generation = 1;
let busy = false;
let busyAction = '';
let saveQueued = false;
let busyFocus = null;
let dragging = null;
let blurTimer = 0;
let suppressBlurUntil = 0;

const form = document.getElementById(formSchema.id);
if (!form) { return; }
if (formSchema.mode === 'live-document') {
    document.body.dataset.draftVersion = String(draftVersion);
}

const post = payload => {
    vscode.postMessage({ ...payload, generation });
};
${formRuntimeCoreScript()}
${formRuntimeEventsScript()}
})();`;
}

/** Bind RPC save handling, synchronous schema checks, and structured error mapping to a form webview panel. */
export function bindRpcFormPanel(
    panel: vscode.WebviewPanel,
    schema: FormSchema,
    save: (submission: FormSubmission) => Promise<void | RpcSaveResult>,
): void {
    let busy = false;
    panel.webview.onDidReceiveMessage(async (rawMessage: unknown) => {
        const data = object(rawMessage);
        if (data.action === 'cancel') {
            panel.dispose();
            return;
        }
        if (data.action !== 'submit' || busy) {
            return;
        }
        busy = true;
        const values = object(data.values);
        const tables = Object.fromEntries(
            Object.entries(object(data.tables)).map(([key, list]) => [key, rows(list)]),
        );
        try {
            const schemaErrors = validateFormModel(schema, values, tables);
            if (schemaErrors.length > 0) {
                await panel.webview.postMessage({
                    action: 'result',
                    error: schemaErrors[0].message,
                    fieldErrors: schemaErrors,
                });
                return;
            }
            const savedValues = await save({ values, tables });
            await panel.webview.postMessage({
                action: 'result',
                savedValues: savedValues || undefined,
                message: savedValues?.message || 'Saved to the Ghidra project.',
            });
        } catch (error) {
            const rawText = String(error);
            const uncertain = uncertainSavePattern.test(rawText);
            const mapped = mapFormError(error, schema, tables, undefined, values);
            await panel.webview.postMessage({
                action: 'result',
                error: formatFriendlyError(error),
                fieldErrors: mapped.fieldErrors,
                uncertain,
            });
        } finally {
            busy = false;
        }
    });
}
