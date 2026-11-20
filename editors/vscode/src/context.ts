// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

import * as vscode from 'vscode';
import { Call } from './memory';

/** Virtual URI schemes associated with a Ghidra program MD5. */
const programSchemes = new Set(['ghidra', 'ghidra-listing', 'ghidra-memory', 'ghidra-type', 'ghidra-type-current', 'ghidra-string', 'ghidra-reference']);

/** Recently opened Ghidra program metadata persisted in workspace state. */
export interface RecentProgram { md5: string; name: string; path?: string; lastUsed: number }

/** A program belongs to the focused Ghidra resource, including graphical tabs. */
export class ProgramContext implements vscode.Disposable {
    /** Currently active program MD5. */
    private selected?: string;
    /** Emitter for active program selection changes. */
    private readonly changed = new vscode.EventEmitter<string | undefined>();
    /** Event fired when the active program MD5 changes. */
    readonly onDidChange = this.changed.event;
    /** Known recent programs indexed by lowercase MD5. */
    private readonly programs = new Map<string, RecentProgram>();
    /** Programs currently being closed. */
    private readonly closing = new Set<string>();
    /** Programs this window works with: activated, or owning an open tab, until their session closes. */
    private readonly inUse = new Set<string>();
    /** Emitter for single-program vs multi-program window scope transitions. */
    private readonly scope = new vscode.EventEmitter<void>();
    /** Fires when titles must start or stop naming their program. */
    readonly onDidChangeScope = this.scope.event;
    /** Monotonic counter used to discard stale activation calls. */
    private serial = 0;

    /** Initialize program history from workspace memento storage. */
    constructor(private readonly call: Call, private readonly state: vscode.Memento) {
        for (const program of state.get<RecentProgram[]>('ghidra.recentPrograms', [])) {
            if (program && typeof program.md5 === 'string') {
                const md5 = program.md5.toLowerCase();
                this.programs.set(md5, { ...program, md5 });
            }
        }
    }
    /** Active program MD5, or undefined when no program is selected. */
    get current(): string | undefined { return this.selected; }
    /** Return true while program `md5` is closing. */
    isClosing(md5: string): boolean { return this.closing.has(md5.toLowerCase()); }
    /** Mark program `md5` as closing and invalidate pending selection calls. */
    beginClosing(md5: string): void { md5 = md5.toLowerCase(); this.closing.add(md5); if (this.selected === md5) { ++this.serial; } }
    /** Clear the closing mark for program `md5`. */
    endClosing(md5: string): void { this.closing.delete(md5.toLowerCase()); }
    /** Recent programs sorted from newest to oldest use. */
    get recent(): RecentProgram[] { return [...this.programs.values()].sort((a, b) => b.lastUsed - a.lastUsed); }
    /** Display name for `md5`, falling back to the MD5 string. */
    name(md5: string): string { md5 = md5.toLowerCase(); return this.programs.get(md5)?.name || md5; }
    /** Recorded disk file path for `md5` when available. */
    path(md5: string): string | undefined { return this.programs.get(md5.toLowerCase())?.path; }
    /** True when more than one program is active or open in tabs. */
    get multiple(): boolean { return this.inUse.size > 1; }
    /** A tab title names its program only while this window works with more than one. */
    titled(label: string, md5: string): string { return this.multiple ? `${label} · ${this.name(md5)}` : label; }
    /** Record `md5` as in use and emit a scope change if multiplicity changed. */
    track(md5: string): void { this.scoped(() => this.inUse.add(md5.toLowerCase())); }
    /** Run `change` and emit `onDidChangeScope` if `multiple` changed. */
    private scoped(change: () => void): void {
        const before = this.multiple;
        change();
        if (before !== this.multiple) { this.scope.fire(); }
    }
    /** Extract a program MD5 from a string, URI, resource object, or current selection. */
    resolve(resource?: unknown): string | undefined {
        if (typeof resource === 'string') {
            if (/^[a-f\d]{32}$/i.test(resource)) { return resource.toLowerCase(); }
            if (/^ghidra(?:-(?:listing|memory|type(?:-current)?|string|reference))?:/.test(resource)) {
                try {
                    const parsed = vscode.Uri.parse(resource);
                    if (programSchemes.has(parsed.scheme)) { return parsed.authority.toLowerCase(); }
                } catch {}
            }
        }
        if (resource instanceof vscode.Uri && programSchemes.has(resource.scheme)) { return resource.authority.toLowerCase(); }
        if (resource && typeof resource === 'object') {
            const item = resource as { md5?: unknown; uri?: unknown };
            if (typeof item.md5 === 'string') { return item.md5.toLowerCase(); }
            if (item.uri) { return this.resolve(item.uri); }
        }
        return this.selected;
    }
    /** Resolve a non-closing program MD5 or throw a user-facing error. */
    require(resource?: unknown): string {
        const md5 = this.resolve(resource);
        if (!md5) { throw new Error('Open a binary or select a Ghidra session first'); }
        if (this.isClosing(md5)) { throw new Error('This Ghidra program is closing'); }
        return md5;
    }
    /** Activate program `md5`, persist state, and synchronize server session selection. */
    async activate(md5: string, name?: string, path?: string): Promise<void> {
        md5 = md5.toLowerCase();
        if (this.isClosing(md5)) { return; }
        const previous = this.programs.get(md5);
        const changed = this.selected !== md5;
        const serial = changed ? ++this.serial : this.serial;
        this.programs.set(md5, { md5, name: name || previous?.name || md5, path: path || previous?.path, lastUsed: Date.now() });
        this.selected = md5;
        this.track(md5);
        await this.persist();
        if (!changed || serial !== this.serial) { return; }
        this.changed.fire(md5);
        try { await this.call('ghidra.selectSession', { md5 }); }
        catch (error) {
            // Resource ownership remains valid even if the backend is temporarily unavailable.
            if (serial === this.serial) { throw error; }
        }
    }
    /** Record metadata and timestamp for `md5` without changing the active selection. */
    async remember(md5: string, name: string, path?: string): Promise<void> {
        md5 = md5.toLowerCase();
        const previous = this.programs.get(md5);
        this.programs.set(md5, { md5, name, path: path || previous?.path, lastUsed: Date.now() });
        await this.persist();
    }
    /** Restore open server sessions and reselect the last active program on startup. */
    async restore(): Promise<string | undefined> {
        const result = await this.call<{ sessions: { md5: string; status: string; fileName?: string; name?: string }[] }>('ghidra.sessions');
        const ready = result.sessions.filter(session => session.status === 'ready');
        for (const session of result.sessions.filter(session => ['ready', 'closed', 'killed', 'stale', 'disconnected'].includes(session.status))) {
            const id = session.md5.toLowerCase();
            if (!this.programs.has(id)) {
                this.programs.set(id, { md5: id, name: session.fileName || session.name || id, lastUsed: 0 });
            }
        }
        const saved = this.state.get<string>('ghidra.currentProgram')?.toLowerCase();
        const target = ready.find(session => session.md5.toLowerCase() === saved)
            || this.recent.map(program => ready.find(session => session.md5.toLowerCase() === program.md5)).find(Boolean);
        if (target) { await this.activate(target.md5); }
        else { await this.persist(); this.changed.fire(undefined); }
        return this.current;
    }
    /** Remove `md5` from active use and clear selection if it was current. */
    async closed(md5: string): Promise<void> {
        md5 = md5.toLowerCase();
        this.scoped(() => this.inUse.delete(md5));
        if (this.selected === md5) {
            this.selected = undefined;
            ++this.serial;
            this.changed.fire(undefined);
        }
        await this.persist();
    }
    /** Save recent programs and current MD5 to workspace memento storage. */
    private async persist(): Promise<void> {
        await this.state.update('ghidra.recentPrograms', this.recent.slice(0, 30));
        await this.state.update('ghidra.currentProgram', this.selected);
    }
    /** Dispose context event emitters. */
    dispose(): void { this.changed.dispose(); this.scope.dispose(); }
}

/** A sidebar header shows its count in muted text, naming its program only while more than one is in use. */
export function viewDescription(context: { multiple?: boolean; name(md5: string): string }, md5: string | undefined, count?: number): string | undefined {
    if (!md5) { return undefined; }
    const program = context.multiple ? context.name(md5) : undefined;
    return count && count > 0 ? (program ? `${count} · ${program}` : String(count)) : program;
}
