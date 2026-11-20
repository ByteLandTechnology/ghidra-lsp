// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

/** Microsoft Codicons, using the bundled font and its accompanying license. */
export const callIcons = {
    info: 0xea74, project: 0xeb30, type: 0xea91, symbol: 0xea88, string: 0xeb8d, edit: 0xea73, trash: 0xea81, comment: 0xea6b, import: 0xea9a, export: 0xeaa1, save: 0xeb4b, search: 0xea6d, more: 0xea7c, plus: 0xea60, minus: 0xeb3b, entry: 0xea9a, columns: 0xeb56, right: 0xeab6, left: 0xeab5, callIncoming: 0xeb92, callOutgoing: 0xeb93, back: 0xea9b, forward: 0xea9c, graph: 0xebb9, callGraph: 0xebb9, function: 0xea8c, down: 0xeab4, up: 0xeaa1, callers: 0xeaa1, callees: 0xea9a,
    overview: 0xec05, fit: 0xeb4c, center: 0xebf8, focus: 0xeb03, depth: 0xebd2,
    refresh: 0xeb37, decompile: 0xeac4, listing: 0xeae9, memory: 0xeae8,
    references: 0xeb36, controlFlow: 0xeb03, details: 0xeb36, check: 0xeab2, close: 0xea76,
    link: 0xeb15, copy: 0xebcc, swap: 0xebcb,
} as const;
/** Render one bundled Codicon glyph as an HTML span element. */
export const callIcon = (name: keyof typeof callIcons, extra = ''): string => `<span class="call-icon${extra ? ` ${extra}` : ''}" aria-hidden="true">&#x${callIcons[name].toString(16)};</span>`;
