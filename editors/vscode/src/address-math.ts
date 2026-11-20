// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

/**
 * Exact 64-bit address math and memory block helpers for Ghidra program views.
 */

export interface ParsedAddress {
    space: string;
    prefix: string;
    offset: bigint;
    width: number;
    canonical: string;
}

/** Metadata for one program memory block returned by the server. */
export interface MemoryBlockInfo {
    name: string;
    start: string;
    end: string;
    length: bigint;
    read: boolean;
    write: boolean;
    execute: boolean;
    initialized: boolean;
    volatile: boolean;
    overlay: boolean;
    kind: string;
    comment: string;
}

/** Address space prefixes that do not refer to linear program memory. */
const NON_MEMORY_PREFIX = /^(?:Stack|register|const|unique|VARIABLE|HASH):/i;

/** Parse a canonical (`ram:00401000`, `EXTERNAL:00000001`) or bare hex address using BigInt. */
export function parseAddress(raw: string, defaultSpace = 'ram'): ParsedAddress | undefined {
    const trimmed = String(raw ?? '').trim();
    if (!trimmed || NON_MEMORY_PREFIX.test(trimmed) || /\[.*\]$/.test(trimmed)) {
        return undefined;
    }
    const colon = trimmed.indexOf(':');
    let space = defaultSpace;
    let hexPart = trimmed;
    if (colon > 0) {
        const prefix = trimmed.slice(0, colon).trim();
        if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(prefix)) {
            return undefined;
        }
        space = prefix;
        hexPart = trimmed.slice(colon + 1).trim();
    } else if (colon === 0) {
        return undefined;
    }
    if (hexPart.startsWith('0x') || hexPart.startsWith('0X')) {
        hexPart = hexPart.slice(2);
    }
    if (!/^[0-9a-f]+$/i.test(hexPart)) {
        return undefined;
    }
    const offset = BigInt(`0x${hexPart}`);
    const width = Math.max(hexPart.length, 1);
    const normalizedHex = offset.toString(16).padStart(width, '0');
    return {
        space,
        prefix: `${space}:`,
        offset,
        width,
        canonical: `${space}:${normalizedHex}`,
    };
}

/** Format an address space and 64-bit offset back to canonical `space:hex`. */
export function formatAddress(space: string, offset: bigint, width: number): string {
    const safeOffset = offset < 0n ? 0n : offset;
    const hex = safeOffset.toString(16).padStart(Math.max(1, width), '0');
    return `${space}:${hex}`;
}

/** Checked BigInt offset addition; returns undefined when the result would underflow below 0. */
export function addAddressOffset(address: string, delta: bigint, defaultSpace = 'ram'): string | undefined {
    const parsed = parseAddress(address, defaultSpace);
    if (!parsed) {
        return undefined;
    }
    const next = parsed.offset + delta;
    if (next < 0n) {
        return undefined;
    }
    return formatAddress(parsed.space, next, parsed.width);
}

/** Compare two addresses by space (`ram` first) then unsigned BigInt offset. */
export function compareAddresses(a: string, b: string): number {
    const left = parseAddress(a);
    const right = parseAddress(b);
    if (!left && !right) {
        return a.localeCompare(b);
    }
    if (!left) {
        return 1;
    }
    if (!right) {
        return -1;
    }
    if (left.space !== right.space) {
        if (left.space === 'ram') {
            return -1;
        }
        if (right.space === 'ram') {
            return 1;
        }
        return left.space.localeCompare(right.space);
    }
    if (left.offset < right.offset) {
        return -1;
    }
    if (left.offset > right.offset) {
        return 1;
    }
    return 0;
}

/** Canonical equality over address space and 64-bit BigInt offset. */
export function sameAddress(a: string, b: string): boolean {
    const left = parseAddress(a);
    const right = parseAddress(b);
    return !!left && !!right && left.space.toLowerCase() === right.space.toLowerCase() && left.offset === right.offset;
}

/** Inclusive range membership test `[start, end]` in matching address space. */
export function addressInRange(address: string, start: string, end: string): boolean {
    const target = parseAddress(address);
    const lo = parseAddress(start);
    const hi = parseAddress(end);
    if (!target || !lo || !hi) {
        return false;
    }
    if (target.space.toLowerCase() !== lo.space.toLowerCase() || target.space.toLowerCase() !== hi.space.toLowerCase()) {
        return false;
    }
    return target.offset >= lo.offset && target.offset <= hi.offset;
}

/** Align an address down to the start of a `bytesPerRow` grid row. */
export function alignRowAddress(address: string, bytesPerRow: number): string {
    const parsed = parseAddress(address);
    if (!parsed || bytesPerRow <= 1) {
        return parsed?.canonical || address;
    }
    const step = BigInt(bytesPerRow);
    const aligned = parsed.offset - (parsed.offset % step);
    return formatAddress(parsed.space, aligned, parsed.width);
}

/** Clamp address `candidate` to `[min, max]` within the same space. */
export function clampAddress(candidate: string, min: string, max: string): string {
    const c = parseAddress(candidate);
    const lo = parseAddress(min);
    const hi = parseAddress(max);
    if (!c || !lo || !hi || c.space.toLowerCase() !== lo.space.toLowerCase()) {
        return candidate;
    }
    if (c.offset < lo.offset) {
        return formatAddress(lo.space, lo.offset, Math.max(c.width, lo.width));
    }
    if (c.offset > hi.offset) {
        return formatAddress(hi.space, hi.offset, Math.max(c.width, hi.width));
    }
    return formatAddress(c.space, c.offset, Math.max(c.width, lo.width));
}

/** Parse a block byte length or derive it from inclusive start and end addresses. */
function asBigIntLength(value: unknown, start: string, end: string): bigint {
    if (typeof value === 'bigint') {
        return value;
    }
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
        return BigInt(value);
    }
    if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
        return BigInt(value.trim());
    }
    const lo = parseAddress(start);
    const hi = parseAddress(end);
    if (lo && hi && hi.offset >= lo.offset) {
        return hi.offset - lo.offset + 1n;
    }
    return 0n;
}

/** Parse and sort `memory_block.list` records by address. */
export function parseMemoryBlocks(items: Record<string, unknown>[]): MemoryBlockInfo[] {
    const blocks: MemoryBlockInfo[] = [];
    for (const raw of items) {
        const start = typeof raw.start === 'string' ? raw.start : '';
        const end = typeof raw.end === 'string' ? raw.end : '';
        if (!start || !end) {
            continue;
        }
        blocks.push({
            name: typeof raw.name === 'string' && raw.name ? raw.name : 'block',
            start,
            end,
            length: asBigIntLength(raw.length, start, end),
            read: raw.read === true,
            write: raw.write === true,
            execute: raw.execute === true,
            initialized: raw.initialized !== false,
            volatile: raw.volatile === true,
            overlay: raw.overlay === true,
            kind: typeof raw.kind === 'string' ? raw.kind : '',
            comment: typeof raw.comment === 'string' ? raw.comment : '',
        });
    }
    blocks.sort((a, b) => compareAddresses(a.start, b.start));
    return blocks;
}

/** Find the memory block containing `address` (prefers non-overlay readable blocks when overlapping). */
export function findMemoryBlock(blocks: MemoryBlockInfo[], address: string): MemoryBlockInfo | undefined {
    let fallback: MemoryBlockInfo | undefined;
    for (const block of blocks) {
        if (!addressInRange(address, block.start, block.end)) {
            continue;
        }
        if (!block.overlay && block.read) {
            return block;
        }
        fallback ||= block;
    }
    return fallback;
}

/** Format Ghidra-style `R-X` / `RW-` permission triplets. */
export function permissionsLabel(block: Pick<MemoryBlockInfo, 'read' | 'write' | 'execute'>): string {
    return `${block.read ? 'R' : '−'}${block.write ? 'W' : '−'}${block.execute ? 'X' : '−'}`;
}
