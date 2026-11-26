// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

/**
 * Client-side script for keyboard navigation, range selection, and focus retention in the Memory and Bytes webview.
 */
import { callIcons } from './call-graph-icons';
import { webviewPopoverScript, webviewShortcutScript } from './view-ui';

/** Build the inline client script for the Memory and Bytes webview page. */
export function renderProgramHexScript(stateJson: string): string {
    return `const vscode = acquireVsCodeApi();
const rawState = ${stateJson};
const { focusId: initialFocusId, ...state } = rawState;
const previous = vscode.getState() || {};
const samePage = previous.md5 === state.md5 && previous.kind === 'memory';

let selected = state.selected || '';
let selectionLength = state.selectionLength || 1;
let selectedKind = 'bytes';
let anchorAddress = selected;
let cursorAddress = selected;
let primaryAction = 'listing';

const hexWrap = document.getElementById('hex-wrap');
const hexBody = document.getElementById('hex-body');
const hexMain = hexWrap.closest('section');
const hexWorkspace = hexMain.closest('.hex-workspace');
const inspectorEl = document.getElementById('hex-inspector');
const memoryMap = document.querySelector('.memory-map');
const search = document.getElementById('search');
const addressInput = document.getElementById('address');
const blockSelect = document.getElementById('block-select');
const pageOptions = document.getElementById('page-options');
const syncToggle = document.getElementById('sync-toggle');
const endianSelect = document.getElementById('hex-endian');
const widthSelect = document.getElementById('hex-row-width');
const showInspectorChk = document.getElementById('hex-show-inspector');
const pvStep = document.getElementById('pv-step');
const pagerBefore = document.getElementById('pager-before');
const pagerAfter = document.getElementById('pager-after');
const scopeNote = document.getElementById('hex-scope-note');
const more = document.getElementById('more-actions');
const moreSummary = document.getElementById('more-actions-button');
const icons = ${JSON.stringify(callIcons)};
const toInspectorEndian = val => (val === 'big' || val === 'be') ? 'be' : 'le';
const toProgramEndian = val => (val === 'big' || val === 'be') ? 'big' : 'little';

if (samePage) {
  if (typeof previous.filter === 'string') search.value = previous.filter;
  if (memoryMap && typeof previous.mapOpen === 'boolean') memoryMap.open = previous.mapOpen;
  if (typeof previous.showInspector === 'boolean') showInspectorChk.checked = previous.showInspector;
  if (previous.inspectorEndian === 'be' || previous.inspectorEndian === 'le' || previous.endian === 'little' || previous.endian === 'big') {
    const nextEndian = toProgramEndian(previous.inspectorEndian || previous.endian);
    endianSelect.value = nextEndian;
    state.endian = nextEndian;
  }
}
document.body.classList.toggle('hide-inspector', !showInspectorChk.checked);

const parseAddr = raw => {
  const m = /^(?:([A-Za-z_][A-Za-z0-9_.-]*):)?(?:0x)?([0-9a-f]+)$/i.exec(String(raw || '').trim());
  if (!m) return null;
  const rawSpace = m[1] || state.defaultSpace || 'ram';
  const offset = BigInt('0x' + m[2]);
  const width = Math.max(m[2].length, 1);
  return { space: rawSpace.toLowerCase(), rawSpace, offset, width, canonical: rawSpace + ':' + offset.toString(16).padStart(width, '0') };
};
const sameAddr = (a, b) => {
  const left = parseAddr(a), right = parseAddr(b);
  return left && right ? left.space === right.space && left.offset === right.offset : String(a || '').toLowerCase() === String(b || '').toLowerCase();
};
if (selectionLength > 1) {
  const initParsed = parseAddr(selected);
  if (initParsed) cursorAddress = initParsed.rawSpace + ':' + (initParsed.offset + BigInt(selectionLength - 1)).toString(16).padStart(initParsed.width, '0');
}
const shortAddr = raw => /^ram:[0-9a-f]+$/i.test(raw || '') ? raw.slice(4) : String(raw || '');
const findBlockFor = addr => {
  const p = parseAddr(addr);
  if (!p) return null;
  for (const b of state.blocks || []) {
    const lo = parseAddr(b.start), hi = parseAddr(b.end);
    if (lo && hi && lo.space === p.space && p.offset >= lo.offset && p.offset <= hi.offset) return b;
  }
  return null;
};

const rawByteCells = () => [...hexBody.querySelectorAll('.hb[data-address]')];
const allByteCells = () => [...hexBody.querySelectorAll('tr.hex-row:not([hidden]) .hb[data-address]')];
const allAsciiCells = () => [...hexBody.querySelectorAll('.ha[data-address]')];
const resolveCanonicalAddr = (rawSpace, offset, width) => {
  const spaceLower = rawSpace.toLowerCase();
  const hit = rawByteCells().find(c => {
    const p = parseAddr(c.dataset.address);
    return p && p.space === spaceLower && p.offset === offset;
  });
  return hit?.dataset.address || (rawSpace + ':' + (offset < 0n ? 0n : offset).toString(16).padStart(Math.max(1, width), '0'));
};
const syncRovingTabindex = (preferredAddr = cursorAddress || selected) => {
  const allCells = rawByteCells();
  if (!allCells.length) return null;
  const visibleCells = allByteCells();
  let target = preferredAddr ? visibleCells.find(c => sameAddr(c.dataset.address, preferredAddr)) : null;
  if (!target && preferredAddr && selected && !sameAddr(preferredAddr, selected)) {
    target = visibleCells.find(c => sameAddr(c.dataset.address, selected));
  }
  if (!target) {
    target = (preferredAddr ? visibleCells.find(c => c.classList.contains('is-selected')) : null)
      || visibleCells[0]
      || (preferredAddr ? allCells.find(c => sameAddr(c.dataset.address, preferredAddr)) : null)
      || allCells[0];
  }
  for (const c of allCells) {
    c.tabIndex = c === target ? 0 : -1;
  }
  return target;
};

const decodeLocalInspector = (startAddr, len) => {
  const cells = rawByteCells();
  const idx = cells.findIndex(c => sameAddr(c.dataset.address, startAddr));
  const block = findBlockFor(startAddr);
  const blockText = block ? shortAddr(startAddr) + ' · ' + block.name + ' (' + (block.read ? 'R' : '−') + (block.write ? 'W' : '−') + (block.execute ? 'X' : '−') + ')' + (len > 1 ? ' · ' + len + ' bytes selected' : '') : shortAddr(startAddr);
  if (idx < 0) return { meta: blockText, rows: [] };
  const slice = cells.slice(idx, idx + 32);
  if (slice[0].dataset.byte === '') {
    return { meta: blockText, rows: [{ label: 'State', value: 'Uninitialized (??)' }] };
  }
  const bytes = [];
  for (const c of slice) {
    if (c.dataset.byte === '') break;
    bytes.push(Number(c.dataset.byte));
  }
  if (!bytes.length) return { meta: blockText, rows: [] };
  const le = state.endian !== 'big';
  const dv = new DataView(new Uint8Array(bytes).buffer);
  const b0 = bytes[0];
  const chHint = b0 >= 32 && b0 <= 126 ? " · '" + String.fromCharCode(b0) + "'" : b0 === 10 ? " · '\\\\n'" : b0 === 9 ? " · '\\\\t'" : b0 === 0 ? " · '\\\\0'" : '';
  const rows = [
    { label: 'Binary', value: b0.toString(2).padStart(8, '0'), title: '0x' + b0.toString(16).padStart(2, '0') },
    { label: 'int8 / uint8', value: dv.getInt8(0) + ' / ' + dv.getUint8(0) + chHint, title: '0x' + b0.toString(16).padStart(2, '0') },
  ];
  if (bytes.length >= 2) { const u = dv.getUint16(0, le); rows.push({ label: 'int16 / uint16', value: dv.getInt16(0, le) + ' / ' + u, title: '0x' + u.toString(16).padStart(4, '0') }); }
  if (bytes.length >= 4) { const u = dv.getUint32(0, le); rows.push({ label: 'int32 / uint32', value: dv.getInt32(0, le) + ' / ' + u, title: '0x' + u.toString(16).padStart(8, '0') }); }
  if (bytes.length >= 8) { const u = dv.getBigUint64(0, le); rows.push({ label: 'int64 / uint64', value: dv.getBigInt64(0, le).toString(10) + ' / ' + u.toString(10), title: '0x' + u.toString(16).padStart(16, '0') }); }
  if (bytes.length >= 4) { const f = dv.getFloat32(0, le); rows.push({ label: 'float32', value: Number.isFinite(f) ? Number(f.toPrecision(6)).toString() : String(f) }); }
  if (bytes.length >= 8) { const f = dv.getFloat64(0, le); rows.push({ label: 'float64', value: Number.isFinite(f) ? Number(f.toPrecision(10)).toString() : String(f) }); }
  const ptrBytes = state.addressSizeBits === 32 ? 4 : 8;
  if (bytes.length >= ptrBytes) {
    const pv = ptrBytes === 4 ? BigInt(dv.getUint32(0, le)) : dv.getBigUint64(0, le);
    const width = state.addressWidth || ptrBytes * 2;
    const target = (state.defaultSpace || 'ram') + ':' + pv.toString(16).padStart(width, '0');
    rows.push({ label: 'Pointer', value: '0x' + pv.toString(16).padStart(width, '0'), title: target, jumpAddress: findBlockFor(target) ? target : undefined });
  }
  let ascii = '';
  for (let i = 0; i < bytes.length && i < 32; i++) {
    if (bytes[i] === 0) break;
    if ((bytes[i] >= 32 && bytes[i] <= 126) || bytes[i] === 9) ascii += bytes[i] === 9 ? '\\\\t' : String.fromCharCode(bytes[i]);
    else { if (i < 2) ascii = ''; break; }
  }
  if (ascii.length >= 2) rows.push({ label: 'ASCII', value: '"' + ascii + '"', title: ascii });
  return { meta: blockText, rows };
};

const applyInspector = (startAddr, metaText, rows) => {
  const activeInInspector = inspectorEl.contains(document.activeElement) ? document.activeElement : null;
  const hadEndianFocus = !!activeInInspector?.hasAttribute('data-toggle-endian');
  const prevJump = activeInInspector?.dataset?.jump || '';
  const mode = toInspectorEndian(state.endian);
  const label = mode === 'be' ? 'Big Endian' : 'Little Endian';
  const head = document.createElement('div'); head.className = 'hex-inspector-head';
  const heading = document.createElement('h2'); heading.textContent = 'Data inspector';
  const pill = document.createElement('button'); pill.type = 'button'; pill.id = 'hex-endian-toggle'; pill.className = 'hex-endian-pill';
  pill.setAttribute('data-toggle-endian', ''); pill.dataset.endian = mode;
  pill.setAttribute('aria-pressed', String(mode === 'be'));
  pill.setAttribute('aria-label', label + ', toggle byte order');
  pill.title = 'Switch byte order'; pill.textContent = label;
  head.append(heading, pill);
  const meta = document.createElement('p'); meta.className = 'hex-inspector-meta'; meta.title = startAddr; meta.textContent = metaText;
  const dl = document.createElement('dl');
  for (const r of rows) {
    const div = document.createElement('div');
    const dt = document.createElement('dt'); dt.textContent = r.label;
    const dd = document.createElement('dd');
    if (r.jumpAddress) {
      const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'hex-ptr-btn'; btn.dataset.jump = r.jumpAddress; btn.title = 'Jump to ' + r.jumpAddress; btn.textContent = r.value + ' →';
      dd.append(btn);
    } else {
      const sp = document.createElement('span'); if (r.rawTitle || r.title) sp.title = r.rawTitle || r.title; sp.textContent = r.value;
      dd.append(sp);
    }
    div.append(dt, dd); dl.append(div);
  }
  inspectorEl.replaceChildren(head, meta, ...(rows.length ? [dl] : []));
  if (activeInInspector && !document.body.classList.contains('hide-inspector') && !hexMain.hidden) {
    const jumpBtns = [...inspectorEl.querySelectorAll('.hex-ptr-btn[data-jump]')];
    const nextFocus = hadEndianFocus ? pill : (prevJump && jumpBtns.find(b => b.dataset.jump === prevJump)) || jumpBtns[0] || pill;
    nextFocus?.focus({ preventScroll: true });
  }
};

const renderInspector = (startAddr, len) => {
  const data = decodeLocalInspector(startAddr, len);
  applyInspector(startAddr, data.meta, data.rows);
};

const persist = () => {
  vscode.setState({
    ...state,
    selected,
    selectionLength,
    filter: search.value,
    mapOpen: memoryMap?.open === true,
    showInspector: showInspectorChk.checked,
    endian: state.endian,
    inspectorEndian: toInspectorEndian(state.endian),
    bytesPerRow: state.bytesPerRow,
    scrollTop: hexWrap.scrollTop,
    focusId: document.activeElement?.id || '',
  });
};
${webviewShortcutScript}
${webviewPopoverScript}
document.addEventListener('focusin', persist);
hexWrap.addEventListener('scroll', () => persist(), { passive: true });

const updateSelectionTools = () => {
  const label = document.getElementById('selection-label');
  const bar = label.closest('.selection-tools');
  const hadBarFocus = bar.contains(document.activeElement);
  const activeAction = hadBarFocus ? document.activeElement?.dataset?.action : '';
  const activeHex = hexBody.querySelector('tr.hex-row:not([hidden]) .hb.is-selected') || hexBody.querySelector('tr.selected:not([hidden])');
  const activeMap = memoryMap?.querySelector('tr.selected:not([hidden])');
  const visible = (!!activeHex && !hexMain.hidden) || (!!activeMap && memoryMap?.open);
  bar.hidden = !visible;
  document.body.classList.toggle('has-selection', visible);
  if (!visible) { closePopover(more); return; }

  const isBlock = selectedKind === 'block' || (!!activeMap && !activeHex);
  const curBlock = findBlockFor(selected);
  label.textContent = isBlock
    ? 'Block ' + (activeMap?.dataset.label || curBlock?.name || shortAddr(selected))
    : shortAddr(selected) + (selectionLength > 1 ? ' (' + selectionLength + 'B)' : '') + (curBlock?.name ? ' · ' + curBlock.name : '');
  label.title = selected;
  const items = [
    { action: 'listing', label: isBlock ? 'Show block in Listing' : 'Show location in Listing', available: true },
    { action: 'references', label: 'References at location', available: true },
    { action: 'copyAddress', label: 'Copy address', available: true },
    { action: 'decompile', label: 'Decompile containing function', available: !isBlock },
  ].filter(i => i.available);
  primaryAction = 'listing';
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
      glyph.textContent = String.fromCodePoint(icons[item.action] || icons.listing);
      btn.append(glyph);
      return btn;
    }));
  }
  if (!extra.length) closePopover(more);
  moreSummary.hidden = !extra.length;
  const moreLabel = 'More actions for ' + label.textContent;
  moreSummary.setAttribute('aria-label', moreLabel);
  moreSummary.title = moreLabel;
  if (activeAction) {
    const candidate = document.getElementById('action-' + activeAction);
    const restore = (candidate && (!more.contains(candidate) || isPopoverOpen(more)))
      ? candidate
      : (isPopoverOpen(more) ? (menuButtons(more)[0] || moreSummary) : document.getElementById('action-' + primaryAction));
    restore?.focus({ preventScroll: true });
  }
};

const highlightRange = (startAddr, len = 1, notify = true, scroll = true) => {
  const start = parseAddr(startAddr);
  if (!start) return;
  const clampedLen = Math.max(1, len);
  const endOffset = start.offset + BigInt(clampedLen) - 1n;
  for (const el of document.querySelectorAll('.hb.is-selected,.ha.is-selected,tr.selected')) {
    el.classList.remove('is-selected', 'selected');
  }
  const byteCells = rawByteCells();
  for (const el of byteCells) {
    el.setAttribute('aria-selected', 'false');
  }
  let firstMatchedRow = null;
  for (const el of byteCells) {
    const p = parseAddr(el.dataset.address);
    if (p && p.space === start.space && p.offset >= start.offset && p.offset <= endOffset) {
      el.classList.add('is-selected');
      el.setAttribute('aria-selected', 'true');
      const tr = el.closest('tr');
      if (tr) {
        tr.classList.add('selected');
        tr.dataset.selLen = String(clampedLen);
        if (!tr.hidden) firstMatchedRow ||= tr;
      }
    }
  }
  for (const el of allAsciiCells()) {
    const p = parseAddr(el.dataset.address);
    if (p && p.space === start.space && p.offset >= start.offset && p.offset <= endOffset) {
      el.classList.add('is-selected');
    }
  }
  selected = startAddr;
  selectionLength = clampedLen;
  selectedKind = 'bytes';
  syncRovingTabindex(cursorAddress || startAddr);
  if (addressInput) addressInput.value = shortAddr(startAddr);
  if (firstMatchedRow && scroll) firstMatchedRow.scrollIntoView({ block: 'nearest' });
  renderInspector(startAddr, selectionLength);
  updateSelectionTools();
  persist();
  if (notify) {
    vscode.postMessage({ action: 'selectByte', address: startAddr, length: selectionLength });
  }
};

const applyFilter = () => {
  const q = search.value.trim().toLowerCase();
  const qCompact = q.replace(/\\s+/g, '');
  const gridRows = [...hexBody.querySelectorAll('tr.hex-row')];
  const mapRows = memoryMap ? [...memoryMap.querySelectorAll('tbody tr')] : [];
  let visible = 0, total = 0;

  for (const r of gridRows) {
    total++;
    const rowHexCells = [...r.querySelectorAll('.hb[data-address]')].map(c => c.textContent.trim().toLowerCase());
    const rowHexSpaced = rowHexCells.join(' ');
    const rowHexCompact = rowHexCells.join('');
    const rowText = ((r.querySelector('.addr')?.textContent || '') + ' ' + rowHexSpaced + ' ' + (r.querySelector('.hex-ascii')?.textContent || '') + ' ' + (r.dataset.address || '')).toLowerCase();
    const hit = !q || rowText.includes(q) || (qCompact.length >= 2 && /^[0-9a-f?]+$/.test(qCompact) && rowHexCompact.includes(qCompact));
    r.hidden = !hit;
    if (hit) visible++;
  }
  const hasGridMatch = gridRows.some(r => !r.hidden);
  hexMain.hidden = !!q && !hasGridMatch;
  if (hexWorkspace) hexWorkspace.hidden = !!q && !hasGridMatch;
  syncRovingTabindex(cursorAddress || selected);

  for (const r of mapRows) {
    const hit = !q || r.textContent.toLowerCase().includes(q);
    r.hidden = !hit;
    if (memoryMap.open) { total++; if (hit) visible++; }
  }
  const mapTableWrap = memoryMap?.querySelector('.table-wrap');
  if (mapTableWrap) mapTableWrap.hidden = !mapRows.length || (!!q && !mapRows.some(r => !r.hidden));

  const collapsedMatches = !!q && !hasGridMatch && !memoryMap?.open && mapRows.some(r => !r.hidden);
  const empty = document.querySelector('.no-results');
  const status = document.getElementById('filter-status');
  empty.hidden = !q || visible > 0;
  empty.querySelector('span').textContent = collapsedMatches ? 'Matches in collapsed memory map.' : 'No matching rows.';
  status.hidden = !q;
  status.classList.toggle('sr-filter-status', !!q && visible === 0);
  status.textContent = !q ? '' : visible ? visible + ' of ' + total + ' displayed rows match.' : collapsedMatches ? 'Matches in collapsed memory map.' : 'No displayed rows match this filter.';
  updateSelectionTools();
};

const resolveShiftRange = targetAddr => {
  const a = anchorAddress ? parseAddr(anchorAddress) : null;
  const b = parseAddr(targetAddr);
  if (!a || !b || a.space !== b.space) {
    anchorAddress = targetAddr;
    return { start: targetAddr, length: 1, cursor: targetAddr, backward: false };
  }
  const maxDelta = 63n;
  const width = Math.max(a.width, b.width);
  if (b.offset >= a.offset) {
    const rawDelta = b.offset - a.offset;
    const clamped = rawDelta > maxDelta ? maxDelta : rawDelta;
    const cursor = rawDelta > maxDelta ? resolveCanonicalAddr(a.rawSpace, a.offset + clamped, width) : targetAddr;
    return { start: anchorAddress, length: Number(clamped + 1n), cursor, backward: false };
  }
  const rawDelta = a.offset - b.offset;
  const maxBack = a.offset >= maxDelta ? maxDelta : a.offset;
  const clamped = rawDelta > maxBack ? maxBack : rawDelta;
  const start = rawDelta > maxBack ? resolveCanonicalAddr(a.rawSpace, a.offset - clamped, width) : targetAddr;
  return { start, length: Number(clamped + 1n), cursor: start, backward: true };
};

hexBody.addEventListener('click', event => {
  const cell = event.target.closest('.hb[data-address]');
  if (cell) {
    const addr = cell.dataset.address;
    if (event.shiftKey && anchorAddress) {
      const range = resolveShiftRange(addr);
      cursorAddress = range.cursor;
      highlightRange(range.start, range.length, true, false);
      const focusCell = allByteCells().find(c => sameAddr(c.dataset.address, range.cursor)) || cell;
      syncRovingTabindex(focusCell.dataset.address);
      focusCell.focus({ preventScroll: true });
      return;
    }
    anchorAddress = addr;
    cursorAddress = addr;
    highlightRange(addr, 1, true, false);
    cell.focus({ preventScroll: true });
    return;
  }
  const rowHeader = event.target.closest('th.addr');
  const row = rowHeader?.closest('tr.hex-row');
  if (row?.dataset.address) {
    anchorAddress = row.dataset.address;
    cursorAddress = row.dataset.address;
    highlightRange(row.dataset.address, 1, true, false);
    row.querySelector('.hb[data-address]')?.focus({ preventScroll: true });
  }
});

hexBody.addEventListener('dblclick', event => {
  const cell = event.target.closest('.hb[data-address]');
  if (cell?.dataset.address) {
    vscode.postMessage({ action: 'listing', address: cell.dataset.address, kind: 'bytes' });
    return;
  }
  const rowHeader = event.target.closest('th.addr');
  const row = rowHeader?.closest('tr.hex-row');
  if (row?.dataset.address) {
    vscode.postMessage({ action: 'listing', address: row.dataset.address, kind: 'bytes' });
  }
});

hexBody.addEventListener('keydown', event => {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  const cell = event.target.closest('.hb[data-address]');
  const row = event.target.closest('tr.hex-row');
  const cells = allByteCells();
  if (!cells.length) return;
  const activeAddr = cursorAddress || selected;
  let curIdx = cell ? cells.indexOf(cell) : cells.findIndex(c => sameAddr(c.dataset.address, activeAddr));
  if (curIdx < 0 && row) curIdx = cells.findIndex(c => c.closest('tr') === row);
  const activeCell = curIdx >= 0 ? cells[curIdx] : cells[0];
  let nextCell = null;
  if (event.key === 'ArrowRight') {
    nextCell = cells[Math.min(cells.length - 1, curIdx < 0 ? 0 : curIdx + 1)];
  } else if (event.key === 'ArrowLeft') {
    nextCell = cells[Math.max(0, curIdx < 0 ? 0 : curIdx - 1)];
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    const visibleRows = [...hexBody.querySelectorAll('tr.hex-row:not([hidden])')];
    const curRow = activeCell.closest('tr');
    const rowIdx = curRow ? visibleRows.indexOf(curRow) : -1;
    const nextRowIdx = rowIdx + (event.key === 'ArrowDown' ? 1 : -1);
    if (nextRowIdx >= 0 && nextRowIdx < visibleRows.length) {
      const colIndex = activeCell.cellIndex;
      const rowByteCells = [...visibleRows[nextRowIdx].querySelectorAll('.hb[data-address]')];
      nextCell = rowByteCells.find(c => c.cellIndex === colIndex)
        || (colIndex < rowByteCells[0]?.cellIndex ? rowByteCells[0] : rowByteCells[rowByteCells.length - 1]);
    } else {
      nextCell = event.key === 'ArrowDown' ? cells[cells.length - 1] : cells[0];
    }
  } else if (event.key === 'Home') {
    nextCell = cells[0];
  } else if (event.key === 'End') {
    nextCell = cells[cells.length - 1];
  } else if (event.key === ' ') {
    nextCell = activeCell;
  } else if (event.key === 'Enter') {
    const enterAddr = (cell && !cell.classList.contains('is-selected') && cell.dataset.address)
      ? cell.dataset.address
      : (!cell && row && !row.classList.contains('selected') && row.dataset.address)
        ? row.dataset.address
        : selected;
    if (enterAddr) { event.preventDefault(); vscode.postMessage({ action: 'listing', address: enterAddr, kind: 'bytes' }); }
    return;
  }
  if (nextCell) {
    event.preventDefault();
    const targetAddr = nextCell.dataset.address;
    if (event.shiftKey) {
      if (!anchorAddress) anchorAddress = activeCell?.dataset.address || selected || targetAddr;
      const range = resolveShiftRange(targetAddr);
      cursorAddress = range.cursor;
      highlightRange(range.start, range.length, true, false);
      const selVis = cells.filter(c => c.classList.contains('is-selected'));
      const focusCell = cells.find(c => sameAddr(c.dataset.address, range.cursor))
        || (range.backward ? selVis[0] : selVis[selVis.length - 1])
        || nextCell;
      syncRovingTabindex(focusCell.dataset.address);
      focusCell.focus({ preventScroll: true });
      focusCell.closest('tr')?.scrollIntoView({ block: 'nearest' });
    } else {
      anchorAddress = targetAddr;
      cursorAddress = targetAddr;
      highlightRange(targetAddr, 1, true, false);
      syncRovingTabindex(targetAddr);
      nextCell.focus({ preventScroll: true });
      nextCell.closest('tr')?.scrollIntoView({ block: 'nearest' });
    }
  }
});

inspectorEl.addEventListener('click', event => {
  const endianBtn = event.target.closest('[data-toggle-endian]');
  if (endianBtn) {
    const nextMode = toInspectorEndian(state.endian) === 'be' ? 'le' : 'be';
    state.endian = toProgramEndian(nextMode);
    if (endianSelect) endianSelect.value = state.endian;
    renderInspector(selected, selectionLength);
    persist();
    vscode.postMessage({ action: 'setHexOptions', endian: state.endian });
    inspectorEl.querySelector('[data-toggle-endian]')?.focus({ preventScroll: true });
    return;
  }
  const jumpBtn = event.target.closest('[data-jump]');
  if (jumpBtn) vscode.postMessage({ action: 'goto', address: jumpBtn.dataset.jump });
});

const selectBlockRow = row => {
  if (!row) return;
  for (const el of document.querySelectorAll('.hb.is-selected,.ha.is-selected,tr.selected')) el.classList.remove('is-selected', 'selected');
  for (const el of rawByteCells()) el.setAttribute('aria-selected', 'false');
  row.classList.add('selected');
  selected = row.dataset.address || '';
  selectedKind = 'block';
  selectionLength = 1;
  anchorAddress = '';
  cursorAddress = '';
  syncRovingTabindex('');
  updateSelectionTools();
  persist();
};
const mapTbody = memoryMap?.querySelector('tbody');
mapTbody?.addEventListener('click', event => {
  selectBlockRow(event.target.closest('tr[data-address]'));
});
mapTbody?.addEventListener('dblclick', event => {
  const row = event.target.closest('tr[data-address]');
  if (!row) return;
  selectBlockRow(row);
  if (row.dataset.address) vscode.postMessage({ action: 'goto', address: row.dataset.address });
});
mapTbody?.addEventListener('keydown', event => {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  const row = event.target.closest('tr[data-address]');
  if (!row) return;
  if (event.key === ' ') {
    event.preventDefault();
    selectBlockRow(row);
    return;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    selectBlockRow(row);
    if (row.dataset.address) vscode.postMessage({ action: 'goto', address: row.dataset.address });
    return;
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const rows = [...mapTbody.querySelectorAll('tr[data-address]:not([hidden])')];
  if (!rows.length) return;
  const idx = rows.indexOf(row);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, (idx < 0 ? 0 : idx) + (event.key === 'ArrowDown' ? 1 : -1)));
  event.preventDefault();
  rows[next]?.focus();
  rows[next]?.scrollIntoView({ block: 'nearest' });
});
memoryMap?.addEventListener('toggle', () => { applyFilter(); persist(); });

document.addEventListener('click', event => {
  const btn = event.target.closest('button[data-action]');
  if (btn && !btn.disabled) {
    const act = btn.dataset.action;
    const menu = btn.closest('[data-popover-menu]');
    if (menu) focusInvokerAndClose(menu);
    persist();
    const focusId = document.activeElement?.id || '';
    if (['navBack', 'navForward', 'refresh', 'loadBefore', 'loadAfter', 'toggleSync', 'openListingBeside'].includes(act)) {
      vscode.postMessage({ action: act, focusId });
    } else if (act === 'copyAddress' && selected) {
      vscode.postMessage({ action: 'copyAddress', address: selected, focusId });
    } else if (selected) {
      vscode.postMessage({ action: act, address: selected, kind: selectedKind, focusId });
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
endianSelect?.addEventListener('change', () => {
  state.endian = endianSelect.value === 'big' ? 'big' : 'little';
  renderInspector(selected, selectionLength);
  persist();
  vscode.postMessage({ action: 'setHexOptions', endian: state.endian });
});
widthSelect?.addEventListener('change', () => {
  const w = Number(widthSelect.value) === 8 ? 8 : 16;
  state.bytesPerRow = w;
  persist();
  vscode.postMessage({ action: 'setHexOptions', bytesPerRow: w });
});
showInspectorChk?.addEventListener('change', () => {
  document.body.classList.toggle('hide-inspector', !showInspectorChk.checked);
  persist();
});

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
    const nextAddr = msg.address || selected;
    const nextLen = msg.length || 1;
    anchorAddress = nextAddr;
    cursorAddress = nextAddr;
    highlightRange(nextAddr, nextLen, false, true);
  } else if (msg.action === 'syncState') {
    state.syncEnabled = !!msg.syncEnabled;
    syncToggle.setAttribute('aria-pressed', String(state.syncEnabled));
  } else if (msg.action === 'inspectorData' && Array.isArray(msg.entries)) {
    const addr = msg.address || selected;
    if (sameAddr(addr, selected)) {
      const len = msg.length || selectionLength || 1;
      const block = findBlockFor(addr);
      const metaText = block ? shortAddr(addr) + ' · ' + block.name + ' (' + (block.read ? 'R' : '−') + (block.write ? 'W' : '−') + (block.execute ? 'X' : '−') + ')' + (len > 1 ? ' · ' + len + ' bytes selected' : '') : shortAddr(addr);
      applyInspector(addr, metaText, msg.entries);
    }
  } else if (msg.action === 'chunkData') {
    const activeEl = document.activeElement;
    const inHexBody = !!(activeEl && hexBody.contains(activeEl));
    const prevHexAddr = inHexBody ? (activeEl.closest('[data-address]')?.dataset.address || '') : '';
    const activeNavBtn = activeEl?.closest?.('.pv-nav button[data-action]') || null;
    const hadFocusedElement = !!(activeEl && activeEl !== document.body && activeEl !== document.documentElement);

    state.address = msg.chunkStart;
    hexBody.innerHTML = msg.rowsHtml;
    if (msg.colsHtml) document.getElementById('hex-cols-head').innerHTML = msg.colsHtml;
    const navBackBtn = document.querySelector('[data-action="navBack"]');
    const navForwardBtn = document.querySelector('[data-action="navForward"]');
    if (typeof msg.canBack === 'boolean' && navBackBtn) navBackBtn.disabled = !msg.canBack;
    if (typeof msg.canForward === 'boolean' && navForwardBtn) navForwardBtn.disabled = !msg.canForward;
    if (pvStep) pvStep.hidden = !msg.hasMoreBefore && !msg.hasMoreAfter;
    pagerBefore.disabled = !msg.hasMoreBefore;
    pagerAfter.disabled = !msg.hasMoreAfter;
    if (msg.scopeNote) scopeNote.textContent = msg.scopeNote;
    if (blockSelect && msg.currentBlockStart) blockSelect.value = msg.currentBlockStart;
    if (msg.sectionLabel) hexMain.setAttribute('aria-label', msg.sectionLabel);
    applyFilter();
    const nextSel = msg.selectedAddress || selected;
    const nextLen = msg.length || 1;
    if (nextLen <= 1 || !sameAddr(nextSel, selected)) {
      anchorAddress = nextSel;
      cursorAddress = nextSel;
    }
    highlightRange(nextSel, nextLen, false, true);

    const focusEmptyFallback = () => {
      const clearBtn = document.getElementById('clear-filter');
      const fallback = (clearBtn && !clearBtn.closest('[hidden]')) ? clearBtn : search;
      fallback?.focus({ preventScroll: true });
    };
    if (inHexBody) {
      const visibleCells = allByteCells();
      if (!visibleCells.length || hexMain.hidden) {
        focusEmptyFallback();
      } else {
        const targetCell = (prevHexAddr && visibleCells.find(c => c.classList.contains('is-selected') && sameAddr(c.dataset.address, prevHexAddr)))
          || visibleCells.find(c => sameAddr(c.dataset.address, cursorAddress))
          || visibleCells.find(c => sameAddr(c.dataset.address, nextSel))
          || visibleCells.find(c => c.classList.contains('is-selected'))
          || visibleCells[0];
        if (targetCell) {
          syncRovingTabindex(targetCell.dataset.address);
          targetCell.focus({ preventScroll: true });
        }
      }
    } else if (activeNavBtn) {
      if (!activeNavBtn.disabled && !activeNavBtn.closest('[hidden]')) {
        if (document.activeElement !== activeNavBtn) activeNavBtn.focus({ preventScroll: true });
      } else {
        const pairMap = { navBack: navForwardBtn, navForward: navBackBtn, loadBefore: pagerAfter, loadAfter: pagerBefore };
        const paired = pairMap[activeNavBtn.dataset.action];
        const fallback = (paired && !paired.disabled && !paired.closest('[hidden]')) ? paired : addressInput;
        fallback?.focus({ preventScroll: true });
      }
    } else if (hadFocusedElement && (!document.activeElement || document.activeElement === document.body)) {
      if (!allByteCells().length || hexMain.hidden) {
        focusEmptyFallback();
      } else {
        syncRovingTabindex(nextSel)?.focus({ preventScroll: true });
      }
    }
    persist();
  }
});

applyFilter();
highlightRange(selected, selectionLength, false, !samePage);
requestAnimationFrame(() => {
  if (samePage && previous.address === state.address && typeof previous.scrollTop === 'number') {
    hexWrap.scrollTop = previous.scrollTop;
  }
  const savedFocusId = (samePage && previous.focusId) || initialFocusId || '';
  if (savedFocusId) restorePopoverAwareFocus(savedFocusId);
  persist();
  document.body.dataset.viewReady = 'true';
});`;
}
