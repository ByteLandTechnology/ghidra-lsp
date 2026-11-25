// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

import { syntaxStyles } from './syntax';
/** Shared by every webview. Native editors, comments and trees use VS Code's own UI. */
export const pageStyles = `${syntaxStyles}
:root,body{--ghidra-muted:color-mix(in srgb,var(--vscode-foreground) 78%,var(--vscode-descriptionForeground,var(--vscode-foreground)));--ghidra-placeholder:color-mix(in srgb,var(--vscode-input-foreground,var(--vscode-foreground)) 78%,var(--vscode-input-placeholderForeground,var(--vscode-descriptionForeground,var(--vscode-foreground))));--ghidra-accent:color-mix(in srgb,var(--vscode-textLink-foreground,var(--vscode-focusBorder)) 72%,var(--vscode-editor-foreground,var(--vscode-foreground)));--ghidra-focus:color-mix(in srgb,var(--vscode-focusBorder) 82%,var(--vscode-editor-foreground,var(--vscode-foreground)));--ghidra-pressed-bg:color-mix(in srgb,var(--vscode-focusBorder) 14%,var(--vscode-editor-background));--ghidra-warning:color-mix(in srgb,var(--vscode-editorWarning-foreground,#cca700) 48%,var(--vscode-editor-foreground,var(--vscode-foreground)));--ghidra-success:color-mix(in srgb,var(--vscode-testing-iconPassed,var(--vscode-foreground)) 78%,var(--vscode-editor-foreground,var(--vscode-foreground)));--ghidra-selection-bg:var(--vscode-list-inactiveSelectionBackground,var(--vscode-list-hoverBackground,var(--vscode-editor-background)));--ghidra-selection-fg:var(--vscode-list-inactiveSelectionForeground,var(--vscode-foreground));--ghidra-active-selection-bg:var(--vscode-list-activeSelectionBackground,var(--ghidra-selection-bg));--ghidra-active-selection-fg:var(--vscode-list-activeSelectionForeground,var(--vscode-foreground))}
*{box-sizing:border-box}
html{scrollbar-color:var(--vscode-scrollbarSlider-background) var(--vscode-editor-background)}
body.vscode-dark,body.vscode-high-contrast{color-scheme:dark}
body.vscode-light,body.vscode-high-contrast-light{color-scheme:light}
::selection{background:var(--vscode-editor-selectionBackground);color:var(--vscode-editor-selectionForeground,var(--vscode-foreground))}
body{margin:0;color:var(--vscode-foreground);background:var(--vscode-editor-background);font:var(--vscode-font-size,13px)/1.5 var(--vscode-font-family)}
main{max-width:1160px;margin:0 auto;padding:24px 28px 40px;min-width:0}
header{padding-bottom:16px;margin-bottom:16px;border-bottom:1px solid var(--vscode-panel-border)}
h1{font-size:22px;line-height:1.3;font-weight:600;margin:4px 0 8px;overflow-wrap:anywhere}
h2{font-size:15px;font-weight:600;margin:0 0 12px}
h3{font-size:13px;font-weight:600;margin:0 0 4px}
p{margin:8px 0;overflow-wrap:anywhere}
.eyebrow,.subtitle,.hint,.form-hint,dt{color:var(--ghidra-muted)}
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
input::placeholder,textarea::placeholder{color:var(--ghidra-placeholder);opacity:1}
input:disabled,select:disabled,textarea:disabled{opacity:.6;cursor:default}
input:read-only{color:var(--ghidra-muted)}
textarea{min-height:88px;resize:vertical}
:focus-visible{outline:2px solid var(--ghidra-focus);outline-offset:2px}
input:focus,select:focus,textarea:focus{outline:1px solid var(--ghidra-focus);outline-offset:0}
.table-wrap{max-width:100%;overflow:auto;border:1px solid var(--vscode-panel-border);border-radius:2px}
table{width:100%;border-collapse:collapse;text-align:left;font-size:inherit;font-variant-numeric:tabular-nums}
th,td{padding:7px 10px;border-bottom:1px solid var(--vscode-panel-border);vertical-align:top}
th{font-size:12px;font-weight:600;color:var(--ghidra-muted);background:var(--vscode-editor-background)}
td{overflow-wrap:anywhere}
tr:last-child td{border-bottom:0}
tbody tr:hover{background:var(--vscode-list-hoverBackground)}
.selected{background:var(--ghidra-selection-bg);color:var(--ghidra-selection-fg);box-shadow:inset 2px 0 var(--ghidra-focus)}
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
.check-group legend{font-size:12px;color:var(--ghidra-muted);margin-bottom:6px;padding:0}
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
.success{color:var(--ghidra-success)}
#error:empty,#status:empty{display:none}
.empty{padding:20px 0;color:var(--ghidra-muted)}
@media(max-width:640px){main{padding:16px}h1{font-size:20px}dl>div{grid-template-columns:1fr;gap:2px}.toolbar{gap:6px}.form-grid{gap:12px}.editable,.editable input{min-width:0}}
:root,body{--ghidra-hv-border:var(--vscode-contrastBorder,color-mix(in srgb,var(--vscode-foreground) 72%,var(--vscode-editor-background)));--ghidra-active-border:var(--vscode-contrastActiveBorder,var(--ghidra-focus))}
button[aria-pressed="true"]:not(.node-branch)::before,button[aria-expanded="true"]:not(.node-branch):not(.expand-run-btn)::before{content:"\\eab2" / "";font:11px/1 call-icons;display:inline-block;vertical-align:middle;flex-shrink:0}
button[aria-pressed="true"]:not(.node-branch):not(.call-column-pick),button[aria-expanded="true"]:not(.node-branch):not(.expand-run-btn){border:2px solid var(--ghidra-active-border)}
input:focus,select:focus,textarea:focus{outline:2px solid var(--ghidra-focus);outline-offset:-1px}
.selected{outline:2px solid var(--ghidra-active-border);outline-offset:-2px}
:is(body.vscode-high-contrast,body.vscode-high-contrast-light) :is(input:not([type="checkbox"]),select,textarea){border:1px solid var(--ghidra-hv-border)}
:is(body.vscode-high-contrast,body.vscode-high-contrast-light) button:where(:not(.link,.type-sort,.xref-link,.target-link,.expand-run-btn,.hex-ptr-btn,.call-column-pick,[aria-pressed="true"],[aria-expanded="true"])){border:1px solid var(--ghidra-hv-border)}
:is(body.vscode-high-contrast,body.vscode-high-contrast-light) :is(button[aria-pressed="true"]:where(:not(.node-branch,.call-column-pick)),button[aria-expanded="true"]:where(:not(.node-branch,.expand-run-btn))){background:var(--vscode-editor-background);color:var(--vscode-foreground);border:2px solid var(--ghidra-active-border)}
@media(prefers-contrast:more){
  input:not([type="checkbox"]),select,textarea{border:1px solid var(--ghidra-hv-border)}
  button:where(:not(.link,.type-sort,.xref-link,.target-link,.expand-run-btn,.hex-ptr-btn,.call-column-pick,[aria-pressed="true"],[aria-expanded="true"])){border:1px solid var(--ghidra-hv-border)}
}
@media(forced-colors:active){
  :root,body{background:Canvas;color:CanvasText;--ghidra-muted:CanvasText;--ghidra-placeholder:GrayText;--ghidra-accent:LinkText;--ghidra-focus:Highlight;--ghidra-pressed-bg:Canvas;--ghidra-warning:CanvasText;--ghidra-success:CanvasText;--ghidra-selection-bg:Canvas;--ghidra-selection-fg:CanvasText;--ghidra-active-selection-bg:Canvas;--ghidra-active-selection-fg:CanvasText;--ghidra-hv-border:ButtonText;--ghidra-active-border:Highlight}
  input:not([type="checkbox"]),select,textarea{background:Field;color:FieldText;border:1px solid var(--ghidra-hv-border)}
  input[type="checkbox"]{border:1px solid var(--ghidra-hv-border)}
  button:where(:not(.link,.type-sort,.xref-link,.target-link,.expand-run-btn,.hex-ptr-btn,.call-column-pick,[aria-pressed="true"],[aria-expanded="true"])){background:ButtonFace;color:ButtonText;border:1px solid var(--ghidra-hv-border)}
  button.link,.xref-link,.target-link,.expand-run-btn,.hex-ptr-btn{color:var(--ghidra-accent);text-decoration:underline}
  button[aria-pressed="true"]:not(.node-branch):not(.call-column-pick),button[aria-expanded="true"]:not(.node-branch):not(.expand-run-btn){background:var(--ghidra-pressed-bg);color:var(--ghidra-selection-fg);border:2px solid var(--ghidra-active-border)}
  .selected,tbody tr.selected,tbody tr.selected:focus,tbody tr.selected:focus-within{background:var(--ghidra-selection-bg);color:var(--ghidra-selection-fg);box-shadow:none;outline:2px solid var(--ghidra-active-border);outline-offset:-2px}
  :focus-visible,input:focus,select:focus,textarea:focus{outline:2px solid var(--ghidra-focus);outline-offset:2px}
  :is(.tok-mnemonic,.tok-register,.tok-number,.tok-string,.tok-keyword,.tok-symbol,.tok-scope,.tok-params,.tok-name){color:var(--ghidra-selection-fg)}
  svg :is(.tok-mnemonic,.tok-register,.tok-number,.tok-string,.tok-keyword,.tok-symbol){fill:var(--ghidra-selection-fg)}
}
`;
