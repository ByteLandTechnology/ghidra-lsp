// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

import { syntaxStyles } from './syntax';
/** Shared by every webview. Native editors, comments and trees use VS Code's own UI. */
export const pageStyles = `${syntaxStyles}
*{box-sizing:border-box}
html{scrollbar-color:var(--vscode-scrollbarSlider-background) var(--vscode-editor-background)}
body.vscode-dark,body.vscode-high-contrast{color-scheme:dark;--gh-contrast-ink:#fff}
body.vscode-light,body.vscode-high-contrast-light{color-scheme:light;--gh-contrast-ink:#000}
::selection{background:var(--vscode-editor-selectionBackground);color:var(--vscode-editor-selectionForeground,var(--vscode-foreground))}
body{margin:0;color:var(--vscode-foreground);background:var(--vscode-editor-background);font:var(--vscode-font-size,13px)/1.5 var(--vscode-font-family);--gh-contrast-ink:var(--vscode-editor-foreground,var(--vscode-foreground));--gh-fg-muted:color-mix(in srgb,var(--vscode-descriptionForeground) 45%,var(--vscode-foreground));--gh-placeholder:color-mix(in srgb,var(--vscode-input-placeholderForeground,var(--vscode-descriptionForeground)) 30%,var(--vscode-input-foreground,var(--vscode-foreground)));--gh-fg-success:color-mix(in srgb,var(--vscode-testing-iconPassed) 80%,var(--gh-contrast-ink));--gh-sel-inactive-bg:var(--vscode-list-inactiveSelectionBackground);--gh-sel-inactive-fg:var(--vscode-list-inactiveSelectionForeground,var(--vscode-foreground));--gh-sel-active-bg:var(--vscode-list-activeSelectionBackground);--gh-sel-active-fg:var(--vscode-list-activeSelectionForeground,var(--vscode-foreground));--gh-sel-link:color-mix(in srgb,var(--vscode-textLink-foreground) 65%,var(--gh-contrast-ink));--gh-tok-mnemonic:var(--vscode-symbolIcon-keywordForeground,var(--vscode-foreground));--gh-tok-register:var(--vscode-symbolIcon-variableForeground,var(--vscode-foreground));--gh-tok-number:var(--vscode-debugTokenExpression-number,var(--vscode-foreground));--gh-tok-string:var(--vscode-debugTokenExpression-string,var(--vscode-foreground));--gh-tok-keyword:var(--gh-fg-muted);--gh-tok-symbol:var(--vscode-symbolIcon-functionForeground,var(--vscode-foreground));--gh-tok-name:var(--vscode-foreground);--gh-badge-bg:var(--vscode-sideBar-background,var(--vscode-editor-background));--gh-badge-fg:var(--gh-fg-muted);--gh-badge-dirty-bg:color-mix(in srgb,var(--vscode-editorWarning-foreground,#cca700) 12%,var(--vscode-editor-background));--gh-badge-dirty-fg:color-mix(in srgb,var(--vscode-editorWarning-foreground,#cca700) 55%,var(--gh-contrast-ink));--gh-badge-dirty-border:color-mix(in srgb,var(--vscode-editorWarning-foreground,#cca700) 45%,transparent);--gh-badge-saving-bg:color-mix(in srgb,var(--vscode-focusBorder) 12%,var(--vscode-editor-background));--gh-badge-saving-fg:color-mix(in srgb,var(--vscode-focusBorder) 55%,var(--gh-contrast-ink));--gh-badge-saving-border:color-mix(in srgb,var(--vscode-focusBorder) 45%,transparent);--gh-toggle-active-bg:color-mix(in srgb,var(--vscode-focusBorder) 16%,var(--vscode-editor-background));--gh-toggle-active-fg:color-mix(in srgb,var(--vscode-focusBorder) 55%,var(--gh-contrast-ink));--gh-toggle-active-border:var(--vscode-focusBorder);--gh-port-stroke:color-mix(in srgb,var(--gh-fg-muted) 85%,var(--vscode-editor-background));--gh-port-expanded-stroke:color-mix(in srgb,var(--vscode-focusBorder) 80%,var(--gh-contrast-ink));--gh-port-root-stroke:color-mix(in srgb,var(--gh-sel-active-fg) 82%,var(--gh-sel-active-bg))}
main{max-width:1160px;margin:0 auto;padding:24px 28px 40px;min-width:0}
header{padding-bottom:16px;margin-bottom:16px;border-bottom:1px solid var(--vscode-panel-border)}
h1{font-size:22px;line-height:1.3;font-weight:600;margin:4px 0 8px;overflow-wrap:anywhere}
h2{font-size:15px;font-weight:600;margin:0 0 12px}
h3{font-size:13px;font-weight:600;margin:0 0 4px}
p{margin:8px 0;overflow-wrap:anywhere}
.eyebrow,.subtitle,.hint,.form-hint,dt{color:var(--gh-fg-muted)}
.eyebrow{font-size:12px;margin-bottom:4px}
.subtitle{margin:0;overflow-wrap:anywhere}
section{margin:20px 0;padding-top:16px;border-top:1px solid var(--vscode-panel-border);min-width:0}
.toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:0 0 16px;min-width:0}
.toolbar>*{max-width:100%}
button{font:inherit;line-height:1.4;min-height:28px;padding:4px 10px;border:1px solid var(--vscode-contrastBorder,var(--vscode-button-border,var(--vscode-panel-border)));border-radius:2px;cursor:pointer;color:var(--vscode-button-secondaryForeground,var(--vscode-foreground));background:var(--vscode-button-secondaryBackground,var(--vscode-input-background))}
button:hover:enabled{background:var(--vscode-button-secondaryHoverBackground,var(--vscode-list-hoverBackground))}
button.primary{color:var(--vscode-button-foreground,var(--vscode-foreground));background:var(--vscode-button-background,var(--vscode-editor-background))}
button.primary:hover:enabled{background:var(--vscode-button-hoverBackground,var(--vscode-list-hoverBackground))}
button:disabled{opacity:.5;cursor:default}
button.link{min-height:0;padding:0;border:0;background:transparent;color:var(--vscode-textLink-foreground);text-align:left;text-decoration:underline;text-underline-offset:3px;overflow-wrap:anywhere}
button.link:hover{color:var(--vscode-textLink-activeForeground);background:transparent}
button.danger{color:var(--vscode-errorForeground)}
input,select,textarea{font:inherit;border:1px solid var(--vscode-input-border,transparent);border-radius:2px;color:var(--vscode-input-foreground);background:var(--vscode-input-background);padding:5px 8px;min-width:0;max-width:100%}
input,textarea{caret-color:var(--vscode-editorCursor-foreground,var(--vscode-foreground))}
input::placeholder,textarea::placeholder{color:var(--gh-placeholder);opacity:1}
input:disabled,select:disabled,textarea:disabled{opacity:.6;cursor:default}
input:read-only{color:var(--gh-fg-muted)}
textarea{min-height:88px;resize:vertical}
:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:2px}
input:focus,select:focus,textarea:focus{outline:1px solid var(--vscode-focusBorder);outline-offset:0}
.table-wrap{max-width:100%;overflow:auto;border:1px solid var(--vscode-panel-border);border-radius:2px}
table{width:100%;border-collapse:collapse;text-align:left;font-size:inherit;font-variant-numeric:tabular-nums}
th,td{padding:7px 10px;border-bottom:1px solid var(--vscode-panel-border);vertical-align:top}
th{font-size:12px;font-weight:600;color:var(--gh-fg-muted);background:var(--vscode-editor-background)}
td{overflow-wrap:anywhere}
tr:last-child td{border-bottom:0}
tbody tr:hover{background:var(--vscode-list-hoverBackground)}
.selected{background:var(--gh-sel-inactive-bg);color:var(--gh-sel-inactive-fg);box-shadow:inset 2px 0 var(--vscode-focusBorder)}
tbody tr.selected{--gh-tok-mnemonic:color-mix(in srgb,var(--vscode-symbolIcon-keywordForeground,var(--vscode-foreground)) 65%,var(--gh-contrast-ink));--gh-tok-register:color-mix(in srgb,var(--vscode-symbolIcon-variableForeground,var(--vscode-foreground)) 65%,var(--gh-contrast-ink));--gh-tok-number:color-mix(in srgb,var(--vscode-debugTokenExpression-number,var(--vscode-foreground)) 65%,var(--gh-contrast-ink));--gh-tok-string:color-mix(in srgb,var(--vscode-debugTokenExpression-string,var(--vscode-foreground)) 65%,var(--gh-contrast-ink));--gh-tok-keyword:var(--gh-sel-inactive-fg);--gh-tok-symbol:color-mix(in srgb,var(--vscode-symbolIcon-functionForeground,var(--vscode-foreground)) 65%,var(--gh-contrast-ink));--gh-tok-name:var(--gh-sel-inactive-fg)}
tbody tr.selected:focus{--gh-tok-mnemonic:var(--gh-sel-active-fg);--gh-tok-register:var(--gh-sel-active-fg);--gh-tok-number:var(--gh-sel-active-fg);--gh-tok-string:var(--gh-sel-active-fg);--gh-tok-keyword:var(--gh-sel-active-fg);--gh-tok-symbol:var(--gh-sel-active-fg);--gh-tok-name:var(--gh-sel-active-fg)}
dl{margin:0}
dl>div{display:grid;grid-template-columns:150px minmax(0,1fr);gap:16px;padding:6px 0;border-bottom:1px solid var(--vscode-panel-border)}
dl>div:last-child{border:0}
dt,dd{margin:0}
dd{overflow-wrap:anywhere}
.description{white-space:pre-wrap;overflow-wrap:anywhere}
details{margin:16px 0;border-top:1px solid var(--vscode-panel-border);padding-top:12px}
summary{cursor:pointer;font-weight:600;overflow-wrap:anywhere}
details[open]>summary{margin-bottom:12px}
#edit-form{max-width:960px}
.form-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,230px),1fr));gap:16px}
.form-grid label{display:block;min-width:0}
label{font-size:12px;color:var(--vscode-foreground)}
label>input:not([type=checkbox]),label>select,label>textarea{display:block;width:100%;margin-top:5px}
input[type=checkbox]{width:auto;margin:0;accent-color:var(--vscode-checkbox-selectBackground,var(--vscode-focusBorder));flex-shrink:0}
.checkbox{display:flex;align-items:center;gap:8px;min-height:28px}
.check-group{display:flex;flex-wrap:wrap;gap:8px 20px;margin:16px 0 0;padding:0;border:0;min-width:0}
.check-group legend{font-size:12px;color:var(--gh-fg-muted);margin-bottom:6px;padding:0}
.full{grid-column:1/-1}
.form-fields{border:0;padding:0}
.form-notes{margin-top:16px}
.form-actions{border-top:1px solid var(--vscode-panel-border);padding-top:16px;margin-top:20px}
.form-hint{font-size:12px;margin:12px 0}
.editable{min-width:460px}
.editable td{padding:6px}
.editable input{width:100%;min-width:90px;margin:0}
.editable td:last-child:has(.row-remove){width:1%;white-space:nowrap}
.row-remove{min-height:26px;padding:3px 7px}
[data-add-row]{margin-top:8px}
.hex{font:13px/1.6 var(--vscode-editor-font-family,monospace);white-space:pre-wrap;overflow-wrap:anywhere}
.error{color:var(--vscode-errorForeground);white-space:pre-wrap;overflow-wrap:anywhere}
.success{color:var(--gh-fg-success)}
#error:empty,#status:empty{display:none}
.empty{padding:20px 0;color:var(--gh-fg-muted)}
@media(forced-colors:active){body{--gh-fg-muted:CanvasText;--gh-placeholder:GrayText;--gh-fg-success:CanvasText;--gh-sel-inactive-bg:Highlight;--gh-sel-inactive-fg:HighlightText;--gh-sel-active-bg:Highlight;--gh-sel-active-fg:HighlightText;--gh-sel-link:HighlightText;--gh-badge-bg:Canvas;--gh-badge-fg:CanvasText;--gh-badge-dirty-bg:Canvas;--gh-badge-dirty-fg:CanvasText;--gh-badge-dirty-border:Highlight;--gh-badge-saving-bg:Canvas;--gh-badge-saving-fg:CanvasText;--gh-badge-saving-border:Highlight;--gh-toggle-active-bg:Highlight;--gh-toggle-active-fg:HighlightText;--gh-toggle-active-border:Highlight;--gh-port-stroke:ButtonText;--gh-port-expanded-stroke:Highlight;--gh-port-root-stroke:HighlightText}tbody tr.selected,tbody tr.selected:focus{forced-color-adjust:none;--gh-tok-mnemonic:HighlightText;--gh-tok-register:HighlightText;--gh-tok-number:HighlightText;--gh-tok-string:HighlightText;--gh-tok-keyword:HighlightText;--gh-tok-symbol:HighlightText;--gh-tok-name:HighlightText}[aria-pressed="true"],[aria-expanded="true"]{forced-color-adjust:none}}
@media(max-width:640px){main{padding:16px}h1{font-size:20px}dl>div{grid-template-columns:1fr;gap:2px}.toolbar{gap:6px}.form-grid{gap:12px}}
`;
