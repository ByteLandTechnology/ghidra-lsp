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
