// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

/** Supported managed executable names installed through npm. */
export type BinaryTarget = 'ghidra-lsp' | 'ghidra-mcp';

/** Resolved command paths passed to the LSP client and backend process. */
export interface ResolvedBinaries {
    /** Executable name or path for `ghidra-lsp`. */
    serverPath: string;
    /** Executable name or path for `ghidra-mcp`. */
    mcpCommand: string;
}

/** Options controlling automatic binary resolution and npm installation. */
export interface ResolveOptions {
    /** Configured `ghidraLsp.serverPath` value. */
    serverPath?: string;
    /** Configured `ghidraLsp.mcpCommand` value. */
    mcpCommand?: string;
    /** Whether missing default binaries should install automatically through npm. */
    autoInstall: boolean;
    /** Output channel receiving installer logs. */
    output: vscode.OutputChannel;
}

/** Result of inspecting one configured or default executable location. */
type BinaryLookup =
    | { source: 'custom' | 'managed' | 'path'; path: string }
    | { source: 'missing' };

/** Map from Node platform-architecture keys to npm platform package suffixes. */
const PLATFORM_SUFFIXES: Record<string, string> = {
    'darwin-arm64': 'darwin-arm64',
    'darwin-x64': 'darwin-x64',
    'linux-arm64': 'linux-arm64',
    'linux-x64': 'linux-x64',
    'win32-arm64': 'win32-arm64',
    'win32-x64': 'win32-x64',
};

/** Map from binary target name to npm CLI launcher package specifier. */
const NPM_PACKAGES: Record<BinaryTarget, string> = {
    'ghidra-lsp': '@ghidra-lsp/cli@latest',
    'ghidra-mcp': '@ghidra-mcp/cli@latest',
};

/** Map from binary target name to npm package scope. */
const NPM_SCOPES: Record<BinaryTarget, string> = {
    'ghidra-lsp': '@ghidra-lsp',
    'ghidra-mcp': '@ghidra-mcp',
};

/** Active install lock preventing concurrent `npm install` runs in the same prefix. */
let activeInstall: Promise<void> = Promise.resolve();
/** Shared in-flight auto-install promise deduplicating concurrent calls. */
let sharedAutoInstall: Promise<Record<BinaryTarget, string>> | undefined;

/** Return the shared managed storage root shared by VS Code and Neovim clients. */
export function managedRootDir(): string {
    if (process.platform === 'win32') {
        const localAppData = process.env.LOCALAPPDATA?.trim() || path.join(os.homedir(), 'AppData', 'Local');
        return path.join(localAppData, 'ghidra-lsp');
    }
    const xdgDataHome = process.env.XDG_DATA_HOME?.trim() || path.join(os.homedir(), '.local', 'share');
    return path.join(xdgDataHome, 'ghidra-lsp');
}

/** Return the shared managed directory holding native executables. */
export function managedBinDir(): string {
    return path.join(managedRootDir(), 'bin');
}

/** Return the native executable filename for `target` on the current platform. */
export function executableName(target: BinaryTarget): string {
    return process.platform === 'win32' ? `${target}.exe` : target;
}

/** Return the full managed executable path for `target`. */
export function managedExecutablePath(target: BinaryTarget): string {
    return path.join(managedBinDir(), executableName(target));
}

/** Return the npm platform package suffix for the host OS and CPU architecture. */
export function platformSuffix(): string {
    const key = `${process.platform}-${process.arch}`;
    const suffix = PLATFORM_SUFFIXES[key];
    if (!suffix) {
        throw new Error(
            `Unsupported platform for automatic npm installation: ${key}. Install ghidra-lsp and ghidra-mcp manually or build from source.`,
        );
    }
    return suffix;
}

/** Return true when `filePath` exists as an executable regular file. */
function isExecutableFile(filePath: string): boolean {
    try {
        if (!fs.statSync(filePath).isFile()) {
            return false;
        }
        if (process.platform !== 'win32') {
            fs.accessSync(filePath, fs.constants.X_OK);
        }
        return true;
    } catch {
        return false;
    }
}

/** Locate `command` on `PATH` (or verify a path-like override) if executable. */
export function findOnPath(command: string): string | undefined {
    const trimmed = command.trim();
    if (!trimmed) {
        return undefined;
    }
    if (trimmed.includes('/') || trimmed.includes('\\')) {
        return isExecutableFile(trimmed) ? trimmed : undefined;
    }
    const pathEnv = process.env.PATH || '';
    const entries = pathEnv.split(path.delimiter).filter(Boolean);
    const suffixes = process.platform === 'win32' ? windowsPathExtensions(trimmed) : [''];
    for (const dir of entries) {
        for (const ext of suffixes) {
            const candidate = path.join(dir, `${trimmed}${ext}`);
            if (isExecutableFile(candidate)) {
                return candidate;
            }
        }
    }
    return undefined;
}

/** Return candidate file extensions from `PATHEXT` for Windows command lookups. */
function windowsPathExtensions(command: string): string[] {
    const raw = process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD';
    const exts = raw.split(';').map(item => item.trim()).filter(Boolean);
    const lower = command.toLowerCase();
    if (exts.some(ext => lower.endsWith(ext.toLowerCase()))) {
        return [''];
    }
    return ['', ...exts];
}

/** Return true when `configured` uses the default command name rather than a custom path. */
function isDefaultSetting(configured: string | undefined, target: BinaryTarget): boolean {
    const trimmed = configured?.trim() || '';
    return trimmed === '' || trimmed === target;
}

/** Inspect whether `target` resolves via custom setting, managed bin dir, or `PATH`. */
function findBinary(configured: string | undefined, target: BinaryTarget): BinaryLookup {
    if (!isDefaultSetting(configured, target)) {
        return { source: 'custom', path: configured!.trim() };
    }
    const managed = managedExecutablePath(target);
    if (isExecutableFile(managed)) {
        return { source: 'managed', path: managed };
    }
    const onPath = findOnPath(target);
    if (onPath) {
        return { source: 'path', path: onPath };
    }
    return { source: 'missing' };
}

/** Ensure the shared npm staging directory and private `package.json` exist. */
function prepareNpmWorkspace(): { npmDir: string; binDir: string } {
    const npmDir = path.join(managedRootDir(), 'npm');
    const binDir = managedBinDir();
    fs.mkdirSync(npmDir, { recursive: true });
    fs.mkdirSync(binDir, { recursive: true });
    const manifestPath = path.join(npmDir, 'package.json');
    if (!fs.existsSync(manifestPath)) {
        fs.writeFileSync(manifestPath, '{"private":true}\n', 'utf8');
    }
    return { npmDir, binDir };
}

/** Copy one platform package executable atomically into the shared managed bin directory. */
function copyManagedBinary(npmDir: string, suffix: string, target: BinaryTarget): string {
    const exe = executableName(target);
    const sourceExe = path.join(npmDir, 'node_modules', NPM_SCOPES[target], suffix, 'bin', exe);
    if (!fs.existsSync(sourceExe) || !fs.statSync(sourceExe).isFile()) {
        throw new Error(
            `Installed ${NPM_PACKAGES[target]} did not include ${exe} for ${suffix}. Check npm optional dependencies or libc compatibility.`,
        );
    }
    const destExe = managedExecutablePath(target);
    const tempExe = `${destExe}.tmp.${process.pid}.${Date.now()}`;
    try {
        fs.copyFileSync(sourceExe, tempExe);
        if (process.platform !== 'win32') {
            fs.chmodSync(tempExe, 0o755);
        }
        fs.renameSync(tempExe, destExe);
    } catch (error) {
        try {
            if (fs.existsSync(tempExe)) { fs.unlinkSync(tempExe); }
        } catch {
            // Best-effort cleanup of failed temp binary.
        }
        throw error;
    }
    return destExe;
}

/** Execute `npm install` for the requested targets inside the isolated staging directory. */
async function runNpmInstall(
    targets: BinaryTarget[],
    output: vscode.OutputChannel,
): Promise<Record<BinaryTarget, string>> {
    const suffix = platformSuffix();
    if (!findOnPath('npm')) {
        throw new Error(
            'npm was not found on PATH. Install Node.js (>= 18) and npm, or install ghidra-lsp and ghidra-mcp manually.',
        );
    }
    const { npmDir } = prepareNpmWorkspace();
    const packages = targets.map(target => NPM_PACKAGES[target]);
    const label = targets.join(' and ');
    output.appendLine(`[installer] Installing ${packages.join(', ')} into ${managedBinDir()}...`);

    return vscode.window.withProgress<Record<BinaryTarget, string>>({
        location: vscode.ProgressLocation.Notification,
        title: `Ghidra LSP: Installing ${label}`,
        cancellable: false,
    }, async progress => {
        progress.report({ message: 'Downloading packages from npm...' });
        await new Promise<void>((resolve, reject) => {
            const args = [
                'install',
                '--no-save',
                '--no-audit',
                '--no-fund',
                '--package-lock=false',
                '--include=optional',
                ...packages,
            ];
            const child = spawn('npm', args, {
                cwd: npmDir,
                shell: process.platform === 'win32',
                windowsHide: true,
            });
            const tail: string[] = [];
            const record = (chunk: Buffer): void => {
                const text = chunk.toString('utf8');
                for (const line of text.split(/\r?\n/)) {
                    const trimmed = line.trim();
                    if (!trimmed) { continue; }
                    output.appendLine(`[npm] ${trimmed}`);
                    tail.push(trimmed);
                    if (tail.length > 8) { tail.shift(); }
                }
            };
            child.stdout?.on('data', record);
            child.stderr?.on('data', record);
            child.on('error', error => {
                reject(new Error(`Failed to run npm: ${error.message}`));
            });
            child.on('close', code => {
                if (code === 0) {
                    resolve();
                } else {
                    const detail = tail.length ? `: ${tail[tail.length - 1]}` : '';
                    reject(new Error(`npm install exited with code ${code ?? 'unknown'}${detail}`));
                }
            });
        });

        progress.report({ message: 'Extracting native executables...' });
        const result: Partial<Record<BinaryTarget, string>> = {};
        for (const target of targets) {
            const dest = copyManagedBinary(npmDir, suffix, target);
            output.appendLine(`[installer] Installed ${target} -> ${dest}`);
            result[target] = dest;
        }
        return {
            'ghidra-lsp': result['ghidra-lsp'] ?? managedExecutablePath('ghidra-lsp'),
            'ghidra-mcp': result['ghidra-mcp'] ?? managedExecutablePath('ghidra-mcp'),
        };
    });
}

/** Install or update the specified managed executables via npm, serialized safely. */
export async function installManagedBinaries(
    output: vscode.OutputChannel,
    targets: BinaryTarget[] = ['ghidra-lsp', 'ghidra-mcp'],
): Promise<Record<BinaryTarget, string>> {
    const unique = Array.from(new Set(targets));
    if (!unique.length) {
        return {
            'ghidra-lsp': managedExecutablePath('ghidra-lsp'),
            'ghidra-mcp': managedExecutablePath('ghidra-mcp'),
        };
    }
    if (sharedAutoInstall && unique.every(t => t === 'ghidra-lsp' || t === 'ghidra-mcp')) {
        return sharedAutoInstall;
    }
    const previous = activeInstall;
    let releaseLock!: () => void;
    activeInstall = new Promise<void>(resolve => { releaseLock = resolve; });
    try {
        await previous;
        const job = runNpmInstall(unique, output);
        if (unique.includes('ghidra-lsp') && unique.includes('ghidra-mcp')) {
            sharedAutoInstall = job;
        }
        try {
            return await job;
        } finally {
            if (sharedAutoInstall === job) {
                sharedAutoInstall = undefined;
            }
        }
    } finally {
        releaseLock();
    }
}

/** Resolve configured, managed, or `PATH` executables, installing missing defaults if enabled. */
export async function resolveOrInstallBinaries(options: ResolveOptions): Promise<ResolvedBinaries> {
    const lspLookup = findBinary(options.serverPath, 'ghidra-lsp');
    const mcpLookup = findBinary(options.mcpCommand, 'ghidra-mcp');
    const missing: BinaryTarget[] = [];
    if (lspLookup.source === 'missing') { missing.push('ghidra-lsp'); }
    if (mcpLookup.source === 'missing') { missing.push('ghidra-mcp'); }

    let installed: Record<BinaryTarget, string> | undefined;
    if (missing.length > 0) {
        if (!options.autoInstall) {
            throw new Error(
                `Missing ${missing.join(' and ')}. Enable ghidraLsp.autoInstall, run "Ghidra: Install or Update Binaries", or configure custom paths.`,
            );
        }
        installed = await installManagedBinaries(options.output, missing);
    }

    const serverPath = lspLookup.source === 'missing'
        ? installed!['ghidra-lsp']
        : lspLookup.path;
    const mcpCommand = mcpLookup.source === 'missing'
        ? installed!['ghidra-mcp']
        : mcpLookup.path;

    options.output.appendLine(
        `[resolver] serverPath=${serverPath} (${lspLookup.source}), mcpCommand=${mcpCommand} (${mcpLookup.source})`,
    );
    return { serverPath, mcpCommand };
}
