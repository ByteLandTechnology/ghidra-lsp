// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

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
.inspector-page .icon-button:hover:enabled,.browser-page .icon-button:hover:enabled{background:var(--vscode-toolbar-hoverBackground,var(--vscode-list-hoverBackground))}
.inspector-menu{position:relative;margin:0;padding:0;border:0;flex-shrink:0}
.inspector-menu>summary{display:flex;align-items:center;justify-content:center;width:32px;height:32px;padding:7px;list-style:none;border-radius:3px;cursor:pointer;font-weight:400}
.inspector-menu>summary:hover{background:var(--vscode-toolbar-hoverBackground,var(--vscode-list-hoverBackground))}
.inspector-menu>summary::-webkit-details-marker{display:none}
.inspector-menu[open]>summary{margin:0}
.inspector-menu-content{position:absolute;z-index:10;right:0;top:calc(100% + 5px);width:230px;max-width:calc(100vw - 32px);padding:6px;border:1px solid var(--vscode-menu-border,var(--vscode-panel-border));background:var(--vscode-menu-background,var(--vscode-editor-background));color:var(--vscode-menu-foreground,var(--vscode-foreground));box-shadow:0 4px 12px var(--vscode-widget-shadow)}
.inspector-menu-content button{width:100%;justify-content:flex-start;text-align:left;border:0;background:transparent;color:inherit;padding:7px 9px}
.inspector-menu-content button:hover:enabled{background:var(--vscode-menu-selectionBackground,var(--vscode-list-hoverBackground));color:var(--vscode-menu-selectionForeground,var(--vscode-foreground))}
.inspector-menu-content .danger{color:var(--vscode-errorForeground);border-top:1px solid var(--vscode-panel-border);margin-top:4px;padding-top:10px}
/* Hallmark · data type editor · the definition is the work surface. */
.inspector-page[data-view-kind="type-editor"] main{max-width:1060px;margin:0;padding:16px 22px 32px}
.inspector-page[data-view-kind="type-editor"] main>header{align-items:flex-start;gap:16px;padding-bottom:12px;margin-bottom:16px;border-bottom:1px solid var(--vscode-panel-border)}
.inspector-page[data-view-kind="type-editor"] main>header .subtitle{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;margin:6px 0 0;font-size:12px;color:var(--vscode-descriptionForeground)}
.inspector-page[data-view-kind="type-editor"] .type-kind-badge{display:inline-flex;align-items:center;padding:1px 7px;border-radius:4px;font:600 11px/1.45 var(--vscode-editor-font-family,monospace);text-transform:lowercase;background:color-mix(in srgb,var(--vscode-focusBorder) 16%,var(--vscode-editor-background));border:1px solid color-mix(in srgb,var(--vscode-focusBorder) 38%,transparent);color:var(--vscode-foreground);white-space:nowrap}
.inspector-page[data-view-kind="type-editor"] .type-kind-badge.is-readonly{background:color-mix(in srgb,var(--vscode-descriptionForeground) 12%,var(--vscode-editor-background));border-color:var(--vscode-panel-border);color:var(--vscode-descriptionForeground)}
.inspector-page[data-view-kind="type-editor"] .type-meta-path{color:var(--vscode-descriptionForeground)}
.inspector-page[data-view-kind="type-editor"] .type-meta-sep{opacity:.55;user-select:none}
.inspector-page[data-view-kind="type-editor"] .type-meta-stat{font-variant-numeric:tabular-nums;white-space:nowrap}
.inspector-page[data-view-kind="type-editor"] .type-actions{display:inline-flex;align-items:center;gap:8px;flex-shrink:0}
.inspector-page[data-view-kind="type-editor"] .type-validation:not([hidden]){margin:8px 0 12px;padding:8px 12px;border-left:1px solid var(--vscode-errorForeground);color:var(--vscode-errorForeground);background:color-mix(in srgb,var(--vscode-errorForeground) 6%,var(--vscode-editor-background))}
.inspector-page[data-view-kind="type-editor"] .type-status{display:inline-flex;align-items:center;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:500;color:var(--vscode-descriptionForeground);background:var(--vscode-sideBar-background,var(--vscode-editor-background));border:1px solid var(--vscode-panel-border);white-space:nowrap}
.inspector-page[data-view-kind="type-editor"] .type-status:empty{display:none}
.inspector-page[data-view-kind="type-editor"] .type-status[data-state="dirty"]{color:var(--vscode-editorWarning-foreground,#cca700);border-color:color-mix(in srgb,var(--vscode-editorWarning-foreground,#cca700) 45%,transparent)}
.inspector-page[data-view-kind="type-editor"] .type-status[data-state="saving"]{color:var(--vscode-focusBorder);border-color:color-mix(in srgb,var(--vscode-focusBorder) 45%,transparent)}
.inspector-page[data-view-kind="type-editor"] .type-actions [data-open-jsonc]{display:inline-flex;align-items:center;gap:6px;min-height:28px;padding:4px 10px;border:1px solid var(--vscode-panel-border);border-radius:6px;background:var(--vscode-button-secondaryBackground,var(--vscode-input-background));color:var(--vscode-button-secondaryForeground,var(--vscode-foreground));font-size:12px;font-weight:500;cursor:pointer;white-space:nowrap}
.inspector-page[data-view-kind="type-editor"] .type-actions [data-open-jsonc]:hover:enabled{background:var(--vscode-button-secondaryHoverBackground,var(--vscode-list-hoverBackground));border-color:var(--vscode-focusBorder)}
.inspector-page[data-view-kind="type-editor"] .type-actions [data-open-jsonc] .call-icon{font-size:14px}
.inspector-page[data-view-kind="type-editor"] .type-icon{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;min-height:0;padding:6px;border:0;background:transparent;color:var(--vscode-descriptionForeground);border-radius:3px}
.inspector-page[data-view-kind="type-editor"] .type-icon:hover{background:var(--vscode-toolbar-hoverBackground,var(--vscode-list-hoverBackground));color:var(--vscode-foreground)}
.inspector-page[data-view-kind="type-editor"] .type-list{margin:0 0 20px;padding-top:12px}
.inspector-page[data-view-kind="type-editor"] .type-list:first-of-type{border-top:0;padding-top:0}
.inspector-page[data-view-kind="type-editor"] .type-definition{margin:0 0 20px;padding:0;border:0}
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
.inspector-page[data-view-kind="type-editor"] .type-table tbody tr:focus-within:not([data-new]){background:color-mix(in srgb,var(--vscode-focusBorder) 14%,var(--vscode-list-inactiveSelectionBackground,var(--vscode-editor-background)));box-shadow:inset 2px 0 var(--vscode-focusBorder),inset 0 0 0 1px color-mix(in srgb,var(--vscode-focusBorder) 48%,transparent)}
.inspector-page[data-view-kind="type-editor"] .type-table input{width:100%;height:32px;min-width:0;border:1px solid transparent;border-radius:2px;background:transparent;cursor:text}
.inspector-page[data-view-kind="type-editor"] .type-table input:hover{background:var(--vscode-input-background);border-color:var(--vscode-input-border,transparent)}
.inspector-page[data-view-kind="type-editor"] .type-table input:focus{background:var(--vscode-input-background);outline:2px solid var(--vscode-focusBorder);outline-offset:-2px}
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
.inspector-page[data-view-kind="type-editor"] .type-table tr.type-drop-before{box-shadow:inset 0 2px var(--vscode-focusBorder)}
.inspector-page[data-view-kind="type-editor"] .type-table tr.type-drop-after{box-shadow:inset 0 -2px var(--vscode-focusBorder)}
.inspector-page[data-view-kind="type-editor"] .type-table tr[data-new] td:not([data-field="name"])>*{visibility:hidden}
.inspector-page[data-view-kind="type-editor"] .type-table tr[data-new] td[data-field="name"]{padding-top:6px}
.inspector-page[data-view-kind="type-editor"] .type-table tr[data-new] td[data-field="name"] input{border:1px dashed color-mix(in srgb,var(--vscode-panel-border) 85%,var(--vscode-descriptionForeground));border-radius:6px;padding:0 10px;background:color-mix(in srgb,var(--vscode-editor-background) 70%,var(--vscode-sideBar-background,var(--vscode-editor-background)))}
.inspector-page[data-view-kind="type-editor"] .type-table tr[data-new] td[data-field="name"] input:hover,.inspector-page[data-view-kind="type-editor"] .type-table tr[data-new] td[data-field="name"] input:focus{border-style:solid;border-color:var(--vscode-focusBorder);background:var(--vscode-input-background)}
.inspector-page[data-view-kind="type-editor"] .type-table tr[data-new] input::placeholder{color:var(--vscode-descriptionForeground);opacity:1}
.inspector-page[data-view-kind="type-editor"] .type-raw pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 var(--vscode-editor-font-family,monospace)}
.inspector-page[data-view-kind="type-editor"] .type-empty{margin:0;padding:12px 8px;color:var(--vscode-descriptionForeground);border-top:1px solid var(--vscode-panel-border)}
.inspector-page[data-view-kind="type-editor"] .type-sr-only{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.inspector-page[data-view-kind="type-editor"] .form-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,200px),1fr));gap:12px}
.inspector-page[data-view-kind="type-editor"] .form-grid label:not(.type-flag){display:flex;flex-direction:column;gap:4px;min-width:0}
.inspector-page[data-view-kind="type-editor"] .form-grid input:not([type="checkbox"]){width:100%;min-width:0}
.inspector-page[data-view-kind="type-editor"] .type-flags{display:flex;flex-wrap:wrap;gap:8px 24px;margin-top:12px}
.inspector-page[data-view-kind="type-editor"] .type-flag{display:flex;align-items:center;gap:8px;min-height:32px}

@media(max-width:640px){
.inspector-page[data-view-kind="type-editor"] main{padding:12px 12px 24px}
.inspector-page[data-view-kind="type-editor"] .type-table,.inspector-page[data-view-kind="type-editor"] .type-table tbody{display:block;min-width:0}
.inspector-page[data-view-kind="type-editor"] .type-table thead{display:block}
.inspector-page[data-view-kind="type-editor"] .type-table thead tr{display:grid;grid-template-columns:32px repeat(2,minmax(0,1fr)) 32px;gap:4px 8px;padding:4px 0 8px;border-bottom:1px solid var(--vscode-panel-border)}
.inspector-page[data-view-kind="type-editor"] .type-table thead th[data-field]{width:auto;padding:2px 4px}
.inspector-page[data-view-kind="type-editor"] .type-table thead .type-handle-col,.inspector-page[data-view-kind="type-editor"] .type-table thead .type-action-col{display:none}
.inspector-page[data-view-kind="type-editor"] .type-table th[data-field="offset"],.inspector-page[data-view-kind="type-editor"] .type-table:not([data-kind="struct"]) th[data-field="name"]{grid-column:2;grid-row:1}
.inspector-page[data-view-kind="type-editor"] .type-table[data-kind="struct"] th[data-field="name"],.inspector-page[data-view-kind="type-editor"] .type-table th[data-field="value"],.inspector-page[data-view-kind="type-editor"] .type-table:not([data-kind="struct"]) th[data-field="type"]{grid-column:3;grid-row:1}
.inspector-page[data-view-kind="type-editor"] .type-table[data-kind="struct"] th[data-field="type"],.inspector-page[data-view-kind="type-editor"] .type-table:not([data-kind="struct"]) th[data-field="length"]{grid-column:2;grid-row:2}
.inspector-page[data-view-kind="type-editor"] .type-table[data-kind="struct"] th[data-field="length"]{grid-column:3;grid-row:2}
.inspector-page[data-view-kind="type-editor"] .type-table tbody tr{display:grid;grid-template-columns:32px repeat(2,minmax(0,1fr)) 32px;gap:6px 8px;padding:8px 0;border-bottom:1px solid var(--vscode-panel-border)}
.inspector-page[data-view-kind="type-editor"] .type-table tr:last-child{border-bottom:0}
.inspector-page[data-view-kind="type-editor"] .type-table td{display:block;min-width:0;padding:0;border:0}
.inspector-page[data-view-kind="type-editor"] .type-table tr[data-new] td:not([data-field="name"]){display:none}
.inspector-page[data-view-kind="type-editor"] .type-table tr[data-new] td[data-field="name"]{grid-column:2/4;grid-row:1}
.inspector-page[data-view-kind="type-editor"] .type-table .type-row-handle{grid-column:1;grid-row:1;align-self:center}
.inspector-page[data-view-kind="type-editor"] .type-table .type-row-action{grid-column:4;grid-row:1;align-self:center}
.inspector-page[data-view-kind="type-editor"] .type-table td[data-field="offset"],.inspector-page[data-view-kind="type-editor"] .type-table:not([data-kind="struct"]) td[data-field="name"]{grid-column:2;grid-row:1}
.inspector-page[data-view-kind="type-editor"] .type-table[data-kind="struct"] td[data-field="name"],.inspector-page[data-view-kind="type-editor"] .type-table td[data-field="value"],.inspector-page[data-view-kind="type-editor"] .type-table:not([data-kind="struct"]) td[data-field="type"]{grid-column:3;grid-row:1}
.inspector-page[data-view-kind="type-editor"] .type-table[data-kind="struct"] td[data-field="type"],.inspector-page[data-view-kind="type-editor"] .type-table:not([data-kind="struct"]) td[data-field="length"]{grid-column:2;grid-row:2}
.inspector-page[data-view-kind="type-editor"] .type-table[data-kind="struct"] td[data-field="length"]{grid-column:3;grid-row:2}
}

.inspector-page h2{font-size:13px;font-weight:600;margin-bottom:8px}
.inspector-page section{margin:20px 0;padding-top:14px}
.inspector-page[data-view-kind="function"] main>section:first-of-type,.inspector-page[data-view-kind="symbol"] main>section:first-of-type{border-top:0;margin-top:0;padding-top:0}
.inspector-page[data-view-kind="type"] .type-meta{display:flex;flex-wrap:wrap;gap:8px 20px;color:var(--vscode-descriptionForeground)}
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
.inspector-page details:not(.inspector-menu){margin:18px 0;padding-top:14px}
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
.edit-page .row-remove{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;min-height:0;padding:6px;border:0;background:transparent;color:var(--vscode-descriptionForeground)}
.edit-page .row-remove:hover:enabled{background:var(--vscode-toolbar-hoverBackground,var(--vscode-list-hoverBackground));color:var(--vscode-foreground)}
.browser-page main{max-width:1450px;margin:0;padding:20px 24px 32px}
.browser-page h1{font-size:16px;line-height:1.4;margin:0 0 2px}
.browser-page .subtitle{font-size:11px;overflow-wrap:anywhere}
.browser-page .toolbar{gap:8px;margin:0 0 12px;flex-wrap:nowrap}
.browser-page #goto{flex:0 1 225px;gap:3px}
.browser-page #address{width:100%;min-width:90px;height:32px;font-size:12px}
.browser-page #goto button{width:32px;min-width:32px;height:32px;min-height:0;padding:6px}
.browser-search{position:relative;display:flex;align-items:center;flex:1;min-width:0;max-width:520px}
.browser-search>.call-icon{position:absolute;left:9px;pointer-events:none;color:var(--vscode-input-placeholderForeground,var(--vscode-descriptionForeground));font-size:14px}
.browser-page .browser-search input{width:100%;height:32px;padding-left:30px;min-width:0;max-width:none;font-size:12px}
.browser-page .scope{font-size:11px;line-height:1.6;margin:10px 0 12px;color:var(--vscode-descriptionForeground)}
.browser-page #filter-status{font-size:11px;margin:8px 0;color:var(--vscode-descriptionForeground)}
.browser-page #filter-status:empty{margin:0}
.browser-page #filter-status.sr-filter-status{position:absolute;width:1px;height:1px;padding:0;margin:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.browser-page .selection-tools{position:fixed;z-index:4;left:50%;bottom:16px;transform:translateX(-50%);width:calc(100% - 32px);max-width:760px;box-shadow:0 3px 12px var(--vscode-widget-shadow);display:flex;align-items:center;gap:10px;padding:8px 10px;margin-bottom:10px;border:1px solid var(--vscode-panel-border);border-radius:4px;background:var(--vscode-sideBar-background,var(--vscode-editor-background))}
.browser-page .selection-tools[hidden]{display:none!important}
.browser-page #selection-label{flex:1;min-width:0;margin:0;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.browser-page .selection-buttons{gap:4px}
.browser-page .selection-buttons button{display:inline-flex;align-items:center;gap:6px;min-height:30px;padding:5px 8px;font-size:12px;border-radius:3px}
.browser-page .selection-buttons button.primary{color:var(--vscode-button-foreground,var(--vscode-foreground));background:var(--vscode-button-background,var(--vscode-editor-background))}
.browser-page .selection-buttons button.primary:hover:enabled{background:var(--vscode-button-hoverBackground,var(--vscode-list-hoverBackground))}
.browser-page .selection-buttons .icon-only{width:32px;min-width:32px;justify-content:center;padding:6px}
.browser-page .more-actions>summary{display:flex;align-items:center;justify-content:center;list-style:none;width:30px;height:30px;min-height:0;padding:6px;border:0;background:transparent;border-radius:3px}
.browser-page .more-actions>summary::-webkit-details-marker{display:none}
.browser-page .more-actions{position:relative;overflow:visible;margin:0;padding:0;border:0}
.browser-page .more-actions[open]{flex-basis:auto}
.browser-page .more-actions[open]>summary{margin:0}
.browser-page #selection-more{position:absolute;z-index:5;right:0;bottom:calc(100% + 6px);width:240px;max-width:calc(100vw - 32px);display:flex;flex-direction:column;gap:2px;padding:6px;border:1px solid var(--vscode-menu-border,var(--vscode-panel-border));background:var(--vscode-menu-background,var(--vscode-editor-background));box-shadow:0 4px 12px var(--vscode-widget-shadow)}
.browser-page #selection-more button{width:100%;justify-content:flex-start;border:0;background:transparent}
.browser-page .table-wrap{scroll-padding:36px 4px 4px;max-height:max(120px,min(620px,calc(100vh - 200px)));border:0;border-radius:0;scrollbar-width:thin}
.browser-page table{font-size:12px}
.browser-page.has-selection .table-wrap{padding-bottom:56px;scroll-padding-bottom:56px}
.browser-page th{position:sticky;top:0;z-index:1;background:var(--vscode-editor-background);font-size:11px;padding:8px 10px}
.browser-page td{padding:8px 10px;line-height:1.55;font-size:12px}
.browser-page td.addr{font-family:var(--vscode-editor-font-family,monospace);font-size:11px;font-variant-numeric:tabular-nums;white-space:nowrap;overflow-wrap:normal}
.browser-page tbody tr.selected{background:var(--vscode-list-inactiveSelectionBackground);color:var(--vscode-list-inactiveSelectionForeground,var(--vscode-foreground))}
.browser-page tbody tr.selected:focus,.browser-page tbody tr.selected:focus-within{background:var(--vscode-list-activeSelectionBackground);color:var(--vscode-list-activeSelectionForeground,var(--vscode-foreground))}
.browser-page tr:focus-visible,.browser-page [role="grid"] :is([role="gridcell"],[role="columnheader"]):focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:-2px}
.browser-page .table-empty{margin:0;padding:12px 0;color:var(--vscode-descriptionForeground);font-size:12px}
.browser-page .no-results{display:flex;align-items:center;gap:12px;margin:12px 0;padding:8px 0;color:var(--vscode-descriptionForeground);font-size:12px}
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
.browser-page :is(button,summary,input):focus-visible,.inspector-page :is(button,summary,input):focus-visible,.edit-page :is(button,summary,input,select,textarea):focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:2px}
.browser-page button,.inspector-page button,.edit-page button{transition:background-color 100ms ease,color 100ms ease}
@media(prefers-reduced-motion:reduce){.browser-page *,.inspector-page *,.edit-page *{animation:none!important;transition:none!important}}
@media(max-width:760px){.inspector-page header{position:relative;align-items:flex-start;flex-wrap:wrap;gap:14px}.inspector-page .inspector-title{flex:1 1 220px}.inspector-page .inspector-tools{margin-left:auto}}
@media(max-width:640px){.inspector-page[data-view-kind="type"] .type-fields tbody tr{border-bottom:1px solid var(--vscode-panel-border)}.inspector-page[data-view-kind="type"] .type-fields tbody tr:last-child{border-bottom:0}.inspector-page[data-view-kind="type"] .type-fields tbody td{border:0}}
@media(max-width:640px){.inspector-page .table-wrap table{min-width:0}.inspector-page main,.edit-page main{padding:18px 16px 28px}.inspector-page .inspector-actions{gap:4px}.inspector-page dl>div{grid-template-columns:105px minmax(0,1fr);gap:10px}.browser-page main{padding:14px 12px 24px}.browser-page .toolbar{gap:6px}.browser-page #goto{flex-basis:170px}.browser-page .selection-tools{flex-wrap:wrap;gap:6px}.browser-page #selection-label{flex-basis:100%}.browser-page[data-view-kind="strings"] th:nth-child(3),.browser-page[data-view-kind="strings"] td:nth-child(3){display:none}.browser-page[data-view-kind="strings"] .cell-detail{display:block;margin-top:4px;font:10px/1.4 var(--vscode-font-family);color:var(--vscode-descriptionForeground)}.browser-page[data-view-kind="strings"] table{min-width:0}.browser-page[data-view-kind="strings"] th:first-child{width:108px}.browser-page[data-view-kind="strings"] th:nth-child(2){width:64px}.browser-page[data-view-kind="strings"] th,.browser-page[data-view-kind="strings"] td{padding-left:7px;padding-right:7px}.browser-page .more-actions{margin-left:auto}.inspector-page .type-fields table{min-width:0;width:100%}.inspector-page .type-fields thead,.inspector-page .type-fields tbody{display:block}.inspector-page .type-fields tr{display:grid;grid-template-columns:54px 68px minmax(0,1fr) minmax(0,1fr)}.inspector-page .type-fields th,.inspector-page .type-fields td{min-width:0;padding:8px 4px;overflow-wrap:anywhere}.inspector-page[data-view-kind="type"] .type-fields th:nth-child(1),.inspector-page[data-view-kind="type"] .type-fields th:nth-child(2){width:auto}.inspector-page .type-fields th:nth-child(5){position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip-path:inset(50%)}.inspector-page .type-fields td:nth-child(5){grid-column:1/-1;padding:0 4px 8px;color:var(--vscode-descriptionForeground)}.inspector-page .type-fields td:nth-child(5):empty{display:none}.inspector-page .type-fields .link{white-space:normal;overflow-wrap:anywhere;text-align:left}.edit-page .form-grid{grid-template-columns:1fr}.edit-page .form-actions{flex-wrap:wrap}}
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
.page-options{position:relative;flex:none;margin:0;padding:0;border:0}
.page-options>summary{display:flex;align-items:center;justify-content:center;list-style:none;width:32px;height:32px;cursor:pointer}
.page-options>summary::-webkit-details-marker{display:none}
.page-options-content{position:absolute;right:0;top:36px;z-index:10;width:260px;padding:8px;background:var(--vscode-menu-background,var(--vscode-editor-background));border:1px solid var(--vscode-menu-border,var(--vscode-panel-border));box-shadow:0 2px 8px var(--vscode-widget-shadow)}
.page-options-content>button,.page-options-content>label{display:flex;align-items:center;gap:8px;width:100%;padding:7px;text-align:left;background:transparent;color:var(--vscode-foreground);border:0}
.page-options-content>p{font-size:11px;color:var(--vscode-descriptionForeground);padding:0 7px;line-height:1.6}
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
.inspector-page .type-category{color:var(--vscode-descriptionForeground);font-size:11px;overflow-wrap:anywhere}
.inspector-page .hex{font-size:inherit}
.inspector-page .detail-heading{font-size:12px;font-weight:600;margin:16px 0 0;color:var(--vscode-descriptionForeground)}
.inspector-page main>details:not(.inspector-menu)>:not(summary){margin-left:16px}
.inspector-page main>details[open]:not(.inspector-menu){margin-bottom:28px}
.inspector-page[data-view-kind="function"] main>.function-definition+section{margin-top:14px}.inspector-page[data-view-kind="function"] main>.function-definition+section>h2{margin-bottom:2px}
.inspector-page .parameters .param-storage{display:none;color:var(--vscode-descriptionForeground)}
.inspector-page:has(#function-details[open]) .parameters .param-storage{display:inline}
.inspector-page .table-wrap:not(.type-fields) table{width:auto;min-width:min(100%,420px)}
.inspector-page .table-wrap:not(.type-fields) :is(th,td):not(:last-child){padding-right:32px}
.inspector-page .recovery{margin-top:12px}
/* Icon-first controls (2026-11-02): labels live in aria-label and tooltips. */
.edit-page [data-add-row].icon-add{width:32px;min-width:32px;padding:0}
.browser-page .pagination .icon-button:disabled{opacity:.4}
.browser-page .no-results .icon-button{width:28px;height:28px;padding:5px}
.browser-page #selection-more{flex-direction:row;width:auto;padding:4px}
.browser-page #selection-more button{width:32px;min-width:32px;justify-content:center;padding:6px}
.edit-page .form-actions .icon-submit{width:36px;min-width:36px;height:32px;padding:0}
.edit-page .form-actions .icon-submit.danger{color:var(--vscode-button-foreground);background:var(--vscode-inputValidation-errorBorder,var(--vscode-errorForeground))}
.page-options-actions{display:flex;gap:2px;padding:0 0 6px;margin-bottom:6px;border-bottom:1px solid var(--vscode-panel-border)}
.page-options-content>.page-options-actions>button{width:32px;height:32px;padding:7px;justify-content:center}
.inspector-menu-content{display:flex;align-items:center;gap:2px;width:auto;padding:4px}
.inspector-menu-content .icon-button{width:32px;min-height:0;padding:7px;justify-content:center}
.inspector-menu-content .icon-button.danger{color:var(--vscode-errorForeground);margin:0 0 0 3px;padding:7px;border-top:0;position:relative}
.inspector-menu-content .icon-button.danger::before{content:'';position:absolute;left:-3px;top:6px;bottom:6px;width:1px;background:var(--vscode-panel-border)}
.sr-status{position:absolute;width:1px;height:1px;padding:0;margin:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.inspector-page.is-busy::before{content:'';position:fixed;z-index:20;top:0;left:0;width:30%;height:2px;background:var(--vscode-progressBar-background,var(--vscode-focusBorder));opacity:0;animation:inspector-busy-in 0s linear 150ms forwards,inspector-busy 1.2s cubic-bezier(.4,0,.2,1) 150ms infinite}
@keyframes inspector-busy-in{to{opacity:1}}
@keyframes inspector-busy{from{transform:translateX(-100%)}to{transform:translateX(340%)}}
@media(prefers-reduced-motion:reduce){.inspector-page.is-busy::before{width:100%;opacity:.6;animation:none}}
`;

/** Shared client script that gives `LiveStatusBus` and `GridController` to ARIA grids. */
export const gridRuntimeScript = String.raw`
    class LiveStatusBus {
      constructor(node) {
        this.node = node;
        this.hadFilter = false;
        this.frame = 0;
        if (this.node) {
          this.node.removeAttribute('hidden');
          this.node.setAttribute('role', 'status');
          this.node.setAttribute('aria-live', 'polite');
          this.node.setAttribute('aria-atomic', 'true');
        }
      }
      announce(message, options = {}) {
        if (!this.node) { return; }
        const text = String(message ?? '');
        this.node.removeAttribute('hidden');
        this.node.classList.toggle('sr-filter-status', Boolean(options.srOnly));
        if (this.frame) { cancelAnimationFrame(this.frame); this.frame = 0; }
        if (options.silent) {
          this.node.textContent = text;
          return;
        }
        if (text && this.node.textContent === text) {
          this.node.textContent = '';
          this.frame = requestAnimationFrame(() => {
            this.frame = 0;
            if (this.node) { this.node.textContent = text; }
          });
          return;
        }
        this.node.textContent = text;
      }
      reportFilter(info) {
        const query = String(info.query ?? '').trim();
        const visible = Number(info.visible) || 0;
        const total = Number(info.total) || 0;
        const nodesMatched = Number(info.nodesMatched) || 0;
        const nodesTotal = Number(info.nodesTotal) || 0;
        const silent = Boolean(info.silent);
        const unit = info.unit || 'displayed rows';
        if (!query) {
          if (this.hadFilter && !silent) {
            this.hadFilter = false;
            const restored = nodesTotal
              ? 'Filter cleared. Showing all ' + nodesTotal + ' nodes' + (total ? ' and ' + total + ' ' + unit + '.' : '.')
              : 'Filter cleared. Showing all ' + total + ' ' + unit + '.';
            this.announce(restored, { srOnly: true });
          } else {
            this.hadFilter = false;
            if (!silent && this.node && this.node.textContent) {
              this.announce('', { srOnly: true, silent: true });
            }
          }
          return;
        }
        this.hadFilter = true;
        const text = nodesTotal
          ? nodesMatched + ' of ' + nodesTotal + ' nodes match' + (total ? '; ' + visible + ' of ' + total + ' ' + unit + ' match.' : '.')
          : visible > 0
            ? visible + ' of ' + total + ' ' + unit + ' match.'
            : (info.emptyText || 'No ' + unit + ' match this filter.');
        this.announce(text, { srOnly: !nodesTotal && visible === 0, silent });
      }
    }
    class GridController {
      constructor(grid, options = {}) {
        this.grid = grid;
        this.options = options;
        this.activeTarget = null;
        this.activeRow = null;
        this.preferredCol = 0;
        this.bind();
        this.syncSelection();
        this.refresh({ syncToSelected: true });
      }
      isVisible(el) {
        if (!el || !el.isConnected || !this.grid.isConnected) { return false; }
        for (let cur = el; cur && cur !== document.body; cur = cur.parentElement) {
          if (cur.hidden || cur.getAttribute('aria-hidden') === 'true') { return false; }
          if (cur.tagName === 'DETAILS' && !cur.open) { return false; }
          const style = getComputedStyle(cur);
          if (style.display === 'none' || style.visibility === 'hidden') { return false; }
        }
        return true;
      }
      syncSelection() {
        const hexMode = this.options.selectionMode === 'hex';
        for (const row of this.grid.querySelectorAll('tbody [role="row"]')) {
          if (row.closest('[role="grid"]') !== this.grid) { continue; }
          const rowSel = row.classList.contains('selected') ? 'true' : 'false';
          row.setAttribute('aria-selected', rowSel);
          for (const cell of row.querySelectorAll('[role="gridcell"]')) {
            if (cell.closest('[role="row"]') !== row) { continue; }
            const cellSel = hexMode && cell.classList.contains('hb')
              ? (cell.classList.contains('is-selected') ? 'true' : 'false')
              : rowSel;
            cell.setAttribute('aria-selected', cellSel);
          }
        }
      }
      buildRows() {
        if (!this.isVisible(this.grid)) { return []; }
        const result = [];
        for (const row of this.grid.querySelectorAll('[role="row"]')) {
          if (row.closest('[role="grid"]') !== this.grid || !this.isVisible(row)) { continue; }
          const cells = [];
          let rawCol = 0;
          for (const child of row.children) {
            const role = child.getAttribute('role');
            if (role === 'none' || role === 'presentation') {
              const slots = [...child.querySelectorAll('.hx-col,.hb')];
              if (slots.length) {
                slots.forEach((slot, idx) => {
                  const slotRole = slot.getAttribute('role');
                  if ((slotRole === 'columnheader' || slotRole === 'gridcell') && this.isVisible(slot)) {
                    cells.push({ cell: slot, startCol: rawCol + idx, endCol: rawCol + idx, widgets: [], stops: [slot], isEmptyAux: false });
                  }
                });
                rawCol += slots.length;
              } else {
                rawCol += 1;
              }
              continue;
            }
            const span = Math.max(1, Number(child.getAttribute('colspan')) || 1);
            const startCol = rawCol;
            const endCol = rawCol + span - 1;
            rawCol += span;
            if ((role === 'columnheader' || role === 'gridcell') && this.isVisible(child)) {
              const widgets = [...child.querySelectorAll('button:not(:disabled),[href]')].filter(w => this.isVisible(w));
              let stops = [child];
              if (widgets.length) {
                const widgetText = widgets.map(w => w.textContent).join('').replace(/\s+/g, '');
                const totalText = child.textContent.replace(/\s+/g, '');
                stops = totalText === widgetText ? widgets : [child, ...widgets];
              }
              const isEmptyAux = row.classList.contains('listing-aux-row') && !widgets.length && child.textContent.trim() === '';
              cells.push({ cell: child, startCol, endCol, widgets, stops, isEmptyAux });
            }
          }
          if (cells.length) {
            result.push({ row, isHeader: Boolean(row.closest('thead')), cells, stops: cells.flatMap(c => c.stops) });
          }
        }
        return result;
      }
      pickCellForCol(rowEntry, col) {
        const candidates = rowEntry.cells.some(c => !c.isEmptyAux)
          ? rowEntry.cells.filter(c => !c.isEmptyAux)
          : rowEntry.cells;
        const exact = candidates.find(c => col >= c.startCol && col <= c.endCol);
        if (exact) { return exact; }
        let best = candidates[0];
        let bestDist = Infinity;
        for (const c of candidates) {
          const dist = col < c.startCol ? c.startCol - col : col - c.endCol;
          if (dist < bestDist) { bestDist = dist; best = c; }
        }
        return best;
      }
      clearTabStops() {
        for (const tr of this.grid.querySelectorAll('tr[tabindex]')) {
          if (tr.closest('[role="grid"]') === this.grid) { tr.removeAttribute('tabindex'); }
        }
        for (const el of this.grid.querySelectorAll('[role="columnheader"],[role="gridcell"],button,[href]')) {
          if (el.closest('[role="grid"]') === this.grid) { el.tabIndex = -1; }
        }
      }
      setActive(target, options = {}) {
        if (!target || !this.isVisible(target)) { return false; }
        if (this.activeTarget && this.grid.contains(this.activeTarget)) {
          this.activeTarget.tabIndex = -1;
        } else {
          this.clearTabStops();
        }
        target.tabIndex = 0;
        this.activeTarget = target;
        this.activeRow = target.closest('[role="row"]');
        if (options.updatePreferredCol) {
          const rows = this.buildRows();
          for (const r of rows) {
            for (const c of r.cells) {
              if (c.stops.includes(target)) {
                this.preferredCol = c.startCol;
                break;
              }
            }
          }
        }
        if (options.focus) {
          target.focus({ preventScroll: !options.scroll });
          if (options.scroll) { target.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
        }
        return true;
      }
      refresh(options = {}) {
        const hadFocus = this.grid.contains(document.activeElement);
        this.clearTabStops();
        const rows = this.buildRows();
        if (!rows.length) {
          this.activeTarget = null;
          this.activeRow = null;
          return;
        }
        const bodyRows = rows.filter(r => !r.isHeader);
        const firstDataRow = bodyRows.find(r => !r.row.classList.contains('listing-aux-row')) || bodyRows[0] || rows[0];
        const firstBodyCell = (firstDataRow.cells.find(c => !c.isEmptyAux) || firstDataRow.cells[0]).stops[0];
        let nextTarget = null;
        const findSelectedCell = () => {
          const direct = [...this.grid.querySelectorAll('tbody [role="gridcell"].is-selected')]
            .find(c => c.closest('[role="grid"]') === this.grid && this.isVisible(c));
          if (direct) { return direct; }
          return [...this.grid.querySelectorAll('tbody tr.selected [role="gridcell"]')]
            .find(c => c.closest('[role="grid"]') === this.grid && this.isVisible(c) && !(c.closest('tr')?.classList.contains('listing-aux-row') && c.textContent.trim() === ''));
        };
        if (options.resetToFirstRow) {
          nextTarget = firstBodyCell;
        } else if (options.syncToSelected) {
          nextTarget = findSelectedCell() || (this.activeTarget && this.grid.contains(this.activeTarget) && this.isVisible(this.activeTarget) ? this.activeTarget : firstBodyCell);
        } else if (this.activeTarget && this.grid.contains(this.activeTarget) && this.isVisible(this.activeTarget)) {
          nextTarget = this.activeTarget;
        } else if (this.activeRow && this.grid.contains(this.activeRow) && this.isVisible(this.activeRow)) {
          const rowEntry = rows.find(r => r.row === this.activeRow);
          if (rowEntry) { nextTarget = this.pickCellForCol(rowEntry, this.preferredCol)?.stops[0] || null; }
        }
        if (!nextTarget || !this.isVisible(nextTarget)) {
          nextTarget = findSelectedCell() || firstBodyCell;
        }
        this.setActive(nextTarget, { focus: hadFocus && document.activeElement !== nextTarget, scroll: false, updatePreferredCol: Boolean(options.resetToFirstRow || options.syncToSelected) });
      }
      focusRow(row, preferredSelector) {
        if (!row || !this.isVisible(row)) { return false; }
        const rows = this.buildRows();
        const entry = rows.find(r => r.row === row);
        if (!entry) { return false; }
        const specific = preferredSelector ? entry.stops.find(s => s.matches(preferredSelector)) : null;
        const target = specific || this.pickCellForCol(entry, this.preferredCol)?.stops[0] || entry.stops[0];
        return this.setActive(target, { focus: true, scroll: true, updatePreferredCol: Boolean(specific) });
      }
      bind() {
        this.grid.addEventListener('focusin', event => {
          const stop = event.target.closest('button:not(:disabled),[href],[role="gridcell"],[role="columnheader"]');
          if (stop && stop !== this.activeTarget && stop.closest('[role="grid"]') === this.grid && this.isVisible(stop)) {
            this.setActive(stop, { focus: false, scroll: false, updatePreferredCol: true });
          }
        });
        this.grid.addEventListener('click', event => {
          const stop = event.target.closest('button:not(:disabled),[href],[role="gridcell"],[role="columnheader"]');
          if (stop && stop.closest('[role="grid"]') === this.grid && this.isVisible(stop)) {
            this.setActive(stop, { focus: document.activeElement !== stop, scroll: false, updatePreferredCol: true });
          }
        });
        this.grid.addEventListener('keydown', event => {
          if (event.altKey) { return; }
          const stop = event.target.closest('button:not(:disabled),[href],[role="gridcell"],[role="columnheader"]');
          if (!stop || stop.closest('[role="grid"]') !== this.grid) { return; }
          const rows = this.buildRows();
          if (!rows.length) { return; }
          const rowIdx = rows.findIndex(r => r.stops.includes(stop));
          if (rowIdx < 0) { return; }
          const curRow = rows[rowIdx];
          const stopIdx = curRow.stops.indexOf(stop);
          if (event.key === 'ArrowRight') {
            event.preventDefault();
            if (stopIdx + 1 < curRow.stops.length) {
              this.setActive(curRow.stops[stopIdx + 1], { focus: true, scroll: true, updatePreferredCol: true });
            }
          } else if (event.key === 'ArrowLeft') {
            event.preventDefault();
            if (stopIdx > 0) {
              this.setActive(curRow.stops[stopIdx - 1], { focus: true, scroll: true, updatePreferredCol: true });
            }
          } else if (event.key === 'ArrowDown' || event.key === 'PageDown') {
            event.preventDefault();
            const step = event.key === 'PageDown' ? 10 : 1;
            const targetIdx = Math.min(rows.length - 1, rowIdx + step);
            if (targetIdx !== rowIdx) {
              const nextCell = this.pickCellForCol(rows[targetIdx], this.preferredCol);
              if (nextCell) { this.setActive(nextCell.stops[0], { focus: true, scroll: true, updatePreferredCol: false }); }
            }
          } else if (event.key === 'ArrowUp' || event.key === 'PageUp') {
            event.preventDefault();
            const step = event.key === 'PageUp' ? 10 : 1;
            const targetIdx = Math.max(0, rowIdx - step);
            if (targetIdx !== rowIdx) {
              const prevCell = this.pickCellForCol(rows[targetIdx], this.preferredCol);
              if (prevCell) { this.setActive(prevCell.stops[0], { focus: true, scroll: true, updatePreferredCol: false }); }
            }
          } else if (event.key === 'Home') {
            event.preventDefault();
            if (event.ctrlKey || event.metaKey) {
              const bodyRows = rows.filter(r => !r.isHeader);
              const firstRow = bodyRows[0] || rows[0];
              const cell = firstRow.cells.find(c => !c.isEmptyAux) || firstRow.cells[0];
              this.setActive(cell.stops[0], { focus: true, scroll: true, updatePreferredCol: true });
            } else {
              const firstStop = (curRow.cells.find(c => !c.isEmptyAux) || curRow.cells[0]).stops[0];
              this.setActive(firstStop, { focus: true, scroll: true, updatePreferredCol: true });
            }
          } else if (event.key === 'End') {
            event.preventDefault();
            if (event.ctrlKey || event.metaKey) {
              const lastRow = rows[rows.length - 1];
              this.setActive(lastRow.stops[lastRow.stops.length - 1], { focus: true, scroll: true, updatePreferredCol: true });
            } else {
              this.setActive(curRow.stops[curRow.stops.length - 1], { focus: true, scroll: true, updatePreferredCol: true });
            }
          } else if (event.key === ' ' && !stop.matches('button,[href]')) {
            const handled = event.defaultPrevented;
            event.preventDefault();
            if (!handled && !curRow.isHeader && this.options.onSelect) {
              this.options.onSelect(stop, curRow.row, event);
            }
          } else if (event.key === 'Enter' && !stop.matches('button,[href]')) {
            if (!event.defaultPrevented && !curRow.isHeader && this.options.onActivate) {
              event.preventDefault();
              this.options.onActivate(stop, curRow.row, event);
            }
          }
        });
      }
    }
`;

/** Client script for browser grids, filter clearing, and action menus. */
export const browserViewScript = String.raw`
    (()=>{
      if(!document.body.classList.contains('browser-page')){return}
      for(const table of document.querySelectorAll('.table-wrap')){table.addEventListener('scroll',schedulePersist,{passive:true});if(!table.querySelector('tbody tr')){table.hidden=true;const next=table.nextElementSibling;const counted=/\(0\)\s*$/.test(table.closest('section')?.querySelector('h2')?.textContent||'');if(!counted&&!next?.classList.contains('empty')){const empty=document.createElement('p');empty.className='table-empty';empty.hidden=!!search.value.trim();empty.setAttribute('role','status');empty.textContent='No entries.';table.after(empty)}}}
      document.getElementById('clear-filter')?.addEventListener('click',()=>{search.value='';filter(false,true);persist();search.focus()});
      document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!pageOptions?.open&&!more?.open&&search.value){event.preventDefault();search.value='';filter(false,true);persist()}});
      window.addEventListener('resize',()=>grids.forEach(grid=>grid.refresh()));
      more?.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();more.open=false;moreSummary.focus();return}if(!['ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Home','End'].includes(event.key)){return}event.preventDefault();more.open=true;const buttons=[...more.querySelectorAll('button:not(:disabled)')],index=buttons.indexOf(document.activeElement),next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(event.key==='ArrowDown'||event.key==='ArrowRight')?(index+1)%buttons.length:(index<=0?buttons.length-1:index-1);buttons[next]?.focus()});
    })();
`;
