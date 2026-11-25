// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

/**
 * Lightweight token colouring for webviews. Native editors keep their TextMate grammar and LSP semantic tokens;
 * these spans only mirror that vocabulary where code appears inside custom pages (Listing table, control-flow blocks,
 * inspector titles). Every colour comes from the active theme.
 */
import { splitScope } from './names';
import { escape } from './web';

/** x86/x64, ARM/AArch64 and MIPS register names; operands are matched whole-word and case-insensitively. */
const register = String.raw`(?:[re]?[abcd]x|[abcd][lh]|[re]?(?:si|di|sp|bp|ip)|[sd]il|[bs]pl|r(?:[89]|1[0-5])[dwb]?|[c-gs]s|[xyz]mm\d{1,2}|st\(?\d?\)?|[cd]r\d|[xw](?:[12]?\d|3[01])|wzr|xzr|w?sp|lr|pc|fp|r(?:\d|1[0-5])|[vqdsbh]\d{1,2}|\$[a-z0-9]{1,4})`;
/** Regular expression matching assembly tokens inside instruction operands. */
const tokenPattern = new RegExp([
    String.raw`(?<string>"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')`,
    String.raw`(?<keyword>\b(?:byte|word|dword|qword|tword|tbyte|xmmword|ymmword|zmmword|ptr|offset|short|near|far)\b)`,
    String.raw`(?<register>\b${register}\b)`,
    String.raw`(?<number>#?-?\b(?:0x[0-9a-f]+|[0-9][0-9a-f]*h|\d+)\b)`,
    String.raw`(?<symbol>[A-Za-z_.$?@][\w.$?@:<>…]*)`,
].join('|'), 'gi');

/** HTML or SVG element tag used to wrap highlighted tokens. */
type Tag = 'span' | 'tspan';
/** Wrap one escaped token in a themed CSS class span. */
const wrap = (tag: Tag, kind: string, text: string): string => `<${tag} class="tok-${kind}">${escape(text)}</${tag}>`;

/** Colour one instruction or data line: mnemonic, registers, immediates, strings, size keywords and symbols. */
export function highlightAsm(text: string, tag: Tag = 'span', withMnemonic = true): string {
    let rest = text, out = '';
    if (withMnemonic) {
        const head = /^(\s*)(\S+)/.exec(text);
        if (head) { out += escape(head[1]) + wrap(tag, 'mnemonic', head[2]); rest = text.slice(head[0].length); }
    }
    let last = 0;
    for (const match of rest.matchAll(tokenPattern)) {
        const groups = match.groups!;
        const kind = Object.keys(groups).find(key => groups[key] !== undefined)!;
        out += escape(rest.slice(last, match.index)) + wrap(tag, kind, match[0]);
        last = match.index! + match[0].length;
    }
    return out + escape(rest.slice(last));
}

/** Index of the parameter list's `(` outside template arguments, or -1. */
function parameterStart(name: string): number {
    let depth = 0;
    for (let i = 0; i < name.length; i++) {
        if (name[i] === '<' && (depth > 0 || (i > 0 && /[\w>]/.test(name[i - 1])))) { depth++; } else if (name[i] === '>' && depth > 0) { depth--; }
        else if (name[i] === '(' && depth === 0 && !/operator\s*$/.test(name.slice(0, i))) { return i; }
    }
    return -1;
}
/** Escape text and insert line-break opportunities after `::`, `<`, and `,`. */
const breakable = (value: string): string => escape(value).replace(/(::|&lt;|,)/g, '$1<wbr>');

/** A qualified C++ name: scopes and parameters recede so the declared name leads; breaks stay after `::`, `<` and `,`. */
export function highlightName(name: string): string {
    const open = parameterStart(name);
    const head = open < 0 ? name : name.slice(0, open), params = open < 0 ? '' : name.slice(open);
    const parts = splitScope(head), declared = parts.pop() ?? '';
    const scope = parts.map(part => `${breakable(part)}::<wbr>`).join('');
    return `${scope ? `<span class="tok-scope">${scope}</span>` : ''}<span class="tok-name">${breakable(declared)}</span>${params ? `<span class="tok-params">${breakable(params)}</span>` : ''}`;
}

/** Theme-sourced token colours shared by every webview. */
export const syntaxStyles = `
.tok-mnemonic{color:var(--vscode-symbolIcon-keywordForeground,var(--vscode-foreground));font-weight:600}
.tok-register{color:var(--vscode-symbolIcon-variableForeground,var(--vscode-foreground))}
.tok-number{color:var(--vscode-debugTokenExpression-number,var(--vscode-foreground))}
.tok-string{color:var(--vscode-debugTokenExpression-string,var(--vscode-foreground))}
.tok-keyword{color:var(--ghidra-muted)}
.tok-symbol{color:var(--vscode-symbolIcon-functionForeground,var(--vscode-foreground))}
.tok-scope,.tok-params{color:var(--ghidra-muted);font-weight:400}
.tok-name{color:var(--vscode-foreground)}
:is(tr.selected,.is-selected) :is(.tok-mnemonic,.tok-register,.tok-number,.tok-string,.tok-keyword,.tok-symbol,.tok-scope,.tok-params,.tok-name){color:inherit}
svg .tok-mnemonic{fill:var(--vscode-symbolIcon-keywordForeground,var(--vscode-foreground))}
svg .tok-register{fill:var(--vscode-symbolIcon-variableForeground,var(--vscode-foreground))}
svg .tok-number{fill:var(--vscode-debugTokenExpression-number,var(--vscode-foreground))}
svg .tok-string{fill:var(--vscode-debugTokenExpression-string,var(--vscode-foreground))}
svg .tok-keyword{fill:var(--ghidra-muted)}
svg .tok-symbol{fill:var(--vscode-symbolIcon-functionForeground,var(--vscode-foreground))}
`;
