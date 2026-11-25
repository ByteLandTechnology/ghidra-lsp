// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

/**
 * HTML and client script renderer for the Program Listing webview.
 */
import { randomBytes } from 'node:crypto';
import { MemoryBlockInfo, parseAddress } from './address-math';
import { callIcon, callIcons } from './call-graph-icons';
import { iconFontStyles } from './icon-font';
import { ListingRenderItem, ListingTarget, ListingUnit, ListingUndefinedRun, ListingWindowModel } from './listing-model';
import { displayAddress } from './names';
import { pageStyles } from './page-styles';
import { addrSpan, programViewStyles } from './program-views-styles';
import { highlightAsm, highlightName } from './syntax';
import { moreActionsPopover, pageOptionsPopover, viewStyles, webviewPopoverScript, webviewShortcutScript } from './view-ui';
import { escape } from './web';

/** Full view-model payload used to render the graphical Program Listing HTML page. */
export interface ListingViewPayload {
    md5: string;
    programName: string;
    title: string;
    blocks: MemoryBlockInfo[];
    currentBlock?: string;
    cursorAddress: string;
    selectedAddress: string;
    window: ListingWindowModel;
    hasMoreBefore: boolean;
    hasMoreAfter: boolean;
    canBack: boolean;
    canForward: boolean;
    syncEnabled: boolean;
    singleKeyShortcuts?: boolean;
    totalUnitsLabel: string;
    focusId?: string;
}

/** Turn inline hex address literals inside highlighted operands into jump buttons. */
function linkifyInlineTargets(opHtml: string, targets: ListingTarget[]): string {
    const inlineTargets = targets.filter(t => t.inlineOnly);
    if (!inlineTargets.length) {
        return opHtml;
    }
    const byHex = new Map<string, ListingTarget>();
    for (const target of inlineTargets) {
        const parsed = parseAddress(target.to);
        if (parsed) {
            byHex.set(parsed.offset.toString(16).toLowerCase(), target);
        }
    }
    return opHtml.replace(/<span class="tok-number">((?:0x)?[0-9a-f]+)<\/span>/gi, (full, rawLiteral: string) => {
        const normalized = rawLiteral.toLowerCase().replace(/^0x/, '').replace(/^0+/, '') || '0';
        const match = byHex.get(normalized);
        if (!match) {
            return full;
        }
        return `<button type="button" class="target-link target-inline" data-jump="${escape(match.to)}" title="${escape(`Jump to ${match.to}${match.kind ? ` (${match.kind})` : ''}`)}">${escape(rawLiteral)}</button>`;
    });
}

/** Render HTML table rows for listing code units, headers, comments, and undefined runs. */
export function renderListingRowsHtml(items: ListingRenderItem[], selectedAddress: string): string {
    const out: string[] = [];
    const renderUnit = (unit: ListingUnit, hiddenRun = false): string => {
        const parts: string[] = [];
        if (unit.blockHeader) {
            const b = unit.blockHeader;
            parts.push(`<tr class="listing-aux-row listing-block-row"${hiddenRun ? ' hidden' : ''}><td colspan="5"><span class="listing-block-name">${escape(b.name)}</span><span>${addrSpan(b.start)}–${addrSpan(b.end)} · ${escape(b.permissions)}${b.initialized ? '' : ' · uninitialized'}${b.kind ? ` · ${escape(b.kind)}` : ''}${b.comment ? ` · ${escape(b.comment)}` : ''}</span></td></tr>`);
        }
        if (unit.plateComment) {
            parts.push(`<tr class="listing-aux-row listing-plate-row"${hiddenRun ? ' hidden' : ''}><td class="addr"></td><td colspan="4">/* ${escape(unit.plateComment)} */</td></tr>`);
        }
        if (unit.functionHeader) {
            const fn = unit.functionHeader;
            const flagStr = [fn.callingConvention, ...fn.flags].filter(Boolean).join(' · ');
            const vars = fn.variables.slice(0, 12).map(v => `<span title="${escape(v.rawStorage || v.storage)}">${escape(v.kind)}: ${escape(v.dataType)} <strong>${escape(v.name)}</strong> [${escape(v.storage)}]</span>`).join('');
            const moreVars = fn.variables.length > 12 ? `<span>+${fn.variables.length - 12} more</span>` : '';
            parts.push(`<tr class="listing-aux-row listing-fn-row"${hiddenRun ? ' hidden' : ''}><td class="addr"></td><td colspan="4"><div class="listing-fn-sig" title="${escape(fn.rawSignature)}${fn.mangledName ? `\nMangled: ${fn.mangledName}` : ''}">${highlightName(fn.displaySignature)}</div>${flagStr ? `<div class="listing-fn-meta">${escape(flagStr)}</div>` : ''}${vars ? `<div class="listing-var-list">${vars}${moreVars}</div>` : ''}</td></tr>`);
        }
        if (unit.labels.length || unit.xrefs.length) {
            const labelsHtml = unit.labels.map(l => `<span class="listing-label-name" title="${escape(l.fullTooltip)}">${highlightName(l.name)}:</span>`).join(' ');
            const xrefsHtml = unit.xrefs.length
                ? `<span class="listing-xrefs">XREF[${unit.xrefTotal}]: ${unit.xrefs.map(x => x.navigable
                    ? `<button type="button" class="xref-link" data-jump="${escape(x.from)}" title="${escape(`${x.type} from ${x.from}`)}">${escape(x.label)}${escape(x.suffix)}</button>`
                    : `<span class="xref-static" title="${escape(`${x.type} from ${x.from}`)}">${escape(x.label)}${escape(x.suffix)}</span>`).join(' ')}${unit.xrefTotal > unit.xrefs.length ? ` <span>+${unit.xrefTotal - unit.xrefs.length}</span>` : ''}</span>`
                : '';
            parts.push(`<tr class="listing-aux-row listing-label-row"${hiddenRun ? ' hidden' : ''}><td class="addr"></td><td colspan="4"><div class="listing-label-main">${labelsHtml}${xrefsHtml}</div></td></tr>`);
        }
        if (unit.preComment) {
            parts.push(`<tr class="listing-aux-row listing-pre-row"${hiddenRun ? ' hidden' : ''}><td class="addr"></td><td colspan="4">; ${escape(unit.preComment)}</td></tr>`);
        }

        const isSel = selectedAddress && unit.address.toLowerCase() === selectedAddress.toLowerCase();
        const rawOpHtml = unit.kind === 'instruction'
            ? highlightAsm(unit.operandsText, 'span', false)
            : unit.typePath
                ? `<span title="${escape(unit.typePath)}">${escape(unit.operandsText)}</span>`
                : escape(unit.operandsText);
        const opHtml = unit.kind === 'instruction' ? linkifyInlineTargets(rawOpHtml, unit.targets) : rawOpHtml;
        const visibleTargets = unit.targets.filter(t => !t.inlineOnly);
        const chipsHtml = visibleTargets.length
            ? `<span class="target-chips">${visibleTargets.map(t => `<button type="button" class="target-link" data-jump="${escape(t.to)}" title="${escape(`Jump to ${t.to}${t.kind ? ` (${t.kind})` : ''}`)}">→ ${escape(t.label)}</button>`).join('')}</span>`
            : '';
        const eolHtml = unit.eolComment ? `; ${escape(unit.eolComment)}` : '';
        parts.push(`<tr class="listing-unit-row${isSel ? ' selected' : ''}" tabindex="0" data-address="${escape(unit.address)}" data-byte-length="${unit.byteLength}" data-kind="${escape(unit.kind)}"${unit.entry ? ` data-entry="${escape(unit.entry)}"` : ''}${unit.functionName ? ` data-fn-name="${escape(unit.functionName)}"` : ''}${unit.targets[0]?.to ? ` data-jump-primary="${escape(unit.targets[0].to)}"` : ''}${hiddenRun ? ' data-run-member="true" hidden' : ''}><td class="addr">${addrSpan(unit.address)}</td><td class="col-bytes" title="${escape(unit.bytesText)}">${escape(unit.bytesShort)}</td><td class="col-mnemonic"><span class="tok-mnemonic">${escape(unit.mnemonic)}</span></td><td class="col-operands">${opHtml}${chipsHtml}</td><td class="col-comment">${eolHtml}</td></tr>`);

        if (unit.postComment) {
            parts.push(`<tr class="listing-aux-row listing-post-row"${hiddenRun ? ' hidden' : ''}><td class="addr"></td><td colspan="4">; post: ${escape(unit.postComment)}</td></tr>`);
        }
        return parts.join('');
    };

    for (const item of items) {
        if ((item as ListingUndefinedRun).kind === 'undefinedRun') {
            const run = item as ListingUndefinedRun;
            if (run.blockHeader) {
                const b = run.blockHeader;
                out.push(`<tr class="listing-aux-row listing-block-row"><td colspan="5"><span class="listing-block-name">${escape(b.name)}</span><span>${addrSpan(b.start)}–${addrSpan(b.end)} · ${escape(b.permissions)}${b.initialized ? '' : ' · uninitialized'}${b.kind ? ` · ${escape(b.kind)}` : ''}${b.comment ? ` · ${escape(b.comment)}` : ''}</span></td></tr>`);
            }
            out.push(`<tr class="listing-undef-run" data-run-start="${escape(run.startAddress)}"><td class="addr">${addrSpan(run.startAddress)}</td><td class="col-bytes"></td><td class="col-mnemonic">${run.uninitialized ? '??' : 'db'}</td><td class="col-operands"><button type="button" class="expand-run-btn" aria-expanded="false" data-expand-run="${escape(run.startAddress)}">${run.byteLength} ${run.uninitialized ? 'uninitialized' : 'undefined'} bytes (${escape(displayAddress(run.startAddress))}..${escape(displayAddress(run.endAddress))})</button></td><td class="col-comment"></td></tr>`);
            for (const member of run.units) {
                out.push(renderUnit(member, true));
            }
        } else {
            out.push(renderUnit(item as ListingUnit, false));
        }
    }
    return out.join('');
}

/** Render the complete HTML webview document for the Program Listing panel. */
export function renderProgramListingPage(payload: ListingViewPayload): string {
    const nonce = randomBytes(18).toString('base64');
    const blockOptions = payload.blocks.map(b => {
        const sel = payload.currentBlock === b.name ? ' selected' : '';
        return `<option value="${escape(b.start)}"${sel}>${escape(b.name)} · ${escape(displayAddress(b.start))}</option>`;
    }).join('');
    const stateJson = JSON.stringify({
        kind: 'listing',
        md5: payload.md5,
        address: payload.cursorAddress,
        selected: payload.selectedAddress,
        windowStart: payload.window.startAddress,
        windowEnd: payload.window.endAddress,
        syncEnabled: payload.syncEnabled,
        singleKeyShortcuts: payload.singleKeyShortcuts !== false,
        ...(payload.focusId ? { focusId: payload.focusId } : {}),
    }).replace(/</g, '\\u003c');

    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';"><title>${escape(payload.title)}</title><style nonce="${nonce}">
${pageStyles}
${iconFontStyles}
${viewStyles}
${programViewStyles}
</style></head><body class="browser-page program-view hide-vars" data-view-kind="listing"><main>
<h1 class="page-context">${escape(payload.title)}</h1>
<div class="toolbar pv-toolbar" role="group" aria-label="Listing navigation">
  <div class="pv-nav" role="group" aria-label="History and window">
    <button type="button" id="nav-back" class="icon-button" data-action="navBack" aria-label="Back" title="Back (Alt+Left)"${payload.canBack ? '' : ' disabled'}>${callIcon('back')}</button>
    <button type="button" id="nav-forward" class="icon-button" data-action="navForward" aria-label="Forward" title="Forward (Alt+Right)"${payload.canForward ? '' : ' disabled'}>${callIcon('forward')}</button>
    <span class="pv-step" id="pv-step"${payload.hasMoreBefore || payload.hasMoreAfter ? '' : ' hidden'}><span class="pv-divider" aria-hidden="true"></span><button type="button" id="pager-before" class="icon-button" data-action="loadBefore" aria-label="Previous window" title="Previous window"${payload.hasMoreBefore ? '' : ' disabled'}>${callIcon('up')}</button><button type="button" id="pager-after" class="icon-button" data-action="loadAfter" aria-label="Next window" title="Next window"${payload.hasMoreAfter ? '' : ' disabled'}>${callIcon('down')}</button></span>
  </div>
  <form id="goto"><input id="address" aria-label="Address or symbol" value="${escape(displayAddress(payload.cursorAddress))}" placeholder="Address or symbol…"><button type="submit" id="goto-submit" aria-label="Go to address" title="Go to address">${callIcon('right')}</button></form>
  <div class="browser-search">${callIcon('search')}<input class="search" id="search" aria-label="Filter displayed rows" placeholder="Filter instructions, labels, comments…"></div>
  <div class="pv-tools" role="group" aria-label="Listing tools">
    <button type="button" id="sync-toggle" class="icon-button" data-action="toggleSync" aria-pressed="${payload.syncEnabled}" aria-label="Sync cursor with other Ghidra views" title="Sync cursor with other Ghidra views">${callIcon('link')}</button>
    <button type="button" id="open-hex-beside" class="icon-button" data-action="openHexBeside" aria-label="Open Hex view beside" title="Open Hex view beside">${callIcon('memory')}</button>
    ${pageOptionsPopover(`${blockOptions ? `<label class="pv-option-row">Memory block<select id="block-select" aria-label="Memory block">${blockOptions}</select></label>` : ''}<label><input id="listing-bytes" type="checkbox" checked>Show bytes</label><label><input id="listing-headers" type="checkbox" checked>Show function headers</label><label><input id="listing-vars" type="checkbox">Show function variables</label><label><input id="listing-xrefs" type="checkbox" checked>Show cross-references</label><label><input id="listing-collapse" type="checkbox" checked>Collapse undefined byte runs</label><p id="listing-scope-note">${escape(payload.totalUnitsLabel)}</p>`)}
  </div>
</div>
<p id="filter-status" role="status" aria-live="polite" hidden></p>
<div class="table-wrap" id="listing-wrap">
  <table class="listing-table">
    <thead><tr><th scope="col">Address</th><th scope="col" class="col-bytes">Bytes</th><th scope="col" class="col-mnemonic">Mnemonic</th><th scope="col" class="col-operands">Operands</th><th scope="col" class="col-comment">Comments</th></tr></thead>
    <tbody id="listing-body">${renderListingRowsHtml(payload.window.collapsedItems, payload.selectedAddress)}</tbody>
  </table>
</div>
<div class="no-results" hidden><span>No matching rows.</span><button type="button" id="clear-filter" class="icon-button" aria-label="Clear filter" title="Clear filter">${callIcon('close')}</button></div>
<div class="toolbar selection-tools" role="group" aria-label="Selected item actions" aria-describedby="selection-label" hidden>
  <span id="selection-label"></span>
  <div id="selection-primary" class="selection-buttons"></div>
  ${moreActionsPopover()}
</div>
</main>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const rawState = ${stateJson};
const { focusId: initialFocusId, ...state } = rawState;
const previous = vscode.getState() || {};
const samePage = previous.md5 === state.md5 && previous.kind === 'listing';
let selected = state.selected || '';
let selectedEntry = '';
let selectedKind = '';
let selectedLength = 1;
let primaryAction = 'decompile';

const wrap = document.getElementById('listing-wrap');
const tbody = document.getElementById('listing-body');
const search = document.getElementById('search');
const addressInput = document.getElementById('address');
const blockSelect = document.getElementById('block-select');
const pageOptions = document.getElementById('page-options');
const syncToggle = document.getElementById('sync-toggle');
const optBytes = document.getElementById('listing-bytes');
const optHeaders = document.getElementById('listing-headers');
const optVars = document.getElementById('listing-vars');
const optXrefs = document.getElementById('listing-xrefs');
const optCollapse = document.getElementById('listing-collapse');
const pvStep = document.getElementById('pv-step');
const pagerBefore = document.getElementById('pager-before');
const pagerAfter = document.getElementById('pager-after');
const scopeNote = document.getElementById('listing-scope-note');
const more = document.getElementById('more-actions');
const moreSummary = document.getElementById('more-actions-button');
const icons = ${JSON.stringify(callIcons)};

if (samePage) {
  if (typeof previous.filter === 'string') search.value = previous.filter;
  if (typeof previous.showBytes === 'boolean') optBytes.checked = previous.showBytes;
  if (typeof previous.showHeaders === 'boolean') optHeaders.checked = previous.showHeaders;
  if (typeof previous.showVars === 'boolean') optVars.checked = previous.showVars;
  if (typeof previous.showXrefs === 'boolean') optXrefs.checked = previous.showXrefs;
  if (typeof previous.collapseRuns === 'boolean') optCollapse.checked = previous.collapseRuns;
}

const applyViewClasses = () => {
  document.body.classList.toggle('hide-bytes', !optBytes.checked);
  document.body.classList.toggle('hide-headers', !optHeaders.checked);
  document.body.classList.toggle('hide-vars', !optVars.checked);
  document.body.classList.toggle('hide-xrefs', !optXrefs.checked);
  const collapse = optCollapse.checked;
  for (const runRow of tbody.querySelectorAll('tr.listing-undef-run')) {
    runRow.hidden = !collapse;
    runRow.querySelector('.expand-run-btn')?.setAttribute('aria-expanded', String(!collapse));
  }
  for (const member of tbody.querySelectorAll('tr[data-run-member="true"]')) { member.hidden = collapse; }
};

const persist = () => {
  vscode.setState({
    ...state,
    selected,
    filter: search.value,
    showBytes: optBytes.checked,
    showHeaders: optHeaders.checked,
    showVars: optVars.checked,
    showXrefs: optXrefs.checked,
    collapseRuns: optCollapse.checked,
    scrollTop: wrap.scrollTop,
    focusId: document.activeElement?.id || '',
  });
};
${webviewShortcutScript}
${webviewPopoverScript}
document.addEventListener('focusin', persist);
wrap.addEventListener('scroll', () => persist(), { passive: true });

const unitRows = () => [...tbody.querySelectorAll('tr.listing-unit-row')];
const findUnitRow = addr => addr ? unitRows().find(r => r.dataset.address?.toLowerCase() === addr.toLowerCase()) : undefined;

const updateSelectionTools = () => {
  const label = document.getElementById('selection-label');
  const bar = label.closest('.selection-tools');
  const active = findUnitRow(selected);
  const visible = !!active && !active.hidden;
  bar.hidden = !visible;
  document.body.classList.toggle('has-selection', visible);
  if (!visible) { closePopover(more); return; }
  const short = v => /^ram:[0-9a-f]+$/i.test(v || '') ? v.slice(4) : v;
  const fn = active.dataset.entry || '';
  const fnName = active.dataset.fnName || '';
  const kind = active.dataset.kind || 'instruction';
  label.textContent = fnName
    ? short(selected) + ' · ' + fnName
    : (kind === 'data' ? short(selected) + ' · data' : short(selected));
  label.title = selected + (fnName ? ' in ' + fnName : fn ? ' in ' + fn : '');

  const canDecompile = !!fn || kind === 'instruction';
  const items = [
    { action: 'decompile', label: 'Decompile containing function', available: canDecompile },
    { action: 'memory', label: 'View bytes in Hex', available: true },
    { action: 'comment', label: 'Edit comment', available: true },
    { action: 'references', label: 'References at location', available: true },
    { action: 'copyAddress', label: 'Copy address', available: true },
    { action: 'callGraph', label: 'Call graph of containing function', available: canDecompile },
    { action: 'controlFlow', label: 'Control flow of containing function', available: canDecompile },
  ].filter(i => i.available);

  primaryAction = canDecompile ? 'decompile' : 'memory';
  const main = items.filter(i => i.action === primaryAction);
  const extra = items.filter(i => i.action !== primaryAction);
  const hosts = [document.getElementById('selection-primary'), more];
  for (const [idx, list] of [main, extra].entries()) {
    hosts[idx].replaceChildren(...list.map(item => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'action-' + item.action;
      btn.dataset.action = item.action;
      btn.className = 'icon-only' + (item.action === primaryAction ? ' primary' : '');
      btn.setAttribute('aria-label', item.label);
      btn.title = item.label;
      const glyph = document.createElement('span');
      glyph.className = 'call-icon';
      glyph.setAttribute('aria-hidden', 'true');
      glyph.textContent = String.fromCodePoint(icons[item.action] || icons.function);
      btn.append(glyph);
      return btn;
    }));
  }
  if (!extra.length) closePopover(more);
  moreSummary.hidden = !extra.length;
  const moreLabel = 'More actions for ' + label.textContent;
  moreSummary.setAttribute('aria-label', moreLabel);
  moreSummary.title = moreLabel;
};

const selectRow = (row, notify = true, scroll = true) => {
  if (!row) return;
  for (const r of tbody.querySelectorAll('tr.selected')) r.classList.remove('selected');
  row.classList.add('selected');
  selected = row.dataset.address || '';
  selectedEntry = row.dataset.entry || '';
  selectedKind = row.dataset.kind || 'instruction';
  selectedLength = Number(row.dataset.byteLength) || 1;
  if (addressInput) addressInput.value = /^ram:[0-9a-f]+$/i.test(selected) ? selected.slice(4) : selected;
  if (scroll) row.scrollIntoView({ block: 'nearest' });
  updateSelectionTools();
  persist();
  if (notify) {
    vscode.postMessage({ action: 'select', address: selected, entry: selectedEntry, kind: selectedKind, byteLength: selectedLength });
  }
};

const applyFilter = () => {
  const q = search.value.trim().toLowerCase();
  const rows = unitRows();
  let visible = 0;
  for (const r of rows) {
    if (!q) {
      if (r.dataset.runMember === 'true' && optCollapse.checked) { r.hidden = true; }
      else { r.hidden = false; visible++; }
      continue;
    }
    const hit = r.textContent.toLowerCase().includes(q) || (r.dataset.address || '').toLowerCase().includes(q);
    r.hidden = !hit;
    if (hit) visible++;
  }
  for (const aux of tbody.querySelectorAll('tr.listing-aux-row, tr.listing-undef-run')) {
    aux.hidden = !!q || (aux.classList.contains('listing-undef-run') && !optCollapse.checked);
  }
  const empty = document.querySelector('.no-results');
  const status = document.getElementById('filter-status');
  const wrapTable = wrap.querySelector('table');
  if (wrapTable) wrapTable.hidden = !!q && visible === 0;
  empty.hidden = !q || visible > 0;
  status.hidden = !q;
  status.classList.toggle('sr-filter-status', !!q && visible === 0);
  status.textContent = q ? (visible ? visible + ' of ' + rows.length + ' displayed rows match.' : 'No displayed rows match this filter.') : '';
  updateSelectionTools();
};

const bindTableInteractions = () => {
  for (const row of unitRows()) {
    if (selected && row.dataset.address?.toLowerCase() === selected.toLowerCase()) {
      row.classList.add('selected');
      selectedEntry = row.dataset.entry || '';
      selectedKind = row.dataset.kind || 'instruction';
      selectedLength = Number(row.dataset.byteLength) || 1;
    }
  }
  applyViewClasses();
  applyFilter();
};

const focusListingFallback = () => {
  const selRow = findUnitRow(selected);
  if (selRow && !selRow.hidden) {
    selRow.focus({ preventScroll: true });
    return;
  }
  const firstVisible = unitRows().find(r => !r.hidden);
  if (firstVisible) {
    firstVisible.scrollIntoView({ block: 'nearest' });
    firstVisible.focus({ preventScroll: true });
    return;
  }
  search?.focus({ preventScroll: true });
};

tbody.addEventListener('click', event => {
  const jumpBtn = event.target.closest('[data-jump]');
  if (jumpBtn) {
    event.stopPropagation();
    vscode.postMessage({ action: 'goto', address: jumpBtn.dataset.jump });
    return;
  }
  const expandBtn = event.target.closest('[data-expand-run]');
  if (expandBtn) {
    event.stopPropagation();
    const runRow = expandBtn.closest('tr');
    optCollapse.checked = false;
    applyViewClasses();
    applyFilter();
    let firstRow = findUnitRow(expandBtn.dataset.expandRun);
    if (!firstRow || firstRow.hidden) {
      let next = runRow?.nextElementSibling;
      while (next && (!next.classList.contains('listing-unit-row') || next.hidden)) {
        next = next.nextElementSibling;
      }
      firstRow = next || unitRows().find(r => !r.hidden);
    }
    if (firstRow) {
      firstRow.focus({ preventScroll: true });
      selectRow(firstRow, true, true);
    } else {
      persist();
    }
    return;
  }
  const row = event.target.closest('tr.listing-unit-row');
  if (row) selectRow(row, true, false);
});

tbody.addEventListener('dblclick', event => {
  if (event.target.closest('[data-jump],[data-expand-run]')) return;
  const row = event.target.closest('tr.listing-unit-row');
  if (!row) return;
  selectRow(row, false, false);
  const jump = row.dataset.jumpPrimary;
  if (jump) vscode.postMessage({ action: 'goto', address: jump });
  else if (primaryAction) vscode.postMessage({ action: primaryAction, address: selected, entry: selectedEntry, kind: selectedKind });
});

tbody.addEventListener('keydown', event => {
  if (event.target.closest('[data-jump],[data-expand-run],button')) return;
  const row = event.target.closest('tr.listing-unit-row');
  if (!row) return;
  const visible = unitRows().filter(r => !r.hidden);
  const idx = visible.indexOf(row);
  if (event.key === 'ArrowDown' && idx + 1 < visible.length) { event.preventDefault(); visible[idx + 1].focus(); selectRow(visible[idx + 1], true, true); }
  else if (event.key === 'ArrowUp' && idx > 0) { event.preventDefault(); visible[idx - 1].focus(); selectRow(visible[idx - 1], true, true); }
  else if (event.key === 'Home' && visible.length) { event.preventDefault(); visible[0].focus(); selectRow(visible[0], true, true); }
  else if (event.key === 'End' && visible.length) { event.preventDefault(); visible[visible.length - 1].focus(); selectRow(visible[visible.length - 1], true, true); }
  else if (event.key === 'Enter') {
    event.preventDefault();
    const jump = row.dataset.jumpPrimary;
    if (jump) vscode.postMessage({ action: 'goto', address: jump });
    else if (primaryAction) vscode.postMessage({ action: primaryAction, address: selected, entry: selectedEntry, kind: selectedKind });
  }
});

document.addEventListener('click', event => {
  const btn = event.target.closest('button[data-action]');
  if (btn && !btn.disabled) {
    const act = btn.dataset.action;
    const menu = btn.closest('[data-popover-menu]');
    if (menu) focusInvokerAndClose(menu);
    persist();
    const focusId = document.activeElement?.id || '';
    if (['navBack', 'navForward', 'refresh', 'loadBefore', 'loadAfter', 'toggleSync', 'openHexBeside'].includes(act)) {
      vscode.postMessage({ action: act, focusId });
    } else if (act === 'copyAddress' && selected) {
      vscode.postMessage({ action: 'copyAddress', address: selected, focusId });
    } else if (selected) {
      vscode.postMessage({ action: act, address: selected, entry: selectedEntry, kind: selectedKind, focusId });
    }
  }
});

document.getElementById('goto').addEventListener('submit', event => {
  event.preventDefault();
  const val = addressInput.value.trim();
  if (val) vscode.postMessage({ action: 'goto', address: val, focusId: document.activeElement?.id || '' });
});
blockSelect?.addEventListener('change', () => {
  if (blockSelect.value) {
    focusInvokerAndClose(pageOptions);
    persist();
    vscode.postMessage({ action: 'goto', address: blockSelect.value, pushHistory: true, focusId: document.activeElement?.id || '' });
  }
});
search.addEventListener('input', () => { applyFilter(); persist(); });
document.getElementById('clear-filter').addEventListener('click', () => { search.value = ''; applyFilter(); persist(); search.focus(); });
for (const chk of [optBytes, optHeaders, optVars, optXrefs, optCollapse]) {
  chk.addEventListener('change', () => { applyViewClasses(); applyFilter(); persist(); });
}

document.addEventListener('keydown', event => {
  if (event.altKey && !event.ctrlKey && !event.metaKey) {
    if (event.key === 'ArrowLeft') { event.preventDefault(); vscode.postMessage({ action: 'navBack' }); return; }
    if (event.key === 'ArrowRight') { event.preventDefault(); vscode.postMessage({ action: 'navForward' }); return; }
  }
  if (isModShortcut(event, 'f')) { event.preventDefault(); search.focus(); search.select(); return; }
  if (isModShortcut(event, 'g')) { event.preventDefault(); addressInput.focus(); addressInput.select(); return; }
  if (event.key === 'Escape') {
    if (search.value) { search.value = ''; applyFilter(); persist(); return; }
  }
  if (event.key === '/' && canUseSingleKeyShortcut(event)) { event.preventDefault(); search.focus(); search.select(); }
  else if ((event.key || '').toLowerCase() === 'g' && canUseSingleKeyShortcut(event)) { event.preventDefault(); addressInput.focus(); addressInput.select(); }
});

window.addEventListener('message', event => {
  const msg = event.data || {};
  if (msg.action === 'highlight') {
    const row = findUnitRow(msg.address);
    if (row) selectRow(row, false, true);
  } else if (msg.action === 'syncState') {
    state.syncEnabled = !!msg.syncEnabled;
    syncToggle.setAttribute('aria-pressed', String(state.syncEnabled));
  } else if (msg.action === 'windowData') {
    const activeEl = document.activeElement;
    const focusInTbody = !!activeEl && tbody.contains(activeEl);
    const navBack = document.querySelector('[data-action="navBack"]');
    const navForward = document.querySelector('[data-action="navForward"]');
    const navButtons = [navBack, navForward, pagerBefore, pagerAfter].filter(Boolean);
    const focusedNavBtn = navButtons.find(btn => btn === activeEl);
    const anchorAddr = msg.anchorAddress;
    const prevTop = anchorAddr ? findUnitRow(anchorAddr)?.getBoundingClientRect().top : undefined;
    tbody.innerHTML = msg.rowsHtml;
    selected = msg.selectedAddress || selected;
    if (addressInput && activeEl !== addressInput) {
      addressInput.value = /^ram:[0-9a-f]+$/i.test(selected) ? selected.slice(4) : selected;
    }
    state.windowStart = msg.windowStart;
    state.windowEnd = msg.windowEnd;
    if (typeof msg.canBack === 'boolean' && navBack) navBack.disabled = !msg.canBack;
    if (typeof msg.canForward === 'boolean' && navForward) navForward.disabled = !msg.canForward;
    if (pvStep) pvStep.hidden = !msg.hasMoreBefore && !msg.hasMoreAfter;
    pagerBefore.disabled = !msg.hasMoreBefore;
    pagerAfter.disabled = !msg.hasMoreAfter;
    if (msg.scopeNote) scopeNote.textContent = msg.scopeNote;
    if (blockSelect && msg.currentBlockStart) blockSelect.value = msg.currentBlockStart;
    bindTableInteractions();
    if (anchorAddr && prevTop !== undefined) {
      const nextRow = findUnitRow(anchorAddr);
      if (nextRow) { wrap.scrollTop += nextRow.getBoundingClientRect().top - prevTop; }
    } else if (msg.scrollToSelected) {
      const selRow = findUnitRow(selected);
      if (selRow && !selRow.hidden) selRow.scrollIntoView({ block: 'center' });
    } else {
      wrap.scrollTop = 0;
    }
    if (focusInTbody) {
      focusListingFallback();
    } else if (focusedNavBtn && (focusedNavBtn.disabled || focusedNavBtn.closest('[hidden]'))) {
      const siblingOrder = focusedNavBtn === pagerBefore
        ? [pagerAfter, navBack, navForward]
        : focusedNavBtn === pagerAfter
          ? [pagerBefore, navBack, navForward]
          : focusedNavBtn === navBack
            ? [navForward, pagerBefore, pagerAfter]
            : [navBack, pagerBefore, pagerAfter];
      const nextBtn = siblingOrder.find(btn => btn && !btn.disabled && !btn.closest('[hidden]'));
      if (nextBtn) nextBtn.focus({ preventScroll: true });
      else focusListingFallback();
    }
    persist();
  }
});

bindTableInteractions();
requestAnimationFrame(() => {
  updateSelectionTools();
  const initialRow = findUnitRow(selected);
  if (samePage && previous.windowStart === state.windowStart && typeof previous.scrollTop === 'number') {
    wrap.scrollTop = previous.scrollTop;
  } else if (initialRow && !samePage) {
    initialRow.scrollIntoView({ block: 'center' });
  }
  const savedFocusId = (samePage && previous.focusId) || initialFocusId || '';
  if (savedFocusId) restorePopoverAwareFocus(savedFocusId);
  persist();
  document.body.dataset.viewReady = 'true';
});
</script></body></html>`;
}
