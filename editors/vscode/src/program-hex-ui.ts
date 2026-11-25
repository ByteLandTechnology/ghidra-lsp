// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

/**
 * HTML and client script renderer for the Memory and Bytes webview.
 */
import { randomBytes } from 'node:crypto';
import { MemoryBlockInfo, parseAddress, permissionsLabel } from './address-math';
import { callIcon } from './call-graph-icons';
import { DataInspectorEntry, HexChunk, ProgramEndian } from './hex-model';
import { iconFontStyles } from './icon-font';
import { displayAddress } from './names';
import { pageStyles } from './page-styles';
import { renderProgramHexScript } from './program-hex-script';
import { addrSpan, programViewStyles } from './program-views-styles';
import { browserLiveRegions, moreActionsPopover, pageOptionsPopover, viewStyles } from './view-ui';
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
    focusId?: string;
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
    const headHtml = `<div class="hex-inspector-head"><h2>Data inspector</h2><button type="button" id="hex-endian-toggle" class="hex-endian-pill" data-toggle-endian data-endian="${endian}" aria-pressed="${endian === 'be'}" aria-label="${endianLabel}, toggle byte order" title="Switch byte order">${endianLabel}</button></div>`;

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
        ...(payload.focusId ? { focusId: payload.focusId } : {}),
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
    <button type="button" id="nav-back" class="icon-button" data-action="navBack" aria-label="Back" title="Back (Alt+Left)"${payload.canBack ? '' : ' disabled'}>${callIcon('back')}</button>
    <button type="button" id="nav-forward" class="icon-button" data-action="navForward" aria-label="Forward" title="Forward (Alt+Right)"${payload.canForward ? '' : ' disabled'}>${callIcon('forward')}</button>
    <span class="pv-step" id="pv-step"${payload.hasMoreBefore || payload.hasMoreAfter ? '' : ' hidden'}><span class="pv-divider" aria-hidden="true"></span><button type="button" id="pager-before" class="icon-button" data-action="loadBefore" aria-label="Previous window" title="Previous window"${payload.hasMoreBefore ? '' : ' disabled'}>${callIcon('up')}</button><button type="button" id="pager-after" class="icon-button" data-action="loadAfter" aria-label="Next window" title="Next window"${payload.hasMoreAfter ? '' : ' disabled'}>${callIcon('down')}</button></span>
  </div>
  <form id="goto"><input id="address" aria-label="Address" value="${escape(displayAddress(payload.cursorAddress))}" placeholder="Address or +offset…"><button type="submit" id="goto-submit" aria-label="Go to address" title="Go to address">${callIcon('right')}</button></form>
  <div class="browser-search">${callIcon('search')}<input class="search" id="search" aria-label="Filter displayed rows" placeholder="Filter hex, ASCII, or block…"></div>
  <div class="pv-tools" role="group" aria-label="Hex tools">
    <button type="button" id="sync-toggle" class="icon-button" data-action="toggleSync" aria-pressed="${payload.syncEnabled}" aria-label="Sync cursor with other Ghidra views" title="Sync cursor with other Ghidra views">${callIcon('link')}</button>
    <button type="button" id="open-listing-beside" class="icon-button" data-action="openListingBeside" aria-label="Open Program Listing beside" title="Open Program Listing beside">${callIcon('listing')}</button>
    ${pageOptionsPopover(`${blockOptions ? `<label class="pv-option-row">Memory block<select id="block-select" aria-label="Memory block">${blockOptions}</select></label>` : ''}<label class="pv-option-row">Byte order<select id="hex-endian" aria-label="Byte order"><option value="little"${payload.endian === 'little' ? ' selected' : ''}>Little-endian</option><option value="big"${payload.endian === 'big' ? ' selected' : ''}>Big-endian</option></select></label><label class="pv-option-row">Bytes per row<select id="hex-row-width" aria-label="Bytes per row"><option value="16"${payload.bytesPerRow === 16 ? ' selected' : ''}>16 bytes</option><option value="8"${payload.bytesPerRow === 8 ? ' selected' : ''}>8 bytes</option></select></label><label><input id="hex-show-inspector" type="checkbox" checked>Show Data Inspector</label><p id="hex-scope-note">${escape(scopeText)}</p>`)}
  </div>
</div>
${browserLiveRegions}
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
  ${moreActionsPopover()}
</div>
</main>
<script nonce="${nonce}">
${renderProgramHexScript(stateJson)}
</script></body></html>`;
}
