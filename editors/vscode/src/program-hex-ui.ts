// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

/**
 * HTML and client script renderer for the Memory and Bytes webview.
 */
import { randomBytes } from 'node:crypto';
import { MemoryBlockInfo, parseAddress, permissionsLabel } from './address-math';
import { callIcon, callIcons } from './call-graph-icons';
import { DataInspectorEntry, HexChunk, ProgramEndian } from './hex-model';
import { iconFontStyles } from './icon-font';
import { displayAddress } from './names';
import { pageStyles } from './page-styles';
import { addrSpan, programViewStyles } from './program-views-styles';
import { viewStyles, webviewShortcutScript } from './view-ui';
import { escape } from './web';

/** Short byte-order identifier used by the Data Inspector pill toggle. */
export type InspectorEndian = 'le' | 'be';

/** Full view-model payload used to render the graphical Memory and Bytes HTML page. */
export interface HexViewPayload {
    md5: string;
    programName: string;
    title: string;
    endian: ProgramEndian;
    addressSizeBits: number;
    defaultSpace: string;
    addressWidth: number;
    blocks: MemoryBlockInfo[];
    currentBlock: MemoryBlockInfo;
    cursorAddress: string;
    selectionLength: number;
    cursorSymbol?: string;
    chunk: HexChunk;
    hasMoreBefore: boolean;
    hasMoreAfter: boolean;
    canBack: boolean;
    canForward: boolean;
    syncEnabled: boolean;
    singleKeyShortcuts?: boolean;
    bytesPerRow: 8 | 16;
    initialInspector: DataInspectorEntry[];
}

/** Render the column header cells for an 8-byte or 16-byte hex layout. */
export function renderHexColHeadersHtml(bytesPerRow: number): string {
    const byteHeaders = Array.from({ length: bytesPerRow }, (_, i) => {
        const gap = i > 0 && i % 8 === 0 ? ' is-gap' : '';
        return `<th scope="col" class="hx-col${gap}">${i.toString(16).padStart(2, '0').toUpperCase()}</th>`;
    }).join('');
    return `<th scope="col" class="addr">Address</th>${byteHeaders}<th scope="col" class="hex-ascii-head">ASCII</th>`;
}

/** Render hex and ASCII table rows for one fetched {@link HexChunk}. */
export function renderHexRowsHtml(chunk: HexChunk, selectedAddress: string, selectionLength: number): string {
    const selStart = parseAddress(selectedAddress);
    const selStartHex = selectedAddress.toLowerCase();
    const selLen = BigInt(Math.max(1, selectionLength || 1));
    const selEndOffset = selStart ? selStart.offset + selLen - 1n : -1n;

    const matchesSelectedStart = (addr: string): boolean => {
        const parsed = parseAddress(addr);
        if (selStart && parsed) {
            return parsed.space.toLowerCase() === selStart.space.toLowerCase() && parsed.offset === selStart.offset;
        }
        return addr.toLowerCase() === selStartHex;
    };

    const isInSelectedRange = (addr: string): boolean => {
        const parsed = parseAddress(addr);
        if (selStart && parsed) {
            return parsed.space.toLowerCase() === selStart.space.toLowerCase()
                && parsed.offset >= selStart.offset
                && parsed.offset <= selEndOffset;
        }
        return addr.toLowerCase() === selStartHex;
    };

    let focusStopAddress = '';
    for (const row of chunk.rows) {
        for (const cell of row.cells) {
            if (!cell.inBlock || !cell.address) {
                continue;
            }
            if (!focusStopAddress) {
                focusStopAddress = cell.address;
            }
            if (matchesSelectedStart(cell.address)) {
                focusStopAddress = cell.address;
                break;
            }
        }
        if (focusStopAddress && matchesSelectedStart(focusStopAddress)) {
            break;
        }
    }

    let focusAssigned = false;
    return chunk.rows.map(row => {
        let rowHasSel = false;
        const bytesHtml = row.cells.map((cell, idx) => {
            const gapClass = idx > 0 && idx % 8 === 0 ? ' is-gap' : '';
            if (!cell.inBlock || !cell.address) {
                return `<td class="hb is-pad${gapClass}" aria-disabled="true" aria-label="Out of block"></td>`;
            }
            const isSel = isInSelectedRange(cell.address);
            if (isSel) {
                rowHasSel = true;
            }
            const isFocusStop = !focusAssigned && cell.address === focusStopAddress;
            if (isFocusStop) {
                focusAssigned = true;
            }
            const byteStr = cell.value === null ? '??' : cell.value.toString(16).padStart(2, '0');
            const nullClass = cell.value === null ? ' is-null' : '';
            const symbolSuffix = cell.symbol ? `, ${cell.symbol}` : '';
            const ariaLabel = cell.value === null
                ? `?? uninitialized at ${cell.address}${symbolSuffix}`
                : `${byteStr} at ${cell.address}${symbolSuffix}`;
            const title = `${cell.address}${cell.symbol ? ` · ${cell.symbol}` : ''}${cell.value === null ? ' (uninitialized)' : ''}`;
            return `<td class="hb${gapClass}${nullClass}${isSel ? ' is-selected' : ''}" data-address="${escape(cell.address)}" data-byte="${cell.value === null ? '' : cell.value}" title="${escape(title)}" aria-label="${escape(ariaLabel)}" aria-selected="${isSel ? 'true' : 'false'}" tabindex="${isFocusStop ? '0' : '-1'}">${byteStr}</td>`;
        }).join('');

        const asciiHtml = row.cells.map(cell => {
            if (!cell.inBlock || !cell.address) {
                return '<span class="ha is-pad" aria-hidden="true"> </span>';
            }
            const ch = cell.value !== null && cell.value >= 32 && cell.value <= 126 ? String.fromCharCode(cell.value) : cell.value === null ? ' ' : '.';
            const isSel = isInSelectedRange(cell.address);
            return `<span class="ha${isSel ? ' is-selected' : ''}" data-address="${escape(cell.address)}">${escape(ch)}</span>`;
        }).join('');

        const rowAddr = row.firstInBlockAddress || row.rowAddress;
        const firstByte = row.cells.find(c => c.inBlock)?.address || rowAddr;
        return `<tr class="hex-row${rowHasSel ? ' selected' : ''}" data-address="${escape(firstByte)}" data-kind="bytes" data-sel-len="${selectionLength}"><th scope="row" class="addr">${addrSpan(row.rowAddress)}</th>${bytesHtml}<td class="hex-ascii" aria-readonly="true">${asciiHtml}</td></tr>`;
    }).join('');
}

/** Render the Data Inspector card grid for the currently selected byte address. */
export function renderDataInspectorHtml(
    entries: DataInspectorEntry[],
    address: string,
    block: MemoryBlockInfo,
    selectionLength: number,
    symbol?: string,
    endian: InspectorEndian = 'le',
): string {
    const shownAddr = displayAddress(address);
    const meta = [
        `${shownAddr} · ${block.name} (${permissionsLabel(block)})`,
        symbol || '',
        selectionLength > 1 ? `${selectionLength} bytes selected` : '',
    ].filter(Boolean).join(' · ');
    const endianLabel = endian === 'be' ? 'Big Endian' : 'Little Endian';
    const headHtml = `<div class="hex-inspector-head"><h2>Data inspector</h2><button type="button" class="hex-endian-pill" data-toggle-endian data-endian="${endian}" aria-pressed="${endian === 'be'}" aria-label="${endianLabel}, toggle byte order" title="Switch byte order">${endianLabel}</button></div>`;

    if (!entries.length) {
        return `${headHtml}<p class="hex-inspector-meta" title="${escape(address)}">${escape(meta || 'Select a byte to inspect decoded values.')}</p>`;
    }
    const rowsHtml = entries.map(entry => {
        const val = entry.jumpAddress
            ? `<button type="button" class="hex-ptr-btn" data-jump="${escape(entry.jumpAddress)}" title="Jump to ${escape(entry.jumpAddress)}">${escape(entry.value)} →</button>`
            : `<span${entry.rawTitle ? ` title="${escape(entry.rawTitle)}"` : ''}>${escape(entry.value)}</span>`;
        return `<div><dt>${escape(entry.label)}</dt><dd>${val}</dd></div>`;
    }).join('');
    return `${headHtml}<p class="hex-inspector-meta" title="${escape(address)}">${escape(meta)}</p><dl>${rowsHtml}</dl>`;
}

/** Render the collapsible Memory Map summary table listing program memory blocks. */
function renderMemoryMapHtml(blocks: MemoryBlockInfo[]): string {
    const rowsHtml = blocks.map(block => {
        const perms = permissionsLabel(block);
        const initText = block.initialized ? 'Yes' : 'No';
        return `<tr data-address="${escape(block.start)}" data-kind="block" data-label="${escape(block.name)}" tabindex="0"><td>${escape(block.name)}</td><td class="addr">${addrSpan(block.start)}</td><td class="addr">${addrSpan(block.end)}</td><td>${escape(block.length.toString(10))}</td><td>${escape(perms)}</td><td>${escape(initText)}</td></tr>`;
    }).join('');
    return `<details class="memory-map"><summary>Memory map (${blocks.length} blocks)</summary><div class="table-wrap"><table><thead><tr><th scope="col">Block</th><th scope="col">Start</th><th scope="col">End</th><th scope="col">Length</th><th scope="col">Permissions</th><th scope="col">Initialized</th></tr></thead><tbody>${rowsHtml}</tbody></table></div></details>`;
}

/** Render the complete HTML webview document for the Memory and Bytes panel. */
export function renderProgramHexPage(payload: HexViewPayload): string {
    const nonce = randomBytes(18).toString('base64');
    const blockOptions = payload.blocks.map(b => {
        const sel = payload.currentBlock.name === b.name ? ' selected' : '';
        return `<option value="${escape(b.start)}"${sel}>${escape(b.name)} (${escape(permissionsLabel(b))}${b.initialized ? '' : ' · uninit'})</option>`;
    }).join('');
    const colHeaders = renderHexColHeadersHtml(payload.bytesPerRow);

    const stateJson = JSON.stringify({
        kind: 'memory',
        md5: payload.md5,
        address: payload.chunk.start,
        selected: payload.cursorAddress,
        selectionLength: payload.selectionLength,
        syncEnabled: payload.syncEnabled,
        singleKeyShortcuts: payload.singleKeyShortcuts !== false,
        endian: payload.endian,
        addressSizeBits: payload.addressSizeBits,
        defaultSpace: payload.defaultSpace,
        addressWidth: payload.addressWidth,
        bytesPerRow: payload.bytesPerRow,
        blocks: payload.blocks.map(b => ({ name: b.name, start: b.start, end: b.end, initialized: b.initialized, read: b.read, write: b.write, execute: b.execute })),
    }).replace(/</g, '\\u003c');

    const scopeText = `${payload.currentBlock.name} · ${displayAddress(payload.chunk.start)}–${displayAddress(payload.chunk.end)} (${payload.chunk.byteLength} bytes)`;

    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';"><title>${escape(payload.title)}</title><style nonce="${nonce}">
${pageStyles}
${iconFontStyles}
${viewStyles}
${programViewStyles}
</style></head><body class="browser-page program-view" data-view-kind="memory"><main>
<h1 class="page-context">${escape(payload.title)}</h1>
<div class="toolbar pv-toolbar" role="group" aria-label="Hex navigation">
  <div class="pv-nav" role="group" aria-label="History and window">
    <button type="button" class="icon-button" data-action="navBack" aria-label="Back" title="Back (Alt+Left)"${payload.canBack ? '' : ' disabled'}>${callIcon('back')}</button>
    <button type="button" class="icon-button" data-action="navForward" aria-label="Forward" title="Forward (Alt+Right)"${payload.canForward ? '' : ' disabled'}>${callIcon('forward')}</button>
    <span class="pv-step" id="pv-step"${payload.hasMoreBefore || payload.hasMoreAfter ? '' : ' hidden'}><span class="pv-divider" aria-hidden="true"></span><button type="button" id="pager-before" class="icon-button" data-action="loadBefore" aria-label="Previous window" title="Previous window"${payload.hasMoreBefore ? '' : ' disabled'}>${callIcon('up')}</button><button type="button" id="pager-after" class="icon-button" data-action="loadAfter" aria-label="Next window" title="Next window"${payload.hasMoreAfter ? '' : ' disabled'}>${callIcon('down')}</button></span>
  </div>
  <form id="goto"><input id="address" aria-label="Address" value="${escape(displayAddress(payload.cursorAddress))}" placeholder="Address or +offset…"><button type="submit" aria-label="Go to address" title="Go to address">${callIcon('right')}</button></form>
  <div class="browser-search">${callIcon('search')}<input class="search" id="search" aria-label="Filter displayed rows" placeholder="Filter hex, ASCII, or block…"></div>
  <div class="pv-tools" role="group" aria-label="Hex tools">
    <button type="button" id="sync-toggle" class="icon-button" data-action="toggleSync" aria-pressed="${payload.syncEnabled}" aria-label="Sync cursor with other Ghidra views" title="Sync cursor with other Ghidra views">${callIcon('link')}</button>
    <button type="button" class="icon-button" data-action="openListingBeside" aria-label="Open Program Listing beside" title="Open Program Listing beside">${callIcon('listing')}</button>
    <details id="page-options" class="page-options">
      <summary aria-label="View options" title="View options">${callIcon('more')}</summary>
      <div class="page-options-content">
        <div class="page-options-actions" role="group" aria-label="Page actions">
          <button type="button" class="icon-button" data-action="refresh" aria-label="Refresh" title="Refresh">${callIcon('refresh')}</button>
        </div>
        ${blockOptions ? `<label class="pv-option-row">Memory block<select id="block-select" aria-label="Memory block">${blockOptions}</select></label>` : ''}
        <label class="pv-option-row">Byte order<select id="hex-endian" aria-label="Byte order"><option value="little"${payload.endian === 'little' ? ' selected' : ''}>Little-endian</option><option value="big"${payload.endian === 'big' ? ' selected' : ''}>Big-endian</option></select></label>
        <label class="pv-option-row">Bytes per row<select id="hex-row-width" aria-label="Bytes per row"><option value="16"${payload.bytesPerRow === 16 ? ' selected' : ''}>16 bytes</option><option value="8"${payload.bytesPerRow === 8 ? ' selected' : ''}>8 bytes</option></select></label>
        <label><input id="hex-show-inspector" type="checkbox" checked>Show Data Inspector</label>
        <p id="hex-scope-note">${escape(scopeText)}</p>
      </div>
    </details>
  </div>
</div>
<p id="filter-status" role="status" aria-live="polite" hidden></p>
<div class="hex-workspace">
  <section class="hex-main" aria-label="Memory bytes at ${escape(payload.cursorAddress)}">
    <div class="table-wrap hex-grid-wrap" id="hex-wrap">
      <table class="hex-table" role="grid" aria-multiselectable="true" aria-label="Hexadecimal bytes">
        <thead><tr id="hex-cols-head">${colHeaders}</tr></thead>
        <tbody id="hex-body">${renderHexRowsHtml(payload.chunk, payload.cursorAddress, payload.selectionLength)}</tbody>
      </table>
    </div>
  </section>
  <aside class="hex-inspector" id="hex-inspector" aria-label="Data inspector">${renderDataInspectorHtml(payload.initialInspector, payload.cursorAddress, payload.currentBlock, payload.selectionLength, payload.cursorSymbol, payload.endian === 'big' ? 'be' : 'le')}</aside>
</div>
<div class="no-results" hidden><span>No matching rows.</span><button type="button" id="clear-filter" class="icon-button" aria-label="Clear filter" title="Clear filter">${callIcon('close')}</button></div>
${renderMemoryMapHtml(payload.blocks)}
<div class="toolbar selection-tools" role="group" aria-label="Selected item actions" aria-describedby="selection-label" hidden>
  <span id="selection-label"></span>
  <div id="selection-primary" class="selection-buttons"></div>
  <details id="more-actions" class="more-actions" hidden><summary id="more-summary" aria-label="More actions" title="More actions">${callIcon('more')}</summary><div id="selection-more" class="selection-buttons" role="group" aria-label="Additional actions"></div></details>
</div>
</main>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const state = ${stateJson};
const previous = vscode.getState() || {};
const samePage = previous.md5 === state.md5 && previous.kind === 'memory';

let selected = state.selected || '';
let selectionLength = state.selectionLength || 1;
let selectedKind = 'bytes';
let anchorAddress = selected;
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
const moreSummary = document.getElementById('more-summary');
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
  return { space: (m[1] || state.defaultSpace || 'ram').toLowerCase(), offset: BigInt('0x' + m[2]), width: Math.max(m[2].length, 1), canonical: ((m[1] || state.defaultSpace || 'ram') + ':' + BigInt('0x' + m[2]).toString(16).padStart(m[2].length, '0')) };
};
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

const allByteCells = () => [...hexBody.querySelectorAll('.hb[data-address]')];
const allAsciiCells = () => [...hexBody.querySelectorAll('.ha[data-address]')];
const sameAddr = (a, b) => {
  const pa = parseAddr(a), pb = parseAddr(b);
  if (pa && pb) return pa.space === pb.space && pa.offset === pb.offset;
  return String(a || '').toLowerCase() === String(b || '').toLowerCase();
};
const syncRovingTabindex = (preferredAddr = selected) => {
  const cells = allByteCells();
  if (!cells.length) return null;
  const visibleCells = cells.filter(c => !c.closest('tr')?.hidden);
  let target = preferredAddr ? visibleCells.find(c => sameAddr(c.dataset.address, preferredAddr)) : null;
  if (!target) {
    target = visibleCells[0] || (preferredAddr ? cells.find(c => sameAddr(c.dataset.address, preferredAddr)) : null) || cells[0];
  }
  for (const c of cells) {
    c.tabIndex = c === target ? 0 : -1;
  }
  return target;
};

const decodeLocalInspector = (startAddr, len) => {
  const cells = allByteCells();
  const idx = cells.findIndex(c => c.dataset.address?.toLowerCase() === startAddr.toLowerCase());
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
  const mode = toInspectorEndian(state.endian);
  const label = mode === 'be' ? 'Big Endian' : 'Little Endian';
  const head = document.createElement('div'); head.className = 'hex-inspector-head';
  const heading = document.createElement('h2'); heading.textContent = 'Data inspector';
  const pill = document.createElement('button'); pill.type = 'button'; pill.className = 'hex-endian-pill';
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
  });
};
${webviewShortcutScript}

const updateSelectionTools = () => {
  const label = document.getElementById('selection-label');
  const bar = label.closest('.selection-tools');
  const activeHex = hexBody.querySelector('.hb.is-selected') || hexBody.querySelector('tr.selected');
  const activeMap = memoryMap?.querySelector('tr.selected');
  const visible = (!!activeHex && !activeHex.closest('tr')?.hidden && !hexMain.hidden) || (!!activeMap && !activeMap.hidden && memoryMap?.open);
  bar.hidden = !visible;
  document.body.classList.toggle('has-selection', visible);
  if (!visible) return;

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
  const hosts = [document.getElementById('selection-primary'), document.getElementById('selection-more')];
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
  more.hidden = !extra.length;
};

const highlightRange = (startAddr, len = 1, notify = true, scroll = true) => {
  const start = parseAddr(startAddr);
  if (!start) return;
  const clampedLen = Math.max(1, len);
  const endOffset = start.offset + BigInt(clampedLen) - 1n;
  for (const el of document.querySelectorAll('.hb.is-selected,.ha.is-selected,tr.selected')) {
    el.classList.remove('is-selected', 'selected');
  }
  const byteCells = allByteCells();
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
        firstMatchedRow ||= tr;
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
  syncRovingTabindex(startAddr);
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
  syncRovingTabindex(selected);

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

hexBody.addEventListener('click', event => {
  const cell = event.target.closest('.hb[data-address]');
  if (cell) {
    const addr = cell.dataset.address;
    if (event.shiftKey && anchorAddress) {
      const a = parseAddr(anchorAddress), b = parseAddr(addr);
      if (a && b && a.space === b.space) {
        const lo = a.offset <= b.offset ? anchorAddress : addr;
        const len = Number((a.offset <= b.offset ? b.offset - a.offset : a.offset - b.offset) + 1n);
        highlightRange(lo, Math.min(len, 64), true, false);
        syncRovingTabindex(addr);
        cell.focus({ preventScroll: true });
        return;
      }
    }
    anchorAddress = addr;
    highlightRange(addr, 1, true, false);
    cell.focus({ preventScroll: true });
    return;
  }
  const rowHeader = event.target.closest('th.addr');
  const row = rowHeader?.closest('tr.hex-row');
  if (row?.dataset.address) {
    anchorAddress = row.dataset.address;
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
  const cell = event.target.closest('.hb[data-address]');
  const cells = allByteCells().filter(c => !c.closest('tr')?.hidden);
  if (!cells.length) return;
  const curIdx = cell ? cells.indexOf(cell) : cells.findIndex(c => sameAddr(c.dataset.address, selected));
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
        || (event.key === 'ArrowDown' ? rowByteCells[0] : rowByteCells[rowByteCells.length - 1]);
    } else {
      nextCell = event.key === 'ArrowDown' ? cells[cells.length - 1] : cells[0];
    }
  } else if (event.key === 'Home') {
    nextCell = cells[0];
  } else if (event.key === 'End') {
    nextCell = cells[cells.length - 1];
  } else if (event.key === 'Enter' && selected) {
    event.preventDefault();
    vscode.postMessage({ action: 'listing', address: selected, kind: 'bytes' });
    return;
  }
  if (nextCell) {
    event.preventDefault();
    const targetAddr = nextCell.dataset.address;
    anchorAddress = targetAddr;
    highlightRange(targetAddr, 1, true, true);
    nextCell.focus({ preventScroll: true });
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

memoryMap?.querySelector('tbody')?.addEventListener('click', event => {
  const row = event.target.closest('tr[data-address]');
  if (!row) return;
  for (const el of document.querySelectorAll('.hb.is-selected,.ha.is-selected,tr.selected')) el.classList.remove('is-selected', 'selected');
  for (const el of allByteCells()) el.setAttribute('aria-selected', 'false');
  row.classList.add('selected');
  selected = row.dataset.address || '';
  selectedKind = 'block';
  selectionLength = 1;
  syncRovingTabindex('');
  updateSelectionTools();
  persist();
});
memoryMap?.querySelector('tbody')?.addEventListener('dblclick', event => {
  const row = event.target.closest('tr[data-address]');
  if (row?.dataset.address) vscode.postMessage({ action: 'goto', address: row.dataset.address });
});
memoryMap?.addEventListener('toggle', () => { applyFilter(); persist(); });

document.addEventListener('click', event => {
  const btn = event.target.closest('button[data-action]');
  if (btn && !btn.disabled) {
    const act = btn.dataset.action;
    if (['navBack', 'navForward', 'refresh', 'loadBefore', 'loadAfter', 'toggleSync', 'openListingBeside'].includes(act)) {
      vscode.postMessage({ action: act });
    } else if (act === 'copyAddress' && selected) {
      vscode.postMessage({ action: 'copyAddress', address: selected });
    } else if (selected) {
      vscode.postMessage({ action: act, address: selected, kind: selectedKind });
    }
    if (more && more.contains(btn)) { more.open = false; moreSummary.focus({ preventScroll: true }); }
    pageOptions.open = false;
    return;
  }
  if (pageOptions.open && !pageOptions.contains(event.target)) pageOptions.open = false;
  if (more.open && !more.contains(event.target)) more.open = false;
});

document.getElementById('goto').addEventListener('submit', event => {
  event.preventDefault();
  const val = addressInput.value.trim();
  if (val) vscode.postMessage({ action: 'goto', address: val });
});
blockSelect?.addEventListener('change', () => {
  if (blockSelect.value) { pageOptions.open = false; vscode.postMessage({ action: 'goto', address: blockSelect.value, pushHistory: true }); }
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
    if (pageOptions.open) { pageOptions.open = false; pageOptions.querySelector('summary').focus(); return; }
    if (more.open) { more.open = false; moreSummary.focus(); return; }
    if (search.value) { search.value = ''; applyFilter(); persist(); return; }
  }
  if (event.key === '/' && canUseSingleKeyShortcut(event)) { event.preventDefault(); search.focus(); search.select(); }
  else if ((event.key || '').toLowerCase() === 'g' && canUseSingleKeyShortcut(event)) { event.preventDefault(); addressInput.focus(); addressInput.select(); }
});

window.addEventListener('message', event => {
  const msg = event.data || {};
  if (msg.action === 'highlight') {
    highlightRange(msg.address, msg.length || 1, false, true);
  } else if (msg.action === 'syncState') {
    state.syncEnabled = !!msg.syncEnabled;
    syncToggle.setAttribute('aria-pressed', String(state.syncEnabled));
  } else if (msg.action === 'inspectorData' && Array.isArray(msg.entries)) {
    const addr = msg.address || selected;
    if (addr === selected) {
      const len = msg.length || selectionLength || 1;
      const block = findBlockFor(addr);
      const metaText = block ? shortAddr(addr) + ' · ' + block.name + ' (' + (block.read ? 'R' : '−') + (block.write ? 'W' : '−') + (block.execute ? 'X' : '−') + ')' + (len > 1 ? ' · ' + len + ' bytes selected' : '') : shortAddr(addr);
      applyInspector(addr, metaText, msg.entries);
    }
  } else if (msg.action === 'chunkData') {
    const prevActive = document.activeElement;
    const focusWasInGrid = !!prevActive && hexBody.contains(prevActive);
    const hadFocusedElement = !!prevActive && prevActive !== document.body && prevActive !== document.documentElement;
    const nextSelected = msg.selectedAddress || selected;
    state.address = msg.chunkStart;
    hexBody.innerHTML = msg.rowsHtml;
    if (msg.colsHtml) document.getElementById('hex-cols-head').innerHTML = msg.colsHtml;
    if (typeof msg.canBack === 'boolean') document.querySelector('[data-action="navBack"]').disabled = !msg.canBack;
    if (typeof msg.canForward === 'boolean') document.querySelector('[data-action="navForward"]').disabled = !msg.canForward;
    if (pvStep) pvStep.hidden = !msg.hasMoreBefore && !msg.hasMoreAfter;
    pagerBefore.disabled = !msg.hasMoreBefore;
    pagerAfter.disabled = !msg.hasMoreAfter;
    if (msg.scopeNote) scopeNote.textContent = msg.scopeNote;
    if (blockSelect && msg.currentBlockStart) blockSelect.value = msg.currentBlockStart;
    if (msg.sectionLabel) hexMain.setAttribute('aria-label', msg.sectionLabel);
    applyFilter();
    highlightRange(nextSelected, msg.length || 1, false, true);
    if (focusWasInGrid || (hadFocusedElement && (!document.activeElement || document.activeElement === document.body))) {
      syncRovingTabindex(nextSelected)?.focus({ preventScroll: true });
    }
  }
});

applyFilter();
highlightRange(selected, selectionLength, false, !samePage);
requestAnimationFrame(() => {
  persist();
  document.body.dataset.viewReady = 'true';
});
</script></body></html>`;
}
