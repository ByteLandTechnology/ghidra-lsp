// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

import * as vscode from 'vscode';
import { applyEdits, modify, parse, ParseError, printParseErrorCode } from 'jsonc-parser';
import { DataTypeFiles, typePath } from './type-files';
import { callIcon } from './call-graph-icons';
import { Data, escape, object, page, properties, reference, rows } from './web';
import { Call } from './memory';
import { parseType, reorderTypeMembers, typeModel, typeMutations } from './type-model';
import {
    extractTypeEditorData,
    FormSchema,
    FormValidationError,
    mapFormError,
    sameFormPath,
    typeEditorSchema,
    validateFormModel,
} from './form-schema';
import {
    ControllerFocus,
    GridSortState,
    mutationFormScript,
    renderDeclarativeForm,
    renderFormSurface,
} from './form-controller';

/** Custom editor viewType identifier for the graphical data type editor. */
export const typeEditorView = 'ghidra.dataTypeEditor';

/** Structured metadata summary rendered below the data type editor heading. */
interface TypeHeaderSummary {
    /** Plain-text metadata summary used for tooltips. */
    subtitle: string;
    /** Rich HTML metadata containing the kind badge, path, total bytes, and member count. */
    subtitleHtml: string;
    /** Byte-length label when known from the definition. */
    bytesLabel?: string;
    /** Member-count label for fields, enum values, or function parameters. */
    countLabel?: string;
}

/** Evaluated form surface, schema, and validation state for a `.ghidra-type` buffer. */
interface EvaluatedTypeState {
    /** Whether the current document text parsed as a JSONC object. */
    validJsonc: boolean;
    /** Parsed JSONC object when `validJsonc` is true. */
    model?: Data;
    /** Declarative form schema built from `model`. */
    schema: FormSchema;
    /** Rendered `#form-surface` HTML markup. */
    surfaceHtml: string;
    /** Top-level error summary when no field path matched or JSONC syntax failed. */
    error: string;
    /** Field-specific validation errors with resolved control IDs. */
    fieldErrors: FormValidationError[];
}

/** Build structured header metadata from a parsed data type model. */
function typeHeaderSummary(model: unknown, fallbackPath: string, readonly: boolean, fallbackBytes?: number): TypeHeaderSummary {
    const m = object(model);
    const rawKind = typeof m.kind === 'string' && m.kind ? m.kind : 'type';
    const kind = ({ structure: 'struct', function_definition: 'function' }[rawKind] || rawKind).toLowerCase();
    const path = typeof m.path === 'string' && m.path ? m.path : fallbackPath;
    const explicitSize = typeof m.length === 'number' && m.length >= 0 ? m.length
        : typeof m.size === 'number' && m.size >= 0 ? m.size : undefined;
    let totalBytes = explicitSize;
    if (totalBytes === undefined && Array.isArray(m.fields)) {
        if (!m.fields.length) {
            totalBytes = 0;
        } else if (kind === 'struct') {
            const valid = m.fields.every((field: unknown) => {
                const item = object(field);
                return typeof item.offset === 'number' && item.offset >= 0 && typeof item.length === 'number' && item.length > 0;
            });
            if (valid) {
                totalBytes = m.fields.reduce<number>((end, field) => Math.max(end, Number(object(field).offset) + Number(object(field).length)), 0);
            }
        } else if (kind === 'union') {
            const valid = m.fields.every((field: unknown) => typeof object(field).length === 'number' && Number(object(field).length) > 0);
            if (valid) {
                totalBytes = m.fields.reduce<number>((maxLen, field) => Math.max(maxLen, Number(object(field).length)), 0);
            }
        }
    }
    if (totalBytes === undefined && typeof fallbackBytes === 'number' && fallbackBytes >= 0) {
        totalBytes = fallbackBytes;
    }
    const bytesLabel = totalBytes !== undefined ? `${totalBytes} ${totalBytes === 1 ? 'byte' : 'bytes'}` : undefined;
    let countLabel: string | undefined;
    if (Array.isArray(m.fields)) {
        countLabel = `${m.fields.length} ${m.fields.length === 1 ? 'field' : 'fields'}`;
    } else if (Array.isArray(m.values)) {
        countLabel = `${m.values.length} ${m.values.length === 1 ? 'value' : 'values'}`;
    } else if (m.signature) {
        const params = object(m.signature).parameters;
        if (Array.isArray(params)) {
            const count = params.length;
            countLabel = `${count} ${count === 1 ? 'parameter' : 'parameters'}`;
        }
    }
    const subtitle = [kind, ...(readonly ? ['read-only'] : []), path, bytesLabel, countLabel].filter(Boolean).join(' · ');
    const subtitleHtml = [
        `<span class="type-kind-badge">${escape(kind)}</span>`,
        readonly ? '<span class="type-kind-badge is-readonly">read-only</span>' : '',
        `<code class="mono type-meta-path">${escape(path)}</code>`,
        `<span class="type-meta-sep" aria-hidden="true"${bytesLabel ? '' : ' hidden'}>·</span><span class="type-meta-stat" data-meta-bytes${bytesLabel ? '' : ' hidden'}>${escape(bytesLabel || '')}</span>`,
        `<span class="type-meta-sep" aria-hidden="true"${countLabel ? '' : ' hidden'}>·</span><span class="type-meta-stat" data-meta-count${countLabel ? '' : ' hidden'}>${escape(countLabel || '')}</span>`,
    ].filter(Boolean).join('');
    return { subtitle, subtitleHtml, bytesLabel, countLabel };
}

/** Normalize raw read-only model member types into display strings for `typeEditorSchema`. */
function normalizeReadonlyModel(rawModel: Data): Data {
    const copy: Data = { ...rawModel };
    if (Array.isArray(rawModel.fields)) {
        copy.fields = rawModel.fields.map(item => {
            const f = object(item);
            return { ...f, type: f.type !== undefined ? f.type : reference(f.data_type) };
        });
    }
    if (rawModel.signature && typeof rawModel.signature === 'object' && !Array.isArray(rawModel.signature)) {
        const sig = object(rawModel.signature);
        if (Array.isArray(sig.parameters)) {
            copy.signature = {
                ...sig,
                return_type: sig.return_type !== undefined ? reference(sig.return_type) : undefined,
                parameters: sig.parameters.map(item => {
                    const p = object(item);
                    return { ...p, type: p.type !== undefined ? p.type : reference(p.data_type) };
                }),
            };
        }
    }
    return copy;
}

/** Extract byte size from a raw Ghidra data type payload when non-negative. */
function extractRawBytes(raw: Data | undefined): number | undefined {
    if (!raw) { return undefined; }
    if (typeof raw.length === 'number' && raw.length >= 0) { return raw.length; }
    if (typeof raw.size === 'number' && raw.size >= 0) { return raw.size; }
    return undefined;
}

/** Declarative custom editor representation of a `.ghidra-type` JSONC document. */
export class DataTypeEditorView implements vscode.CustomTextEditorProvider, vscode.Disposable {
    /** VS Code custom editor provider registration handle. */
    private readonly registration: vscode.Disposable;

    /** Register the `ghidra.dataTypeEditor` custom text editor provider. */
    constructor(private readonly call: Call, private readonly typeFiles?: DataTypeFiles) {
        this.registration = vscode.window.registerCustomEditorProvider(typeEditorView, this, {
            webviewOptions: { retainContextWhenHidden: true },
            supportsMultipleEditorsPerDocument: true,
        });
    }

    /** Bind a declarative graphical form webview to an open `ghidra-type://` JSONC document. */
    async resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): Promise<void> {
        const path = typePath(document.uri);
        panel.webview.options = { enableScripts: true, localResourceRoots: [] };
        const stat = await vscode.workspace.fs.stat(document.uri);
        const readonly = !!(stat.permissions && (stat.permissions & vscode.FilePermission.Readonly));
        let applying = false;
        let savingFromWebview = false;
        let awaitingSaveReadback = false;
        let panelVersion = document.version;
        let generation = 1;
        let completedUpdateGeneration: number | undefined;
        let editorFocus: ControllerFocus | undefined;
        let baselineRaw: Data | undefined = this.typeFiles?.snapshotOriginal(document.uri);
        let cachedRawBytes: number | undefined = extractRawBytes(baselineRaw);
        const sorts: Record<string, GridSortState> = {};
        let typeOptions = ['void', 'pointer', 'int', 'char', 'byte', 'undefined1', 'undefined4', 'uint', 'long'];
        let activeSchema: FormSchema = typeEditorSchema({}, readonly, typeOptions);

        const evaluateDocumentState = (text: string): EvaluatedTypeState => {
            const parseErrors: ParseError[] = [];
            const parsed = parse(text, parseErrors, { allowTrailingComma: true, disallowComments: false });
            if (parseErrors.length || !parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                const code = parseErrors.length ? printParseErrorCode(parseErrors[0].error) : 'ObjectExpected';
                const error = `The definition contains invalid JSONC (${code}). Correct it in the JSONC text editor or use Undo.`;
                const schema: FormSchema = {
                    id: 'type-editor-form',
                    mode: 'live-document',
                    readonly: true,
                    fields: [],
                    grids: [],
                    renderActionsBar: false,
                    typeOptions,
                    emptyMessage: 'The definition contains invalid JSONC. Use the JSONC button above to correct it.',
                };
                return {
                    validJsonc: false,
                    schema,
                    surfaceHtml: renderFormSurface(schema),
                    error,
                    fieldErrors: [],
                };
            }

            const modelObj = object(parsed);
            if (readonly) {
                const reason = text.split('\n').find(line => line.startsWith('// Read-only: '))?.slice('// Read-only: '.length) || 'This type is read-only.';
                const information: [string, unknown][] = [['Kind', modelObj.kind], ['Size', modelObj.length ?? modelObj.size]];
                if (modelObj.base_type) { information.push(['Base type', reference(modelObj.base_type)]); }
                let leadHtml = `<section class="type-definition"><p class="hint" title="${escape(reason)}">Read-only</p>${properties(information)}</section>`;
                const normalized = normalizeReadonlyModel(modelObj);
                const roSchema = typeEditorSchema({ ...normalized, signature: undefined }, true, typeOptions);
                let sigHtml = '';
                if (modelObj.signature && typeof modelObj.signature === 'object' && !Array.isArray(modelObj.signature)) {
                    const sig = object(modelObj.signature);
                    sigHtml += `<section><h2>Signature</h2>${properties([
                        ['Return type', reference(sig.return_type)],
                        ['Calling convention', sig.calling_convention],
                        ['Variadic', sig.has_var_args === true ? 'Yes' : 'No'],
                    ])}</section>`;
                    const sigOnly = typeEditorSchema({ kind: modelObj.kind, signature: object(normalized.signature) }, true, typeOptions);
                    sigOnly.fields = [];
                    sigHtml += renderFormSurface(sigOnly);
                    roSchema.grids.push(...sigOnly.grids);
                }
                const rawDetails = `<details class="type-raw"><summary>Raw definition</summary><pre>${escape(text)}</pre></details>`;
                const gridSurface = roSchema.grids.length ? renderFormSurface({ ...roSchema, grids: roSchema.grids.filter(g => g.key !== 'parameters'), emptyMessage: undefined }) : '';
                return {
                    validJsonc: true,
                    model: modelObj,
                    schema: roSchema,
                    surfaceHtml: leadHtml + gridSurface + sigHtml + rawDetails,
                    error: '',
                    fieldErrors: [],
                };
            }

            const schema = typeEditorSchema(modelObj, false, typeOptions);
            const { values, tables } = extractTypeEditorData(modelObj);
            const fieldErrors = validateFormModel(schema, values, tables);
            let summaryError = '';

            if (baselineRaw) {
                try {
                    const originalModel = typeModel(baselineRaw);
                    const draft = parseType(text, originalModel);
                    typeMutations(originalModel, draft, baselineRaw);
                } catch (err) {
                    const mapped = mapFormError(err, schema, tables, undefined, values);
                    for (const item of mapped.fieldErrors) {
                        if (!fieldErrors.some(existing => sameFormPath(existing.path, item.path))) {
                            fieldErrors.push(item);
                        }
                    }
                    if (!fieldErrors.length && mapped.summary) {
                        summaryError = mapped.summary;
                    }
                }
            }

            const cachedValidation = this.typeFiles?.validationFailure(document.uri);
            if (!fieldErrors.length && !summaryError && cachedValidation && !cachedValidation.valid && cachedValidation.message) {
                const mapped = mapFormError(cachedValidation.message, schema, tables, cachedValidation.path, values);
                fieldErrors.push(...mapped.fieldErrors);
                if (!fieldErrors.length) {
                    summaryError = mapped.summary;
                }
            }

            return {
                validJsonc: true,
                model: modelObj,
                schema,
                surfaceHtml: renderFormSurface(schema),
                error: summaryError,
                fieldErrors,
            };
        };

        const post = async (payload: unknown): Promise<void> => {
            try { await panel.webview.postMessage(payload); } catch { /* The native editor may have replaced this view. */ }
        };

        const syncWebview = async (statusMessage?: string, focusOverride?: ControllerFocus): Promise<void> => {
            generation += 1;
            panelVersion = document.version;
            const state = evaluateDocumentState(document.getText());
            activeSchema = state.schema;
            const summary = typeHeaderSummary(
                state.validJsonc ? state.model : undefined,
                path,
                readonly,
                document.isDirty ? undefined : cachedRawBytes,
            );
            const resolvedStatus = statusMessage !== undefined
                ? statusMessage
                : !state.validJsonc
                    ? 'Invalid JSONC'
                    : (document.isDirty ? 'Unsaved changes' : '');
            await post({
                action: 'sync-document',
                generation,
                version: document.version,
                dirty: document.isDirty,
                schema: state.schema,
                surfaceHtml: state.surfaceHtml,
                sorts,
                meta: {
                    bytesLabel: summary.bytesLabel || '',
                    countLabel: summary.countLabel || '',
                    subtitle: summary.subtitle,
                },
                error: state.error,
                fieldErrors: state.fieldErrors,
                statusMessage: resolvedStatus,
                focus: focusOverride || editorFocus,
            });
        };

        const diagnosticsSummary = (): { error: string; fieldErrors: FormValidationError[] } => {
            const state = evaluateDocumentState(document.getText());
            activeSchema = state.schema;
            if (state.fieldErrors.length || state.error) {
                return { error: state.error, fieldErrors: state.fieldErrors };
            }
            const diagMessages = vscode.languages
                .getDiagnostics(document.uri)
                .filter(item => item.source === 'Ghidra type' && item.severity === vscode.DiagnosticSeverity.Error)
                .map(item => item.message);
            if (!diagMessages.length) {
                return { error: '', fieldErrors: [] };
            }
            const { values, tables } = state.model ? extractTypeEditorData(state.model) : { values: {}, tables: {} };
            const cachedFailure = this.typeFiles?.validationFailure(document.uri);
            const mapped = mapFormError(diagMessages[0], state.schema, tables, cachedFailure?.path, values);
            return { error: mapped.summary, fieldErrors: mapped.fieldErrors };
        };

        const ensureBaseline = async (): Promise<Data | undefined> => {
            const fromFiles = this.typeFiles?.snapshotOriginal(document.uri);
            if (fromFiles) {
                baselineRaw = fromFiles;
                cachedRawBytes = extractRawBytes(fromFiles) ?? cachedRawBytes;
                return baselineRaw;
            }
            if (baselineRaw) { return baselineRaw; }
            const fetched = await this.call<Data>('ghidra.type', { md5: document.uri.authority, path }).catch(() => undefined);
            if (fetched) {
                baselineRaw = fetched;
                cachedRawBytes = extractRawBytes(fetched) ?? cachedRawBytes;
            }
            return baselineRaw;
        };

        const disposables: vscode.Disposable[] = [];

        disposables.push(vscode.workspace.onDidChangeTextDocument(event => {
            if (event.document.uri.toString() !== document.uri.toString() || applying) { return; }
            let announcement: string | undefined;
            if (awaitingSaveReadback && !document.isDirty) {
                awaitingSaveReadback = false;
                announcement = 'Saved';
            } else if (event.reason === vscode.TextDocumentChangeReason.Undo) {
                announcement = document.isDirty ? 'Undo applied · Unsaved changes' : 'Undo applied';
            } else if (event.reason === vscode.TextDocumentChangeReason.Redo) {
                announcement = document.isDirty ? 'Redo applied · Unsaved changes' : 'Redo applied';
            } else {
                const probeErrors: ParseError[] = [];
                const parsed = parse(document.getText(), probeErrors, { allowTrailingComma: true, disallowComments: false });
                if (probeErrors.length || !parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                    announcement = 'Invalid JSONC';
                } else {
                    announcement = document.isDirty ? 'Synced JSONC changes · Unsaved changes' : 'Synced with Ghidra';
                }
            }
            void syncWebview(announcement, panel.active ? editorFocus : undefined);
        }));

        disposables.push(vscode.languages.onDidChangeDiagnostics(event => {
            if (!event.uris.some(uri => uri.toString() === document.uri.toString()) || savingFromWebview) { return; }
            const diag = diagnosticsSummary();
            void post({ action: 'type-diagnostics', error: diag.error, fieldErrors: diag.fieldErrors });
        }));

        if (this.typeFiles) {
            disposables.push(this.typeFiles.onDidSaveType(event => {
                if (event.uri.toString() !== document.uri.toString()) { return; }
                baselineRaw = event.original;
                cachedRawBytes = extractRawBytes(event.original) ?? cachedRawBytes;
                awaitingSaveReadback = event.requiresReadback;
                if (!savingFromWebview) {
                    void syncWebview('Saved', panel.active ? editorFocus : undefined);
                }
            }));
            disposables.push(this.typeFiles.onDidFailSaveType(event => {
                if (event.uri.toString() !== document.uri.toString() || savingFromWebview) { return; }
                const state = evaluateDocumentState(document.getText());
                activeSchema = state.schema;
                const { values, tables } = state.model ? extractTypeEditorData(state.model) : { values: {}, tables: {} };
                const mapped = mapFormError(event.message, activeSchema, tables, event.path, values);
                void post({
                    action: 'save-failed',
                    error: event.message,
                    fieldErrors: mapped.fieldErrors.length ? mapped.fieldErrors : state.fieldErrors,
                });
            }));
            disposables.push(this.typeFiles.onDidValidateType(event => {
                if (event.uri.toString() !== document.uri.toString() || savingFromWebview) { return; }
                const diag = diagnosticsSummary();
                void post({ action: 'type-diagnostics', error: diag.error, fieldErrors: diag.fieldErrors });
            }));
        }

        panel.onDidDispose(() => {
            for (const item of disposables) { item.dispose(); }
        });

        const executeDocumentSave = async (focus?: ControllerFocus): Promise<void> => {
            editorFocus = focus || editorFocus;
            const precheck = evaluateDocumentState(document.getText());
            activeSchema = precheck.schema;
            if (!precheck.validJsonc || precheck.fieldErrors.length > 0 || precheck.error) {
                await post({
                    action: 'save-failed',
                    error: precheck.error || precheck.fieldErrors[0]?.message || 'Invalid data type definition.',
                    fieldErrors: precheck.fieldErrors,
                });
                return;
            }
            savingFromWebview = true;
            try {
                const savedOk = await document.save();
                if (!savedOk) {
                    const failure = this.typeFiles?.lastSaveFailure(document.uri);
                    const { values, tables } = precheck.model ? extractTypeEditorData(precheck.model) : { values: {}, tables: {} };
                    const message = failure?.message || 'Could not save the data type. Check the document diagnostics.';
                    const mapped = mapFormError(message, activeSchema, tables, failure?.path, values);
                    await post({
                        action: 'save-failed',
                        error: message,
                        fieldErrors: mapped.fieldErrors,
                    });
                    return;
                }
                panelVersion = document.version;
                const postState = evaluateDocumentState(document.getText());
                activeSchema = postState.schema;
                const summary = typeHeaderSummary(postState.model, path, readonly, cachedRawBytes);
                await post({
                    action: 'save-succeeded',
                    version: document.version,
                    statusMessage: 'Saved',
                    meta: {
                        bytesLabel: summary.bytesLabel || '',
                        countLabel: summary.countLabel || '',
                        subtitle: summary.subtitle,
                    },
                });
            } catch (error) {
                const failure = this.typeFiles?.lastSaveFailure(document.uri);
                const message = failure?.message || String(error);
                const { values, tables } = precheck.model ? extractTypeEditorData(precheck.model) : { values: {}, tables: {} };
                const mapped = mapFormError(message, activeSchema, tables, failure?.path, values);
                await post({
                    action: 'save-failed',
                    error: mapped.summary,
                    fieldErrors: mapped.fieldErrors,
                });
            } finally {
                savingFromWebview = false;
            }
        };

        let pending: Promise<void> = Promise.resolve();
        panel.webview.onDidReceiveMessage(rawMessage => {
            const message = object(rawMessage);
            pending = pending.then(async () => {
                try {
                    if (message.action === 'save-after-update') {
                        const msgGen = Number(message.generation);
                        if (readonly || completedUpdateGeneration !== msgGen || panelVersion !== document.version) { return; }
                        completedUpdateGeneration = undefined;
                        await executeDocumentSave(editorFocus);
                        return;
                    }
                    if (Number(message.generation) !== generation) { return; }
                    if (message.action === 'open-jsonc') {
                        await vscode.commands.executeCommand('vscode.openWith', document.uri, 'default', vscode.ViewColumn.Beside);
                        return;
                    }
                    if (message.action === 'ready') {
                        await post({ action: 'type-options', values: typeOptions });
                        const diag = diagnosticsSummary();
                        if (diag.error || diag.fieldErrors.length) {
                            await post({ action: 'type-diagnostics', error: diag.error, fieldErrors: diag.fieldErrors });
                        }
                        if (cachedRawBytes !== undefined && !document.isDirty) {
                            await post({ action: 'type-meta', bytesLabel: `${cachedRawBytes} ${cachedRawBytes === 1 ? 'byte' : 'bytes'}` });
                        }
                        return;
                    }
                    if (message.action === 'focus') {
                        editorFocus = (message.focus as ControllerFocus | undefined) || undefined;
                        return;
                    }
                    if (message.action === 'sort') {
                        const key = String(message.key ?? '');
                        const field = String(message.field ?? '');
                        const direction = String(message.direction ?? '');
                        if (!['fields', 'values', 'parameters'].includes(key)) { return; }
                        if (direction === 'none') {
                            delete sorts[key];
                        } else if ((direction === 'ascending' || direction === 'descending') && ['offset', 'name', 'type', 'length', 'value'].includes(field)) {
                            sorts[key] = { field, direction };
                        }
                        return;
                    }
                    if (panelVersion !== document.version) {
                        await syncWebview();
                        throw new Error('The definition changed in another view. Review the current values.');
                    }
                    if (message.action === 'save') {
                        await executeDocumentSave((message.focus as ControllerFocus | undefined) || editorFocus);
                        return;
                    }
                    if ((message.action === 'add' || message.action === 'remove' || message.action === 'move') && !readonly) {
                        const key = String(message.key ?? '');
                        if (!['fields', 'values', 'parameters'].includes(key)) { return; }
                        const text = document.getText();
                        const model = object(parse(text));
                        const memberPath: (string | number)[] = key === 'parameters' ? ['signature', 'parameters'] : [key];
                        const items = key === 'parameters' ? object(model.signature).parameters : model[key];
                        if (!Array.isArray(items)) { return; }
                        const reqIndex = Number(message.index);
                        if (message.action === 'remove' && (!Number.isInteger(reqIndex) || reqIndex < 0 || reqIndex >= items.length)) { return; }
                        let next: string;
                        let offset: number | string | undefined;
                        let focus: ControllerFocus | undefined;
                        if (message.action === 'move') {
                            const from = Number(message.from);
                            const to = Number(message.to);
                            const before = message.before;
                            if (!['fields', 'parameters'].includes(key)) { return; }
                            if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= items.length || to >= items.length || typeof before !== 'boolean') { return; }
                            const order = items.map((_, index) => index);
                            if (key === 'fields' && model.kind === 'struct') {
                                order.sort((a, b) => Number(object(items[a]).offset) - Number(object(items[b]).offset));
                            }
                            const source = order.indexOf(from);
                            const target = order.indexOf(to);
                            let destination = target + (before ? 0 : 1);
                            if (source < destination) { destination--; }
                            if (destination === source) {
                                editorFocus = { kind: 'move', gridKey: key, index: from };
                                completedUpdateGeneration = Number(message.generation);
                                await syncWebview(undefined, editorFocus);
                                return;
                            }
                            const raw = await ensureBaseline();
                            if (!raw || Number(message.generation) !== generation || panelVersion !== document.version) { return; }
                            const moved = reorderTypeMembers(text, raw, key, from, order[destination]);
                            const original = typeModel(raw);
                            typeMutations(original, parseType(moved.text, original), raw);
                            next = moved.text;
                            focus = { kind: 'move', gridKey: key, index: moved.index };
                        } else {
                            const reqName = message.name;
                            if (message.action === 'add' && (reqIndex !== items.length || typeof reqName !== 'string')) {
                                await syncWebview();
                                throw new Error('The member list changed. Try adding it again.');
                            }
                            if (message.action === 'add' && key === 'fields' && model.kind === 'struct') {
                                const raw = await ensureBaseline();
                                if (Number(message.generation) !== generation || panelVersion !== document.version) { return; }
                                const original = raw ? typeModel(raw).fields || [] : [];
                                const source = rows(raw?.fields).filter(field => field.is_undefined !== true);
                                let unknownLength = false;
                                const end = items.reduce<number>((acc, rawField) => {
                                    const field = object(rawField);
                                    const previous = original.find(item => item.id === field.id);
                                    const rawLength = previous && field.type === previous.type ? Number(source[Number(previous.id)]?.length) : 0;
                                    const explicit = Number(field.length);
                                    const length = Number.isSafeInteger(explicit) && explicit > 0 && (previous ? field.type === previous.type || field.length !== previous.length : field.id === undefined)
                                        ? explicit
                                        : rawLength || (field.id === undefined && field.type === 'undefined1' ? 1 : 0);
                                    if (!length) { unknownLength = true; }
                                    return Math.max(acc, Number(field.offset || 0) + length);
                                }, 0);
                                offset = unknownLength ? '' : end;
                            }
                            const item = key === 'values'
                                ? { name: reqName, value: 0 }
                                : key === 'parameters'
                                    ? { name: reqName, type: 'int' }
                                    : { ...(model.kind === 'struct' ? { offset } : {}), name: reqName, type: 'undefined1' };
                            const edits = modify(text, [...memberPath, message.action === 'remove' ? reqIndex : -1], message.action === 'remove' ? undefined : item, {
                                isArrayInsertion: message.action === 'add',
                                formattingOptions: { insertSpaces: true, tabSize: 2, eol: '\n' },
                            });
                            next = applyEdits(text, edits);
                            if (message.action === 'remove') {
                                focus = items.length > 1
                                    ? { kind: 'control', path: [...memberPath, Math.max(0, Math.min(reqIndex, items.length - 2)), 'name'], gridKey: key }
                                    : { kind: 'add', gridKey: key };
                            }
                        }
                        const edit = new vscode.WorkspaceEdit();
                        edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(text.length)), next);
                        applying = true;
                        try {
                            if (!await vscode.workspace.applyEdit(edit)) {
                                throw new Error('Could not update the data type draft.');
                            }
                        } finally {
                            applying = false;
                        }
                        panelVersion = document.version;
                        const nextParsed = object(parse(next));
                        activeSchema = typeEditorSchema(nextParsed, false, typeOptions);
                        const meta = typeHeaderSummary(nextParsed, path, readonly);
                        if (message.action === 'add') {
                            completedUpdateGeneration = Number(message.generation);
                            await post({
                                action: 'draft-version',
                                version: document.version,
                                dirty: document.isDirty,
                                added: { key, index: reqIndex, offset },
                                meta: { bytesLabel: meta.bytesLabel || '', countLabel: meta.countLabel || '', subtitle: meta.subtitle },
                            });
                        } else {
                            editorFocus = focus;
                            const priorGen = Number(message.generation);
                            await syncWebview(undefined, focus);
                            completedUpdateGeneration = priorGen;
                        }
                        return;
                    }
                    if (message.action !== 'change' || readonly || !Array.isArray(message.path)) { return; }
                    if (message.path[0] === 'path' || message.path[0] === 'kind') { return; }
                    const text = document.getText();
                    const editPath = message.path as (string | number)[];
                    const nextVal = editPath[editPath.length - 1] === 'length' && message.value === '' ? undefined : message.value;
                    const edits = modify(text, editPath, nextVal, { formattingOptions: { insertSpaces: true, tabSize: 2, eol: '\n' } });
                    const next = applyEdits(text, edits);
                    const edit = new vscode.WorkspaceEdit();
                    edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(text.length)), next);
                    applying = true;
                    try {
                        if (!await vscode.workspace.applyEdit(edit)) {
                            throw new Error('Could not update the data type draft.');
                        }
                    } finally {
                        applying = false;
                    }
                    panelVersion = document.version;
                    completedUpdateGeneration = Number(message.generation);
                    const nextParsed = object(parse(next));
                    activeSchema = typeEditorSchema(nextParsed, false, typeOptions);
                    const meta = typeHeaderSummary(nextParsed, path, readonly);
                    await post({
                        action: 'draft-version',
                        version: document.version,
                        dirty: document.isDirty,
                        meta: { bytesLabel: meta.bytesLabel || '', countLabel: meta.countLabel || '', subtitle: meta.subtitle },
                    });
                } catch (error) {
                    const currentParsed = object(parse(document.getText()));
                    const { values, tables } = extractTypeEditorData(currentParsed);
                    const mapped = mapFormError(error, activeSchema, tables, undefined, values);
                    await post({ action: 'save-failed', error: mapped.summary, fieldErrors: mapped.fieldErrors });
                    if (!panel.visible) {
                        void vscode.window.showErrorMessage(mapped.summary);
                    }
                }
            });
        });

        const initialState = evaluateDocumentState(document.getText());
        activeSchema = initialState.schema;
        const summary = typeHeaderSummary(
            initialState.validJsonc ? initialState.model : undefined,
            path,
            readonly,
            document.isDirty ? undefined : cachedRawBytes,
        );
        const initialStatus = !initialState.validJsonc ? 'Invalid JSONC' : (document.isDirty ? 'Unsaved changes' : '');
        const actions = `<div class="type-actions"><span id="type-status" class="type-status" data-state="${!initialState.validJsonc ? 'error' : (document.isDirty ? 'dirty' : 'clean')}" role="status">${escape(initialStatus)}</span>${readonly ? '' : `<button class="primary icon-submit" id="submit" form="type-editor-form" type="submit" aria-label="Save data type" title="Save data type">${callIcon('save')}</button>`}<button type="button" data-open-jsonc aria-label="Open JSONC text editor beside" title="Open .ghidra-type JSONC text editor beside">${callIcon('edit')}<span>JSONC</span></button></div>`;
        panel.webview.html = page(
            path.split('/').pop() || 'Data type',
            'Data type editor',
            summary.subtitle,
            renderDeclarativeForm(initialState.schema, initialState.surfaceHtml),
            mutationFormScript({
                schema: initialState.schema,
                sorts,
                draftVersion: document.version,
                draftDirty: document.isDirty,
                initialErrors: initialState.fieldErrors,
                initialSummaryError: initialState.error,
            }),
            { kind: 'type-editor', md5: document.uri.authority, path },
            actions,
            { subtitleHtml: summary.subtitleHtml, error: initialState.fieldErrors.length ? undefined : initialState.error },
        );

        if (!readonly) {
            void ensureBaseline().then(raw => {
                const rawLen = extractRawBytes(raw);
                if (rawLen !== undefined && !document.isDirty) {
                    void post({ action: 'type-meta', bytesLabel: `${rawLen} ${rawLen === 1 ? 'byte' : 'bytes'}` });
                }
            });
            void this.call<{ items: { name?: string; path?: string }[] }>('ghidra.types', { md5: document.uri.authority }).then(result => {
                typeOptions = [...new Set([...typeOptions, ...result.items.flatMap(item => [item.path, item.name].filter((val): val is string => typeof val === 'string' && !!val))])].sort();
                activeSchema.typeOptions = typeOptions;
                return post({ action: 'type-options', values: typeOptions });
            }).catch(() => {});
        }
    }

    /** Unregister the graphical data type custom editor provider. */
    dispose(): void {
        this.registration.dispose();
    }
}
