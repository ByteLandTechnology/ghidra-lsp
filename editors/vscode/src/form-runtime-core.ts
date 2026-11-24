// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

/** Build the client-side validation, focus management, busy-state, and table helper script for {@link mutationFormScript}. */
export function formRuntimeCoreScript(): string {
    return `
const encodeControlId = path => {
    const encoded = path.map(part => String(part).replace(/[^a-zA-Z0-9_-]/g, ch => '_' + ch.charCodeAt(0).toString(16) + '_')).join('-');
    return 'field-' + (encoded || 'root');
};

const capitalize = word => word ? word[0].toUpperCase() + word.slice(1) : '';

const samePath = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((seg, i) => String(seg) === String(b[i]));

const checkTypeRef = (raw, requiredFlag) => {
    const name = String(raw ?? '').trim();
    if (!name) { return requiredFlag ? 'Choose a data type.' : ''; }
    const check = part => {
        const trimmed = String(part ?? '').trim();
        if (!trimmed) { return 'Choose a data type.'; }
        if (trimmed === 'pointer') { return ''; }
        const arr = /^(.*)\\[([0-9]+)\\]$/.exec(trimmed);
        if (arr) {
            const count = Number(arr[2]);
            if (!Number.isSafeInteger(count) || count < 1 || count > 2147483647) {
                return 'Array length must be an integer between 1 and 2147483647.';
            }
            return check(arr[1]);
        }
        if (/\\*$/.test(trimmed)) {
            return check(trimmed.slice(0, -1));
        }
        return '';
    };
    return check(name);
};

const validateValue = (raw, rules, label) => {
    if (!rules) { return ''; }
    if (rules.mustBeChecked) {
        return raw === true ? '' : (rules.requiredMessage || (label + ' is required.'));
    }
    const text = typeof raw === 'boolean' ? (raw ? 'true' : '') : String(raw ?? '').trim();
    if (rules.required && !text) {
        if (rules.typeRef) { return 'Choose a data type.'; }
        return rules.requiredMessage || (label + ' is required.');
    }
    if (!text) { return ''; }
    if (rules.disallowed) {
        const probe = rules.disallowed.ignoreCase ? text.toLowerCase() : text;
        const hit = rules.disallowed.values.some(v => (rules.disallowed.ignoreCase ? String(v).toLowerCase() : String(v)) === probe);
        if (hit) { return rules.disallowed.message; }
    }
    if (rules.integer) {
        const parsed = typeof raw === 'number' ? raw : (/^-?\\d+$/.test(text) ? Number(text) : NaN);
        if (!Number.isSafeInteger(parsed) || parsed < rules.integer.min || parsed > rules.integer.max) {
            return rules.integer.message || (label + ' must be an integer between ' + rules.integer.min + ' and ' + rules.integer.max + '.');
        }
    }
    if (rules.typeRef) {
        return checkTypeRef(text, Boolean(rules.required));
    }
    return '';
};

const openAncestorDisclosures = el => {
    let cur = el ? el.parentElement : null;
    while (cur) {
        if (cur.tagName === 'DETAILS' && !cur.hasAttribute('data-action-menu')) {
            cur.open = true;
        }
        cur = cur.parentElement;
    }
};

const setControlError = (el, message) => {
    if (!el) { return; }
    const container = el.closest('.form-field, td');
    const errEl = (el.id && document.getElementById(el.id + '-error')) || container?.querySelector('.field-error');
    const hintId = el.dataset.hintId || '';
    if (message) {
        el.setAttribute('aria-invalid', 'true');
        if (errEl) {
            if (!errEl.id && el.id) { errEl.id = el.id + '-error'; }
            errEl.textContent = message;
            errEl.hidden = false;
        }
        const ids = [errEl?.id, hintId].filter(Boolean).join(' ');
        if (ids) { el.setAttribute('aria-describedby', ids); }
        openAncestorDisclosures(el);
    } else {
        el.removeAttribute('aria-invalid');
        if (errEl) {
            errEl.textContent = '';
            errEl.hidden = true;
        }
        if (hintId) { el.setAttribute('aria-describedby', hintId); }
        else { el.removeAttribute('aria-describedby'); }
    }
};

const clearAllFieldErrors = () => {
    for (const el of form.querySelectorAll('[aria-invalid="true"], [data-path]')) {
        setControlError(el, '');
    }
};

const renderErrorAlert = (summaryText, fieldErrors) => {
    const errorEl = document.getElementById('error');
    if (!errorEl) { return; }
    errorEl.replaceChildren();
    if (Array.isArray(fieldErrors) && fieldErrors.length > 0) {
        const lead = document.createElement('p');
        lead.className = 'error-summary-lead';
        lead.textContent = fieldErrors.length === 1
            ? 'Please fix 1 validation error:'
            : 'Please fix ' + fieldErrors.length + ' validation errors:';
        const list = document.createElement('ul');
        list.className = 'error-summary-list';
        for (const item of fieldErrors) {
            const li = document.createElement('li');
            const link = document.createElement('a');
            link.className = 'error-jump-link';
            link.href = '#' + item.controlId;
            link.dataset.jumpTarget = item.controlId;
            link.textContent = item.label + ': ' + item.message;
            li.appendChild(link);
            list.appendChild(li);
        }
        errorEl.appendChild(lead);
        errorEl.appendChild(list);
        return;
    }
    if (summaryText) {
        errorEl.textContent = summaryText;
    }
};

const findControlByPath = path => {
    const id = encodeControlId(path);
    const byId = document.getElementById(id);
    if (byId) { return byId; }
    const encoded = JSON.stringify(path);
    return [...form.querySelectorAll('[data-path]')].find(el => el.dataset.path === encoded && !el.closest('tr[data-new]')) || null;
};

const collectPayload = () => {
    const values = {};
    for (const el of form.querySelectorAll('[name]')) {
        values[el.name] = el.type === 'checkbox' ? el.checked : el.value;
    }
    const tables = {};
    for (const table of form.querySelectorAll('table[data-grid-key]')) {
        const key = table.dataset.gridKey;
        const rowsOut = [];
        for (const row of table.tBodies[0].rows) {
            if (row.hasAttribute('data-new')) { continue; }
            const rowIndex = Number(row.dataset.index ?? rowsOut.length);
            const entry = { _rowIndex: rowIndex };
            if (row.dataset.original !== undefined) { entry._original = row.dataset.original; }
            for (const input of row.querySelectorAll('[data-column]')) {
                entry[input.dataset.column] = input.type === 'checkbox' ? input.checked : input.value;
            }
            rowsOut.push(entry);
        }
        rowsOut.sort((a, b) => a._rowIndex - b._rowIndex);
        tables[key] = rowsOut.map(({ _rowIndex, ...rest }) => rest);
    }
    return { values, tables };
};

const validateClient = () => {
    if (formSchema.readonly) { return []; }
    const { values, tables } = collectPayload();
    const errors = [];
    for (const field of formSchema.fields || []) {
        if (field.readonly) { continue; }
        const path = field.path || [field.key];
        const el = findControlByPath(path);
        const raw = el ? (el.type === 'checkbox' ? el.checked : el.value) : values[field.key];
        const msg = validateValue(raw, field.rules, field.label);
        if (msg) {
            errors.push({ path, controlId: el?.id || encodeControlId(path), label: field.label, message: msg });
        }
    }
    for (const grid of formSchema.grids || []) {
        const base = grid.path || [grid.key];
        const list = tables[grid.key] || [];
        const seen = new Map();
        for (const col of grid.columns || []) {
            if (col.unique) { seen.set(col.key, new Map()); }
        }
        list.forEach((row, rowIndex) => {
            for (const col of grid.columns || []) {
                const cellPath = [...base, rowIndex, col.key];
                const el = findControlByPath(cellPath);
                const cellLabel = capitalize(grid.singular) + ' ' + (rowIndex + 1) + ' ' + col.label.toLowerCase();
                const raw = row[col.key];
                const msg = validateValue(raw, col.rules, cellLabel);
                if (msg) {
                    errors.push({ path: cellPath, controlId: el?.id || encodeControlId(cellPath), label: cellLabel, message: msg });
                    continue;
                }
                if (col.unique) {
                    const trimmed = String(raw ?? '').trim();
                    const norm = col.numeric && trimmed !== '' ? String(Number(trimmed)) : trimmed;
                    if (col.unique.ignoreEmpty && !norm) { continue; }
                    const bucket = seen.get(col.key);
                    const indices = bucket.get(norm) || [];
                    indices.push(rowIndex);
                    bucket.set(norm, indices);
                }
            }
        });
        for (const col of grid.columns || []) {
            if (!col.unique) { continue; }
            for (const indices of seen.get(col.key).values()) {
                if (indices.length < 2) { continue; }
                for (const dupIndex of indices.slice(1)) {
                    const cellPath = [...base, dupIndex, col.key];
                    if (!errors.some(e => samePath(e.path, cellPath))) {
                        const el = findControlByPath(cellPath);
                        const cellLabel = capitalize(grid.singular) + ' ' + (dupIndex + 1) + ' ' + col.label.toLowerCase();
                        errors.push({ path: cellPath, controlId: el?.id || encodeControlId(cellPath), label: cellLabel, message: col.unique.message });
                    }
                }
            }
        }
    }
    return errors;
};

const applyValidationState = (fieldErrors, summaryText, announceSummary) => {
    clearAllFieldErrors();
    const resolvedErrors = [];
    for (const err of fieldErrors || []) {
        const el = (err.controlId && document.getElementById(err.controlId)) || (err.path ? findControlByPath(err.path) : null);
        if (el) {
            setControlError(el, err.message);
            resolvedErrors.push({ ...err, controlId: el.id || err.controlId });
        } else if (err.controlId) {
            resolvedErrors.push(err);
        }
    }
    if (announceSummary) {
        renderErrorAlert(summaryText || '', resolvedErrors);
    }
    return resolvedErrors;
};

const setStatusText = (text, state) => {
    if (formSchema.mode === 'live-document') {
        const status = document.querySelector('.type-status');
        if (status) {
            status.textContent = text;
            if (state) { status.dataset.state = state; }
        }
    } else {
        const status = document.getElementById('status');
        if (status) { status.textContent = text; }
    }
};

const interactiveControls = () => [
    ...form.querySelectorAll('button, input, select, textarea'),
    ...document.querySelectorAll('.type-actions button'),
];

const captureFocus = () => {
    const el = document.activeElement;
    if (!el || el === document.body) { return null; }
    if (el.id === 'submit') { return { kind: 'submit', controlId: 'submit' }; }
    if (el.hasAttribute('data-open-jsonc')) { return { kind: 'open-jsonc' }; }
    if (el.dataset?.path && !el.closest('tr[data-new]')) {
        try {
            return {
                kind: 'control',
                path: JSON.parse(el.dataset.path),
                controlId: el.id,
                start: typeof el.selectionStart === 'number' ? el.selectionStart : null,
                end: typeof el.selectionEnd === 'number' ? el.selectionEnd : null,
            };
        } catch {}
    }
    if (el.dataset?.newKey) {
        return {
            kind: 'add',
            gridKey: el.dataset.newKey,
            start: typeof el.selectionStart === 'number' ? el.selectionStart : null,
            end: typeof el.selectionEnd === 'number' ? el.selectionEnd : null,
        };
    }
    if (el.hasAttribute('data-move')) {
        const row = el.closest('tr');
        const table = row?.closest('table');
        return { kind: 'move', gridKey: table?.dataset.gridKey, index: Number(row?.dataset.index ?? 0) };
    }
    if (el.hasAttribute('data-remove-row')) {
        const row = el.closest('tr');
        const table = row?.closest('table');
        return { kind: 'remove', gridKey: table?.dataset.gridKey, index: Number(row?.dataset.index ?? 0) };
    }
    if (el.dataset?.addRow) {
        return { kind: 'add', gridKey: el.dataset.addRow };
    }
    if (el.dataset?.sort) {
        const table = el.closest('table');
        return { kind: 'sort', gridKey: table?.dataset.gridKey, field: el.dataset.sort };
    }
    if (el.tagName === 'SUMMARY') {
        return { kind: 'disclosure', controlId: el.id };
    }
    if (el.id) {
        return { kind: 'control', controlId: el.id };
    }
    return null;
};

const focusFallback = preferredGridKey => {
    if (preferredGridKey) {
        const table = form.querySelector('table[data-grid-key="' + preferredGridKey + '"]');
        const rowInput = table?.querySelector('tbody tr:not([data-new]) input, tbody tr[data-new] input[data-new-key]');
        if (rowInput) { rowInput.focus({ preventScroll: true }); return; }
        const addBtn = form.querySelector('[data-add-row="' + preferredGridKey + '"]');
        if (addBtn) { addBtn.focus({ preventScroll: true }); return; }
    }
    const candidate = form.querySelector('[autofocus]')
        || form.querySelector('input:not([readonly]), textarea:not([readonly]), select')
        || document.getElementById('submit')
        || document.querySelector('[data-open-jsonc]')
        || document.querySelector('h1');
    candidate?.focus({ preventScroll: true });
};

const restoreFocus = (focus, ensureFocused = false) => {
    let target = null;
    if (focus) {
        if (focus.kind === 'submit') {
            target = document.getElementById('submit');
        } else if (focus.kind === 'open-jsonc') {
            target = document.querySelector('[data-open-jsonc]');
        } else if (focus.path) {
            target = findControlByPath(focus.path);
            if (!target && focus.path.length >= 3) {
                const gridKey = String(focus.path[focus.path.length - 3]);
                const table = form.querySelector('table[data-grid-key="' + gridKey + '"]');
                const rowsList = [...(table?.querySelectorAll('tbody tr:not([data-new])') || [])];
                if (rowsList.length) {
                    const clamped = rowsList[Math.min(rowsList.length - 1, Math.max(0, Number(focus.path[focus.path.length - 2]) || 0))];
                    target = clamped?.querySelector('[data-column="' + focus.path[focus.path.length - 1] + '"]') || clamped?.querySelector('input');
                }
            }
        } else if (focus.kind === 'move' && focus.gridKey) {
            target = form.querySelector('table[data-grid-key="' + focus.gridKey + '"] tr[data-index="' + focus.index + '"] [data-move]');
        } else if (focus.kind === 'remove' && focus.gridKey) {
            target = form.querySelector('table[data-grid-key="' + focus.gridKey + '"] tr[data-index="' + focus.index + '"] [data-remove-row]');
        } else if (focus.kind === 'add' && focus.gridKey) {
            target = form.querySelector('input[data-new-key="' + focus.gridKey + '"]') || form.querySelector('[data-add-row="' + focus.gridKey + '"]');
        } else if (focus.kind === 'sort' && focus.gridKey && focus.field) {
            target = form.querySelector('table[data-grid-key="' + focus.gridKey + '"] [data-sort="' + focus.field + '"]');
        } else if (focus.controlId) {
            target = document.getElementById(focus.controlId);
        }
    }
    if (target) {
        openAncestorDisclosures(target);
        target.focus({ preventScroll: true });
        if (typeof focus?.start === 'number' && typeof focus?.end === 'number' && typeof target.setSelectionRange === 'function') {
            try { target.setSelectionRange(focus.start, focus.end); } catch {}
        }
        return;
    }
    if (ensureFocused || !document.activeElement || document.activeElement === document.body) {
        focusFallback(focus?.gridKey);
    }
};

const setBusy = (next, action = 'save', statusOverride) => {
    if (next === busy) {
        if (!next && statusOverride !== undefined) {
            setStatusText(statusOverride, draftDirty ? 'dirty' : 'clean');
        }
        return;
    }
    if (next) { busyFocus = captureFocus(); }
    busy = next;
    busyAction = next ? action : '';
    document.body.dataset.formBusy = String(next);
    if (next) {
        form.setAttribute('aria-busy', 'true');
    } else {
        form.removeAttribute('aria-busy');
    }
    for (const el of interactiveControls()) {
        if (el.dataset.openJsonc !== undefined) { continue; }
        if (next) {
            el.dataset.prevAriaDisabled = el.getAttribute('aria-disabled') || '';
            el.setAttribute('aria-disabled', 'true');
        } else {
            const prev = el.dataset.prevAriaDisabled;
            delete el.dataset.prevAriaDisabled;
            if (prev) { el.setAttribute('aria-disabled', prev); }
            else if (el.dataset.readonlyLock !== 'true') { el.removeAttribute('aria-disabled'); }
        }
    }
    if (next) {
        if (formSchema.mode === 'live-document') {
            setStatusText(action === 'save' ? 'Saving…' : 'Updating…', 'saving');
        } else {
            setStatusText('Saving analysis…');
        }
    } else if (statusOverride !== undefined) {
        setStatusText(statusOverride, draftDirty ? 'dirty' : 'clean');
    } else if (formSchema.mode === 'live-document') {
        setStatusText(draftDirty ? 'Unsaved changes' : '', draftDirty ? 'dirty' : 'clean');
    }
    if (!next) {
        if (!document.activeElement || document.activeElement === document.body) {
            restoreFocus(busyFocus, true);
        }
        busyFocus = null;
    }
};

const reindexEditGrid = table => {
    const base = JSON.parse(table.dataset.basePath || '[]');
    Array.from(table.tBodies[0].rows).forEach((row, rowIndex) => {
        if (row.hasAttribute('data-new')) { return; }
        row.dataset.index = String(rowIndex);
        for (const input of row.querySelectorAll('[data-column]')) {
            const colKey = input.dataset.column;
            const cellPath = [...base, rowIndex, colKey];
            const cellId = encodeControlId(cellPath);
            input.dataset.path = JSON.stringify(cellPath);
            input.id = cellId;
            const errEl = input.closest('td')?.querySelector('.field-error');
            if (errEl) { errEl.id = cellId + '-error'; }
            const hasErr = input.getAttribute('aria-invalid') === 'true' && errEl && !errEl.hidden;
            const hintId = input.dataset.hintId || '';
            const ids = [hasErr ? errEl.id : '', hintId].filter(Boolean).join(' ');
            if (ids) { input.setAttribute('aria-describedby', ids); }
            else { input.removeAttribute('aria-describedby'); }
        }
    });
};

const sortTypeTable = (table, field, direction) => {
    const body = table.tBodies[0];
    const items = [...body.querySelectorAll('tr[data-index]:not([data-new])')];
    const blank = body.querySelector('tr[data-new]');
    const cellVal = (row, key) => row.querySelector('td[data-field="' + key + '"] input')?.value || '';
    items.sort((a, b) => {
        if (direction === 'none') {
            return table.dataset.kind === 'struct' && table.dataset.typeList === 'fields'
                ? (Number(cellVal(a, 'offset')) - Number(cellVal(b, 'offset')))
                : Number(a.dataset.index) - Number(b.dataset.index);
        }
        const x = cellVal(a, field);
        const y = cellVal(b, field);
        const numeric = ['offset', 'length', 'value'].includes(field);
        const diff = numeric ? (Number(x) - Number(y)) : x.localeCompare(y, undefined, { numeric: true, sensitivity: 'base' });
        return (direction === 'ascending' ? 1 : -1) * diff || Number(a.dataset.index) - Number(b.dataset.index);
    });
    for (const row of items) { body.append(row); }
    if (blank) { body.append(blank); }
    for (const head of table.querySelectorAll('th[data-field]')) {
        head.setAttribute('aria-sort', head.dataset.field === field ? direction : 'none');
    }
};

const applySavedSorts = () => {
    for (const table of form.querySelectorAll('.type-table')) {
        const saved = activeSorts[table.dataset.typeList];
        if (saved && table.querySelector('[data-sort="' + saved.field + '"]')) {
            sortTypeTable(table, saved.field, saved.direction);
        }
    }
};
applySavedSorts();

const cloneNextBlankRow = row => {
    const blank = row.cloneNode(true);
    const table = row.closest('table');
    const key = table.dataset.typeList;
    const gridSpec = (formSchema.grids || []).find(g => g.key === key);
    const singular = gridSpec?.singular || (key === 'fields' ? 'field' : key === 'values' ? 'value' : 'parameter');
    const nextIndex = Number(row.dataset.index) + 1;
    blank.dataset.index = String(nextIndex);
    blank.setAttribute('data-new', 'true');
    for (const el of blank.querySelectorAll('[data-path]')) {
        const path = JSON.parse(el.dataset.path);
        path[path.length - 2] = nextIndex;
        const cellId = encodeControlId(path);
        el.dataset.path = JSON.stringify(path);
        el.id = cellId;
        el.removeAttribute('aria-invalid');
        el.removeAttribute('required');
        delete el.dataset.edited;
        const colKey = String(path[path.length - 1]);
        el.setAttribute('aria-label', el.dataset.newKey ? 'Add ' + singular : singular + ' ' + (nextIndex + 1) + ' ' + colKey);
        if (el.dataset.newKey) { el.value = ''; }
        const errEl = el.closest('td')?.querySelector('.field-error');
        if (errEl) { errEl.id = cellId + '-error'; errEl.textContent = ''; errEl.hidden = true; }
    }
    const moveBtn = blank.querySelector('[data-move]');
    const removeBtn = blank.querySelector('[data-remove-row]');
    if (moveBtn) { moveBtn.setAttribute('aria-label', 'Move ' + singular + ' ' + (nextIndex + 1)); }
    if (removeBtn) { removeBtn.setAttribute('aria-label', 'Remove ' + singular + ' ' + (nextIndex + 1)); }
    row.after(blank);
};

const handleLiveInput = el => {
    if (!el || el.readOnly || el.getAttribute('aria-disabled') === 'true' || busy || formSchema.readonly) { return; }
    if (el.dataset.newKey) {
        if (!el.value) { return; }
        const key = el.dataset.newKey;
        const gridSpec = (formSchema.grids || []).find(g => g.key === key);
        const singular = gridSpec?.singular || (key === 'fields' ? 'field' : key === 'values' ? 'value' : 'parameter');
        const row = el.closest('tr');
        const index = Number(row.dataset.index);
        const name = el.value;
        cloneNextBlankRow(row);
        row.removeAttribute('data-new');
        delete el.dataset.newKey;
        el.removeAttribute('placeholder');
        el.setAttribute('aria-label', singular + ' ' + (index + 1) + ' name');
        for (const cellInput of row.querySelectorAll('[data-column]')) {
            const colSpec = gridSpec?.columns?.find(c => c.key === cellInput.dataset.column);
            if (colSpec?.rules?.required || colSpec?.rules?.mustBeChecked) {
                cellInput.setAttribute('required', '');
            }
            if (cellInput.dataset.hintId) {
                cellInput.setAttribute('aria-describedby', cellInput.dataset.hintId);
            }
        }
        post({ action: 'add', key, index, name });
        return;
    }
    el.dataset.edited = 'true';
    let val = el.type === 'checkbox' ? el.checked : el.value;
    if (el.dataset.number === 'true' && typeof val === 'string' && val.trim() !== '') {
        const parsed = Number(val);
        if (Number.isFinite(parsed)) { val = parsed; }
    }
    post({ action: 'change', path: JSON.parse(el.dataset.path), value: val });
};

const moveRow = (row, targetRow, before) => {
    if (!row || !targetRow || row === targetRow || busy || formSchema.readonly) { return; }
    const table = row.closest('table');
    if (!table || table !== targetRow.closest('table')) { return; }
    const key = table.dataset.typeList;
    delete activeSorts[key];
    post({ action: 'sort', key, direction: 'none' });
    setBusy(true, 'move');
    post({ action: 'move', key, from: Number(row.dataset.index), to: Number(targetRow.dataset.index), before });
};

const runSubmitOrSave = () => {
    if (blurTimer) { clearTimeout(blurTimer); blurTimer = 0; }
    if (formSchema.readonly) { return; }
    if (busy) {
        if (formSchema.mode === 'live-document' && busyAction !== 'save' && !saveQueued) {
            saveQueued = true;
            post({ action: 'save-after-update' });
        }
        return;
    }
    const clientErrors = validateClient();
    if (clientErrors.length > 0) {
        const resolved = applyValidationState(clientErrors, '', true);
        if (formSchema.mode === 'live-document') {
            setStatusText('Validation failed', 'dirty');
        } else {
            setStatusText('');
        }
        const firstEl = resolved[0] && document.getElementById(resolved[0].controlId);
        if (firstEl) {
            openAncestorDisclosures(firstEl);
            firstEl.focus();
            firstEl.scrollIntoView({ block: 'nearest' });
        }
        return;
    }
    clearAllFieldErrors();
    renderErrorAlert('', []);
    if (formSchema.mode === 'live-document') {
        const currentFocus = captureFocus();
        setBusy(true, 'save');
        post({ action: 'save', focus: currentFocus });
        return;
    }
    const { values, tables } = collectPayload();
    setBusy(true, 'save');
    post({ action: 'submit', values, tables });
};
`;
}
