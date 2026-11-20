// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

/**
 * Hex grid model and Data Inspector types for Ghidra program views.
 */
import {
    MemoryBlockInfo,
    findMemoryBlock,
    formatAddress,
    parseAddress,
} from './address-math';

/** Byte ordering reported by the Ghidra program. */
export type ProgramEndian = 'little' | 'big';

/** One byte cell rendered inside a hex row. */
export interface HexCell {
    offsetInRow: number;
    address?: string;
    /** Byte value `0..255`, or `null` when inside an uninitialized block (`??`). Undefined when outside block bounds. */
    value: number | null;
    inBlock: boolean;
    symbol?: string;
}

/** One 16-byte aligned row in the memory hex view. */
export interface HexRow {
    rowAddress: string;
    firstInBlockAddress: string;
    cells: HexCell[];
}

/** One fetched memory window chunk ready for rendering. */
export interface HexChunk {
    block: MemoryBlockInfo;
    rowStart: string;
    start: string;
    end: string;
    byteLength: number;
    bytesPerRow: number;
    rows: HexRow[];
}

/** One decoded value row shown in the Data Inspector panel. */
export interface DataInspectorEntry {
    label: string;
    value: string;
    rawTitle?: string;
    jumpAddress?: string;
}

/** Pick the next/previous row-aligned start address for a chunk jump. */
export function stepChunkAddress(
    blocks: MemoryBlockInfo[],
    currentStart: string,
    chunkBytes: number,
    direction: -1 | 1,
): string | undefined {
    const block = findMemoryBlock(blocks, currentStart);
    if (!block) {
        return direction > 0 ? blocks[0]?.start : blocks[blocks.length - 1]?.start;
    }
    const cur = parseAddress(currentStart);
    const start = parseAddress(block.start);
    const end = parseAddress(block.end);
    if (!cur || !start || !end) {
        return undefined;
    }
    if (direction > 0) {
        const next = cur.offset + BigInt(chunkBytes);
        if (next <= end.offset) {
            return formatAddress(cur.space, next, cur.width);
        }
        const idx = blocks.indexOf(block);
        return blocks[idx + 1]?.start;
    }
    if (cur.offset > start.offset) {
        const prev = cur.offset - BigInt(chunkBytes);
        return prev >= start.offset ? formatAddress(cur.space, prev, cur.width) : block.start;
    }
    const idx = blocks.indexOf(block);
    const prevBlock = blocks[idx - 1];
    if (!prevBlock) {
        return undefined;
    }
    const prevStart = parseAddress(prevBlock.start);
    const prevEnd = parseAddress(prevBlock.end);
    if (!prevStart || !prevEnd) {
        return prevBlock.start;
    }
    const lastWindowStart = prevEnd.offset + 1n - BigInt(chunkBytes);
    return lastWindowStart > prevStart.offset
        ? formatAddress(prevStart.space, lastWindowStart, prevStart.width)
        : prevBlock.start;
}
