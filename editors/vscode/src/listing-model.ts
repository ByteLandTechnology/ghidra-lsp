// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

/**
 * Listing render model types and unit lookup helper.
 */
import {
    MemoryBlockInfo,
    parseAddress,
} from './address-math';

/** Symbol label rendered above or beside a listing address. */
export interface ListingLabel {
    id?: string;
    name: string;
    fullTooltip: string;
    primary: boolean;
}

/** Incoming cross-reference displayed in the listing margin. */
export interface ListingXref {
    from: string;
    label: string;
    suffix: string;
    type: string;
    navigable: boolean;
}

/** Outgoing jump, call, or data reference target from a listing unit. */
export interface ListingTarget {
    to: string;
    label: string;
    kind: string;
    preview?: string;
    inlineOnly?: boolean;
}

/** Parameter or local stack variable shown in a function header. */
export interface ListingVariable {
    kind: 'param' | 'local';
    dataType: string;
    storage: string;
    rawStorage?: string;
    name: string;
}

/** Function signature and local variable summary rendered at function entry. */
export interface ListingFunctionHeader {
    entry: string;
    displaySignature: string;
    rawSignature: string;
    name: string;
    mangledName?: string;
    callingConvention?: string;
    flags: string[];
    variables: ListingVariable[];
}

/** Memory block banner rendered at the start of a block inside the listing. */
export interface ListingBlockHeader {
    name: string;
    start: string;
    end: string;
    permissions: string;
    initialized: boolean;
    kind?: string;
    comment?: string;
}

/** Single instruction or data code unit row in the graphical listing model. */
export interface ListingUnit {
    kind: 'instruction' | 'data';
    address: string;
    byteLength: number;
    entry?: string;
    functionName?: string;
    bytesText: string;
    bytesShort: string;
    mnemonic: string;
    operandsText: string;
    typePath?: string;
    blockHeader?: ListingBlockHeader;
    plateComment?: string;
    functionHeader?: ListingFunctionHeader;
    labels: ListingLabel[];
    xrefs: ListingXref[];
    xrefTotal: number;
    preComment?: string;
    postComment?: string;
    eolComment?: string;
    targets: ListingTarget[];
    isUndefinedByte?: boolean;
}

/** Collapsed run of consecutive undefined bytes in the listing table. */
export interface ListingUndefinedRun {
    kind: 'undefinedRun';
    startAddress: string;
    endAddress: string;
    byteLength: number;
    uninitialized: boolean;
    blockHeader?: ListingBlockHeader;
    units: ListingUnit[];
}

/** Renderable item in the listing view: a code unit or a collapsed undefined run. */
export type ListingRenderItem = ListingUnit | ListingUndefinedRun;

/** Full listing window payload including collapsed render items. */
export interface ListingWindowModel {
    startAddress: string;
    endAddress: string;
    block?: MemoryBlockInfo;
    units: ListingUnit[];
    collapsedItems: ListingRenderItem[];
}

/** Find the ListingUnit whose byte span `[address, address + byteLength - 1]` covers `targetAddress`. */
export function findUnitContainingAddress(units: ListingUnit[], targetAddress: string): ListingUnit | undefined {
    const target = parseAddress(targetAddress);
    if (!target) {
        return undefined;
    }
    for (const unit of units) {
        const start = parseAddress(unit.address);
        if (!start || start.space.toLowerCase() !== target.space.toLowerCase()) {
            continue;
        }
        const endOffset = start.offset + BigInt(Math.max(1, unit.byteLength)) - 1n;
        if (target.offset >= start.offset && target.offset <= endOffset) {
            return unit;
        }
    }
    return undefined;
}
