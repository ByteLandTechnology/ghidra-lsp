// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

/**
 * Shared styles and address span helpers for Program Listing and Hex views.
 */
import { displayAddress } from './names';
import { escape } from './web';

/** Render a display address with the canonical address in its tooltip when shortened. */
export function addrSpan(address: string): string {
    const shown = displayAddress(address);
    return shown === address
        ? `<span>${escape(shown)}</span>`
        : `<span title="${escape(address)}">${escape(shown)}</span>`;
}

/** Shared CSS styles for full-program Listing and Hex webviews. */
export const programViewStyles = `
/* Scoped strictly to full-program Listing & Hex views; reuses pageStyles + viewStyles. */
.program-view main{max-width:none;padding:10px 16px 22px;display:flex;flex-direction:column;min-height:100vh}
.program-view.has-selection main{padding-bottom:68px}
.program-view.has-selection .table-wrap{padding-bottom:52px;scroll-padding-bottom:56px}
.program-view .pv-toolbar{display:flex;align-items:center;flex-wrap:nowrap;gap:4px;margin:0 0 8px;min-height:30px;min-width:0}
.program-view .pv-toolbar .icon-button{width:28px;min-width:28px;height:28px;padding:5px}
.program-view .pv-nav{display:flex;align-items:center;gap:2px;flex-shrink:0}
.program-view .pv-step{display:inline-flex;align-items:center;gap:2px}
.program-view .pv-step[hidden]{display:none}
.program-view .pv-divider{width:1px;height:16px;margin:0 2px;background:var(--vscode-panel-border);flex-shrink:0}
.program-view #goto{display:flex;align-items:center;gap:3px;flex:0 1 156px;min-width:104px}
.program-view #address{flex:1;width:0;min-width:72px;height:28px;padding:3px 7px;font-size:12px;font-family:var(--vscode-editor-font-family,monospace);font-variant-numeric:tabular-nums}
.program-view #goto button{width:28px;min-width:28px;height:28px;min-height:0;padding:5px}
.program-view .browser-search{flex:1 1 110px;max-width:260px;min-width:88px}
.program-view .browser-search input{height:28px;padding-top:3px;padding-bottom:3px}
.program-view .page-options>summary{width:28px;height:28px}
.program-view .pv-tools{display:flex;align-items:center;gap:2px;margin-left:auto;flex-shrink:0}
.program-view .icon-button[aria-pressed="true"]{color:var(--ghidra-accent);background:var(--ghidra-pressed-bg);box-shadow:inset 0 0 0 1px var(--ghidra-focus)}
.program-view .icon-button:disabled{opacity:.4}
.program-view .page-options-content{max-width:calc(100vw - 24px)}
.program-view .page-options-content>label.pv-option-row{flex-direction:column;align-items:stretch;gap:4px;padding:5px 7px;font-size:11px;color:var(--ghidra-muted)}
.program-view .pv-option-row select{width:100%;height:28px;font-size:12px;padding:2px 6px;border:1px solid var(--vscode-input-border,var(--vscode-panel-border));border-radius:2px;background:var(--vscode-dropdown-background,var(--vscode-input-background));color:var(--vscode-dropdown-foreground,var(--vscode-input-foreground))}
.program-view .selection-tools{width:max-content;max-width:calc(100% - 24px);bottom:12px;margin-bottom:0;padding:4px 6px 4px 12px;gap:8px;flex-wrap:nowrap}
.program-view #selection-label{flex:0 1 auto;flex-basis:auto;max-width:min(340px,54vw)}

/* Listing Grid */
.program-view[data-view-kind="listing"] .table-wrap{max-height:max(220px,calc(100vh - 100px));overflow:auto;flex:1;min-width:0}
.program-view[data-view-kind="listing"] table.listing-table{width:100%;border-collapse:collapse;table-layout:auto;font-family:var(--vscode-editor-font-family,monospace);font-size:12px;font-variant-numeric:tabular-nums}
.program-view[data-view-kind="listing"] table.listing-table th{font-family:var(--vscode-font-family);font-size:11px;font-weight:600;padding:6px 8px;white-space:nowrap;border-bottom:1px solid var(--vscode-panel-border)}
.program-view[data-view-kind="listing"] table.listing-table td{padding:3px 8px;line-height:1.45;border-bottom:0;vertical-align:top;white-space:pre-wrap;overflow-wrap:anywhere}
.program-view[data-view-kind="listing"] tr.listing-unit-row{cursor:pointer;border-bottom:1px solid color-mix(in srgb,var(--vscode-panel-border) 35%,transparent)}
.program-view[data-view-kind="listing"] tr.listing-unit-row:hover{background:var(--vscode-list-hoverBackground)}
.program-view[data-view-kind="listing"] tr.listing-unit-row.selected{background:var(--ghidra-selection-bg);color:var(--ghidra-selection-fg)}
.program-view[data-view-kind="listing"] tr.listing-unit-row.selected:focus{background:var(--ghidra-active-selection-bg);color:var(--ghidra-active-selection-fg)}
.program-view[data-view-kind="listing"] tr.listing-unit-row.selected td.addr{color:inherit;font-weight:600;box-shadow:inset 3px 0 var(--ghidra-focus)}
.program-view[data-view-kind="listing"] tr.listing-unit-row.selected:focus td.addr{box-shadow:inset 3px 0 var(--ghidra-active-selection-fg)}
.program-view[data-view-kind="listing"] table.listing-table td.addr{width:1%;min-width:max-content;white-space:nowrap;overflow-wrap:normal;padding-right:12px;color:var(--ghidra-muted)}
.program-view[data-view-kind="listing"] table.listing-table :is(th,td).col-bytes{width:116px;max-width:132px;color:var(--ghidra-muted);white-space:nowrap;overflow-wrap:normal;overflow:hidden;text-overflow:ellipsis;font-size:11px}
.program-view[data-view-kind="listing"] table.listing-table :is(th,td).col-mnemonic{width:72px;white-space:nowrap;overflow-wrap:normal;font-weight:600}
.program-view[data-view-kind="listing"] table.listing-table td.col-operands{width:auto;min-width:140px;white-space:pre-wrap}
.program-view[data-view-kind="listing"] table.listing-table td.col-comment{width:auto;max-width:260px;color:var(--ghidra-muted);font-size:11px;font-family:var(--vscode-font-family)}
.program-view[data-view-kind="listing"] tr.listing-unit-row.selected :is(td.col-bytes,td.col-comment){color:inherit}
.program-view[data-view-kind="listing"] .listing-aux-row td{padding:2px 8px;border-bottom:0}
.program-view[data-view-kind="listing"] .listing-block-row td{padding:9px 8px 4px;border-top:1px solid var(--vscode-panel-border);font-family:var(--vscode-font-family);font-size:11px;color:var(--ghidra-muted)}
.program-view[data-view-kind="listing"] .listing-block-name{font-weight:600;color:var(--vscode-foreground);margin-right:8px}
.program-view[data-view-kind="listing"] .listing-plate-row td{padding:4px 8px;color:var(--ghidra-muted);font-size:11px;white-space:pre-wrap}
.program-view[data-view-kind="listing"] .listing-fn-row td{padding:7px 8px 4px;border-top:1px solid color-mix(in srgb,var(--vscode-panel-border) 60%,transparent)}
.program-view[data-view-kind="listing"] .listing-fn-sig{font-size:12px;font-weight:600;line-height:1.4;overflow-wrap:anywhere}
.program-view[data-view-kind="listing"] .listing-fn-meta{font-family:var(--vscode-font-family);font-size:11px;color:var(--ghidra-muted);margin-top:2px}
.program-view[data-view-kind="listing"] .listing-var-list{margin-top:4px;padding-left:10px;border-left:1px solid var(--vscode-panel-border);font-size:11px;color:var(--ghidra-muted);display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:2px 14px}
.program-view[data-view-kind="listing"] .listing-label-row td{padding:3px 8px 1px}
.program-view[data-view-kind="listing"] .listing-label-main{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 12px}
.program-view[data-view-kind="listing"] .listing-label-name{font-weight:600;color:var(--vscode-symbolIcon-functionForeground,var(--vscode-foreground))}
.program-view[data-view-kind="listing"] .listing-xrefs{display:inline-flex;flex-wrap:wrap;align-items:center;gap:4px 6px;font-family:var(--vscode-font-family);font-size:11px;color:var(--ghidra-muted)}
.program-view[data-view-kind="listing"] .xref-static{font-family:var(--vscode-editor-font-family,monospace);font-size:11px;color:var(--ghidra-muted)}
.program-view[data-view-kind="listing"] .xref-link,.program-view[data-view-kind="listing"] .target-link{border:0;background:transparent;color:var(--vscode-textLink-foreground);font-family:var(--vscode-editor-font-family,monospace);font-size:11px;cursor:pointer;text-decoration:none}
.program-view[data-view-kind="listing"] .xref-link,.program-view[data-view-kind="listing"] .target-link:not(.target-inline),.program-view[data-view-kind="listing"] .expand-run-btn{display:inline-flex;align-items:center;min-width:24px;min-height:24px;padding:0 4px}
.program-view[data-view-kind="listing"] .xref-link{justify-content:center}
.program-view[data-view-kind="listing"] .target-link.target-inline{min-width:0;min-height:0;padding:0;font-size:inherit}
.program-view[data-view-kind="listing"] .xref-link:hover,.program-view[data-view-kind="listing"] .target-link:hover{text-decoration:underline;color:var(--vscode-textLink-activeForeground)}
.program-view[data-view-kind="listing"] tr.listing-unit-row.selected .target-link,.program-view[data-view-kind="listing"] tr.listing-unit-row.selected .target-link:hover{color:inherit;text-decoration:underline;text-underline-offset:2px}
.program-view[data-view-kind="listing"] .target-chips{display:inline-flex;flex-wrap:wrap;align-items:center;gap:6px;margin-left:8px;vertical-align:middle}
.program-view[data-view-kind="listing"] .listing-pre-row td,.program-view[data-view-kind="listing"] .listing-post-row td{padding:2px 8px;color:var(--ghidra-muted);font-size:11px}
.program-view[data-view-kind="listing"] tr.listing-undef-run{cursor:pointer;color:var(--ghidra-muted)}
.program-view[data-view-kind="listing"] tr.listing-undef-run td{vertical-align:middle}
.program-view[data-view-kind="listing"] tr.listing-undef-run:hover{background:var(--vscode-list-hoverBackground)}
.program-view[data-view-kind="listing"] .expand-run-btn{border:0;background:transparent;color:var(--vscode-textLink-foreground);font-size:11px;cursor:pointer;text-align:left}
.program-view[data-view-kind="listing"] .expand-run-btn:hover{text-decoration:underline}
.program-view.hide-bytes .col-bytes{display:none}
.program-view.hide-headers .listing-fn-row,.program-view.hide-headers .listing-plate-row,.program-view.hide-headers .listing-pre-row,.program-view.hide-headers .listing-post-row{display:none}
.program-view.hide-vars .listing-var-list{display:none}
.program-view.hide-xrefs .listing-xrefs,.program-view.hide-xrefs .target-chips{display:none}

/* Hex Grid & Data Inspector */
.program-view[data-view-kind="memory"] .hex-workspace{display:grid;grid-template-columns:minmax(0,max-content) minmax(256px,316px);gap:20px;align-items:start;min-width:0}
.program-view[data-view-kind="memory"] .hex-workspace[hidden]{display:none}
.program-view[data-view-kind="memory"].hide-inspector .hex-workspace{grid-template-columns:minmax(0,1fr)}
.program-view[data-view-kind="memory"].hide-inspector .hex-inspector{display:none}
.program-view[data-view-kind="memory"] .hex-main{min-width:0;display:flex;flex-direction:column}
.program-view[data-view-kind="memory"] .hex-grid-wrap{max-height:max(220px,calc(100vh - 150px));overflow:auto;min-width:0}
.program-view[data-view-kind="memory"] table.hex-table{width:auto;min-width:0;border-collapse:collapse;font-family:var(--vscode-editor-font-family,monospace);font-size:12px;font-variant-numeric:tabular-nums}
.program-view[data-view-kind="memory"] table.hex-table thead th{position:sticky;top:0;z-index:2;background:var(--vscode-editor-background);padding:4px 8px;height:26px;min-height:24px;font-size:11px;font-weight:600;color:var(--ghidra-muted);border-bottom:1px solid var(--vscode-panel-border);white-space:nowrap;vertical-align:middle}
.program-view[data-view-kind="memory"] table.hex-table thead th.addr{left:0;z-index:3;text-align:left}
.program-view[data-view-kind="memory"] table.hex-table tbody th.addr{position:sticky;left:0;top:auto;z-index:1;background:var(--vscode-editor-background);padding:3px 8px;height:24px;min-height:24px;line-height:18px;font-family:var(--vscode-editor-font-family,monospace);font-size:11px;font-weight:400;font-variant-numeric:tabular-nums;color:var(--ghidra-muted);border-bottom:0;white-space:nowrap;vertical-align:middle;text-align:left;cursor:pointer}
.program-view[data-view-kind="memory"] table.hex-table td{padding:3px 8px;height:24px;min-height:24px;line-height:18px;border-bottom:0;white-space:nowrap;vertical-align:middle}
.program-view[data-view-kind="memory"] tr.hex-row{border-bottom:1px solid color-mix(in srgb,var(--vscode-panel-border) 30%,transparent)}
.program-view[data-view-kind="memory"] tr.hex-row:hover th.addr{background:var(--vscode-list-hoverBackground)}
.program-view[data-view-kind="memory"] tr.hex-row.selected{background:color-mix(in srgb,var(--vscode-focusBorder) 10%,var(--vscode-editor-background));color:var(--vscode-foreground)}
.program-view[data-view-kind="memory"] tr.hex-row.selected th.addr{color:var(--vscode-foreground);font-weight:600;background:color-mix(in srgb,var(--vscode-focusBorder) 12%,var(--vscode-editor-background));box-shadow:inset 3px 0 var(--ghidra-focus)}
.program-view[data-view-kind="memory"] table.hex-table th.hx-col,.program-view[data-view-kind="memory"] table.hex-table td.hb{width:25px;min-width:24px;height:25px;min-height:24px;padding:3px 2px;font-family:var(--vscode-editor-font-family,monospace);text-align:center;user-select:none}
.program-view[data-view-kind="memory"] table.hex-table th.hx-col.is-gap,.program-view[data-view-kind="memory"] table.hex-table td.hb.is-gap{border-left:1px solid color-mix(in srgb,var(--vscode-panel-border) 45%,transparent)}
.program-view[data-view-kind="memory"] td.hb[data-address]{cursor:pointer}
.program-view[data-view-kind="memory"] td.hb[data-address]:hover{background:var(--vscode-list-hoverBackground)}
.program-view[data-view-kind="memory"] td.hb:focus-visible{outline:2px solid var(--ghidra-focus);outline-offset:-2px;position:relative;z-index:1}
.program-view[data-view-kind="memory"] td.hb.is-null{color:var(--ghidra-muted)}
.program-view[data-view-kind="memory"] tr.hex-row.selected td.hb.is-null{color:var(--vscode-foreground)}
.program-view[data-view-kind="memory"] td.hb.is-pad{pointer-events:none}
.program-view[data-view-kind="memory"] td.hb.is-selected,.program-view[data-view-kind="memory"] .ha.is-selected{border-radius:3px;background:color-mix(in srgb,var(--vscode-focusBorder) 20%,var(--vscode-editor-background));color:var(--vscode-editor-foreground,var(--vscode-foreground));box-shadow:inset 0 0 0 1px var(--ghidra-focus);font-weight:600}
.program-view[data-view-kind="memory"] td.hex-ascii{letter-spacing:0;padding-left:10px;border-left:1px solid color-mix(in srgb,var(--vscode-panel-border) 50%,transparent)}
.program-view[data-view-kind="memory"] .ha{display:inline-block;width:8px;text-align:center;border-radius:2px}
.program-view[data-view-kind="memory"] .ha.is-pad{visibility:hidden}
.program-view[data-view-kind="memory"] .hex-inspector{min-width:0;padding:4px 0 8px 18px;border-left:1px solid var(--vscode-panel-border)}
.program-view[data-view-kind="memory"] .hex-inspector-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 6px}
.program-view[data-view-kind="memory"] .hex-inspector h2{font-size:12px;font-weight:600;margin:0;color:var(--vscode-foreground)}
.program-view[data-view-kind="memory"] .hex-endian-pill{display:inline-flex;align-items:center;min-height:24px;padding:2px 9px;border:1px solid var(--vscode-panel-border);border-radius:6px;background:var(--vscode-sideBar-background,var(--vscode-input-background));color:var(--ghidra-accent);font-size:11px;font-weight:600;line-height:1.2;white-space:nowrap;cursor:pointer}
.program-view[data-view-kind="memory"] .hex-endian-pill:hover{background:var(--vscode-list-hoverBackground);border-color:var(--ghidra-focus)}
.program-view[data-view-kind="memory"] .hex-endian-pill[aria-pressed="true"]{background:var(--ghidra-pressed-bg);border-color:var(--ghidra-focus);color:var(--ghidra-accent)}
.program-view[data-view-kind="memory"] .hex-inspector-meta{font-size:11px;color:var(--ghidra-muted);margin:0 0 10px;overflow-wrap:anywhere}
.program-view[data-view-kind="memory"] .hex-inspector dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:0}
.program-view[data-view-kind="memory"] .hex-inspector dl>div{display:flex;flex-direction:column;gap:3px;min-width:0;padding:8px 10px;border:1px solid color-mix(in srgb,var(--vscode-panel-border) 80%,transparent);border-radius:8px;background:color-mix(in srgb,var(--vscode-sideBar-background,var(--vscode-editor-background)) 75%,var(--vscode-editor-background));font-size:11px}
.program-view[data-view-kind="memory"] .hex-inspector dt{font-size:10.5px;color:var(--ghidra-muted);font-weight:600;line-height:1.25}
.program-view[data-view-kind="memory"] .hex-inspector dd{margin:0;font-family:var(--vscode-editor-font-family,monospace);font-size:12px;font-weight:600;font-variant-numeric:tabular-nums;color:var(--vscode-foreground);overflow-wrap:anywhere;line-height:1.3}
.program-view[data-view-kind="memory"] .hex-ptr-btn{display:inline-flex;align-items:center;min-height:24px;padding:0;border:0;background:transparent;color:var(--vscode-textLink-foreground);font-family:var(--vscode-editor-font-family,monospace);font-size:12px;font-weight:600;cursor:pointer;text-align:left}
.program-view[data-view-kind="memory"] .hex-ptr-btn:hover{text-decoration:underline;color:var(--vscode-textLink-activeForeground)}
.program-view[data-view-kind="memory"] .memory-map{margin-top:12px;padding-top:10px;border-top:1px solid var(--vscode-panel-border)}
.program-view[data-view-kind="memory"] .memory-map>summary{font-size:12px;font-weight:600;color:var(--vscode-foreground);margin-bottom:8px}
.program-view[data-view-kind="memory"] .memory-map .table-wrap{max-height:240px}

@media(max-width:880px){
.program-view[data-view-kind="memory"] .hex-workspace{grid-template-columns:minmax(0,1fr);gap:12px}
.program-view[data-view-kind="memory"] .hex-grid-wrap{max-height:clamp(180px,calc(100vh - 265px),460px)}
.program-view[data-view-kind="memory"] .hex-inspector{border-left:0;border-top:1px solid var(--vscode-panel-border);padding:10px 0 4px}
.program-view[data-view-kind="memory"] .hex-inspector dl{grid-template-columns:repeat(auto-fill,minmax(148px,1fr));gap:8px}
.program-view[data-view-kind="memory"] .hex-inspector dl>div{padding:8px 10px}
}
@media(max-width:760px){
.program-view main{padding:10px 12px 24px}
.program-view[data-view-kind="listing"] table.listing-table th,.program-view[data-view-kind="listing"] table.listing-table td{padding-left:6px;padding-right:6px}
.program-view[data-view-kind="listing"] table.listing-table :is(th,td).col-bytes{width:92px;max-width:100px}
.program-view[data-view-kind="listing"] table.listing-table :is(th,td).col-mnemonic{width:60px}
.program-view[data-view-kind="listing"] table.listing-table td.col-comment{max-width:170px}
}
@media(max-width:580px){
.program-view[data-view-kind="memory"] table.hex-table thead th.addr,.program-view[data-view-kind="memory"] table.hex-table tbody th.addr,.program-view[data-view-kind="memory"] table.hex-table td.hex-ascii{padding-left:6px;padding-right:6px}
.program-view[data-view-kind="memory"] table.hex-table th.hx-col,.program-view[data-view-kind="memory"] table.hex-table td.hb{font-size:11px}
}
@media(max-width:520px){
.program-view .pv-toolbar{flex-wrap:wrap}
.program-view #goto{flex:1 1 120px}
.program-view .browser-search{order:4;flex:1 1 100%;max-width:none}
.program-view[data-view-kind="listing"] table.listing-table :is(th,td).col-bytes{width:72px;max-width:78px}
.program-view[data-view-kind="listing"] table.listing-table td.col-operands{min-width:110px}
.program-view[data-view-kind="listing"] table.listing-table th:first-child,.program-view[data-view-kind="listing"] table.listing-table tr.listing-unit-row td.addr{position:sticky;left:0;z-index:2;background:var(--vscode-editor-background)}
.program-view[data-view-kind="listing"] table.listing-table tr.listing-unit-row:hover td.addr{background:var(--vscode-list-hoverBackground)}
.program-view[data-view-kind="listing"] table.listing-table tr.listing-unit-row.selected td.addr{background:var(--ghidra-selection-bg);box-shadow:inset 3px 0 var(--ghidra-focus)}
.program-view[data-view-kind="listing"] table.listing-table tr.listing-unit-row.selected:focus td.addr{background:var(--ghidra-active-selection-bg);box-shadow:inset 3px 0 var(--ghidra-active-selection-fg)}
}
`;
