// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

/** Build the client-side DOM event listeners, host message handlers, and initial focus bootstrap for {@link mutationFormScript}. */
export function formRuntimeEventsScript(): string {
    return `
form.addEventListener('submit', event => {
    event.preventDefault();
    runSubmitOrSave();
});

document.addEventListener('pointerdown', event => {
    if (event.target.closest('#submit, [type="submit"], [data-jump-target]')) {
        if (blurTimer) { clearTimeout(blurTimer); blurTimer = 0; }
        suppressBlurUntil = Date.now() + 300;
    }
    const handle = event.target.closest('[data-move]');
    if (!handle || busy || formSchema.readonly || event.button !== 0 || handle.getAttribute('aria-disabled') === 'true') { return; }
    dragging = { row: handle.closest('tr'), handle, id: event.pointerId, x: event.clientX, y: event.clientY, active: false, target: null, before: false };
    handle.setPointerCapture(event.pointerId);
}, true);

const clearDrag = () => {
    dragging = null;
    for (const row of form.querySelectorAll('.is-dragging,.type-drop-before,.type-drop-after')) {
        row.classList.remove('is-dragging', 'type-drop-before', 'type-drop-after');
    }
};

document.addEventListener('pointermove', event => {
    if (!dragging || dragging.id !== event.pointerId) { return; }
    if (!dragging.active && Math.hypot(event.clientX - dragging.x, event.clientY - dragging.y) > 4) {
        dragging.active = true;
        dragging.row.classList.add('is-dragging');
    }
    if (!dragging.active) { return; }
    event.preventDefault();
    const row = document.elementFromPoint(event.clientX, event.clientY)?.closest('tr[data-index]:not([data-new])');
    for (const other of form.querySelectorAll('.type-drop-before,.type-drop-after')) {
        other.classList.remove('type-drop-before', 'type-drop-after');
    }
    dragging.target = row && row.closest('table') === dragging.row.closest('table') ? row : null;
    if (dragging.target) {
        const bounds = row.getBoundingClientRect();
        dragging.before = event.clientY < bounds.top + bounds.height / 2;
        row.classList.add(dragging.before ? 'type-drop-before' : 'type-drop-after');
    }
});

document.addEventListener('pointerup', event => {
    if (!dragging || dragging.id !== event.pointerId) { return; }
    const state = dragging;
    if (state.handle.hasPointerCapture(event.pointerId)) { state.handle.releasePointerCapture(event.pointerId); }
    clearDrag();
    if (state.active) { moveRow(state.row, state.target, state.before); }
});

document.addEventListener('pointercancel', clearDrag);

document.addEventListener('beforeinput', event => {
    const target = event.target;
    if (target && (busy || target.getAttribute?.('aria-disabled') === 'true') && form.contains(target)) {
        event.preventDefault();
    }
}, true);

document.addEventListener('click', event => {
    const jump = event.target.closest('[data-jump-target]');
    if (jump) {
        event.preventDefault();
        event.stopPropagation();
        const target = document.getElementById(jump.dataset.jumpTarget);
        if (target) {
            openAncestorDisclosures(target);
            target.focus();
            target.scrollIntoView({ block: 'nearest' });
        }
        return;
    }
    const jsoncBtn = event.target.closest('[data-open-jsonc]');
    if (jsoncBtn) {
        event.preventDefault();
        event.stopPropagation();
        post({ action: 'open-jsonc' });
        return;
    }
    const disabledControl = event.target.closest('[aria-disabled="true"]');
    if (disabledControl) {
        if (disabledControl.id === 'submit' && busy && formSchema.mode === 'live-document' && busyAction !== 'save' && !saveQueued) {
            saveQueued = true;
            post({ action: 'save-after-update' });
        }
        event.preventDefault();
        event.stopPropagation();
        return;
    }
    const sortBtn = event.target.closest('[data-sort]');
    if (sortBtn && form.contains(sortBtn)) {
        event.preventDefault();
        event.stopPropagation();
        const head = sortBtn.closest('th');
        const current = head.getAttribute('aria-sort') || 'none';
        const next = current === 'none' ? 'ascending' : current === 'ascending' ? 'descending' : 'none';
        const table = sortBtn.closest('table');
        const key = table.dataset.typeList;
        sortTypeTable(table, sortBtn.dataset.sort, next);
        if (next === 'none') { delete activeSorts[key]; }
        else { activeSorts[key] = { field: sortBtn.dataset.sort, direction: next }; }
        post({ action: 'sort', key, field: sortBtn.dataset.sort, direction: next });
        return;
    }
    const removeBtn = event.target.closest('[data-remove-row]');
    if (removeBtn && form.contains(removeBtn)) {
        event.preventDefault();
        event.stopPropagation();
        const row = removeBtn.closest('tr');
        const table = row.closest('table');
        if (formSchema.mode === 'live-document') {
            setBusy(true, 'remove');
            post({ action: 'remove', key: table.dataset.typeList, index: Number(row.dataset.index) });
            return;
        }
        const key = table.dataset.gridKey;
        const nextTarget = row.nextElementSibling?.querySelector('input')
            || row.previousElementSibling?.querySelector('input')
            || form.querySelector('[data-add-row="' + key + '"]')
            || document.getElementById('submit');
        row.remove();
        reindexEditGrid(table);
        nextTarget?.focus();
        return;
    }
    const addBtn = event.target.closest('[data-add-row]');
    if (addBtn && form.contains(addBtn)) {
        event.preventDefault();
        event.stopPropagation();
        const key = addBtn.dataset.addRow;
        const table = form.querySelector('table[data-grid-key="' + key + '"]');
        const tpl = form.querySelector('template[data-row-template="' + key + '"]');
        if (table && tpl) {
            table.tBodies[0].append(tpl.content.cloneNode(true));
            reindexEditGrid(table);
            table.tBodies[0].lastElementChild?.querySelector('input')?.focus();
        }
    }
}, true);

form.addEventListener('input', event => {
    const el = event.target.closest('[data-path]');
    if (!el) { return; }
    if (formSchema.mode === 'live-document' && !event.isComposing) {
        handleLiveInput(el);
    }
    if (el.getAttribute('aria-invalid') === 'true') {
        const currentErrors = validateClient();
        const stillInvalid = currentErrors.find(err => err.controlId === el.id);
        if (!stillInvalid) {
            setControlError(el, '');
            if (currentErrors.length === 0 && document.querySelector('#error .error-summary-list')) {
                renderErrorAlert('', []);
            }
        }
    }
});

form.addEventListener('change', event => {
    const el = event.target.closest('input[type="checkbox"][data-path]');
    if (!el) { return; }
    if (el.getAttribute('aria-invalid') === 'true') {
        const currentErrors = validateClient();
        const stillInvalid = currentErrors.find(err => err.controlId === el.id);
        if (!stillInvalid) {
            setControlError(el, '');
            if (currentErrors.length === 0 && document.querySelector('#error .error-summary-list')) {
                renderErrorAlert('', []);
            }
        }
    }
});

form.addEventListener('compositionend', event => {
    if (formSchema.mode === 'live-document') {
        handleLiveInput(event.target.closest('[data-path]'));
    }
});

form.addEventListener('focusout', event => {
    const el = event.target.closest?.('[data-path]');
    if (!el || el.closest('tr[data-new]') || busy || Date.now() < suppressBlurUntil) { return; }
    if (blurTimer) { clearTimeout(blurTimer); }
    blurTimer = setTimeout(() => {
        blurTimer = 0;
        if (busy || Date.now() < suppressBlurUntil || !document.contains(el)) { return; }
        const allErrors = validateClient();
        const table = el.closest('table[data-grid-key]');
        const colKey = el.dataset.column;
        if (table && colKey) {
            for (const peer of table.querySelectorAll('tbody tr:not([data-new]) [data-column="' + colKey + '"]')) {
                const peerErr = allErrors.find(item => item.controlId === peer.id);
                if (peer === el || peer.getAttribute('aria-invalid') === 'true' || peerErr) {
                    setControlError(peer, peerErr ? peerErr.message : '');
                }
            }
        } else {
            const ownErr = allErrors.find(item => item.controlId === el.id);
            setControlError(el, ownErr ? ownErr.message : '');
        }
        if (allErrors.length === 0 && document.querySelector('#error .error-summary-list')) {
            renderErrorAlert('', []);
        }
    }, 160);
});

document.addEventListener('focusin', () => {
    if (!busy && formSchema.mode === 'live-document') {
        post({ action: 'focus', focus: captureFocus() });
    }
});

document.addEventListener('selectionchange', () => {
    if (!busy && formSchema.mode === 'live-document' && document.activeElement?.dataset?.path) {
        post({ action: 'focus', focus: captureFocus() });
    }
});

document.addEventListener('keydown', event => {
    const handle = event.target.closest?.('[data-move]');
    if (handle && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault();
        if (busy || handle.getAttribute('aria-disabled') === 'true') { return; }
        const row = handle.closest('tr');
        const items = [...row.parentElement.querySelectorAll('tr[data-index]:not([data-new])')];
        const index = items.indexOf(row);
        const up = event.key === 'ArrowUp';
        moveRow(row, items[index + (up ? -1 : 1)], up);
        return;
    }
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 's') {
        event.preventDefault();
        event.stopPropagation();
        runSubmitOrSave();
    }
}, true);

const updateHeaderMeta = meta => {
    if (!meta) { return; }
    const bytesEl = document.querySelector('[data-meta-bytes]');
    const countEl = document.querySelector('[data-meta-count]');
    const subtitleEl = document.querySelector('header .subtitle');
    if (subtitleEl && meta.subtitle) { subtitleEl.title = meta.subtitle; }
    if (bytesEl && meta.bytesLabel !== undefined) {
        bytesEl.textContent = meta.bytesLabel || '';
        bytesEl.hidden = !meta.bytesLabel;
        const sep = bytesEl.previousElementSibling;
        if (sep?.classList.contains('type-meta-sep')) { sep.hidden = !meta.bytesLabel; }
    }
    if (countEl && meta.countLabel !== undefined) {
        countEl.textContent = meta.countLabel || '';
        countEl.hidden = !meta.countLabel;
        const sep = countEl.previousElementSibling;
        if (sep?.classList.contains('type-meta-sep')) { sep.hidden = !meta.countLabel; }
    }
};

window.addEventListener('message', event => {
    const msg = event.data;
    if (!msg || typeof msg !== 'object') { return; }

    if (msg.action === 'type-options') {
        const list = document.getElementById('type-options');
        if (list && Array.isArray(msg.values)) {
            list.replaceChildren(...msg.values.map(val => {
                const option = document.createElement('option');
                option.value = val;
                return option;
            }));
        }
        return;
    }

    if (msg.action === 'type-meta') {
        if (!draftDirty && msg.bytesLabel) {
            updateHeaderMeta({ bytesLabel: msg.bytesLabel });
        }
        return;
    }

    if (msg.action === 'type-diagnostics') {
        const fieldErrors = Array.isArray(msg.fieldErrors) ? msg.fieldErrors : [];
        const summary = msg.error || '';
        applyValidationState(fieldErrors, summary, Boolean(summary || fieldErrors.length || document.getElementById('error')?.textContent));
        return;
    }

    if (msg.action === 'draft-version') {
        draftVersion = msg.version;
        draftDirty = Boolean(msg.dirty);
        document.body.dataset.draftVersion = String(draftVersion);
        if (msg.added?.offset !== undefined) {
            const row = form.querySelector('table[data-type-list="' + msg.added.key + '"] tr[data-index="' + msg.added.index + '"]');
            const offsetInput = row?.querySelector('td[data-field="offset"] input');
            if (offsetInput && !offsetInput.dataset.edited) {
                offsetInput.value = String(msg.added.offset);
            }
        }
        updateHeaderMeta(msg.meta);
        if (!busy) {
            setStatusText(msg.statusMessage ?? (draftDirty ? 'Unsaved changes' : ''), draftDirty ? 'dirty' : 'clean');
        }
        return;
    }

    if (msg.action === 'sync-document') {
        const priorFocus = msg.focus || busyFocus || captureFocus();
        saveQueued = false;
        generation = typeof msg.generation === 'number' ? msg.generation : generation + 1;
        if (msg.schema) { formSchema = msg.schema; }
        draftVersion = msg.version ?? draftVersion;
        draftDirty = Boolean(msg.dirty);
        document.body.dataset.draftVersion = String(draftVersion);
        const surface = document.getElementById('form-surface');
        if (surface && typeof msg.surfaceHtml === 'string') {
            surface.innerHTML = msg.surfaceHtml;
        }
        if (msg.sorts) { activeSorts = { ...msg.sorts }; }
        applySavedSorts();
        updateHeaderMeta(msg.meta);
        busyFocus = null;
        const fieldErrors = Array.isArray(msg.fieldErrors) ? msg.fieldErrors : [];
        setBusy(false, '', msg.statusMessage ?? (draftDirty ? 'Unsaved changes' : ''));
        if (msg.statusMessage === 'Invalid JSONC') {
            const status = document.querySelector('.type-status');
            if (status) { status.dataset.state = 'error'; }
        }
        applyValidationState(fieldErrors, msg.error || '', true);
        restoreFocus(priorFocus, true);
        return;
    }

    if (msg.action === 'save-failed') {
        const priorFocus = busyFocus || captureFocus();
        saveQueued = false;
        busyFocus = null;
        setBusy(false, '', 'Save failed');
        const status = document.querySelector('.type-status');
        if (status) { status.dataset.state = 'error'; }
        const fieldErrors = Array.isArray(msg.fieldErrors) ? msg.fieldErrors : [];
        const resolved = applyValidationState(fieldErrors, msg.error || 'Could not save the data type.', true);
        if (resolved.length > 0) {
            const firstEl = document.getElementById(resolved[0].controlId);
            if (firstEl) {
                openAncestorDisclosures(firstEl);
                firstEl.focus();
                firstEl.scrollIntoView({ block: 'nearest' });
                return;
            }
        }
        restoreFocus(priorFocus, true);
        return;
    }

    if (msg.action === 'save-succeeded') {
        const priorFocus = busyFocus || captureFocus();
        saveQueued = false;
        draftDirty = false;
        if (typeof msg.version === 'number') {
            draftVersion = msg.version;
            document.body.dataset.draftVersion = String(draftVersion);
        }
        updateHeaderMeta(msg.meta);
        busyFocus = null;
        setBusy(false, '', msg.statusMessage || 'Saved');
        clearAllFieldErrors();
        renderErrorAlert('', []);
        restoreFocus(priorFocus, true);
        return;
    }

    if (msg.action === 'result') {
        const priorFocus = busyFocus || captureFocus();
        busyFocus = null;
        setBusy(false);
        if (msg.savedValues && typeof msg.savedValues === 'object') {
            if (msg.savedValues.title) {
                const heading = document.querySelector('h1');
                if (heading) { heading.textContent = String(msg.savedValues.title); }
            }
            if (msg.savedValues.rowOriginals && typeof msg.savedValues.rowOriginals === 'object') {
                for (const [gridKey, originals] of Object.entries(msg.savedValues.rowOriginals)) {
                    const table = form.querySelector('table[data-grid-key="' + gridKey + '"]');
                    if (!table || !Array.isArray(originals)) { continue; }
                    Array.from(table.tBodies[0].rows).forEach((row, idx) => {
                        if (originals[idx] !== undefined) { row.dataset.original = String(originals[idx]); }
                    });
                }
            }
        }
        const fieldErrors = Array.isArray(msg.fieldErrors) ? msg.fieldErrors : [];
        if (msg.error || fieldErrors.length > 0) {
            setStatusText('');
            const resolved = applyValidationState(fieldErrors, msg.error || '', true);
            if (resolved.length > 0) {
                const firstEl = document.getElementById(resolved[0].controlId);
                if (firstEl) {
                    openAncestorDisclosures(firstEl);
                    firstEl.focus();
                    firstEl.scrollIntoView({ block: 'nearest' });
                    return;
                }
            }
            restoreFocus(priorFocus, true);
            return;
        }
        clearAllFieldErrors();
        renderErrorAlert('', []);
        setStatusText(msg.message || 'Saved to the Ghidra project.');
        restoreFocus(priorFocus, true);
    }
});

if ((cfg.initialErrors && cfg.initialErrors.length > 0) || cfg.initialSummaryError) {
    applyValidationState(cfg.initialErrors || [], cfg.initialSummaryError || '', true);
}

requestAnimationFrame(() => {
    for (const invalidEl of form.querySelectorAll('[aria-invalid="true"]')) {
        openAncestorDisclosures(invalidEl);
    }
    if (cfg.initialBusy) {
        setBusy(true, 'save');
        busyFocus = cfg.initialFocus;
    } else if (cfg.initialFocus) {
        restoreFocus(cfg.initialFocus, true);
    } else if (formSchema.mode === 'submit') {
        const firstInvalid = form.querySelector('[aria-invalid="true"]');
        const target = firstInvalid
            || form.querySelector('[autofocus]')
            || form.querySelector('input:not([readonly]), textarea:not([readonly]), select')
            || document.getElementById('submit');
        if (target) {
            openAncestorDisclosures(target);
            target.focus({ preventScroll: true });
            window.addEventListener('focus', () => {
                if (!document.activeElement || document.activeElement === document.body) {
                    target.focus({ preventScroll: true });
                }
            }, { once: true });
        }
    }
    if (formSchema.mode === 'live-document') {
        post({ action: 'ready' });
    }
});
`;
}
