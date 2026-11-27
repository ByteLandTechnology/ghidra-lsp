// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

/**
 * Interactive commands for Sleigh assembly, disassembly, code-unit clear, and byte writes.
 */
import * as vscode from 'vscode';
import { addAddressOffset, compareAddresses, formatAddress, parseAddress } from './address-math';
import { memoryAddressAt, memoryScheme, memorySelectedAddresses } from './bytes';
import { ProgramContext } from './context';
import { formatFriendlyError } from './error';
import { ListingViews, listingScheme } from './listing';
import { plainAddress } from './listing-format';
import { cursorLocation } from './location';
import { Call } from './memory';
import { displayAddress } from './names';
import { AddressRange, addressText } from './view-ranges';
import { Data, object, stringOf } from './web';

/** Resolved address or inclusive range target for one listing or memory mutation. */
interface PatchTarget {
    md5: string;
    address: string;
    endAddress?: string;
    length?: number;
}

/** Normalize a list of `AddressRange` items into one inclusive `[start, end]` span when contiguous in one space. */
function spanFromRanges(ranges: AddressRange[]): { start: string; end?: string; length: number } | undefined {
    if (!ranges.length) { return undefined; }
    const space = ranges[0].space;
    let lo = ranges[0].start;
    let hi = ranges[0].end;
    for (const item of ranges) {
        if (item.space !== space) { break; }
        if (item.start < lo) { lo = item.start; }
        if (item.end > hi) { hi = item.end; }
    }
    const start = addressText({ space, start: lo, end: lo });
    const end = hi > lo ? addressText({ space, start: hi, end: hi }) : undefined;
    return { start, end, length: Number(hi - lo + 1n) };
}

/** Parse user-supplied Sleigh text into non-empty instruction strings separated by `;` or newlines. */
function splitInstructions(raw: string): string[] {
    return raw.split(/[;\r\n]+/).map(line => line.trim()).filter(Boolean);
}

/** Parse and validate a hex byte string (whitespace and `0x` prefixes ignored). */
function normalizeHexBytes(raw: string): { hex: string; length: number } {
    const cleaned = raw.replace(/0x/gi, '').replace(/[\s,_-]+/g, '').toLowerCase();
    if (!cleaned || cleaned.length % 2 !== 0 || !/^[0-9a-f]+$/.test(cleaned)) {
        throw new Error('Enter an even number of hexadecimal digits, for example "90 90" or "31c0c3".');
    }
    return { hex: cleaned, length: cleaned.length / 2 };
}

/** Build a bridge `ListingScope` selector from a `PatchTarget`. */
function listingSelector(target: PatchTarget): Data {
    if (target.endAddress && compareAddresses(target.endAddress, target.address) > 0) {
        return { kind: 'range', start: target.address, end: target.endAddress };
    }
    if (target.length && target.length > 1) {
        const computedEnd = addAddressOffset(target.address, BigInt(target.length - 1));
        if (computedEnd) {
            return { kind: 'range', start: target.address, end: computedEnd };
        }
    }
    return { kind: 'address', address: target.address };
}

/** Human-readable label for a single address or inclusive range. */
function describeTarget(target: PatchTarget): string {
    const selector = listingSelector(target);
    if (selector.kind === 'range') {
        return `${displayAddress(String(selector.start))}..${displayAddress(String(selector.end))}`;
    }
    return displayAddress(target.address);
}

/** Commands for `instruction.assemble`, `instruction.disassemble`, `code_unit.clear`, and `memory.write`. */
export class PatchingUI implements vscode.Disposable {
    /** Command registrations owned by this controller. */
    private readonly disposables: vscode.Disposable[] = [];

    /** Register listing and memory mutation commands. */
    constructor(
        private readonly call: Call,
        private readonly context: ProgramContext,
        private readonly listingViews: () => ListingViews | undefined,
    ) {
        const commands: Record<string, (arg?: unknown) => Promise<void>> = {
            assembleInstruction: this.assembleInstruction.bind(this),
            disassembleBytes: this.disassembleBytes.bind(this),
            clearCodeUnits: this.clearCodeUnits.bind(this),
            patchBytes: this.patchBytes.bind(this),
        };
        for (const [name, handler] of Object.entries(commands)) {
            this.disposables.push(vscode.commands.registerCommand(`ghidraLsp.${name}`, async (arg?: unknown) => {
                try { await handler(arg); }
                catch (error) { void vscode.window.showErrorMessage(formatFriendlyError(error)); }
            }));
        }
    }

    /** Resolve target MD5, start address, and optional range from command arguments or active editor. */
    private async resolveTarget(arg: unknown, promptTitle: string): Promise<PatchTarget | undefined> {
        const data = object(arg);
        const explicitAddress = stringOf(data.address);
        if (explicitAddress) {
            const md5 = this.context.require(data.md5 || arg);
            const length = Number(data.length || data.byteLength) || undefined;
            const endAddress = stringOf(data.endAddress) || undefined;
            return { md5, address: explicitAddress, endAddress, length };
        }

        const uri = arg instanceof vscode.Uri ? arg : vscode.window.activeTextEditor?.document.uri;
        const editor = uri
            ? vscode.window.visibleTextEditors.find(item => item.document.uri.toString() === uri.toString())
            : vscode.window.activeTextEditor;
        const md5 = this.context.require(uri || arg);

        if (editor && editor.document.uri.scheme === listingScheme) {
            const views = this.listingViews();
            const spans = views ? spanFromRanges(views.addresses(editor.document, editor.selections)) : undefined;
            if (spans) {
                return { md5, address: spans.start, endAddress: spans.end, length: spans.length };
            }
            const single = views?.addressAt(editor);
            if (single) { return { md5, address: single }; }
        }

        if (editor && editor.document.languageId === memoryScheme) {
            const spans = spanFromRanges(memorySelectedAddresses(editor.document, editor.selections));
            if (spans) {
                return { md5, address: spans.start, endAddress: spans.end, length: spans.length };
            }
            const single = memoryAddressAt(editor);
            if (single) { return { md5, address: single }; }
        }

        const loc = await cursorLocation(this.call, md5, uri);
        if (loc?.address) {
            return { md5, address: loc.code_unit_address || loc.address };
        }

        const typed = await vscode.window.showInputBox({
            title: promptTitle,
            prompt: `Address or range (start..end) in ${this.context.name(md5)}`,
            placeHolder: '00401000 or 00401000..0040100f',
            ignoreFocusOut: true,
        });
        const trimmed = typed?.trim();
        if (!trimmed) { return undefined; }
        const parts = trimmed.split(/\.\.|-/).map(part => part.trim()).filter(Boolean);
        if (parts.length === 2) {
            const a = parseAddress(parts[0]);
            const b = parseAddress(parts[1], a?.space || 'ram');
            if (a && b) {
                return {
                    md5,
                    address: formatAddress(a.space, a.offset, a.width),
                    endAddress: formatAddress(b.space, b.offset, b.width),
                };
            }
        }
        return { md5, address: trimmed };
    }

    /** Refresh sidebar trees, virtual files, and open workbench views after a mutation. */
    private async refreshAll(md5: string): Promise<void> {
        try { await vscode.commands.executeCommand('ghidraLsp.refreshBrowser', md5); }
        catch (error) { void vscode.window.showWarningMessage(`Saved changes, but view refresh failed: ${String(error)}`); }
    }

    /** Read a short hex preview at `address` so the byte-patch input box can pre-populate current bytes. */
    private async readPreviewHex(md5: string, address: string, length: number): Promise<string> {
        try {
            const count = Math.max(1, Math.min(64, length));
            const res = await this.call<Data>('ghidra.query', {
                md5,
                domain: 'memory',
                operation: 'read',
                params: { selector: { address }, length: count, encoding: 'hex' },
            });
            const raw = stringOf(object(res.bytes).data);
            return raw ? raw.replace(/(..)/g, '$1 ').trim() : '';
        } catch {
            return '';
        }
    }

    /** Prompt for Sleigh assembly text and run `instruction.assemble` at the target address. */
    async assembleInstruction(arg?: unknown): Promise<void> {
        const target = await this.resolveTarget(arg, 'Ghidra: Assemble Instruction');
        if (!target) { return; }

        const text = await vscode.window.showInputBox({
            title: `Assemble at ${displayAddress(target.address)}`,
            prompt: 'Enter one or more Sleigh instructions separated by ";"',
            placeHolder: 'NOP or XOR EAX, EAX; RET',
            ignoreFocusOut: true,
            validateInput: input => splitInstructions(input).length ? undefined : 'Enter at least one instruction.',
        });
        if (!text) { return; }
        const instructions = splitInstructions(text);

        const padChoice = await vscode.window.showQuickPick([
            { label: 'Pad leftover instruction bytes with NOP', description: 'Recommended when replacing a longer instruction', padNop: true },
            { label: 'Assemble exact instruction bytes only', description: 'Leave any trailing bytes undefined', padNop: false },
        ], {
            title: `Assemble at ${displayAddress(target.address)}`,
            placeHolder: 'Select how to treat leftover bytes of a replaced instruction',
            ignoreFocusOut: true,
        });
        if (!padChoice) { return; }

        const result = await this.call<Data>('ghidra.mutate', {
            md5: target.md5,
            domain: 'instruction',
            operation: 'assemble',
            params: {
                selector: { address: target.address },
                instructions,
                pad_nop: padChoice.padNop,
            },
        });
        await this.refreshAll(target.md5);
        const items = Array.isArray(object(result.result).items) ? (object(result.result).items as unknown[]).length : instructions.length;
        vscode.window.setStatusBarMessage(`Assembled ${items} instruction(s) at ${plainAddress(target.address)}`, 5000);
    }

    /** Decode undefined bytes into instructions at an address or range with `instruction.disassemble`. */
    async disassembleBytes(arg?: unknown): Promise<void> {
        const target = await this.resolveTarget(arg, 'Ghidra: Disassemble Bytes');
        if (!target) { return; }
        const selector = listingSelector(target);
        const result = await this.call<Data>('ghidra.mutate', {
            md5: target.md5,
            domain: 'instruction',
            operation: 'disassemble',
            params: { selector },
        });
        await this.refreshAll(target.md5);
        const items = Array.isArray(object(result.result).items) ? (object(result.result).items as unknown[]).length : 0;
        vscode.window.setStatusBarMessage(`Disassembled ${items} instruction(s) at ${describeTarget(target)}`, 5000);
    }

    /** Clear instructions and defined data back to undefined bytes with `code_unit.clear`. */
    async clearCodeUnits(arg?: unknown): Promise<void> {
        const target = await this.resolveTarget(arg, 'Ghidra: Clear Code Units (Undefine)');
        if (!target) { return; }
        const label = describeTarget(target);
        const confirm = await vscode.window.showQuickPick([
            { label: `Clear code units at ${label}`, description: 'Reset instructions and defined data to undefined bytes', ok: true },
            { label: 'Cancel', ok: false },
        ], {
            title: 'Ghidra: Clear Code Units (Undefine)',
            placeHolder: `Confirm clearing code units at ${label}`,
            ignoreFocusOut: true,
        });
        if (!confirm?.ok) { return; }

        const selector = listingSelector(target);
        await this.call<Data>('ghidra.mutate', {
            md5: target.md5,
            domain: 'code_unit',
            operation: 'clear',
            params: { selector },
        });
        await this.refreshAll(target.md5);
        vscode.window.setStatusBarMessage(`Cleared code units at ${label}`, 5000);
    }

    /** Prompt for hex bytes and write options, then execute `memory.write`. */
    async patchBytes(arg?: unknown): Promise<void> {
        const target = await this.resolveTarget(arg, 'Ghidra: Patch Bytes');
        if (!target) { return; }
        const initialHex = await this.readPreviewHex(target.md5, target.address, target.length || 4);

        const rawHex = await vscode.window.showInputBox({
            title: `Patch bytes at ${displayAddress(target.address)}`,
            prompt: 'Enter hexadecimal byte values to write at the target address',
            value: initialHex,
            placeHolder: '90 90 or 31 c0 c3',
            ignoreFocusOut: true,
            validateInput: input => {
                try { normalizeHexBytes(input); return undefined; }
                catch (err) { return err instanceof Error ? err.message : String(err); }
            },
        });
        if (!rawHex) { return; }
        const { hex, length } = normalizeHexBytes(rawHex);

        const mode = await vscode.window.showQuickPick([
            {
                label: 'Clear prior code units and disassemble',
                description: 'Safe for instruction patches; decodes patched bytes as instructions',
                clearExisting: true,
                disassemble: true,
            },
            {
                label: 'Clear prior code units only',
                description: 'Writes raw bytes and leaves the patched range undefined',
                clearExisting: true,
                disassemble: false,
            },
            {
                label: 'Strict write over undefined bytes only',
                description: 'Fails if defined instructions or data overlap the write range',
                clearExisting: false,
                disassemble: false,
            },
        ], {
            title: `Patch ${length} byte(s) at ${displayAddress(target.address)}`,
            placeHolder: 'Select how Ghidra handles code units in the patched range',
            ignoreFocusOut: true,
        });
        if (!mode) { return; }

        const patch: Data = { bytes: { encoding: 'hex', data: hex, length } };
        if (mode.clearExisting) { patch.clear_existing = true; }
        if (mode.disassemble) { patch.disassemble = true; }
        await this.call<Data>('ghidra.mutate', {
            md5: target.md5,
            domain: 'memory',
            operation: 'write',
            params: {
                selector: { address: target.address },
                patch,
            },
        });
        await this.refreshAll(target.md5);
        vscode.window.setStatusBarMessage(`Patched ${length} byte(s) at ${plainAddress(target.address)}`, 5000);
    }

    /** Dispose all registered patching commands. */
    dispose(): void {
        for (const item of this.disposables) { item.dispose(); }
    }
}
