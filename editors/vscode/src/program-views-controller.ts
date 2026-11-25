// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

/**
 * Controller for full Ghidra GUI-style Program Listing and Hex (Memory & bytes) webviews.
 * Handles bounded windowed queries, metadata caching, Go To resolution, navigation history,
 * memory-block stepping, Data Inspector updates, and opt-in bidirectional cursor sync.
 */
import * as vscode from 'vscode';
import {
    MemoryBlockInfo,
    addAddressOffset,
    addressInRange,
    clampAddress,
    compareAddresses,
    findMemoryBlock,
    parseAddress,
    parseMemoryBlocks,
    permissionsLabel,
    sameAddress,
} from './address-math';
import {
    DataInspectorEntry,
    HexChunk,
    ProgramEndian,
    stepChunkAddress,
} from './hex-model';
import {
    ListingWindowModel,
    findUnitContainingAddress,
} from './listing-model';
import { Call } from './memory';
import { displayAddress, SymbolName } from './names';
import {
    HexViewPayload,
    renderHexColHeadersHtml,
    renderHexRowsHtml,
    renderProgramHexPage,
} from './program-hex-ui';
import {
    ListingViewPayload,
    renderListingRowsHtml,
    renderProgramListingPage,
} from './program-listing-ui';
import { Data, object, rows, stringOf } from './web';

/** Host callbacks required by {@link ProgramViewsController} to integrate with the workbench. */
export interface ProgramViewHost {
    readonly context: {
        name: (md5: string) => string;
        titled: (title: string, md5: string) => string;
    };
    readonly call: Call;
    readonly reveal: (md5: string, address: string, preserveFocus: boolean) => Promise<void>;
    readonly navigate: (md5: string, address: string, requireFunction?: boolean) => Promise<void>;
    readonly openBeside: (kind: 'listing' | 'memory', md5: string, address: string) => Promise<void>;
    readonly openWorkbench: (kind: 'references' | 'callGraph' | 'controlFlow', md5: string, address: string) => Promise<void>;
    readonly getPanels: () => Iterable<ProgramPanelState>;
}

/** Cached program-level metadata used across Program Listing and Hex panels. */
export interface ProgramMetadata {
    programName: string;
    endian: ProgramEndian;
    addressSizeBits: number;
    defaultSpace: string;
    addressWidth: number;
    blocks: MemoryBlockInfo[];
    defaultAddress?: string;
    demangledFunctions: Map<string, SymbolName>;
}

/** Saved navigation location in a Listing or Hex panel history stack. */
export interface HistoryPoint {
    address: string;
    blockStart?: string;
}

/** Extended panel state shared between {@link Workbench} and {@link ProgramViewsController}. */
export interface ProgramPanelState {
    kind: string;
    md5: string;
    address?: string;
    cursor?: string;
    selected?: string;
    displayAddress?: string;
    panel: vscode.WebviewPanel;
    // Extended full-view state
    syncEnabled?: boolean;
    pvHistory?: HistoryPoint[];
    pvFuture?: HistoryPoint[];
    pvWindowStart?: string;
    pvWindowEnd?: string;
    pvFirstCursor?: string;
    pvLastCursor?: string;
    pvNextCursor?: string;
    pvPrevStarts?: string[];
    pvHasMoreAfter?: boolean;
    pvListingWindow?: ListingWindowModel;
    pvChunk?: HexChunk;
    pvBytesPerRow?: 8 | 16;
    pvEndian?: ProgramEndian;
    pvSelectionLength?: number;
}

/** Maximum number of code units fetched per graphical Listing page. */
const LISTING_PAGE_LIMIT = 140;
/** Byte window size per graphical Hex chunk (64 rows by 16 bytes). */
const HEX_CHUNK_BYTES = 1024; // 64 rows × 16B; responsive and bounded per read

/** Normalize an address string to lowercase `space:hex` for cache keys. */
function canonKey(address: string): string {
    const parsed = parseAddress(address);
    return parsed ? `${parsed.space.toLowerCase()}:${parsed.offset.toString(16)}` : address.toLowerCase();
}

/** Return true if single-key webview shortcuts are active in extension settings. */
export function singleKeyShortcutsEnabled(): boolean {
    return vscode.workspace.getConfiguration('ghidraLsp').get<boolean>('views.singleKeyShortcuts', true) !== false;
}

/** Manages windowed Program Listing and Memory Hex panels and bidirectional cursor sync. */
export class ProgramViewsController {
    /** Cached program metadata keyed by MD5. */
    private readonly metadataCache = new Map<string, ProgramMetadata>();
    /** Re-entrancy guard preventing selection-sync echo loops between peer panels. */
    private syncFromSelf = false;

    /** Construct a controller wired to the owning {@link ProgramViewHost}. */
    constructor(private readonly host: ProgramViewHost) {}

    /** Evict cached program metadata for `md5` after analysis mutations. */
    invalidate(md5: string): void {
        this.metadataCache.delete(md5);
    }

    /** Return whether cursor sync is enabled by default in extension settings. */
    defaultSyncEnabled(): boolean {
        return vscode.workspace.getConfiguration('ghidraLsp').get<boolean>('views.syncCursor', true) !== false;
    }

    /** Return true if single-key webview shortcuts are active in extension settings. */
    singleKeyShortcutsEnabled(): boolean {
        return singleKeyShortcutsEnabled();
    }

    /** Fetch or return cached {@link ProgramMetadata} for `md5`. */
    async getMetadata(md5: string): Promise<ProgramMetadata> {
        const cached = this.metadataCache.get(md5);
        if (cached) { return cached; }

        const res = await this.host.call<Data>('ghidra.programMeta', { md5 });
        const blocks = parseMemoryBlocks(rows(res.blocks));
        const addressSizeBits = Number(res.addressSizeBits) || 64;
        const endian: ProgramEndian = stringOf(res.endian).toLowerCase() === 'big' ? 'big' : 'little';
        const defaultSpace = stringOf(res.defaultSpace) || parseAddress(blocks[0]?.start || '')?.space || 'ram';
        const addressWidth = Number(res.addressWidth) || Math.max(8, Math.ceil(addressSizeBits / 4));

        const demangledFunctions = new Map<string, SymbolName>();
        for (const fn of rows(res.functions)) {
            const entry = stringOf(fn.entry);
            if (entry) {
                demangledFunctions.set(canonKey(entry), fn as SymbolName);
            }
        }

        const meta: ProgramMetadata = {
            programName: stringOf(res.programName) || this.host.context.name(md5),
            endian,
            addressSizeBits,
            defaultSpace,
            addressWidth,
            blocks,
            defaultAddress: stringOf(res.defaultAddress) || undefined,
            demangledFunctions,
        };
        this.metadataCache.set(md5, meta);
        return meta;
    }

    /** Pick an initial executable or initialized address when opening a blank view. */
    async pickDefaultAddress(md5: string): Promise<string | undefined> {
        const meta = await this.getMetadata(md5);
        if (meta.defaultAddress) { return meta.defaultAddress; }
        const preferred =
            meta.blocks.find(b => b.initialized && b.execute && !b.overlay && /^\.?text$/i.test(b.name))
            || meta.blocks.find(b => b.initialized && b.execute && !b.overlay)
            || meta.blocks.find(b => b.initialized && b.read && !b.overlay)
            || meta.blocks.find(b => b.initialized)
            || meta.blocks[0];
        if (preferred?.start) { return preferred.start; }
        return meta.demangledFunctions.keys().next().value;
    }

    /** Resolve a user-entered address or symbol name to a canonical program address. */
    async resolveTarget(md5: string, rawInput: string, currentAddress?: string): Promise<string> {
        const input = rawInput.trim();
        if (!input) {
            return currentAddress || (await this.pickDefaultAddress(md5)) || '';
        }
        const res = await this.host.call<Data>('ghidra.resolveTarget', {
            md5,
            input,
            ...(currentAddress ? { currentAddress } : {}),
        });
        const address = stringOf(res.address);
        if (!address) {
            throw new Error(`Address or symbol "${input}" not found in program memory`);
        }
        return address;
    }

    /** Fetch and render a full HTML page or incremental row update for a Listing panel. */
    async renderListing(state: ProgramPanelState, mode: 'full' | 'partial' = 'full', direction?: 'before' | 'after'): Promise<void> {
        const meta = await this.getMetadata(state.md5);
        if (state.syncEnabled === undefined) { state.syncEnabled = this.defaultSyncEnabled(); }
        if (!state.address) {
            state.address = (await this.pickDefaultAddress(state.md5)) || '';
        }

        let startAddress = state.address;
        let cursorToUse = state.cursor;
        let anchorAddress: string | undefined;

        if (direction === 'after') {
            const prevStart = state.pvWindowStart || state.address;
            if (prevStart) {
                state.pvPrevStarts = [...(state.pvPrevStarts || []), prevStart].slice(-50);
            }
            if (state.pvNextCursor) {
                cursorToUse = state.pvNextCursor;
                startAddress = state.pvWindowEnd ? (addAddressOffset(state.pvWindowEnd, 1n) || state.address) : state.address;
                anchorAddress = state.pvWindowEnd;
            } else {
                cursorToUse = undefined;
                const currentEnd = state.pvWindowEnd || state.address;
                const block = findMemoryBlock(meta.blocks, currentEnd);
                if (block && compareAddresses(currentEnd, block.end) < 0) {
                    startAddress = addAddressOffset(currentEnd, 1n) || currentEnd;
                } else if (block) {
                    const idx = meta.blocks.indexOf(block);
                    if (idx >= 0 && idx + 1 < meta.blocks.length) {
                        startAddress = meta.blocks[idx + 1]!.start;
                    }
                }
                anchorAddress = currentEnd;
            }
        } else if (direction === 'before') {
            cursorToUse = undefined;
            const currentStart = state.pvWindowStart || state.address;
            anchorAddress = currentStart;
            if (state.pvPrevStarts?.length) {
                startAddress = state.pvPrevStarts.pop()!;
            } else {
                const block = findMemoryBlock(meta.blocks, currentStart);
                if (block && !sameAddress(currentStart, block.start)) {
                    const stepped = addAddressOffset(currentStart, -256n) || block.start;
                    startAddress = clampAddress(stepped, block.start, block.end) || block.start;
                } else {
                    const idx = block ? meta.blocks.indexOf(block) : -1;
                    const prevBlock = idx > 0 ? meta.blocks[idx - 1] : undefined;
                    if (prevBlock) {
                        const nearEnd = addAddressOffset(prevBlock.end, -256n) || prevBlock.start;
                        startAddress = clampAddress(nearEnd, prevBlock.start, prevBlock.end) || prevBlock.start;
                    }
                }
            }
        }

        const exactStart = Boolean(direction || state.pvWindowStart);
        if (!direction && state.pvWindowStart) {
            startAddress = state.pvWindowStart;
        }

        const res = await this.host.call<Data>('ghidra.listingWindow', {
            md5: state.md5,
            ...(startAddress ? { address: startAddress } : {}),
            ...(cursorToUse ? { cursor: cursorToUse } : {}),
            limit: LISTING_PAGE_LIMIT,
            ...(exactStart ? { exactStart: true } : {}),
        });

        const blocks = res.blocks ? parseMemoryBlocks(rows(res.blocks)) : meta.blocks;
        const parsedBlock = res.block && typeof res.block === 'object' ? parseMemoryBlocks([object(res.block)])[0] : undefined;
        const windowModel: ListingWindowModel = {
            startAddress: stringOf(res.startAddress),
            endAddress: stringOf(res.endAddress),
            block: parsedBlock || findMemoryBlock(blocks, stringOf(res.startAddress)),
            units: (Array.isArray(res.units) ? res.units : []) as ListingWindowModel['units'],
            collapsedItems: (Array.isArray(res.collapsedItems) ? res.collapsedItems : []) as ListingWindowModel['collapsedItems'],
        };

        state.pvListingWindow = windowModel;
        if (direction === 'after' || direction === 'before') {
            state.address = windowModel.startAddress || startAddress;
        }
        state.pvWindowStart = windowModel.startAddress || state.address;
        state.pvWindowEnd = windowModel.endAddress || state.address;
        state.displayAddress = windowModel.startAddress || state.address;
        state.pvNextCursor = stringOf(res.nextCursor) || undefined;
        state.pvHasMoreAfter = typeof res.hasMoreAfter === 'boolean'
            ? res.hasMoreAfter
            : Boolean(state.pvNextCursor || (windowModel.block && compareAddresses(windowModel.endAddress, windowModel.block.end) < 0));

        const firstBlockStart = blocks[0]?.start;
        const hasMoreBefore = Boolean(windowModel.startAddress && firstBlockStart && compareAddresses(windowModel.startAddress, firstBlockStart) > 0);

        const matchedUnit = state.selected ? findUnitContainingAddress(windowModel.units, state.selected) : undefined;
        const selectedAddr = matchedUnit?.address
            || findUnitContainingAddress(windowModel.units, state.address)?.address
            || windowModel.startAddress
            || state.address;
        state.selected = selectedAddr;

        const blockLabel = windowModel.block
            ? `${windowModel.block.name} (${permissionsLabel(windowModel.block)})`
            : displayAddress(state.address);
        const totalUnitsLabel = `${windowModel.units.length} code units · ${blockLabel}`;

        if (mode === 'partial') {
            await state.panel.webview.postMessage({
                action: 'windowData',
                rowsHtml: renderListingRowsHtml(windowModel.collapsedItems, selectedAddr),
                selectedAddress: selectedAddr,
                windowStart: state.pvWindowStart,
                windowEnd: state.pvWindowEnd,
                canBack: (state.pvHistory?.length || 0) > 0,
                canForward: (state.pvFuture?.length || 0) > 0,
                hasMoreBefore,
                hasMoreAfter: Boolean(state.pvHasMoreAfter),
                scopeNote: totalUnitsLabel,
                currentBlockStart: windowModel.block?.start || '',
                anchorAddress,
                scrollToSelected: !direction,
            });
            return;
        }

        const payload: ListingViewPayload = {
            md5: state.md5,
            programName: stringOf(res.programName) || meta.programName,
            title: 'Listing',
            blocks,
            currentBlock: windowModel.block?.name,
            cursorAddress: state.address,
            selectedAddress: selectedAddr,
            window: windowModel,
            hasMoreBefore,
            hasMoreAfter: Boolean(state.pvHasMoreAfter),
            canBack: (state.pvHistory?.length || 0) > 0,
            canForward: (state.pvFuture?.length || 0) > 0,
            syncEnabled: Boolean(state.syncEnabled),
            singleKeyShortcuts: this.singleKeyShortcutsEnabled(),
            totalUnitsLabel,
        };
        state.panel.webview.html = renderProgramListingPage(payload);
    }

    /** Fetch and render a full HTML page or incremental chunk update for a Memory Hex panel. */
    async renderHex(state: ProgramPanelState, mode: 'full' | 'partial' = 'full'): Promise<void> {
        const meta = await this.getMetadata(state.md5);
        if (state.syncEnabled === undefined) { state.syncEnabled = this.defaultSyncEnabled(); }
        if (!state.address) {
            state.address = (await this.pickDefaultAddress(state.md5)) || meta.blocks[0]?.start || '';
        }

        const bytesPerRow = state.pvBytesPerRow || 16;
        const endian = state.pvEndian || meta.endian;
        state.pvBytesPerRow = bytesPerRow;
        state.pvEndian = endian;

        const selectionLength = Math.max(1, state.pvSelectionLength || 1);
        const res = await this.host.call<Data>('ghidra.memoryWindow', {
            md5: state.md5,
            ...(state.address ? { address: state.address } : {}),
            length: HEX_CHUNK_BYTES,
            bytesPerRow,
            endian,
            ...(state.selected ? { inspectAddress: state.selected } : {}),
            selectionLength,
        });

        const blocks = res.blocks ? parseMemoryBlocks(rows(res.blocks)) : meta.blocks;
        const rawChunk = object(res.chunk);
        const chunkBlock = (rawChunk.block && typeof rawChunk.block === 'object'
            ? parseMemoryBlocks([object(rawChunk.block)])[0]
            : undefined)
            || findMemoryBlock(blocks, stringOf(rawChunk.start) || state.address)
            || blocks[0];
        if (!chunkBlock) {
            throw new Error('Program has no memory blocks.');
        }
        const chunk: HexChunk = {
            block: chunkBlock,
            rowStart: stringOf(rawChunk.rowStart),
            start: stringOf(rawChunk.start),
            end: stringOf(rawChunk.end),
            byteLength: Number(rawChunk.byteLength) || 0,
            bytesPerRow: Number(rawChunk.bytesPerRow) === 8 ? 8 : 16,
            rows: (Array.isArray(rawChunk.rows) ? rawChunk.rows : []) as HexChunk['rows'],
        };
        state.pvChunk = chunk;

        const selectedAddr = stringOf(res.selectedAddress) || chunk.start;
        state.selected = selectedAddr;
        const finalSelectionLength = Math.max(1, Number(res.selectionLength) || selectionLength);
        const hasMoreBefore = Boolean(res.hasPrev);
        const hasMoreAfter = Boolean(res.hasNext);
        const scopeText = `${chunkBlock.name} · ${displayAddress(chunk.start)}–${displayAddress(chunk.end)} (${chunk.byteLength} bytes)`;
        const inspectorEntries = (Array.isArray(res.inspector) ? res.inspector : []) as DataInspectorEntry[];
        let cursorSymbol: string | undefined;
        for (const row of chunk.rows) {
            const cell = row.cells.find(c => c.address && sameAddress(c.address, selectedAddr) && c.symbol);
            if (cell?.symbol) { cursorSymbol = cell.symbol; break; }
        }

        if (mode === 'partial') {
            await state.panel.webview.postMessage({
                action: 'chunkData',
                chunkStart: chunk.start,
                rowsHtml: renderHexRowsHtml(chunk, selectedAddr, finalSelectionLength),
                colsHtml: renderHexColHeadersHtml(bytesPerRow),
                selectedAddress: selectedAddr,
                length: finalSelectionLength,
                canBack: (state.pvHistory?.length || 0) > 0,
                canForward: (state.pvFuture?.length || 0) > 0,
                hasMoreBefore,
                hasMoreAfter,
                scopeNote: scopeText,
                currentBlockStart: chunkBlock.start,
                sectionLabel: `Memory bytes at ${selectedAddr}`,
            });
            await state.panel.webview.postMessage({
                action: 'inspectorData',
                address: selectedAddr,
                length: finalSelectionLength,
                entries: inspectorEntries,
            });
            return;
        }

        const payload: HexViewPayload = {
            md5: state.md5,
            programName: stringOf(res.programName) || meta.programName,
            title: 'Memory & bytes',
            endian: stringOf(res.endian).toLowerCase() === 'big' ? 'big' : 'little',
            addressSizeBits: Number(res.addressSizeBits) || meta.addressSizeBits,
            defaultSpace: stringOf(res.defaultSpace) || meta.defaultSpace,
            addressWidth: Number(res.addressWidth) || meta.addressWidth,
            blocks,
            currentBlock: chunkBlock,
            cursorAddress: selectedAddr,
            selectionLength: finalSelectionLength,
            cursorSymbol,
            chunk,
            hasMoreBefore,
            hasMoreAfter,
            canBack: (state.pvHistory?.length || 0) > 0,
            canForward: (state.pvFuture?.length || 0) > 0,
            syncEnabled: Boolean(state.syncEnabled),
            singleKeyShortcuts: this.singleKeyShortcutsEnabled(),
            bytesPerRow,
            initialInspector: inspectorEntries,
        };
        state.panel.webview.html = renderProgramHexPage(payload);
    }

    /** Recompute and push live Data Inspector values for the currently selected byte. */
    private async updateInspector(state: ProgramPanelState): Promise<void> {
        if (state.kind !== 'memory' || !state.pvChunk || !state.selected) { return; }
        const meta = await this.getMetadata(state.md5);
        const cursorBytes = this.collectBytesFromChunk(state.pvChunk, state.selected, 8);
        const endian = state.pvEndian || meta.endian;
        const res = await this.host.call<{ entries?: DataInspectorEntry[] }>('ghidra.inspectBytes', {
            md5: state.md5,
            bytes: cursorBytes,
            endian,
            addressSizeBits: meta.addressSizeBits,
            defaultSpace: meta.defaultSpace,
            addressWidth: meta.addressWidth,
        });
        await state.panel.webview.postMessage({
            action: 'inspectorData',
            address: state.selected,
            length: Math.max(1, state.pvSelectionLength || 1),
            entries: Array.isArray(res.entries) ? res.entries : [],
        });
    }

    /** Extract up to `maxLen` consecutive bytes starting at `startAddr` from `chunk`. */
    private collectBytesFromChunk(chunk: HexChunk, startAddr: string, maxLen: number): (number | null)[] {
        const start = parseAddress(startAddr);
        if (!start) { return []; }
        const result: (number | null)[] = [];
        const flat = new Map<string, number | null>();
        for (const row of chunk.rows) {
            for (const cell of row.cells) {
                if (cell.inBlock && cell.address) {
                    flat.set(canonKey(cell.address), cell.value);
                }
            }
        }
        for (let i = 0; i < maxLen; i++) {
            const addr = addAddressOffset(startAddr, BigInt(i));
            if (!addr) { break; }
            const val = flat.get(canonKey(addr));
            if (val === undefined) { break; }
            if (val === null) {
                if (i === 0) { result.push(null); }
                break;
            }
            result.push(val);
        }
        return result;
    }

    /** Record the previous address in the panel history stack before jumping to `target`. */
    private pushHistory(state: ProgramPanelState, target: string): void {
        const current = state.selected || state.address;
        if (current && !sameAddress(current, target)) {
            state.pvHistory = [...(state.pvHistory || []), { address: current }].slice(-50);
            state.pvFuture = [];
        }
    }

    /** Resolve `rawTarget`, update panel state, and optionally record navigation history. */
    async prepareNavigation(state: ProgramPanelState, rawTarget: string, pushHistory = true): Promise<string> {
        const current = state.selected || state.address;
        const resolved = await this.resolveTarget(state.md5, rawTarget, current);
        if (pushHistory) { this.pushHistory(state, resolved); }
        state.address = resolved;
        state.selected = resolved;
        state.pvSelectionLength = 1;
        state.cursor = undefined;
        state.pvWindowStart = undefined;
        state.pvPrevStarts = [];
        return resolved;
    }

    /** Navigate a Listing or Hex panel to `rawTarget` and synchronize peer panels. */
    async navigateTo(state: ProgramPanelState, rawTarget: string, pushHistory = true): Promise<void> {
        const resolved = await this.prepareNavigation(state, rawTarget, pushHistory);

        if (state.kind === 'listing') {
            await this.renderListing(state, state.pvListingWindow ? 'partial' : 'full');
        } else if (state.kind === 'memory') {
            if (state.pvChunk && addressInRange(resolved, state.pvChunk.start, state.pvChunk.end)) {
                state.selected = resolved;
                await state.panel.webview.postMessage({ action: 'highlight', address: resolved, length: 1 });
            } else {
                await this.renderHex(state, state.pvChunk ? 'partial' : 'full');
            }
        }
        await this.broadcastCursorSync(state, resolved, 1);
    }

    /** Handle interactive webview messages for Listing and Memory Hex panels. */
    async handleMessage(state: ProgramPanelState, message: Data): Promise<boolean> {
        if (state.kind !== 'listing' && state.kind !== 'memory') {
            return false;
        }
        const action = stringOf(message.action);
        const address = stringOf(message.address);

        if (action === 'toggleSync') {
            state.syncEnabled = !(state.syncEnabled ?? this.defaultSyncEnabled());
            await state.panel.webview.postMessage({ action: 'syncState', syncEnabled: state.syncEnabled });
            return true;
        }
        if (action === 'copyAddress' && address) {
            await vscode.env.clipboard.writeText(address);
            vscode.window.setStatusBarMessage(`Copied ${displayAddress(address)}`, 3000);
            return true;
        }
        if (action === 'refresh') {
            this.invalidate(state.md5);
            if (state.kind === 'listing') {
                await this.renderListing(state, 'full');
            } else {
                await this.renderHex(state, 'full');
            }
            return true;
        }
        if (action === 'navBack') {
            const prev = state.pvHistory?.pop();
            if (!prev) { return true; }
            const cur = state.selected || state.address;
            if (cur) { state.pvFuture = [...(state.pvFuture || []), { address: cur }].slice(-50); }
            state.address = prev.address;
            state.selected = prev.address;
            state.pvSelectionLength = 1;
            state.cursor = undefined;
            state.pvWindowStart = undefined;
            state.pvPrevStarts = [];
            if (state.kind === 'listing') { await this.renderListing(state, 'partial'); }
            else { await this.renderHex(state, 'partial'); }
            await this.broadcastCursorSync(state, prev.address, 1);
            return true;
        }
        if (action === 'navForward') {
            const next = state.pvFuture?.pop();
            if (!next) { return true; }
            const cur = state.selected || state.address;
            if (cur) { state.pvHistory = [...(state.pvHistory || []), { address: cur }].slice(-50); }
            state.address = next.address;
            state.selected = next.address;
            state.pvSelectionLength = 1;
            state.cursor = undefined;
            state.pvWindowStart = undefined;
            state.pvPrevStarts = [];
            if (state.kind === 'listing') { await this.renderListing(state, 'partial'); }
            else { await this.renderHex(state, 'partial'); }
            await this.broadcastCursorSync(state, next.address, 1);
            return true;
        }
        if (action === 'loadBefore') {
            if (state.kind === 'listing') {
                await this.renderListing(state, 'partial', 'before');
            } else if (state.pvChunk) {
                const meta = await this.getMetadata(state.md5);
                const prevStart = stepChunkAddress(meta.blocks, state.pvChunk.start, HEX_CHUNK_BYTES, -1);
                if (prevStart) {
                    state.address = prevStart;
                    state.selected = prevStart;
                    state.pvSelectionLength = 1;
                    await this.renderHex(state, 'partial');
                }
            }
            return true;
        }
        if (action === 'loadAfter') {
            if (state.kind === 'listing') {
                await this.renderListing(state, 'partial', 'after');
            } else if (state.pvChunk) {
                const meta = await this.getMetadata(state.md5);
                const nextStart = stepChunkAddress(meta.blocks, state.pvChunk.start, HEX_CHUNK_BYTES, 1);
                if (nextStart) {
                    state.address = nextStart;
                    state.selected = nextStart;
                    state.pvSelectionLength = 1;
                    await this.renderHex(state, 'partial');
                }
            }
            return true;
        }
        if (action === 'goto' && address) {
            const push = message.pushHistory !== false;
            await this.navigateTo(state, address, push);
            return true;
        }
        if (action === 'setHexOptions' && state.kind === 'memory') {
            let endianChanged = false;
            if ((message.endian === 'big' || message.endian === 'little') && message.endian !== state.pvEndian) {
                state.pvEndian = message.endian;
                endianChanged = true;
            }
            if ((Number(message.bytesPerRow) === 8 || Number(message.bytesPerRow) === 16) && Number(message.bytesPerRow) !== state.pvBytesPerRow) {
                state.pvBytesPerRow = Number(message.bytesPerRow) as 8 | 16;
                await this.renderHex(state, 'partial');
            } else if (endianChanged) {
                await this.updateInspector(state);
            }
            return true;
        }
        if (action === 'select' && state.kind === 'listing' && address) {
            state.selected = address;
            const len = Math.max(1, Number(message.byteLength) || 1);
            await this.broadcastCursorSync(state, address, len);
            if (message.kind === 'instruction') {
                await this.host.reveal(state.md5, address, true);
            }
            return true;
        }
        if (action === 'selectByte' && state.kind === 'memory' && address) {
            state.selected = address;
            state.pvSelectionLength = Math.max(1, Number(message.length) || 1);
            await this.broadcastCursorSync(state, address, state.pvSelectionLength);
            await this.updateInspector(state);
            return true;
        }
        if (action === 'openHexBeside') {
            await this.host.openBeside('memory', state.md5, state.selected || state.address || '');
            return true;
        }
        if (action === 'openListingBeside') {
            await this.host.openBeside('listing', state.md5, state.selected || state.address || '');
            return true;
        }
        if (action === 'memory' && state.kind === 'listing' && address) {
            await this.host.openBeside('memory', state.md5, address);
            return true;
        }
        if (action === 'listing' && state.kind === 'memory' && address) {
            await this.host.openBeside('listing', state.md5, address);
            return true;
        }
        if (action === 'decompile' && (stringOf(message.entry) || address)) {
            await this.host.navigate(state.md5, stringOf(message.entry) || address, Boolean(stringOf(message.entry) || message.kind === 'instruction'));
            return true;
        }
        if (['references', 'callGraph', 'controlFlow'].includes(action) && (stringOf(message.entry) || address)) {
            await this.host.openWorkbench(action as 'references' | 'callGraph' | 'controlFlow', state.md5, stringOf(message.entry) || address);
            return true;
        }
        return false;
    }

    /** Push selection/highlight from an active Listing or Hex panel to visible peer panels. */
    async broadcastCursorSync(source: ProgramPanelState, address: string, byteLength = 1): Promise<void> {
        if (this.syncFromSelf || !source.syncEnabled || !address) { return; }
        this.syncFromSelf = true;
        try {
            for (const peer of this.host.getPanels()) {
                if (peer === source || peer.md5 !== source.md5 || !peer.panel.visible || peer.syncEnabled === false) {
                    continue;
                }
                if (peer.kind === 'memory') {
                    peer.pvSelectionLength = byteLength;
                    if (peer.pvChunk && addressInRange(address, peer.pvChunk.start, peer.pvChunk.end)) {
                        peer.selected = address;
                        await peer.panel.webview.postMessage({ action: 'highlight', address, length: byteLength });
                    } else {
                        peer.address = address;
                        peer.selected = address;
                        await this.renderHex(peer, peer.pvChunk ? 'partial' : 'full');
                    }
                } else if (peer.kind === 'listing') {
                    const unit = peer.pvListingWindow ? findUnitContainingAddress(peer.pvListingWindow.units, address) : undefined;
                    if (unit) {
                        peer.selected = unit.address;
                        await peer.panel.webview.postMessage({ action: 'highlight', address: unit.address });
                    } else {
                        peer.address = address;
                        peer.selected = address;
                        peer.cursor = undefined;
                        await this.renderListing(peer, peer.pvListingWindow ? 'partial' : 'full');
                    }
                } else if (peer.kind === 'controlFlow') {
                    await peer.panel.webview.postMessage({ action: 'highlight', address });
                }
            }
            if (source.kind === 'memory') {
                await this.host.reveal(source.md5, address, true);
            }
        } finally {
            this.syncFromSelf = false;
        }
    }

    /** Sync active decompiler or companion view cursor into visible Listing / Hex panels. */
    async syncFromCodeAddress(md5: string, address: string): Promise<void> {
        if (this.syncFromSelf || !address) { return; }
        this.syncFromSelf = true;
        try {
            for (const peer of this.host.getPanels()) {
                if (peer.md5 !== md5 || !peer.panel.visible) { continue; }
                if (peer.kind === 'controlFlow') {
                    await peer.panel.webview.postMessage({ action: 'highlight', address });
                    continue;
                }
                if (peer.syncEnabled === false) { continue; }
                if (peer.kind === 'listing') {
                    const unit = peer.pvListingWindow ? findUnitContainingAddress(peer.pvListingWindow.units, address) : undefined;
                    if (unit) {
                        peer.selected = unit.address;
                        await peer.panel.webview.postMessage({ action: 'highlight', address: unit.address });
                    } else {
                        peer.address = address;
                        peer.selected = address;
                        peer.cursor = undefined;
                        await this.renderListing(peer, peer.pvListingWindow ? 'partial' : 'full');
                    }
                } else if (peer.kind === 'memory') {
                    peer.pvSelectionLength = 1;
                    if (peer.pvChunk && addressInRange(address, peer.pvChunk.start, peer.pvChunk.end)) {
                        peer.selected = address;
                        await peer.panel.webview.postMessage({ action: 'highlight', address, length: 1 });
                    } else {
                        peer.address = address;
                        peer.selected = address;
                        await this.renderHex(peer, peer.pvChunk ? 'partial' : 'full');
                    }
                }
            }
        } finally {
            this.syncFromSelf = false;
        }
    }
}
