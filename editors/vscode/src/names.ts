// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

/** Symbol metadata fields used to format display names and tooltips. */
export interface SymbolName {
    name?: unknown;
    namespace?: unknown;
    demangled_name?: unknown;
}

/** Current template argument display mode controlled by `ghidraLsp.templateArguments`. */
let showTemplateArguments = false;
/** Presentation-only: `ghidraLsp.templateArguments` decides whether `Name<…>` expands. */
export function setShowTemplateArguments(show: boolean): void { showTemplateArguments = show; }

/** C++ operator suffixes that keep angle brackets when collapsing templates. */
const operatorSymbols = ['<<=', '>>=', '<=>', '<<', '>>', '<=', '>=', '->*', '->', '<', '>'];
/** Collapse every outermost template argument list to `<…>`, keeping `operator<`, `operator<<`, `operator->` and friends intact. Mirrors `brief_templates` in the LSP. */
export function briefTemplates(name: string): string {
    let out = '', depth = 0;
    for (let i = 0; i < name.length;) {
        if (depth === 0 && name.startsWith('operator', i) && (i === 0 || !/[\w]/.test(name[i - 1]))) {
            out += 'operator'; i += 8;
            while (name[i] === ' ') { out += ' '; i++; }
            const symbol = operatorSymbols.find(candidate => name.startsWith(candidate, i));
            if (symbol) { out += symbol; i += symbol.length; }
            continue;
        }
        const ch = name[i];
        // Only `Name<` opens template arguments; Ghidra namespaces such as `<EXTERNAL>` stay intact.
        if (ch === '<' && (depth > 0 || (i > 0 && /[\w>]/.test(name[i - 1])))) { if (depth === 0) { out += '<…>'; } depth++; }
        else if (ch === '>' && depth > 0) { depth--; }
        else if (depth === 0) { out += ch; }
        i++;
    }
    return depth > 0 ? name : out;
}

/** Format any name-like string, such as a namespace, under the current template display setting. */
export const displayTemplates = (name: string): string => showTemplateArguments ? name : briefTemplates(name);

/** Candidate item for sibling C++ template collision disambiguation. */
export interface TemplateItem {
    /** Stable key identifying this sibling node. */
    key: string;
    /** Visible collapsed or expanded label shown on the tree item. */
    label: string;
    /** Complete uncollapsed symbol or namespace name. */
    full: string;
}

/** Extract outermost `<...>` template argument lists using the same operator rules as `briefTemplates`. */
export function templateArgumentLists(name: string): string[] {
    const lists: string[] = [];
    let depth = 0, start = 0;
    for (let i = 0; i < name.length;) {
        if (depth === 0 && name.startsWith('operator', i) && (i === 0 || !/[\w]/.test(name[i - 1]))) {
            i += 8;
            while (name[i] === ' ') { i++; }
            const symbol = operatorSymbols.find(candidate => name.startsWith(candidate, i));
            if (symbol) { i += symbol.length; }
            continue;
        }
        const ch = name[i];
        if (ch === '<' && (depth > 0 || (i > 0 && /[\w>]/.test(name[i - 1])))) {
            if (depth === 0) { start = i + 1; }
            depth++;
        } else if (ch === '>' && depth > 0) {
            depth--;
            if (depth === 0) { lists.push(name.slice(start, i)); }
        }
        i++;
    }
    return depth > 0 ? [] : lists;
}

/** Split one template argument list on top-level commas outside nested brackets and parentheses. */
function splitTemplateArguments(list: string): string[] {
    const args: string[] = [];
    let angle = 0, paren = 0, start = 0;
    for (let i = 0; i < list.length; i++) {
        const ch = list[i];
        if (ch === '<') { angle++; }
        else if (ch === '>' && angle > 0) { angle--; }
        else if (ch === '(') { paren++; }
        else if (ch === ')' && paren > 0) { paren--; }
        else if (ch === ',' && angle === 0 && paren === 0) {
            args.push(list.slice(start, i).trim());
            start = i + 1;
        }
    }
    const tail = list.slice(start).trim();
    if (tail) { args.push(tail); }
    return args;
}

/** Strip leading `ns::` scope prefixes on type identifiers while keeping cv-qualifiers and pointers. */
function stripScopeQualifiers(typeText: string): string {
    let current = typeText.replace(/\s+/g, ' ').trim();
    let previous = '';
    while (current !== previous) {
        previous = current;
        current = current.replace(/\b[A-Za-z_]\w*(?:<[^<>]*>)?::/g, '');
    }
    return current;
}

/** Format one template argument list at a progressive conciseness `level` (`0` = compact to `3` = full). */
function formatTemplateBadgeList(list: string, level: number): string {
    const normalized = list.replace(/\s+/g, ' ').trim();
    if (level >= 3) { return `<${normalized}>`; }
    const args = splitTemplateArguments(normalized);
    if (!args.length) { return '<>'; }
    const foldInner = level <= 1;
    const firstOnly = (level === 0 || level === 2) && args.length > 1;
    const formatArg = (arg: string): string => {
        const unqualified = stripScopeQualifiers(arg);
        return foldInner ? briefTemplates(unqualified) : unqualified;
    };
    if (firstOnly) { return `<${formatArg(args[0])}, …>`; }
    return `<${args.map(formatArg).join(', ')}>`;
}

/** Build concise inline `<...>` badges for sibling C++ templates that collapse to identical labels. */
export function templateCollisionBadges(items: ReadonlyArray<TemplateItem>): Map<string, string> {
    const badges = new Map<string, string>();
    if (showTemplateArguments) { return badges; }
    const byLabel = new Map<string, TemplateItem[]>();
    for (const item of items) {
        if (!item.full || item.full === item.label) { continue; }
        const group = byLabel.get(item.label) || [];
        group.push(item);
        byLabel.set(item.label, group);
    }
    for (const group of byLabel.values()) {
        const specializations = [...new Set(group.map(item => item.full))];
        if (specializations.length < 2) { continue; }
        const parsed = new Map(specializations.map(full => [full, templateArgumentLists(full)]));
        const lengths = [...new Set([...parsed.values()].map(lists => lists.length))];
        const sharedCount = lengths.length === 1 ? lengths[0] : 0;
        const varyingIndices = sharedCount > 1
            ? Array.from({ length: sharedCount }, (_, index) => index)
                .filter(index => new Set(specializations.map(full => parsed.get(full)![index])).size > 1)
            : [];
        const renderAtLevel = (full: string, level: number): string => {
            const lists = parsed.get(full) || [];
            if (!lists.length) { return full; }
            const selected = level < 4 && varyingIndices.length ? varyingIndices.map(index => lists[index]) : lists;
            const listLevel = level >= 4 ? 3 : level;
            return selected.map(list => formatTemplateBadgeList(list, listLevel)).join(' · ');
        };
        let chosen = new Map<string, string>();
        for (let level = 0; level <= 4; level++) {
            const candidate = new Map(specializations.map(full => [full, renderAtLevel(full, level)]));
            if (new Set(candidate.values()).size === specializations.length) {
                chosen = candidate;
                break;
            }
            chosen = candidate;
        }
        for (const item of group) {
            const badge = chosen.get(item.full);
            if (badge) { badges.set(item.key, badge); }
        }
    }
    return badges;
}

/** Split a qualified name on `::` outside template argument lists. */
export function splitScope(name: string): string[] {
    const parts: string[] = []; let depth = 0, start = 0;
    for (let i = 0; i < name.length; i++) {
        if (name[i] === '<' && (depth > 0 || (i > 0 && /[\w>]/.test(name[i - 1])))) { depth++; } else if (name[i] === '>' && depth > 0) { depth--; }
        else if (depth === 0 && name.startsWith('::', i)) { parts.push(name.slice(start, i)); start = i + 2; i++; }
    }
    parts.push(name.slice(start));
    return parts;
}

/** The complete demangled or qualified name, for matching and tooltips. */
export function fullSymbolName(symbol: SymbolName, qualified = false): string {
    if (typeof symbol.demangled_name === 'string' && symbol.demangled_name) { return symbol.demangled_name; }
    const name = typeof symbol.name === 'string' ? symbol.name : '';
    const namespace = typeof symbol.namespace === 'string' ? symbol.namespace : '';
    return qualified && namespace && namespace !== 'Global' ? `${namespace}::${name}` : name;
}

/** The name as displayed; template arguments are elided unless the user enabled them. */
export function symbolName(symbol: SymbolName, qualified = false): string {
    const full = fullSymbolName(symbol, qualified);
    return showTemplateArguments ? full : briefTemplates(full);
}

/** Build a tooltip showing the full qualified name and raw mangled symbol name. */
export function symbolTooltip(symbol: SymbolName): string {
    const full = fullSymbolName(symbol, true);
    return typeof symbol.demangled_name === 'string' && symbol.demangled_name
        ? `${full}\nMangled: ${String(symbol.name || '')}` : full;
}

/**
 * Ghidra's own listing omits the default `ram` space. Every other space (OTHER, EXTERNAL, Harvard CODE…) keeps its
 * prefix, so a bare address always means `ram` and the shortening is reversible. Data attributes keep the full form.
 */
export const displayAddress = (value: string): string => /^ram:[0-9a-f]+$/i.test(value) ? value.slice(4) : value;
