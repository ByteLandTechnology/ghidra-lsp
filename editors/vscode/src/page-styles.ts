// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

import { syntaxStyles } from './syntax';
/** Shared by every webview. Native editors, comments and trees use VS Code's own UI. */
export const pageStyles = `${syntaxStyles}
*{box-sizing:border-box}
html{scrollbar-color:var(--vscode-scrollbarSlider-background) var(--vscode-editor-background)}
body.vscode-dark,body.vscode-high-contrast{color-scheme:dark}
body.vscode-light,body.vscode-high-contrast-light{color-scheme:light}
::selection{background:var(--vscode-editor-selectionBackground);color:var(--vscode-editor-selectionForeground,var(--vscode-foreground))}
body{margin:0;color:var(--ghidra-fg,var(--vscode-foreground));background:var(--ghidra-bg,var(--vscode-editor-background));font:var(--vscode-font-size,13px)/1.5 var(--vscode-font-family)}
main{max-width:1160px;margin:0 auto;padding:24px 28px 40px;min-width:0}
header{padding-bottom:16px;margin-bottom:16px;border-bottom:1px solid var(--vscode-panel-border)}
h1{font-size:22px;line-height:1.3;font-weight:600;margin:4px 0 8px;overflow-wrap:anywhere}
h2{font-size:15px;font-weight:600;margin:0 0 12px}
h3{font-size:13px;font-weight:600;margin:0 0 4px}
p{margin:8px 0;overflow-wrap:anywhere}
.eyebrow,.subtitle,.hint,.form-hint,dt{color:var(--ghidra-muted,var(--vscode-descriptionForeground))}
.eyebrow{font-size:12px;margin-bottom:4px}
.subtitle{margin:0;overflow-wrap:anywhere}
section{margin:20px 0;padding-top:16px;border-top:1px solid var(--vscode-panel-border);min-width:0}
.toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:0 0 16px;min-width:0}
.toolbar>*{max-width:100%}
button{font:inherit;line-height:1.4;min-height:28px;padding:4px 10px;border:1px solid var(--vscode-contrastBorder,var(--vscode-button-border,var(--vscode-panel-border)));border-radius:2px;cursor:pointer;color:var(--ghidra-btn-sec-fg,var(--vscode-button-secondaryForeground,var(--vscode-foreground)));background:var(--ghidra-btn-sec-bg,var(--vscode-button-secondaryBackground,var(--vscode-input-background)))}
button:hover:enabled{color:var(--ghidra-btn-sec-hover-fg,var(--vscode-button-secondaryForeground,var(--vscode-foreground)));background:var(--ghidra-btn-sec-hover-bg,var(--vscode-button-secondaryHoverBackground,var(--vscode-list-hoverBackground)))}
button.primary{color:var(--ghidra-btn-fg,var(--vscode-button-foreground,var(--vscode-foreground)));background:var(--ghidra-btn-bg,var(--vscode-button-background,var(--vscode-editor-background)))}
button.primary:hover:enabled{color:var(--ghidra-btn-hover-fg,var(--vscode-button-foreground,var(--vscode-foreground)));background:var(--ghidra-btn-hover-bg,var(--vscode-button-hoverBackground,var(--vscode-list-hoverBackground)))}
button:disabled{opacity:.5;cursor:default}
button.link{min-height:0;padding:0;border:0;background:transparent;color:var(--ghidra-row-link,var(--ghidra-link,var(--vscode-textLink-foreground)));text-align:left;text-decoration:underline;text-underline-offset:3px;overflow-wrap:anywhere;transition:none}
button.link:hover{color:var(--ghidra-row-link,var(--ghidra-link-active,var(--vscode-textLink-activeForeground)));background:transparent}
button.danger{color:var(--ghidra-btn-danger-fg,var(--vscode-errorForeground))}
input,select,textarea{font:inherit;border:1px solid var(--vscode-input-border,transparent);border-radius:2px;color:var(--ghidra-input-fg,var(--vscode-input-foreground));background:var(--ghidra-input-bg,var(--vscode-input-background));padding:5px 8px;min-width:0;max-width:100%}
input,textarea{caret-color:var(--vscode-editorCursor-foreground,var(--vscode-foreground))}
input::placeholder,textarea::placeholder{color:var(--ghidra-input-placeholder,var(--vscode-input-placeholderForeground));opacity:1}
input:disabled,select:disabled,textarea:disabled{opacity:.6;cursor:default}
input:read-only{color:var(--ghidra-input-readonly,var(--vscode-descriptionForeground))}
textarea{min-height:88px;resize:vertical}
:focus-visible{outline:2px solid var(--ghidra-focus-border,var(--vscode-focusBorder));outline-offset:2px}
input:focus,select:focus,textarea:focus{outline:1px solid var(--ghidra-focus-border,var(--vscode-focusBorder));outline-offset:0}
.table-wrap{max-width:100%;overflow:auto;border:1px solid var(--vscode-panel-border);border-radius:2px}
table{width:100%;border-collapse:collapse;text-align:left;font-size:inherit;font-variant-numeric:tabular-nums}
th,td{padding:7px 10px;border-bottom:1px solid var(--vscode-panel-border);vertical-align:top}
th{font-size:12px;font-weight:600;color:var(--ghidra-muted,var(--vscode-descriptionForeground));background:var(--ghidra-bg,var(--vscode-editor-background))}
td{overflow-wrap:anywhere}
tr:last-child td{border-bottom:0}
tbody tr:hover{background:var(--ghidra-hover-bg,var(--vscode-list-hoverBackground));color:var(--ghidra-hover-fg,var(--vscode-foreground));--ghidra-row-fg:var(--ghidra-hover-fg);--ghidra-row-muted:var(--ghidra-hover-muted);--ghidra-row-link:var(--ghidra-hover-link);--ghidra-row-tok-mnemonic:var(--ghidra-hover-tok-mnemonic);--ghidra-row-tok-register:var(--ghidra-hover-tok-register);--ghidra-row-tok-number:var(--ghidra-hover-tok-number);--ghidra-row-tok-string:var(--ghidra-hover-tok-string);--ghidra-row-tok-keyword:var(--ghidra-hover-tok-keyword);--ghidra-row-tok-symbol:var(--ghidra-hover-tok-symbol);--ghidra-row-tok-scope:var(--ghidra-hover-tok-scope);--ghidra-row-tok-name:var(--ghidra-hover-tok-name)}
.selected{background:var(--ghidra-inactive-sel-bg,var(--vscode-list-inactiveSelectionBackground));color:var(--ghidra-inactive-sel-fg,var(--vscode-list-inactiveSelectionForeground,var(--vscode-foreground)));box-shadow:inset 2px 0 var(--ghidra-focus-border,var(--vscode-focusBorder));--ghidra-row-fg:var(--ghidra-inactive-sel-fg);--ghidra-row-muted:var(--ghidra-inactive-sel-muted);--ghidra-row-link:var(--ghidra-inactive-sel-link);--ghidra-row-tok-mnemonic:var(--ghidra-inactive-sel-tok-mnemonic);--ghidra-row-tok-register:var(--ghidra-inactive-sel-tok-register);--ghidra-row-tok-number:var(--ghidra-inactive-sel-tok-number);--ghidra-row-tok-string:var(--ghidra-inactive-sel-tok-string);--ghidra-row-tok-keyword:var(--ghidra-inactive-sel-tok-keyword);--ghidra-row-tok-symbol:var(--ghidra-inactive-sel-tok-symbol);--ghidra-row-tok-scope:var(--ghidra-inactive-sel-tok-scope);--ghidra-row-tok-name:var(--ghidra-inactive-sel-tok-name)}
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
label{font-size:12px;color:var(--ghidra-fg,var(--vscode-foreground))}
label>input:not([type=checkbox]),label>select,label>textarea{display:block;width:100%;margin-top:5px}
input[type=checkbox]{width:auto;margin:0;accent-color:var(--vscode-checkbox-selectBackground,var(--vscode-focusBorder));flex-shrink:0}
.checkbox{display:flex;align-items:center;gap:8px;min-height:28px}
.check-group{display:flex;flex-wrap:wrap;gap:8px 20px;margin:16px 0 0;padding:0;border:0;min-width:0}
.check-group legend{font-size:12px;color:var(--ghidra-muted,var(--vscode-descriptionForeground));margin-bottom:6px;padding:0}
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
.error{color:var(--ghidra-error,var(--vscode-errorForeground));white-space:pre-wrap;overflow-wrap:anywhere}
.success{color:var(--ghidra-success,var(--vscode-testing-iconPassed))}
#error:empty,#status:empty{display:none}
.empty{padding:20px 0;color:var(--ghidra-muted,var(--vscode-descriptionForeground))}
@media(max-width:640px){main{padding:16px}h1{font-size:20px}dl>div{grid-template-columns:1fr;gap:2px}.toolbar{gap:6px}.form-grid{gap:12px}}
`;
