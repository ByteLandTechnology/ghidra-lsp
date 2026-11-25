// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

import { callIcon } from './call-graph-icons';

/** Render the View Options button and its adjacent top-layer popover. */
export function pageOptionsPopover(extraContent = ''): string {
    return `<button type="button" id="page-options-button" class="icon-button page-options-button" popovertarget="page-options" aria-label="View options" title="View options">${callIcon('more')}</button><div id="page-options" class="page-options-content" popover="auto" data-popover-menu><div class="page-options-actions" role="group" aria-label="Page actions"><button type="button" id="page-options-refresh" class="icon-button" data-action="refresh" aria-label="Refresh" title="Refresh">${callIcon('refresh')}</button></div>${extraContent}</div>`;
}

/** Render the More Actions button and its adjacent top-layer popover. */
export function moreActionsPopover(): string {
    return `<button type="button" id="more-actions-button" class="icon-button more-actions-button" popovertarget="more-actions" aria-label="More actions" title="More actions" hidden>${callIcon('more')}</button><div id="more-actions" class="selection-buttons more-actions-content" popover="auto" data-popover-menu role="group" aria-label="Additional actions"></div>`;
}

/** Scoped to list pages, inspectors and edit forms; graph and native editors retain their own layout. */
export const viewStyles = `
/* Hallmark · app · analysis workbench · VS Code theme · direct, quiet controls */
/* Critique: align related views, reduce repeated chrome and keep actions discoverable. */
.inspector-page .call-icon,.edit-page .call-icon,.browser-page .call-icon{font:16px call-icons;display:inline-block;line-height:1;vertical-align:middle;flex-shrink:0}
.inspector-page main,.edit-page main{max-width:1060px;margin:0;padding:20px 24px 36px;position:relative}
.inspector-page header,.edit-page header{display:flex;align-items:center;gap:20px;justify-content:space-between;min-width:0;padding-bottom:16px;margin-bottom:16px}
.inspector-title{display:flex;align-items:flex-start;gap:8px;min-width:0;flex:1}
.inspector-title>div{min-width:0}
.inspector-page h1,.edit-page h1{font-size:20px;line-height:1.3;letter-spacing:-.015em;margin:0 0 4px;font-weight:600}
.inspector-page .eyebrow,.edit-page .eyebrow{position:absolute;width:1px;height:1px;padding:0;margin:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.inspector-page .subtitle,.edit-page .subtitle{font-size:12px;overflow-wrap:anywhere}
.inspector-actions{display:flex;align-items:center;gap:2px;flex-shrink:0}
.inspector-actions>button,.inspector-page .recovery>button,.inspector-menu-content button,.edit-page .form-actions button,.edit-page [data-add-row]{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:32px;font-size:12px;border-radius:3px}
.inspector-page .icon-button,.browser-page .icon-button{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;min-height:0;padding:7px;border:0;background:transparent;color:var(--vscode-foreground);border-radius:3px;flex-shrink:0}
.inspector-page .icon-button[hidden],.browser-page .icon-button[hidden]{display:none!important}
.inspector-page .icon-button:hover:enabled,.browser-page .icon-button:hover:enabled{background:var(--vscode-toolbar-hoverBackground,var(--vscode-list-hoverBackground))}
[data-popover-menu]:not(:popover-open){display:none}
[data-popover-menu]{position:fixed;inset:auto;margin:0;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);overflow-y:auto;border:1px solid var(--vscode-menu-border,var(--vscode-panel-border));border-radius:4px;background:var(--vscode-menu-background,var(--vscode-editor-background));color:var(--vscode-menu-foreground,var(--vscode-foreground));box-shadow:0 4px 12px var(--vscode-widget-shadow)}
.inspector-menu-content button{width:100%;justify-content:flex-start;text-align:left;border:0;background:transparent;color:inherit;padding:7px 9px}
.inspector-menu-content button:hover:enabled{background:var(--vscode-menu-selectionBackground,var(--vscode-list-hoverBackground));color:var(--vscode-menu-selectionForeground,var(--vscode-foreground))}
.inspector-menu-content .danger{color:var(--vscode-errorForeground);border-top:1px solid var(--vscode-panel-border);margin-top:4px;padding-top:10px}
/* Hallmark · data type editor · the definition is the work surface. */
.inspector-page[data-view-kind="type-editor"] main{max-width:1060px;margin:0;padding:16px 22px 32px}
.inspector-page[data-view-kind="type-editor"] main>header{align-items:flex-start;gap:16px;padding-bottom:12px;margin-bottom:16px;border-bottom:1px solid var(--vscode-panel-border)}
.inspector-page[data-view-kind="type-editor"] main>header .subtitle{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;margin:6px 0 0;font-size:12px;color:var(--ghidra-muted)}
.inspector-page[data-view-kind="type-editor"] .type-kind-badge{display:inline-flex;align-items:center;padding:1px 7px;border-radius:4px;font:600 11px/1.45 var(--vscode-editor-font-family,monospace);text-transform:lowercase;background:color-mix(in srgb,var(--vscode-focusBorder) 16%,var(--vscode-editor-background));border:1px solid color-mix(in srgb,var(--vscode-focusBorder) 38%,transparent);color:var(--vscode-foreground);white-space:nowrap}
.inspector-page[data-view-kind="type-editor"] .type-kind-badge.is-readonly{background:color-mix(in srgb,var(--vscode-descriptionForeground) 8%,var(--vscode-editor-background));border-color:var(--vscode-panel-border);color:var(--ghidra-muted)}
.inspector-page[data-view-kind="type-editor"] .type-meta-path{color:var(--ghidra-muted)}
.inspector-page[data-view-kind="type-editor"] .type-meta-sep{opacity:.55;user-select:none}
.inspector-page[data-view-kind="type-editor"] .type-meta-stat{font-variant-numeric:tabular-nums;white-space:nowrap}
.inspector-page[data-view-kind="type-editor"] .type-actions{display:inline-flex;align-items:center;gap:8px;flex-shrink:0}
.inspector-page[data-view-kind="type-editor"] .type-validation:not([hidden]){margin:8px 0 12px;padding:8px 12px;border-left:1px solid var(--vscode-errorForeground);color:var(--vscode-errorForeground);background:color-mix(in srgb,var(--vscode-errorForeground) 6%,var(--vscode-editor-background))}
.inspector-page[data-view-kind="type-editor"] .type-status{display:inline-flex;align-items:center;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:500;color:var(--ghidra-muted);background:var(--vscode-sideBar-background,var(--vscode-editor-background));border:1px solid var(--vscode-panel-border);white-space:nowrap}
.inspector-page[data-view-kind="type-editor"] .type-status:empty{position:absolute;width:1px;height:1px;padding:0;margin:0;border:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.inspector-page[data-view-kind="type-editor"] .type-status[data-state="dirty"]{color:var(--ghidra-warning);border-color:color-mix(in srgb,var(--ghidra-warning) 45%,transparent)}
.inspector-page[data-view-kind="type-editor"] .type-status[data-state="saving"]{color:var(--ghidra-accent);border-color:color-mix(in srgb,var(--ghidra-accent) 45%,transparent)}
.inspector-page[data-view-kind="type-editor"] .type-actions [data-open-jsonc]{display:inline-flex;align-items:center;gap:6px;min-height:28px;padding:4px 10px;border:1px solid var(--vscode-panel-border);border-radius:6px;background:var(--vscode-button-secondaryBackground,var(--vscode-input-background));color:var(--vscode-button-secondaryForeground,var(--vscode-foreground));font-size:12px;font-weight:500;cursor:pointer;white-space:nowrap}
.inspector-page[data-view-kind="type-editor"] .type-actions [data-open-jsonc]:hover:enabled{background:var(--vscode-button-secondaryHoverBackground,var(--vscode-list-hoverBackground));border-color:var(--ghidra-focus)}
.inspector-page[data-view-kind="type-editor"] .type-actions [data-open-jsonc] .call-icon{font-size:14px}
.inspector-page[data-view-kind="type-editor"] .type-icon{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;min-height:0;padding:6px;border:0;background:transparent;color:var(--ghidra-muted);border-radius:3px}
.inspector-page[data-view-kind="type-editor"] .type-icon:hover{background:var(--vscode-toolbar-hoverBackground,var(--vscode-list-hoverBackground));color:var(--vscode-foreground)}
.inspector-page[data-view-kind="type-editor"] .type-list{margin:0 0 20px;padding-top:12px}
.inspector-page[data-view-kind="type-editor"] .type-list:first-of-type{border-top:0;padding-top:0}
.inspector-page[data-view-kind="type-editor"] .type-definition{margin:0 0 20px;padding:0;border:0}
.inspector-page[data-view-kind="type-editor"] .hint{margin:0 0 8px;font-size:12px;line-height:1.5}
.inspector-page[data-view-kind="type-editor"] .type-table-wrap{max-width:100%;overflow:auto}
.inspector-page[data-view-kind="type-editor"] .type-table{table-layout:fixed;min-width:520px}
.inspector-page[data-view-kind="type-editor"] .type-table th{position:sticky;top:0;z-index:1;padding:6px 8px;font-weight:500;background:var(--vscode-editor-background)}
.inspector-page[data-view-kind="type-editor"] .type-sort{display:inline-flex;align-items:center;gap:5px;min-height:0;padding:0;border:0;background:transparent;color:inherit;font:inherit;text-align:left}
.inspector-page[data-view-kind="type-editor"] .type-sort:hover{color:var(--vscode-foreground)}
.inspector-page[data-view-kind="type-editor"] th[aria-sort="none"] .type-sort:hover span::after,.inspector-page[data-view-kind="type-editor"] th[aria-sort="none"] .type-sort:focus-visible span::after{content:'↕';opacity:.7}
.inspector-page[data-view-kind="type-editor"] th[aria-sort="ascending"] .type-sort span::after{content:'↑'}
.inspector-page[data-view-kind="type-editor"] th[aria-sort="descending"] .type-sort span::after{content:'↓'}
.inspector-page[data-view-kind="type-editor"] .type-table td{padding:3px 4px;vertical-align:middle}
.inspector-page[data-view-kind="type-editor"] .type-table tbody tr:hover:not([data-new]){background:var(--vscode-list-hoverBackground,var(--vscode-editor-background))}
.inspector-page[data-view-kind="type-editor"] .type-table tbody tr:focus-within:not([data-new]){background:color-mix(in srgb,var(--vscode-focusBorder) 8%,var(--vscode-editor-background));box-shadow:inset 2px 0 var(--ghidra-focus),inset 0 0 0 1px color-mix(in srgb,var(--ghidra-focus) 48%,transparent)}
.inspector-page[data-view-kind="type-editor"] .type-table tbody tr:focus-within:not([data-new]) input:not(:focus){color:var(--vscode-editor-foreground,var(--vscode-foreground))}
.inspector-page[data-view-kind="type-editor"] .type-table input{width:100%;height:32px;min-width:0;border:1px solid transparent;border-radius:2px;background:transparent;cursor:text}
.inspector-page[data-view-kind="type-editor"] .type-table input:hover{background:var(--vscode-input-background);border-color:var(--vscode-input-border,transparent)}
.inspector-page[data-view-kind="type-editor"] .type-table input:focus{background:var(--vscode-input-background);outline:2px solid var(--ghidra-focus);outline-offset:-2px}
.inspector-page[data-view-kind="type-editor"] .type-table td[data-field="offset"] input,.inspector-page[data-view-kind="type-editor"] .type-table td[data-field="length"] input,.inspector-page[data-view-kind="type-editor"] .type-table td[data-field="value"] input{font-variant-numeric:tabular-nums}
.inspector-page[data-view-kind="type-editor"] .type-table th[data-field="offset"]{width:88px}
.inspector-page[data-view-kind="type-editor"] .type-table th[data-field="length"]{width:100px}
.inspector-page[data-view-kind="type-editor"] .type-table .type-handle-col,.inspector-page[data-view-kind="type-editor"] .type-table .type-action-col{width:36px}
.inspector-page[data-view-kind="type-editor"] .type-row-action{text-align:center}
.inspector-page[data-view-kind="type-editor"] .type-row-handle{opacity:.65}
.inspector-page[data-view-kind="type-editor"] .type-row-action{opacity:.7;transition:opacity .12s ease}
@media(hover:hover){.inspector-page[data-view-kind="type-editor"] .type-row-action{opacity:0}}
.inspector-page[data-view-kind="type-editor"] .type-table tr:hover .type-row-handle,.inspector-page[data-view-kind="type-editor"] .type-table tr:hover .type-row-action,.inspector-page[data-view-kind="type-editor"] .type-table tr:focus-within .type-row-handle,.inspector-page[data-view-kind="type-editor"] .type-table tr:focus-within .type-row-action{opacity:1}
@media(prefers-reduced-motion:reduce){.inspector-page[data-view-kind="type-editor"] .type-row-action{transition:none}}
.inspector-page[data-view-kind="type-editor"] .type-move{cursor:grab;touch-action:none}
.inspector-page[data-view-kind="type-editor"] .type-move:active{cursor:grabbing}
.inspector-page[data-view-kind="type-editor"] .type-move svg{width:16px;height:16px;fill:currentColor}
.inspector-page[data-view-kind="type-editor"] .type-table tr.is-dragging{opacity:.45}
.inspector-page[data-view-kind="type-editor"] .type-table tr.type-drop-before{box-shadow:inset 0 2px var(--ghidra-focus)}
.inspector-page[data-view-kind="type-editor"] .type-table tr.type-drop-after{box-shadow:inset 0 -2px var(--ghidra-focus)}
.inspector-page[data-view-kind="type-editor"] .type-table tr[data-new] td:not([data-field="name"])>*{visibility:hidden}
.inspector-page[data-view-kind="type-editor"] .type-table tr[data-new] td[data-field="name"]{padding-top:6px}
.inspector-page[data-view-kind="type-editor"] .type-table tr[data-new] td[data-field="name"] input{border:1px dashed color-mix(in srgb,var(--vscode-panel-border) 85%,var(--ghidra-muted));border-radius:6px;padding:0 10px;background:color-mix(in srgb,var(--vscode-editor-background) 70%,var(--vscode-sideBar-background,var(--vscode-editor-background)))}
.inspector-page[data-view-kind="type-editor"] .type-table tr[data-new] td[data-field="name"] input:hover,.inspector-page[data-view-kind="type-editor"] .type-table tr[data-new] td[data-field="name"] input:focus{border-style:solid;border-color:var(--ghidra-focus);background:var(--vscode-input-background)}
.inspector-page[data-view-kind="type-editor"] .type-table tr[data-new] input::placeholder{color:var(--ghidra-placeholder);opacity:1}
.inspector-page[data-view-kind="type-editor"] .type-raw pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 var(--vscode-editor-font-family,monospace)}
.inspector-page[data-view-kind="type-editor"] .type-empty{margin:0;padding:12px 8px;color:var(--ghidra-muted);border-top:1px solid var(--vscode-panel-border)}
.inspector-page .type-sr-only,.edit-page .type-sr-only{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.inspector-page[data-view-kind="type-editor"] .form-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,200px),1fr));gap:12px}
.inspector-page[data-view-kind="type-editor"] .form-grid label:not(.type-flag){display:flex;flex-direction:column;gap:4px;min-width:0}
.inspector-page[data-view-kind="type-editor"] .form-grid input:not([type="checkbox"]){width:100%;min-width:0}
.inspector-page[data-view-kind="type-editor"] .type-flags{display:flex;flex-wrap:wrap;gap:8px 24px;margin-top:12px}
.inspector-page[data-view-kind="type-editor"] .type-flag{display:flex;align-items:center;gap:8px;min-height:32px}

@media(max-width:640px){
.inspector-page[data-view-kind="type-editor"] main{padding:12px 12px 24px}
.inspector-page[data-view-kind="type-editor"] .inspector-tools,.inspector-page[data-view-kind="type-editor"] .inspector-actions,.inspector-page[data-view-kind="type-editor"] .type-actions{flex-wrap:wrap;min-width:0;max-width:100%}
.inspector-page[data-view-kind="type-editor"] .type-status{white-space:normal;overflow-wrap:anywhere;max-width:100%}
.inspector-page[data-view-kind="type-editor"] .type-table,.inspector-page[data-view-kind="type-editor"] .type-table tbody{display:block;min-width:0}
.inspector-page[data-view-kind="type-editor"] .type-table thead{display:block}
.inspector-page[data-view-kind="type-editor"] .type-table thead tr{display:grid;grid-template-columns:32px repeat(2,minmax(0,1fr)) 32px;gap:4px 8px;padding:4px 0 8px;border-bottom:1px solid var(--vscode-panel-border)}
.inspector-page[data-view-kind="type-editor"] .type-table thead th[data-field]{position:static;width:auto;min-width:0;padding:2px 4px}
.inspector-page[data-view-kind="type-editor"] .type-table thead .type-handle-col,.inspector-page[data-view-kind="type-editor"] .type-table thead .type-action-col{display:none}
.inspector-page[data-view-kind="type-editor"] .type-table th[data-field="offset"],.inspector-page[data-view-kind="type-editor"] .type-table:not([data-kind="struct"],[data-kind="structure"]) th[data-field="name"]{grid-column:2;grid-row:1}
.inspector-page[data-view-kind="type-editor"] .type-table:is([data-kind="struct"],[data-kind="structure"]) th[data-field="name"],.inspector-page[data-view-kind="type-editor"] .type-table th[data-field="value"],.inspector-page[data-view-kind="type-editor"] .type-table:not([data-kind="struct"],[data-kind="structure"]) th[data-field="type"]{grid-column:3;grid-row:1}
.inspector-page[data-view-kind="type-editor"] .type-table:is([data-kind="struct"],[data-kind="structure"]) th[data-field="type"],.inspector-page[data-view-kind="type-editor"] .type-table:not([data-kind="struct"],[data-kind="structure"]) th[data-field="length"]{grid-column:2;grid-row:2}
.inspector-page[data-view-kind="type-editor"] .type-table:is([data-kind="struct"],[data-kind="structure"]) th[data-field="length"]{grid-column:3;grid-row:2}
.inspector-page[data-view-kind="type-editor"] .type-table tbody tr{display:grid;grid-template-columns:32px repeat(2,minmax(0,1fr)) 32px;gap:6px 8px;padding:8px 0;border-bottom:1px solid var(--vscode-panel-border)}
.inspector-page[data-view-kind="type-editor"] .type-table tr:last-child{border-bottom:0}
.inspector-page[data-view-kind="type-editor"] .type-table td{display:block;min-width:0;padding:0;border:0}
.inspector-page[data-view-kind="type-editor"] .type-table tr[data-new] td:not([data-field="name"]){display:none}
.inspector-page[data-view-kind="type-editor"] .type-table tr[data-new] td[data-field="name"]{grid-column:2/4;grid-row:1}
.inspector-page[data-view-kind="type-editor"] .type-table .type-row-handle{grid-column:1;grid-row:1;align-self:center}
.inspector-page[data-view-kind="type-editor"] .type-table .type-row-action{grid-column:4;grid-row:1;align-self:center}
.inspector-page[data-view-kind="type-editor"] .type-table td[data-field="offset"],.inspector-page[data-view-kind="type-editor"] .type-table:not([data-kind="struct"],[data-kind="structure"]) td[data-field="name"]{grid-column:2;grid-row:1}
.inspector-page[data-view-kind="type-editor"] .type-table:is([data-kind="struct"],[data-kind="structure"]) td[data-field="name"],.inspector-page[data-view-kind="type-editor"] .type-table td[data-field="value"],.inspector-page[data-view-kind="type-editor"] .type-table:not([data-kind="struct"],[data-kind="structure"]) td[data-field="type"]{grid-column:3;grid-row:1}
.inspector-page[data-view-kind="type-editor"] .type-table:is([data-kind="struct"],[data-kind="structure"]) td[data-field="type"],.inspector-page[data-view-kind="type-editor"] .type-table:not([data-kind="struct"],[data-kind="structure"]) td[data-field="length"]{grid-column:2;grid-row:2}
.inspector-page[data-view-kind="type-editor"] .type-table:is([data-kind="struct"],[data-kind="structure"]) td[data-field="length"]{grid-column:3;grid-row:2}
.edit-page .editable,.edit-page .editable thead,.edit-page .editable tbody{display:block;min-width:0}
.edit-page .editable tr{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 8px;align-items:center;padding:6px;border-bottom:1px solid var(--vscode-panel-border)}
.edit-page .editable tr:has(.row-remove,.editable-action-col){grid-template-columns:repeat(2,minmax(0,1fr)) 32px}
.edit-page .editable tbody tr:last-child{border-bottom:0}
.edit-page .editable th,.edit-page .editable td,.edit-page .editable td:last-child:has(.row-remove){display:block;width:auto;min-width:0;padding:0;border:0;overflow-wrap:anywhere}
.edit-page .editable th:not(.editable-action-col){padding:2px 4px}
.edit-page .editable .row-remove{opacity:1}
}

.inspector-page h2{font-size:13px;font-weight:600;margin-bottom:8px}
.inspector-page section{margin:20px 0;padding-top:14px}
.inspector-page[data-view-kind="function"] main>section:first-of-type,.inspector-page[data-view-kind="symbol"] main>section:first-of-type{border-top:0;margin-top:0;padding-top:0}
.inspector-page[data-view-kind="type"] .type-meta{display:flex;flex-wrap:wrap;gap:8px 20px;color:var(--ghidra-muted)}
.inspector-page[data-view-kind="type"] .type-meta>div{display:block;padding:0;border:0;font-size:12px}
.inspector-page[data-view-kind="type"] .type-meta dt{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.inspector-page[data-view-kind="type"] .type-members{margin:16px 0 20px;padding:0;border:0}
.inspector-page dl>div{grid-template-columns:135px minmax(0,1fr);padding:8px 0;font-size:12px}
.inspector-page dd{font-variant-numeric:tabular-nums}
.inspector-page[data-view-kind="symbol"] .symbol-data dl>div:last-child{grid-column:1/-1}
.inspector-page th,.inspector-page td{padding:8px 10px;font-size:12px}
.inspector-page .table-wrap table{min-width:540px}
.inspector-page .table-wrap{border:0;border-radius:0;scrollbar-width:thin}
.inspector-page[data-view-kind="type"] .type-fields table{table-layout:fixed}
.inspector-page[data-view-kind="type"] .type-fields th:nth-child(1),.inspector-page[data-view-kind="type"] .type-fields th:nth-child(2){width:88px}
.inspector-page th{position:sticky;top:0;z-index:1;background:var(--vscode-editor-background)}
.inspector-page details{margin:18px 0;padding-top:14px}
.inspector-page summary{font-size:12px}
.inspector-page .description{font-size:12px;line-height:1.7}
.inspector-page .error:not(:empty),.edit-page .error:not(:empty){padding:10px 12px;border-left:1px solid var(--vscode-errorForeground);background:color-mix(in srgb,var(--vscode-errorForeground) 6%,var(--vscode-editor-background));font-size:12px}
.edit-page main{max-width:900px}
.edit-page #edit-form{max-width:none}
.edit-page .form-grid{grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:20px 24px}
.edit-page input:not([type="checkbox"]),.edit-page select{min-height:34px}
.edit-page label{font-size:12px}
.edit-page .form-fields{margin-top:0}
.edit-page :is(input,select,textarea,button){scroll-margin-block:12px 80px}
.edit-page .form-actions{position:sticky;bottom:0;z-index:2;background:var(--vscode-editor-background);padding:16px 0 8px;gap:8px}
.edit-page .form-hint{font-size:11px;line-height:1.65}
.edit-page .table-wrap{scrollbar-width:thin}
.edit-page .success:not(:empty){font-size:12px;padding:10px 0}
.edit-page .editable .editable-action-col{position:relative}
.edit-page .row-remove{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;min-height:0;padding:6px;border:0;background:transparent;color:var(--ghidra-muted)}
.edit-page .row-remove:hover:enabled{background:var(--vscode-toolbar-hoverBackground,var(--vscode-list-hoverBackground));color:var(--vscode-foreground)}
.browser-page main{max-width:1450px;margin:0;padding:20px 24px 32px}
.browser-page h1{font-size:16px;line-height:1.4;margin:0 0 2px}
.browser-page .subtitle{font-size:11px;overflow-wrap:anywhere}
.browser-page .toolbar{gap:8px;margin:0 0 12px;flex-wrap:nowrap}
.browser-page .toolbar:has(#goto-error:not(:empty)){align-items:flex-start}
.browser-page #goto{flex:0 1 225px;gap:3px}
.browser-page #address{flex:1 1 0;width:0;min-width:90px;height:32px;font-size:12px}
.browser-page #goto button{width:32px;min-width:32px;height:32px;min-height:0;padding:6px}
.browser-search{position:relative;display:flex;align-items:center;flex:1;min-width:0;max-width:520px}
.browser-search>.call-icon{position:absolute;left:9px;pointer-events:none;color:var(--ghidra-placeholder);font-size:14px}
.browser-page .browser-search input{width:100%;height:32px;padding-left:30px;min-width:0;max-width:none;font-size:12px}
.browser-page .scope{font-size:11px;line-height:1.6;margin:10px 0 12px;color:var(--ghidra-muted)}
.browser-page #filter-status{font-size:11px;margin:8px 0;color:var(--ghidra-muted)}
.browser-page #filter-status.sr-filter-status{position:absolute;width:1px;height:1px;padding:0;margin:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
html:has(body.browser-page.has-selection){scroll-padding-bottom:68px}
.browser-page.has-selection main{padding-bottom:76px}
.browser-page .selection-tools{position:fixed;z-index:4;left:50%;bottom:12px;transform:translateX(-50%);width:calc(100% - 32px);max-width:760px;box-shadow:0 3px 12px var(--vscode-widget-shadow);display:flex;align-items:center;flex-wrap:nowrap;gap:10px;padding:6px 10px;margin-bottom:0;border:1px solid var(--vscode-panel-border);border-radius:4px;background:var(--vscode-sideBar-background,var(--vscode-editor-background))}
.browser-page .selection-tools[hidden]{display:none!important}
.browser-page #selection-label{flex:1;min-width:0;margin:0;font-size:11px;color:var(--ghidra-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.browser-page .selection-buttons{gap:4px}
.browser-page .selection-buttons button{display:inline-flex;align-items:center;gap:6px;min-height:30px;padding:5px 8px;font-size:12px;border-radius:3px}
.browser-page .selection-buttons button.primary{color:var(--vscode-button-foreground,var(--vscode-foreground));background:var(--vscode-button-background,var(--vscode-editor-background))}
.browser-page .selection-buttons button.primary:hover:enabled{background:var(--vscode-button-hoverBackground,var(--vscode-list-hoverBackground))}
.browser-page .selection-buttons .icon-only{width:32px;min-width:32px;justify-content:center;padding:6px}
.browser-page .more-actions-button{width:30px;height:30px;min-height:0;padding:6px;border:0;background:transparent;border-radius:3px}
.browser-page #more-actions:popover-open{display:flex;flex-direction:row;flex-wrap:wrap;align-items:center;gap:2px;width:auto;padding:4px}
.browser-page #more-actions button{width:32px;min-width:32px;justify-content:center;padding:6px;border:0;background:transparent;color:inherit}
.browser-page #more-actions button:hover:enabled{background:var(--vscode-menu-selectionBackground,var(--vscode-list-hoverBackground));color:var(--vscode-menu-selectionForeground,var(--vscode-foreground))}
.browser-page .table-wrap{scroll-padding:36px 4px 4px;max-height:max(180px,min(620px,calc(100vh - 200px)));border:0;border-radius:0;scrollbar-width:thin}
.browser-page table{font-size:12px}
.browser-page.has-selection .table-wrap{padding-bottom:60px;scroll-padding-bottom:64px}
.browser-page th{position:sticky;top:0;z-index:1;background:var(--vscode-editor-background);font-size:11px;padding:8px 10px}
.browser-page td{padding:8px 10px;line-height:1.55;font-size:12px}
.browser-page td.addr{font-family:var(--vscode-editor-font-family,monospace);font-size:11px;font-variant-numeric:tabular-nums;white-space:nowrap;overflow-wrap:normal}
.browser-page tbody tr.selected{background:var(--ghidra-selection-bg);color:var(--ghidra-selection-fg)}
.browser-page tbody tr.selected:focus{background:var(--ghidra-active-selection-bg);color:var(--ghidra-active-selection-fg)}
.browser-page tr:focus-visible{outline:2px solid var(--ghidra-focus);outline-offset:-2px}
.browser-page tbody tr.selected:focus-visible{outline-color:var(--ghidra-active-selection-fg)}
.browser-page .table-empty{margin:0;padding:12px 0;color:var(--ghidra-muted);font-size:12px}
.browser-page .no-results{display:flex;align-items:center;gap:12px;margin:12px 0;padding:8px 0;color:var(--ghidra-muted);font-size:12px}
.browser-page .no-results[hidden]{display:none}
.browser-page .no-results button{min-height:28px;padding:2px 0;border:0;background:transparent;color:var(--vscode-textLink-foreground);font-size:12px}
.browser-page .no-results button:hover:enabled{text-decoration:underline}
.browser-page[data-view-kind="strings"] table{table-layout:fixed;min-width:560px}
.browser-page[data-view-kind="strings"] th:nth-child(1){width:150px}.browser-page[data-view-kind="strings"] th:nth-child(2){width:60px}.browser-page[data-view-kind="strings"] th:nth-child(3){width:160px}
.browser-page .cell-detail{display:none}
.browser-page[data-view-kind="strings"] td:nth-child(4){font-family:var(--vscode-editor-font-family,monospace)}
.browser-page[data-view-kind="imports"] td:first-child,.browser-page[data-view-kind="exports"] td:first-child{font:12px/1.55 var(--vscode-font-family);white-space:normal;overflow-wrap:anywhere;min-width:180px}
.browser-page section,.browser-page .memory-map{border-top:0;padding-top:0}
.browser-page[data-view-kind="references"] section{margin:18px 0;padding:0;border:0}
.browser-page[data-view-kind="references"] h2{font-size:12px;margin:0 0 8px}
.browser-page .pagination{gap:6px;margin-top:12px}
.browser-page .pagination button{display:flex;align-items:center;gap:6px;font-size:12px}
.browser-page .empty{font-size:12px}
.browser-page :is(button,summary,input,select):focus-visible,.inspector-page :is(button,summary,input,select):focus-visible,.edit-page :is(button,summary,input,select,textarea):focus-visible{outline:2px solid var(--ghidra-focus);outline-offset:2px}
.browser-page button,.inspector-page button,.edit-page button{transition:background-color 100ms ease,color 100ms ease}
@media(prefers-reduced-motion:reduce){.browser-page *,.inspector-page *,.edit-page *{animation:none!important;transition:none!important}}
@media(max-width:760px){.inspector-page header{position:relative;align-items:flex-start;flex-wrap:wrap;gap:14px}.inspector-page .inspector-title{flex:1 1 220px}.inspector-page .inspector-tools{margin-left:auto}}
@media(max-width:640px){.inspector-page[data-view-kind="type"] .type-fields tbody tr{border-bottom:1px solid var(--vscode-panel-border)}.inspector-page[data-view-kind="type"] .type-fields tbody tr:last-child{border-bottom:0}.inspector-page[data-view-kind="type"] .type-fields tbody td{border:0}}
@media(max-width:640px){.inspector-page .table-wrap table{min-width:0}.inspector-page main,.edit-page main{padding:18px 16px 28px}.inspector-page .inspector-actions{gap:4px}.inspector-page dl>div{grid-template-columns:105px minmax(0,1fr);gap:10px}.browser-page main{padding:14px 12px 24px}.browser-page.has-selection main{padding-bottom:72px}.browser-page .toolbar{gap:6px}.browser-page #goto{flex-basis:170px}.browser-page .selection-tools{width:calc(100% - 24px);gap:6px;padding:5px 8px}.browser-page[data-view-kind="strings"] th:nth-child(3),.browser-page[data-view-kind="strings"] td:nth-child(3){display:none}.browser-page[data-view-kind="strings"] .cell-detail{display:block;margin-top:4px;font:10px/1.4 var(--vscode-font-family);color:var(--ghidra-muted)}.browser-page[data-view-kind="strings"] tbody tr.selected .cell-detail{color:inherit}.browser-page[data-view-kind="strings"] table{min-width:0}.browser-page[data-view-kind="strings"] th:first-child{width:108px}.browser-page[data-view-kind="strings"] th:nth-child(2){width:64px}.browser-page[data-view-kind="strings"] th,.browser-page[data-view-kind="strings"] td{padding-left:7px;padding-right:7px}.browser-page .more-actions-button{margin-left:auto}.inspector-page .type-fields table{min-width:0;width:100%}.inspector-page .type-fields thead,.inspector-page .type-fields tbody{display:block}.inspector-page .type-fields tr{display:grid;grid-template-columns:54px 68px minmax(0,1fr) minmax(0,1fr)}.inspector-page .type-fields th,.inspector-page .type-fields td{min-width:0;padding:8px 4px;overflow-wrap:anywhere}.inspector-page[data-view-kind="type"] .type-fields th:nth-child(1),.inspector-page[data-view-kind="type"] .type-fields th:nth-child(2){width:auto}.inspector-page .type-fields th:nth-child(5){position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip-path:inset(50%)}.inspector-page .type-fields td:nth-child(5){grid-column:1/-1;padding:0 4px 8px;color:var(--ghidra-muted)}.inspector-page .type-fields td:nth-child(5):empty{display:none}.inspector-page .type-fields .link{white-space:normal;overflow-wrap:anywhere;text-align:left}.edit-page .form-grid{grid-template-columns:1fr}.edit-page .form-actions{flex-wrap:wrap}}
/* Keep both address entry and filtering usable in narrow editor groups. */
@media(max-width:440px){
.browser-page .toolbar:not(.selection-tools){flex-wrap:wrap}
.browser-page #goto{flex:1 1 100%}
.browser-page .browser-search{flex:1 1 120px;max-width:none}
.browser-page .pagination{flex-wrap:wrap}
.browser-page .no-results{align-items:flex-start;flex-wrap:wrap}
}
@media(max-height:420px){.edit-page .form-actions{position:static}}

/* Keep the first screen focused on the object and its primary task. */
.browser-page .page-context{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
.page-options-button{flex:none}
.page-options-content:popover-open{display:block;width:min(260px,calc(100vw - 16px));padding:8px}
.page-options-content>button,.page-options-content>label{display:flex;align-items:center;gap:8px;width:100%;padding:7px;text-align:left;background:transparent;color:var(--vscode-foreground);border:0}
.page-options-content p{font-size:11px;color:var(--ghidra-muted);padding:0 7px;line-height:1.6}
.browser-page:not(.show-extra-columns)[data-view-kind="strings"] :is(th,td):nth-child(2),
.browser-page:not(.show-extra-columns)[data-view-kind="strings"] :is(th,td):nth-child(3),
.browser-page:not(.show-extra-columns)[data-view-kind="imports"] :is(th,td):nth-child(4),
.browser-page:not(.show-extra-columns)[data-view-kind="exports"] :is(th,td):nth-child(n+3),
.browser-page:not(.show-extra-columns)[data-view-kind="references"] :is(th,td):nth-child(n+4),
.browser-page:not(.show-extra-columns)[data-view-kind="callers"] :is(th,td):nth-child(3),
.browser-page:not(.show-extra-columns)[data-view-kind="callees"] :is(th,td):nth-child(3){display:none}
.browser-page[data-view-kind="strings"] table{table-layout:auto;min-width:0}
.browser-page[data-view-kind="strings"] th:last-child{width:auto}
.browser-page:not(.show-extra-columns) .cell-detail{display:none!important}
.edit-page .advanced-fields{margin:18px 0}
.edit-page .advanced-fields[open]>summary{margin-bottom:16px}

.browser-page.show-extra-columns[data-view-kind="strings"] :is(th,td):nth-child(3){display:table-cell}

.browser-page .listing:not(.show-details) table{min-width:0;table-layout:auto}
/* The content establishes hierarchy; avoid a border around each section. */
.inspector-page header,.edit-page header{border:0;padding-bottom:0;margin-bottom:24px}
.inspector-page h1,.edit-page h1{font-size:16px;letter-spacing:normal}
.inspector-page main>details,.edit-page .advanced-fields,.inspector-page section,.edit-page section,.edit-page .form-actions{border-top:0}
.inspector-page dl>div{border-bottom:0}
.edit-page .editable:has(tbody:empty){display:none}
.edit-page .table-wrap:has(.editable tbody:empty){display:none}
@media(hover:hover){.edit-page .row-remove,.inspector-page[data-view-kind="type-editor"] .type-row-handle{opacity:0}.edit-page tr:hover .row-remove,.edit-page tr:focus-within .row-remove{opacity:1}}

/* Inspector identity: code-face values, history navigation and native-style loading (critique 2026-11-02). */
.inspector-page code.mono,.edit-page code.mono{font-family:var(--vscode-editor-font-family,monospace);font-size:inherit;font-variant-numeric:tabular-nums;color:inherit;background:none;padding:0;overflow-wrap:anywhere}
.inspector-page .subtitle code.mono{font-size:12px}
.inspector-page h1:focus:not(:focus-visible){outline:none}
.inspector-page h1{overflow-wrap:break-word}
.inspector-tools{display:flex;align-items:center;flex-shrink:0}.inspector-nav{display:flex;align-items:center;gap:2px;flex-shrink:0}
.inspector-page header:has(.inspector-nav){gap:12px}
.inspector-page .inspector-nav+.inspector-actions{padding-left:8px;border-left:1px solid var(--vscode-panel-border)}
.inspector-page .nowrap{white-space:nowrap}
.inspector-page .inspector-nav .icon-button:disabled{opacity:.4}
/* Second critique pass (2026-11-02): type links, grouping and details-on-demand storage. */
.inspector-page .type-category{color:var(--ghidra-muted);font-size:11px;overflow-wrap:anywhere}
.inspector-page .hex{font-size:inherit}
.inspector-page .detail-heading{font-size:12px;font-weight:600;margin:16px 0 0;color:var(--ghidra-muted)}
.inspector-page main>details>:not(summary){margin-left:16px}
.inspector-page main>details[open]{margin-bottom:28px}
.inspector-page[data-view-kind="function"] main>.function-definition+section{margin-top:14px}.inspector-page[data-view-kind="function"] main>.function-definition+section>h2{margin-bottom:2px}
.inspector-page .parameters .param-storage{display:none;color:var(--ghidra-muted)}
.inspector-page:has(#function-details[open]) .parameters .param-storage{display:inline}
.inspector-page .table-wrap:not(.type-fields) table{width:auto;min-width:min(100%,420px)}
.inspector-page .table-wrap:not(.type-fields) :is(th,td):not(:last-child){padding-right:32px}
.inspector-page .recovery{margin-top:12px}
/* Icon-first controls (2026-11-02): labels live in aria-label and tooltips. */
.edit-page [data-add-row].icon-add{width:32px;min-width:32px;padding:0}
.browser-page .pagination .icon-button:disabled{opacity:.4}
.browser-page .no-results .icon-button{width:28px;height:28px;padding:5px}
.edit-page .form-actions .icon-submit{width:36px;min-width:36px;height:32px;padding:0}
.edit-page .form-actions .icon-submit.danger{color:var(--vscode-button-foreground);background:var(--vscode-inputValidation-errorBorder,var(--vscode-errorForeground))}
.page-options-actions{display:flex;gap:2px;padding:0 0 6px;margin-bottom:6px;border-bottom:1px solid var(--vscode-panel-border)}
.page-options-content>.page-options-actions>button{width:32px;height:32px;padding:7px;justify-content:center}
.inspector-menu-content:popover-open{display:flex;align-items:center;gap:2px;width:auto;padding:4px}
.inspector-menu-content .icon-button{width:32px;min-height:0;padding:7px;justify-content:center}
.inspector-menu-content .icon-button.danger{color:var(--vscode-errorForeground);margin:0 0 0 3px;padding:7px;border-top:0;position:relative}
.inspector-menu-content .icon-button.danger::before{content:'';position:absolute;left:-3px;top:6px;bottom:6px;width:1px;background:var(--vscode-panel-border)}
@media(hover:hover){.inspector-page[data-view-kind="type-editor"] .type-row-action button,.inspector-page[data-view-kind="type-editor"] .type-row-handle .type-move{opacity:0}.inspector-page[data-view-kind="type-editor"] .type-table tr:hover :is(.type-row-handle,.type-row-handle .type-move,.type-row-action,.type-row-action button),.inspector-page[data-view-kind="type-editor"] .type-table tr:focus-within :is(.type-row-handle,.type-row-handle .type-move,.type-row-action,.type-row-action button){opacity:1}}
.browser-page tbody tr.selected{outline:2px solid var(--ghidra-active-border);outline-offset:-2px}
.browser-page tbody tr.selected:focus{outline:2px solid var(--ghidra-active-selection-fg);outline-offset:-2px}
body.inspector-page[data-view-kind="type-editor"]:is(.vscode-high-contrast,.vscode-high-contrast-light) :is(.type-table input,.type-table tr[data-new] td[data-field="name"] input),body.edit-page:is(.vscode-high-contrast,.vscode-high-contrast-light) .editable input{border:1px solid var(--ghidra-hv-border);background:var(--vscode-input-background)}
body.inspector-page[data-view-kind="type-editor"]:is(.vscode-high-contrast,.vscode-high-contrast-light) :is(.type-row-handle,.type-row-handle .type-move,.type-row-action,.type-row-action button),body.edit-page:is(.vscode-high-contrast,.vscode-high-contrast-light) .row-remove{opacity:1;transition:none}
body.inspector-page:is(.vscode-high-contrast,.vscode-high-contrast-light) :is(.icon-button,.inspector-menu>summary,.page-options>summary),body.inspector-page[data-view-kind="type-editor"]:is(.vscode-high-contrast,.vscode-high-contrast-light) :is(.type-icon,.type-actions [data-open-jsonc]),body.browser-page:is(.vscode-high-contrast,.vscode-high-contrast-light) :is(.icon-button:not([aria-pressed="true"]):not([aria-expanded="true"]),.more-actions>summary,.page-options>summary),body.edit-page:is(.vscode-high-contrast,.vscode-high-contrast-light) .row-remove{border:1px solid var(--ghidra-hv-border);color:var(--vscode-foreground)}
body.browser-page:is(.vscode-high-contrast,.vscode-high-contrast-light) tbody tr.selected,body.browser-page:is(.vscode-high-contrast,.vscode-high-contrast-light) tbody tr.selected:focus{background:var(--vscode-editor-background);color:var(--vscode-foreground);outline:2px solid var(--ghidra-active-border);outline-offset:-2px}
@media(prefers-contrast:more){
  .inspector-page[data-view-kind="type-editor"] .type-table input,.inspector-page[data-view-kind="type-editor"] .type-table tr[data-new] td[data-field="name"] input,.edit-page .editable input{border:1px solid var(--ghidra-hv-border);background:var(--vscode-input-background)}
  .inspector-page[data-view-kind="type-editor"] :is(.type-row-handle,.type-row-handle .type-move,.type-row-action,.type-row-action button),.edit-page .row-remove{opacity:1;transition:none}
  .inspector-page .icon-button,.browser-page .icon-button:not([aria-pressed="true"]):not([aria-expanded="true"]),.inspector-page[data-view-kind="type-editor"] .type-icon,.edit-page .row-remove,.inspector-menu>summary,.browser-page .more-actions>summary,.page-options>summary,.inspector-page[data-view-kind="type-editor"] .type-actions [data-open-jsonc]{border:1px solid var(--ghidra-hv-border);color:var(--vscode-foreground)}
}
@media(forced-colors:active){
  .inspector-page[data-view-kind="type-editor"] .type-table input,.inspector-page[data-view-kind="type-editor"] .type-table tr[data-new] td[data-field="name"] input,.edit-page .editable input{background:Field;color:FieldText;border:1px solid var(--ghidra-hv-border)}
  .inspector-page[data-view-kind="type-editor"] :is(.type-row-handle,.type-row-handle .type-move,.type-row-action,.type-row-action button),.edit-page .row-remove{opacity:1;transition:none}
  .inspector-page .icon-button,.browser-page .icon-button:not([aria-pressed="true"]):not([aria-expanded="true"]),.inspector-page[data-view-kind="type-editor"] .type-icon,.edit-page .row-remove,.inspector-menu>summary,.browser-page .more-actions>summary,.page-options>summary,.inspector-page[data-view-kind="type-editor"] .type-actions [data-open-jsonc]{background:ButtonFace;color:ButtonText;border:1px solid var(--ghidra-hv-border)}
  .browser-page tbody tr.selected,.browser-page tbody tr.selected:focus,.inspector-page[data-view-kind="type-editor"] .type-table tbody tr:focus-within:not([data-new]){background:var(--ghidra-selection-bg);color:var(--ghidra-selection-fg);box-shadow:none;outline:2px solid var(--ghidra-active-border);outline-offset:-2px}
  .browser-page tr:focus-visible,.browser-page :is(button,summary,input):focus-visible,.inspector-page :is(button,summary,input):focus-visible,.edit-page :is(button,summary,input,select,textarea):focus-visible{outline:2px solid var(--ghidra-focus);outline-offset:-2px}
  .browser-page .selection-tools,.inspector-menu-content,.page-options-content,.browser-page #selection-more,[data-popover-menu]{background:var(--ghidra-selection-bg);color:var(--ghidra-selection-fg);border:1px solid var(--ghidra-hv-border)}
}
`;

/** Format the search toggle tooltip for the active shortcut mode. */
export function searchShortcutTitle(label: string, singleKeyShortcuts: boolean): string {
    const mod = typeof process !== 'undefined' && process.platform === 'darwin' ? 'Cmd+F' : 'Ctrl+F';
    return `${label} (${singleKeyShortcuts ? '/' : mod})`;
}

/** Format the graph-fit tooltip for the active shortcut mode. */
export function fitGraphTitle(singleKeyShortcuts: boolean): string {
    return singleKeyShortcuts ? 'Fit the entire graph (0)' : 'Fit the entire graph';
}

/** Shared client script for shortcut guards, modifier keys, live updates, and tooltips. */
export const webviewShortcutScript = String.raw`
const shortcutGuardSelector='input,select,textarea,[contenteditable]:not([contenteditable="false" i]),button,summary,[role="button"],[popover]';
const isShortcutBlockedElement=node=>{const el=node instanceof Element?node:node?.parentElement;return Boolean(el)&&(Boolean(el.isContentEditable)||Boolean(el.closest(shortcutGuardSelector)))};
const canUseSingleKeyShortcut=(event,directTarget)=>{
  if(state.singleKeyShortcuts===false||event.ctrlKey||event.metaKey||event.altKey||event.isComposing){return false}
  if(document.querySelector('[popover]:popover-open')){return false}
  if(directTarget&&(event.target!==directTarget||(directTarget.contains(document.activeElement)&&document.activeElement!==directTarget))){return false}
  return !isShortcutBlockedElement(event.target)&&!isShortcutBlockedElement(document.activeElement);
};
const isModShortcut=(event,key)=>!event.altKey&&!event.shiftKey&&!event.isComposing&&(event.ctrlKey||event.metaKey)&&(event.key||'').toLowerCase()===key;
const syncShortcutHints=()=>{
  const platform=(navigator.userAgentData&&navigator.userAgentData.platform)||navigator.platform||navigator.userAgent||'';
  const mod=/Mac|iPhone|iPad|iPod/i.test(platform)?'Cmd+F':'Ctrl+F';
  const searchHint=state.singleKeyShortcuts===false?mod:'/';
  const cfgToggle=document.getElementById('cfg-search-toggle');if(cfgToggle){cfgToggle.title='Find blocks ('+searchHint+')'}
  const callToggle=document.getElementById('call-search-toggle');if(callToggle){callToggle.title='Find functions ('+searchHint+')'}
  const fitBtn=document.getElementById('graph-fit');if(fitBtn){fitBtn.title=state.singleKeyShortcuts===false?'Fit the entire graph':'Fit the entire graph (0)'}
};
const setSingleKeyShortcuts=enabled=>{
  state.singleKeyShortcuts=enabled!==false;
  syncShortcutHints();
  if(typeof persist==='function'){persist()}
};
const setBusyState=busy=>{
  const statusEl=document.getElementById('busy-status');
  if(busy){document.body.classList.add('is-busy');document.body.setAttribute('aria-busy','true');if(statusEl){statusEl.textContent='Loading'}}
  else{document.body.classList.remove('is-busy');document.body.removeAttribute('aria-busy');if(statusEl){statusEl.textContent=''}}
};
const setViewError=message=>{
  setBusyState(false);
  const errEl=document.getElementById('error');
  if(errEl){errEl.textContent=message||''}
};
const clearGotoError=()=>{
  const addrEl=document.getElementById('address'),gotoErr=document.getElementById('goto-error');
  if(addrEl){addrEl.removeAttribute('aria-invalid');if(addrEl.getAttribute('aria-describedby')==='goto-error'){addrEl.removeAttribute('aria-describedby')}}
  if(gotoErr){gotoErr.textContent=''}
};
const setGotoError=message=>{
  setBusyState(false);
  const addrEl=document.getElementById('address'),gotoErr=document.getElementById('goto-error');
  if(addrEl){addrEl.setAttribute('aria-invalid','true');addrEl.setAttribute('aria-describedby','goto-error');addrEl.focus({preventScroll:true})}
  if(gotoErr){gotoErr.textContent=message||'Address or symbol not found in program memory.'}
};
const isAddressInputProtected=()=>{
  const addrEl=document.getElementById('address');
  return Boolean(addrEl)&&(document.activeElement===addrEl||addrEl.getAttribute('aria-invalid')==='true'||addrEl.dataset.draftDirty==='true');
};
const setSyncedAddressValue=(nextValue,force=false)=>{
  const addrEl=document.getElementById('address');
  if(!addrEl){return}
  if(force){clearGotoError();delete addrEl.dataset.draftDirty;addrEl.value=nextValue;return}
  if(!isAddressInputProtected()){addrEl.value=nextValue}
};
const bindGotoForm=(onSubmit,onInput)=>{
  const formEl=document.getElementById('goto'),addrEl=document.getElementById('address');
  if(!formEl||!addrEl||formEl.dataset.gotoBound==='true'){return}
  formEl.dataset.gotoBound='true';
  addrEl.addEventListener('input',()=>{clearGotoError();addrEl.dataset.draftDirty='true';if(onInput){onInput()}});
  formEl.addEventListener('submit',event=>{
    event.preventDefault();
    const raw=addrEl.value.trim();
    if(!raw){setGotoError('Enter an address or symbol name.');return}
    clearGotoError();
    setBusyState(true);
    onSubmit(raw);
  });
};
window.addEventListener('message',event=>{
  const msg=event.data||{};
  if(msg.action==='singleKeyShortcuts'){setSingleKeyShortcuts(typeof msg.singleKeyShortcuts==='boolean'?msg.singleKeyShortcuts:msg.enabled)}
  else if(msg.action==='busy'){setBusyState(true)}
  else if(msg.action==='busyDone'){setBusyState(false)}
  else if(msg.action==='error'){setViewError(msg.error||'')}
  else if(msg.action==='gotoError'){setGotoError(msg.error||'')}
});
syncShortcutHints();
`;

/** Shared client script for top-layer popover position, keyboard navigation, and focus control. */
export const webviewPopoverScript = String.raw`
const isPopoverOpen=menu=>{if(!menu){return false}try{return menu.matches(':popover-open')}catch{return menu.hasAttribute('data-open')}};
const openPopovers=()=>[...document.querySelectorAll('[data-popover-menu]')].filter(isPopoverOpen);
const popoverInvoker=menu=>menu?.id?document.querySelector('[popovertarget="'+CSS.escape(menu.id)+'"]'):null;
const menuButtons=menu=>[...menu.querySelectorAll('button:not(:disabled)')].filter(btn=>!btn.hidden&&!btn.closest('[hidden]'));
const closePopover=menu=>{if(!menu||!isPopoverOpen(menu)){return}if(typeof menu.hidePopover==='function'){menu.hidePopover()}else{menu.removeAttribute('data-open')}};
const positionPopover=menu=>{
  if(!menu||!isPopoverOpen(menu)){return}
  const invoker=popoverInvoker(menu);
  if(!invoker||invoker.hidden||invoker.getClientRects().length===0){closePopover(menu);return}
  const vw=document.documentElement.clientWidth||window.innerWidth,vh=document.documentElement.clientHeight||window.innerHeight;
  const pad=Math.min(8,Math.max(2,Math.floor(Math.min(vw,vh)*0.03))),gap=6,inv=invoker.getBoundingClientRect();
  if(inv.bottom<=0||inv.top>=vh||inv.right<=0||inv.left>=vw){closePopover(menu);return}
  menu.style.maxWidth=Math.max(96,vw-pad*2)+'px';menu.style.maxHeight=Math.max(64,vh-pad*2)+'px';menu.style.left='0px';menu.style.top='0px';
  const preferAbove=menu.id==='more-actions'||Boolean(invoker.closest('.selection-tools'));
  const spaceAbove=Math.floor(inv.top-gap-pad),spaceBelow=Math.floor(vh-inv.bottom-gap-pad),natural=menu.getBoundingClientRect();
  const placeAbove=preferAbove?(spaceAbove>=Math.min(natural.height,44)||spaceAbove>=spaceBelow):(natural.height>spaceBelow&&spaceAbove>spaceBelow);
  menu.style.maxHeight=Math.max(44,placeAbove?spaceAbove:spaceBelow)+'px';
  const rect=menu.getBoundingClientRect();
  const left=Math.min(Math.max(pad,inv.right-rect.width),Math.max(pad,vw-rect.width-pad));
  const top=placeAbove?Math.max(pad,inv.top-gap-rect.height):Math.min(Math.max(pad,vh-rect.height-pad),inv.bottom+gap);
  menu.style.left=Math.round(left)+'px';menu.style.top=Math.round(top)+'px';
};
const openPopover=menu=>{if(!menu){return}if(!isPopoverOpen(menu)){if(typeof menu.showPopover==='function'){menu.showPopover()}else{menu.setAttribute('data-open','')}}positionPopover(menu)};
const focusInvokerAndClose=menu=>{
  const invoker=popoverInvoker(menu);
  if(invoker&&!invoker.hidden&&!invoker.disabled){invoker.focus({preventScroll:true})}
  closePopover(menu);
  if(invoker&&!invoker.hidden&&!invoker.disabled&&document.activeElement!==invoker){invoker.focus({preventScroll:true})}
  return invoker;
};
const restorePopoverAwareFocus=id=>{
  if(!id){return false}
  const el=document.getElementById(id);
  const closedMenu=el?.closest('[data-popover-menu]');
  const target=(closedMenu&&!isPopoverOpen(closedMenu))?popoverInvoker(closedMenu):el;
  if(target&&!target.hidden&&!target.disabled){target.focus({preventScroll:true});return true}
  return false;
};
(()=>{
  let pointerMenu=null;
  document.addEventListener('pointerdown',event=>{
    const el=event.target instanceof Element?event.target:null;
    const trigger=el?.closest('[popovertarget]');
    pointerMenu=el?.closest('[data-popover-menu]')||(trigger?document.getElementById(trigger.getAttribute('popovertarget')||''):null);
  },true);
  const clearPointerMenu=()=>{requestAnimationFrame(()=>{pointerMenu=null})};
  document.addEventListener('pointerup',clearPointerMenu,true);
  document.addEventListener('pointercancel',()=>{pointerMenu=null},true);
  document.addEventListener('beforetoggle',event=>{const menu=event.target;if(menu instanceof HTMLElement&&menu.hasAttribute('data-popover-menu')&&event.newState==='open'){queueMicrotask(()=>positionPopover(menu))}},true);
  document.addEventListener('toggle',event=>{const menu=event.target;if(menu instanceof HTMLElement&&menu.hasAttribute('data-popover-menu')&&isPopoverOpen(menu)){positionPopover(menu)}},true);
  document.addEventListener('click',event=>{const trigger=(event.target instanceof Element?event.target:null)?.closest('[popovertarget]');if(!trigger){return}const menu=document.getElementById(trigger.getAttribute('popovertarget')||'');if(menu&&isPopoverOpen(menu)){positionPopover(menu)}});
  window.addEventListener('resize',()=>{for(const menu of openPopovers()){positionPopover(menu)}});
  document.addEventListener('scroll',event=>{for(const menu of openPopovers()){if(event.target instanceof Node&&menu.contains(event.target)){continue}positionPopover(menu)}},true);
  document.addEventListener('focusin',event=>{
    const next=event.target instanceof Node?event.target:null;
    const prev=event.relatedTarget instanceof Node?event.relatedTarget:null;
    for(const menu of openPopovers()){
      const invoker=popoverInvoker(menu);
      const onInvoker=Boolean(invoker&&next&&invoker.contains(next));
      const inMenu=Boolean(next&&menu.contains(next));
      if(!inMenu&&(!onInvoker||(pointerMenu!==menu&&Boolean(prev&&menu.contains(prev))))){closePopover(menu)}
    }
  },true);
  document.addEventListener('focusout',event=>{
    const next=event.relatedTarget instanceof Node?event.relatedTarget:null;
    if(next){
      for(const menu of openPopovers()){
        if(pointerMenu===menu){continue}
        const invoker=popoverInvoker(menu);
        if(!menu.contains(next)&&!(invoker&&invoker.contains(next))){closePopover(menu)}
      }
      return;
    }
    queueMicrotask(()=>{
      const active=document.activeElement;
      for(const menu of openPopovers()){
        if(pointerMenu===menu){continue}
        const invoker=popoverInvoker(menu);
        const inside=Boolean(active)&&active!==document.body&&active!==document.documentElement&&(menu.contains(active)||Boolean(invoker&&invoker.contains(active)));
        if(!inside){closePopover(menu)}
      }
    });
  },true);
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&!event.altKey&&!event.ctrlKey&&!event.metaKey){
      const open=openPopovers();
      if(open.length){
        const active=document.activeElement;
        const owner=open.find(m=>(active&&m.contains(active))||popoverInvoker(m)===active);
        event.preventDefault();event.stopPropagation();
        for(const m of open){closePopover(m)}
        if(owner){popoverInvoker(owner)?.focus({preventScroll:true})}
        else if(active instanceof HTMLElement&&active!==document.body&&active!==document.documentElement){active.focus({preventScroll:true})}
        return;
      }
    }
    if(event.altKey||event.ctrlKey||event.metaKey||!['ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Home','End'].includes(event.key)){return}
    const el=event.target instanceof Element?event.target:null;
    const invoker=el?.closest('[popovertarget]');
    if(invoker){
      const menu=document.getElementById(invoker.getAttribute('popovertarget')||'');
      if(menu&&menu.hasAttribute('data-popover-menu')){
        const items=menuButtons(menu);
        if(items.length){
          event.preventDefault();event.stopPropagation();
          openPopover(menu);
          const forward=event.key==='ArrowDown'||event.key==='ArrowRight'||event.key==='Home';
          (forward?items[0]:items[items.length-1])?.focus({preventScroll:true});
          return;
        }
      }
    }
    const menu=el?.closest('[data-popover-menu]');
    if(menu&&isPopoverOpen(menu)&&!el?.closest('input,select,textarea')){
      const items=menuButtons(menu);
      if(items.length){
        event.preventDefault();event.stopPropagation();
        const index=items.indexOf(document.activeElement),forward=event.key==='ArrowDown'||event.key==='ArrowRight';
        const next=event.key==='Home'?0:event.key==='End'?items.length-1:forward?(index+1)%items.length:(index<=0?items.length-1:index-1);
        items[next]?.focus({preventScroll:true});
      }
    }
  },true);
})();
`;

/** Client-side script for filterable browser tables and keyboard row navigation. */
export const browserViewScript = String.raw`
    const mountBrowserView=()=>{
      if(!document.body.classList.contains('browser-page')){return}
      for(const table of document.querySelectorAll('.table-wrap')){
        if(!table.dataset.browserBound){table.dataset.browserBound='true';table.addEventListener('scroll',schedulePersist,{passive:true})}
        if(!table.querySelector('tbody tr')){table.hidden=true;const next=table.nextElementSibling;const counted=/\(0\)\s*$/.test(table.closest('section')?.querySelector('h2')?.textContent||'');if(!counted&&!next?.classList.contains('empty')&&!next?.classList.contains('table-empty')){const empty=document.createElement('p');empty.className='table-empty';empty.hidden=!!search.value;empty.setAttribute('role','status');empty.textContent='No entries.';table.after(empty)}}
      }
      const clearBtn=document.getElementById('clear-filter');
      if(clearBtn&&!clearBtn.dataset.browserBound){clearBtn.dataset.browserBound='true';clearBtn.addEventListener('click',()=>{search.value='';filter();persist();search.focus()})}
      for(const row of selectable){
        if(row.dataset.rowNavBound){continue}
        row.dataset.rowNavBound='true';
        row.addEventListener('keydown',event=>{if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key)){return}const rows=[...row.closest('tbody').querySelectorAll('tr[data-address]:not([hidden]),tr[data-entry]:not([hidden])')],index=rows.indexOf(row),next=event.key==='Home'?0:event.key==='End'?rows.length-1:Math.max(0,Math.min(rows.length-1,index+(event.key==='ArrowDown'?1:-1)));event.preventDefault();rows[next]?.focus();rows[next]?.scrollIntoView({block:'nearest'})});
      }
    };
    mountBrowserView();
`;
