// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

import * as vscode from 'vscode';

/** Optional Ghidra project selection and firmware import parameters for session open. */
export interface OpenBinaryOptions {
    programName?: string;
    processor?: string;
    compilerSpec?: string;
    loader?: string;
    baseAddress?: string;
    reimport?: boolean;
    analyze?: boolean;
}

/** Backend request payload accepted by `ghidra.beginOpenBinary` and `ghidra.openBinary`. */
export type OpenProgramRequest = ({ path: string } | { md5: string }) & OpenBinaryOptions;

/** Normalized open request and UI metadata resolved from command arguments or dialogs. */
export interface ResolvedOpenInput {
    target: OpenProgramRequest;
    name: string;
    originalPath?: string;
    interactive: boolean;
}

const FIRMWARE_EXTENSIONS = new Set(['bin', 'hex', 'ihex', 'srec']);
const OPTION_KEYS: (keyof OpenBinaryOptions)[] = [
    'programName', 'processor', 'compilerSpec', 'loader', 'baseAddress', 'reimport', 'analyze',
];

/** Return true when `fsPath` ends with `.gpr`. */
export function isGprPath(fsPath: string): boolean {
    return /\.gpr$/i.test(fsPath);
}

/** Return true when `fsPath` ends with `.bin`, `.hex`, `.ihex`, or `.srec`. */
export function isFirmwarePath(fsPath: string): boolean {
    const ext = fsPath.split(/[\\/]/).pop()?.split('.').pop()?.toLowerCase() || '';
    return FIRMWARE_EXTENSIONS.has(ext);
}

/** Show the file dialog for binaries, firmware images, and `.gpr` Ghidra projects. */
export async function showOpenProgramDialog(): Promise<vscode.Uri | undefined> {
    const selected = await vscode.window.showOpenDialog({
        canSelectMany: false,
        openLabel: 'Open with Ghidra',
        filters: {
            'All Files': ['*'],
            'Ghidra Projects': ['gpr'],
            'Firmware Images': ['bin', 'hex', 'ihex', 'srec'],
        },
    });
    return selected?.[0];
}

function readStringOption(record: Record<string, unknown>, camel: string, snake?: string): string | undefined {
    const raw = record[camel] !== undefined ? record[camel] : (snake ? record[snake] : undefined);
    if (typeof raw !== 'string') { return undefined; }
    const trimmed = raw.trim();
    return trimmed ? trimmed : undefined;
}

/** Normalize optional open flags from a raw command argument object. */
export function normalizeOpenOptions(raw: unknown): OpenBinaryOptions {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw instanceof vscode.Uri) { return {}; }
    const record = raw as Record<string, unknown>;
    const options: OpenBinaryOptions = {};
    const programName = readStringOption(record, 'programName', 'program_name');
    const processor = readStringOption(record, 'processor');
    const compilerSpec = readStringOption(record, 'compilerSpec', 'compiler_spec');
    const loader = readStringOption(record, 'loader');
    const baseAddress = readStringOption(record, 'baseAddress', 'base_address');
    if (programName) { options.programName = programName; }
    if (processor) { options.processor = processor; }
    if (compilerSpec) { options.compilerSpec = compilerSpec; }
    if (loader) { options.loader = loader; }
    if (baseAddress) { options.baseAddress = baseAddress; }
    if (typeof record.reimport === 'boolean') { options.reimport = record.reimport; }
    if (typeof record.analyze === 'boolean') { options.analyze = record.analyze; }
    return options;
}

function hasExplicitOptions(options: OpenBinaryOptions): boolean {
    return OPTION_KEYS.some(key => options[key] !== undefined);
}

async function promptOptionalInput(title: string, prompt: string, value?: string): Promise<string | null> {
    const entered = await vscode.window.showInputBox({
        title,
        prompt,
        value: value || '',
        ignoreFocusOut: true,
    });
    if (entered === undefined) { return null; }
    return entered.trim();
}

async function promptOpenOptions(
    fsPath: string,
    initial: OpenBinaryOptions,
    promptAll: boolean,
): Promise<OpenBinaryOptions | undefined> {
    const next: OpenBinaryOptions = { ...initial };
    if (isGprPath(fsPath)) {
        if (!promptAll) { return next; }
        const programName = await promptOptionalInput(
            'Ghidra Program Name',
            'Optional program name or project path inside the .gpr project (leave empty for single-program projects)',
            next.programName,
        );
        if (programName === null) { return undefined; }
        if (programName) { next.programName = programName; }
        return next;
    }
    const processor = await promptOptionalInput(
        'Firmware Processor (Language ID)',
        'Optional Ghidra processor ID (for example ARM:LE:32:Cortex); leave empty for auto-detection or saved settings',
        next.processor,
    );
    if (processor === null) { return undefined; }
    if (processor) { next.processor = processor; }

    const baseAddress = await promptOptionalInput(
        'Base Address',
        'Optional hexadecimal load base address (for example 0x08000000)',
        next.baseAddress,
    );
    if (baseAddress === null) { return undefined; }
    if (baseAddress) { next.baseAddress = baseAddress; }

    if (!promptAll) { return next; }

    const compilerSpec = await promptOptionalInput(
        'Compiler Spec',
        'Optional Ghidra compiler specification ID (for example default or gcc)',
        next.compilerSpec,
    );
    if (compilerSpec === null) { return undefined; }
    if (compilerSpec) { next.compilerSpec = compilerSpec; }

    const loader = await promptOptionalInput(
        'Loader',
        'Optional Ghidra loader class (for example BinaryLoader, IntelHexLoader, MotorolaHexLoader)',
        next.loader,
    );
    if (loader === null) { return undefined; }
    if (loader) { next.loader = loader; }

    const reimportPick = await vscode.window.showQuickPick(
        [
            { label: 'Keep existing project if already imported', reimport: false },
            { label: 'Reimport binary from scratch', reimport: true },
        ],
        { title: 'Reimport Mode', placeHolder: 'Choose whether to reset any existing imported project' },
    );
    if (!reimportPick) { return undefined; }
    if (reimportPick.reimport) { next.reimport = true; }
    return next;
}

/** Format a display label for a binary or `.gpr` project path. */
export function formatOpenDisplayName(fsPath: string, programName?: string): string {
    const base = fsPath.split(/[\\/]/).pop() || 'Binary';
    return programName ? `${base} (${programName})` : base;
}

/** Resolve command arguments or interactive prompts into a normalized `OpenProgramRequest`. */
export async function resolveOpenInput(
    resource?: unknown,
    extra?: unknown,
    promptAllOptions = false,
): Promise<ResolvedOpenInput | undefined> {
    let uri: vscode.Uri | undefined;
    let md5: string | undefined;
    let interactive = false;
    let options: OpenBinaryOptions = {
        ...normalizeOpenOptions(resource),
        ...normalizeOpenOptions(extra),
    };

    if (resource instanceof vscode.Uri) {
        uri = resource;
        if (extra === undefined || Array.isArray(extra)) {
            interactive = true;
        }
    } else if (typeof resource === 'string' && resource.trim()) {
        const trimmed = resource.trim();
        if (/^[a-f\d]{32}$/i.test(trimmed)) {
            md5 = trimmed.toLowerCase();
        } else {
            uri = vscode.Uri.file(trimmed);
        }
    } else if (resource && typeof resource === 'object') {
        const record = resource as Record<string, unknown>;
        if (record.uri instanceof vscode.Uri) {
            uri = record.uri;
        } else if (typeof record.uri === 'string' && record.uri.trim()) {
            uri = vscode.Uri.parse(record.uri.trim());
        } else if (typeof record.path === 'string' && record.path.trim()) {
            uri = vscode.Uri.file(record.path.trim());
        } else if (typeof record.md5 === 'string' && /^[a-f\d]{32}$/i.test(record.md5.trim())) {
            md5 = record.md5.trim().toLowerCase();
        }
    }

    if (!uri && !md5) {
        uri = await showOpenProgramDialog();
        if (!uri) { return undefined; }
        interactive = true;
    }

    if (md5) {
        return {
            target: { md5, ...options },
            name: options.programName || md5,
            interactive,
        };
    }

    if (!uri || uri.scheme !== 'file') {
        throw new Error('Choose a local binary or .gpr project');
    }

    const fsPath = uri.fsPath;
    if (promptAllOptions || (interactive && isFirmwarePath(fsPath) && !hasExplicitOptions(options))) {
        const prompted = await promptOpenOptions(fsPath, options, promptAllOptions);
        if (!prompted) { return undefined; }
        options = prompted;
    }

    return {
        target: { path: fsPath, ...options },
        name: formatOpenDisplayName(fsPath, options.programName),
        originalPath: fsPath,
        interactive: interactive || promptAllOptions,
    };
}

/** Parse candidate program names from a multi-program `.gpr` open error message. */
export function extractCandidatePrograms(error: unknown): string[] | undefined {
    const text = error instanceof Error ? error.message : String(error || '');
    const match = text.match(/Candidate programs:\s*([^\r\n"}]+)/i);
    if (!match) { return undefined; }
    const cleaned = match[1].replace(/\s*\(GhidraScript\)\s*$/i, '');
    const items = cleaned
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
    return items.length ? items : undefined;
}
