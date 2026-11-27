// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

/** Call graph uses the existing themed graph viewport, with function-focused controls. */
export const callGraphStyles = `
.call-page{padding:0}
.call-page .call-topbar{min-height:48px}
.call-page .call-topbar-primary{flex:1;min-width:0}
.call-page .call-topbar h1{font-size:14px;letter-spacing:.01em;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin:0}
.call-page .call-topbar .call-function-title{display:flex;align-items:center;min-width:0}
.call-page .call-topbar #call-function-picker{display:flex;align-items:center;gap:6px;max-width:100%;min-width:24px;min-height:28px;height:auto;padding:4px 6px;border:0;border-radius:4px;background:transparent;color:inherit;font:inherit;letter-spacing:inherit;text-align:left;overflow:hidden}
.call-function-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.call-function-title .call-icon:first-child{color:var(--ghidra-muted);flex-shrink:0}
.call-function-title .call-icon:last-child{font-size:12px;color:var(--ghidra-muted);flex-shrink:0}
.call-icon{font:16px call-icons;display:inline-block;line-height:1;vertical-align:middle}
.call-page .call-icon-button,.call-page #call-menu>summary{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;min-width:24px;min-height:24px;padding:6px;border:0;border-radius:4px;background:transparent;text-align:center;cursor:pointer;flex-shrink:0}
.call-page .call-topbar button{background:transparent;border:0;min-height:28px;height:auto}
.call-page button:hover,.call-page #call-menu>summary:hover{background:var(--vscode-toolbar-hoverBackground,var(--vscode-list-hoverBackground))}
.call-page #call-menu{margin:0;border:0;padding:0;flex-shrink:0}
.call-page #call-menu>summary,.call-page #call-menu[open]>summary{list-style:none;margin:0}
.call-page #call-menu>summary::-webkit-details-marker{display:none}
.call-menu-content{position:absolute;z-index:6;right:8px;top:calc(100% + 2px);width:min(304px,calc(100vw - 16px));max-height:max(96px,calc(100vh - 116px));overflow:auto;background:var(--vscode-menu-background,var(--vscode-editor-background));color:var(--vscode-menu-foreground,var(--vscode-foreground));border:1px solid var(--vscode-menu-border,var(--vscode-panel-border));box-shadow:0 4px 12px var(--vscode-widget-shadow);padding:8px;cursor:default}
.call-page #call-menu:not([open]) .call-menu-content{display:none}
.call-page #call-menu[open] .call-menu-content{animation:call-reveal 140ms cubic-bezier(.2,.8,.2,1)}
.call-page .selection-tools{display:flex;flex-direction:column;gap:4px;margin:0;padding:4px 0 8px;border-bottom:1px solid var(--vscode-panel-border)}
.call-page #selection-label{display:flex;flex-direction:column;font-size:12px;line-height:1.6;padding:2px 8px 8px;overflow-wrap:anywhere;color:var(--ghidra-muted)}
.call-page .selection-buttons{display:flex;flex-direction:column;gap:2px;width:100%}
.call-page .selection-buttons button,.call-page .call-controls button{display:flex;align-items:center;gap:10px;width:100%;border:0;text-align:left;padding:6px 8px;min-height:32px;border-radius:3px;font-size:13px;font-weight:400;background:transparent;color:inherit}
.call-page .selection-buttons button.primary{background:transparent;color:inherit}
.call-page .selection-buttons button:hover,.call-page .call-controls button:hover{background:var(--vscode-menu-selectionBackground,var(--vscode-list-hoverBackground));color:var(--vscode-menu-selectionForeground,var(--vscode-foreground))}
.call-page #more-summary{font-size:13px;background:transparent;color:inherit;border:0;padding:6px 8px;min-height:32px}
.call-page .more-actions[open]>summary{margin-bottom:4px}
.call-page #selection-label strong{font-size:13px;font-weight:600;color:var(--vscode-foreground)}
.call-page #selection-label>span{font:11px var(--vscode-editor-font-family,monospace)}
.call-menu-check{margin-left:auto;visibility:hidden}
[aria-pressed="true"]>.call-menu-check{visibility:visible}
.call-menu-footer{border-top:1px solid var(--vscode-panel-border);margin-top:6px;padding-top:6px}
.call-page .call-controls label>span{display:flex;gap:10px;align-items:center}
.call-page .call-controls select{min-width:100px}
.call-page .call-topbar .call-icon-button[aria-pressed="true"],.call-page .call-topbar .call-icon-button[aria-expanded="true"]{color:var(--ghidra-accent);background:var(--ghidra-pressed-bg);box-shadow:inset 0 0 0 1px var(--ghidra-focus)}
.call-page .call-controls{display:flex;flex-direction:column;gap:2px;padding-top:8px;font-size:13px}
.call-page .call-controls label{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:5px 8px}
.call-page .call-controls button{text-align:left}
.call-page .call-icon-row,.call-page .selection-buttons{flex-direction:row;flex-wrap:wrap;align-items:center;gap:2px;padding:4px}
.call-page .call-icon-row button,.call-page .selection-buttons button{width:32px;min-width:32px;justify-content:center;padding:6px}
.call-page .call-icon-row [aria-pressed="true"]{color:var(--ghidra-accent);background:var(--ghidra-pressed-bg);box-shadow:inset 0 0 0 1px var(--ghidra-focus)}
.call-divider{width:1px;align-self:stretch;margin:6px 3px;background:var(--vscode-panel-border)}
.call-page .call-search input{width:100%;min-height:30px;height:auto;border-radius:4px}
.call-page .call-search:not([hidden]){animation:call-reveal 140ms cubic-bezier(.2,.8,.2,1)}
.call-page .call-canvas{position:relative;min-height:0;border:0;border-radius:0;background:var(--vscode-editor-background)}
.call-canvas svg{overflow:visible}
.call-node-port{display:flex;justify-content:center;align-items:center;padding:1px 8px}
.call-node-main{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:8px;padding:8px 8px 8px 12px;min-width:0}
.call-node-copy{display:flex;flex-direction:column;gap:2px;min-width:0}
.call-canvas .call-node .node-title{font:500 14px/1.35 var(--vscode-font-family);color:inherit;min-width:0;white-space:normal;overflow-wrap:anywhere}
.call-canvas .call-node.is-root .node-title{font-size:15px;font-weight:600}
.call-canvas .call-node .call-root-address{font:500 11.5px/1.35 var(--vscode-editor-font-family,monospace);font-variant-numeric:tabular-nums;color:inherit;opacity:.85;overflow-wrap:anywhere}
.call-node-actions{display:flex;align-items:center;justify-content:center;flex-shrink:0}
.call-node-controls{overflow:visible}
.call-node .call-node-controls{opacity:.82;pointer-events:auto;transition:opacity 140ms ease}
.call-node:hover .call-node-controls,.call-node:focus-within .call-node-controls,.call-node.selected .call-node-controls,.call-node.is-root .call-node-controls{opacity:1}
.call-node-controls .call-icon{font-size:16px;flex-shrink:0}
.call-page .node-decompile{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;min-width:28px;min-height:28px;padding:3px;background:transparent;border:0;border-radius:4px;color:var(--ghidra-muted)}
.call-node:hover .node-decompile,.call-node:focus-within .node-decompile,.call-node.is-root .node-decompile{color:var(--vscode-foreground)}
.call-node .node-decompile:hover{background:var(--vscode-list-hoverBackground)}
.call-page .node-branch{display:inline-flex;align-items:center;justify-content:center;width:52px;height:26px;min-width:52px;min-height:26px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--ghidra-muted);box-shadow:none;cursor:pointer;box-sizing:border-box;transition:color 150ms ease,transform 100ms ease-out}
.call-page .node-branch[aria-expanded="true"]{color:var(--ghidra-accent)}
.call-node.is-root .node-branch{color:color-mix(in srgb,var(--vscode-foreground) 78%,var(--vscode-editor-background))}
.call-node.is-root .node-branch[aria-expanded="true"]{color:var(--ghidra-focus)}
.call-page .node-branch svg.branch-bar{width:48px;height:12px;flex:none;overflow:visible}
.call-page .node-branch .branch-bar-path{stroke-width:3.4;d:path("M6 6 Q24 6 42 6");transition:d 180ms cubic-bezier(.23,1,.32,1),stroke-width 180ms ease}
.call-page .node-branch[aria-expanded="true"] .branch-bar-path{stroke-width:2.8;d:path("M13 6 Q24 6 35 6")}
.call-page .node-branch:hover,.call-page .node-branch:focus-visible{background:transparent;color:var(--vscode-editor-foreground,var(--vscode-foreground));box-shadow:none}
.call-node.is-root .node-branch:is(:hover,:focus-visible){color:var(--vscode-foreground)}
.call-page .node-branch[data-direction="callers"][aria-expanded="false"]:hover .branch-bar-path,.call-page .node-branch[data-direction="callers"][aria-expanded="false"]:focus-visible .branch-bar-path{stroke-width:3.6;d:path("M3 7.1 Q24 1.8 45 7.1")}
.call-page .node-branch[data-direction="callees"][aria-expanded="false"]:hover .branch-bar-path,.call-page .node-branch[data-direction="callees"][aria-expanded="false"]:focus-visible .branch-bar-path{stroke-width:3.6;d:path("M3 4.9 Q24 10.2 45 4.9")}
.call-page .node-branch[data-direction="callers"][aria-expanded="true"]:hover .branch-bar-path,.call-page .node-branch[data-direction="callers"][aria-expanded="true"]:focus-visible .branch-bar-path{stroke-width:3.2;d:path("M10 5 Q24 9.4 38 5")}
.call-page .node-branch[data-direction="callees"][aria-expanded="true"]:hover .branch-bar-path,.call-page .node-branch[data-direction="callees"][aria-expanded="true"]:focus-visible .branch-bar-path{stroke-width:3.2;d:path("M10 7 Q24 2.6 38 7")}
.call-page .node-branch:active{transform:scale(0.95)}
.call-page .node-branch:focus-visible,.call-node.is-root :is(.node-branch,.node-decompile):focus-visible{outline:2px solid var(--ghidra-focus);outline-offset:0}
.call-page .node-branch:disabled{cursor:wait;opacity:.45}
.call-edge{cursor:pointer;outline:none}
.call-edge-hit{fill:none;stroke:transparent;stroke-width:14;vector-effect:non-scaling-stroke;pointer-events:stroke}
.call-canvas .call-edge .edge{pointer-events:none}
.call-page .call-canvas:focus-visible{outline:2px solid var(--ghidra-focus);outline-offset:-3px}
.call-page .call-zoom{position:absolute;z-index:2;bottom:14px;right:14px;display:flex;gap:0;border:1px solid var(--vscode-panel-border);border-radius:8px;background:var(--vscode-editor-background);box-shadow:0 2px 8px var(--vscode-widget-shadow);overflow:visible}
.call-page .call-zoom button{min-height:28px;height:auto;background:transparent;border:0;border-radius:0;min-width:30px;padding:4px 8px}
.call-page .call-zoom #graph-zoom{font-size:12px;border-inline:1px solid var(--vscode-panel-border);font-variant-numeric:tabular-nums;min-width:50px}
.call-page .call-zoom button:first-child{border-radius:7px 0 0 7px}
.call-page .call-zoom button:last-child{border-radius:0 7px 7px 0}
.call-page [hidden]{display:none!important}
.call-canvas .call-edge{color:var(--vscode-charts-blue,#64a8eb);opacity:.65;transition:opacity 120ms ease}
.call-canvas .call-edge .edge{stroke-width:1.25;vector-effect:non-scaling-stroke}
.call-canvas .call-edge.is-hovered{color:var(--ghidra-focus);opacity:1}
.call-canvas.is-tracing .call-edge:not(.is-hovered):not(.is-active){opacity:.4}
.call-canvas .call-edge.dimmed{opacity:.6}
.call-canvas .call-edge.connected{opacity:.8}
.call-canvas .call-edge.connected .edge{stroke-width:1.6}
.call-canvas .call-edge.is-active,.call-canvas .call-edge:focus-visible{color:var(--ghidra-focus);opacity:1!important}
.call-canvas .call-edge.is-active .edge,.call-canvas .call-edge:focus-visible .edge{stroke-width:3}
.call-canvas .call-edge.is-hovered .edge{stroke-width:2.5}
#call-arrow path{fill:var(--vscode-descriptionForeground);fill:context-stroke}
.call-overview{margin:0;padding:0;position:absolute;z-index:2;right:14px;bottom:52px;width:min(176px,calc(100% - 20px));max-height:calc(100% - 58px);background:var(--vscode-editor-background);border:1px solid var(--vscode-editorWidget-border,var(--vscode-panel-border));border-radius:8px;box-shadow:0 2px 8px var(--vscode-widget-shadow);overflow:hidden;opacity:.95;cursor:default}
.call-overview summary{display:flex;align-items:center;gap:6px;min-height:28px;margin:0!important;padding:4px 8px;font-size:11px;font-weight:500;cursor:pointer;user-select:none;list-style:none}
.call-overview summary::-webkit-details-marker{display:none}
.call-overview summary>span:not(.call-icon){flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.call-overview summary .call-icon{font-size:13px;flex-shrink:0}
.call-overview summary .call-icon:last-child{margin-left:auto}
.call-canvas .call-overview svg{display:block;width:100%;height:110px;border-top:1px solid var(--vscode-panel-border);cursor:crosshair;background:var(--vscode-sideBar-background)}
.call-overview path{fill:none;stroke:var(--vscode-descriptionForeground);stroke-width:2}
.call-overview rect{fill:var(--vscode-editorWidget-border,var(--vscode-descriptionForeground));stroke:none}
.call-overview .overview-root{fill:var(--vscode-focusBorder)}
.call-overview #call-overview-window{fill:var(--vscode-focusBorder);fill-opacity:.12;stroke:var(--vscode-focusBorder);stroke-width:1;vector-effect:non-scaling-stroke;pointer-events:none}
.call-page .call-details{position:absolute;z-index:3;bottom:52px;left:12px;right:12px;margin:0;padding:10px 14px;max-height:40vh;overflow:auto;font-size:12px;background:var(--vscode-editor-background);border:1px solid var(--vscode-panel-border)}
.call-page .call-details summary{display:flex;align-items:center;min-height:28px;padding:4px 0;cursor:pointer}
.call-page .call-details .table-wrap{max-height:190px;overflow:auto}
.call-page .call-details th,.call-page .call-details td{padding:7px 10px;font-size:12px}
.call-page button,.call-page summary{transition:background-color 120ms ease,color 120ms ease}
@keyframes call-reveal{from{opacity:0;transform:translateY(-3px)}to{opacity:1;transform:translateY(0)}}
@media(prefers-reduced-motion:reduce){.call-page *{animation:none!important;transition:none!important}}
.vscode-high-contrast .call-canvas .call-edge,.vscode-high-contrast-light .call-canvas .call-edge{opacity:1!important}
@media(hover:none) and (pointer:coarse){.call-node.is-root .call-node-controls,.call-node.selected .call-node-controls{opacity:1;pointer-events:auto}}
.call-page .call-topbar .call-icon-button[aria-expanded="true"],.call-page .call-icon-row [aria-pressed="true"]{width:auto;min-width:32px;gap:3px;padding-inline:6px;border:2px solid var(--ghidra-active-border)}
.call-canvas div.call-node .node-branch{width:52px;height:26px;min-width:52px;min-height:26px}
.call-canvas div.call-node{display:flex;flex-direction:column;align-items:stretch;width:max-content;min-width:210px;max-width:340px;border:1px solid var(--vscode-contrastBorder,var(--vscode-editorWidget-border,var(--vscode-panel-border)));border-radius:8px;background:var(--vscode-editor-background);color:var(--vscode-foreground);box-shadow:none}
.call-canvas div.call-node.is-root{min-width:240px;background:var(--vscode-editor-background);color:var(--vscode-foreground);border:2px solid var(--ghidra-active-border);outline:2px solid color-mix(in srgb,var(--ghidra-active-border) 62%,var(--vscode-foreground));outline-offset:2px}
.call-canvas div.call-node.is-root:is(.selected,:focus-visible,.search-match,.edge-endpoint){border-color:var(--ghidra-active-border);outline:2px solid var(--ghidra-focus);outline-offset:2px}
.call-canvas div.call-node:not(.is-root):hover{background:var(--vscode-list-hoverBackground);border-color:var(--ghidra-focus)}
.call-canvas div.call-node.selected:not(.is-root){background:var(--ghidra-selection-bg);color:var(--ghidra-selection-fg)}
.call-canvas div.call-node:not(.is-root):is(.selected,:focus-visible,.search-match,.edge-endpoint){border-color:var(--ghidra-active-border);outline:2px solid var(--ghidra-active-border);outline-offset:0}
.call-canvas div.call-node.is-root .call-root-address{color:var(--vscode-foreground);opacity:1;overflow-wrap:anywhere}
.call-canvas .call-root-badge{display:inline-flex;align-items:center;align-self:flex-start;padding:1px 7px;border:1.5px solid var(--ghidra-active-border);border-radius:999px;background:var(--vscode-editor-background);color:var(--vscode-foreground);font:700 9.5px/1.2 var(--vscode-font-family);letter-spacing:.06em;pointer-events:none}
.call-canvas .call-node-copy .call-root-badge{margin-bottom:2px}
body.call-page:is(.vscode-high-contrast,.vscode-high-contrast-light) .call-node .call-node-controls{opacity:1;pointer-events:auto;transition:none}
body.call-page:is(.vscode-high-contrast,.vscode-high-contrast-light) :is(.node-decompile,.node-branch,.call-topbar .call-icon-button:not([aria-expanded="true"]),#call-menu>summary,#call-function-picker,.call-icon-row button:not([aria-pressed="true"]),.selection-buttons button){background:var(--vscode-button-secondaryBackground,var(--vscode-editor-background));color:var(--vscode-foreground);border:1px solid var(--ghidra-hv-border)}
body.call-page.vscode-high-contrast .call-canvas .call-edge{color:var(--vscode-charts-blue,#75beff);opacity:1!important}
body.call-page.vscode-high-contrast-light .call-canvas .call-edge{color:#0f4a85;opacity:1!important}
body.call-page:is(.vscode-high-contrast,.vscode-high-contrast-light) .call-canvas div.call-node:not(.is-root){background:var(--vscode-editor-background);color:var(--vscode-foreground);border:1.5px solid var(--ghidra-hv-border)}
body.call-page:is(.vscode-high-contrast,.vscode-high-contrast-light) .call-canvas div.call-node:not(.is-root):is(.selected,:focus-visible,.search-match,.edge-endpoint){background:var(--vscode-editor-background);color:var(--vscode-foreground);border-color:var(--ghidra-active-border);outline:2px solid var(--ghidra-active-border);outline-offset:0}
body.call-page:is(.vscode-high-contrast,.vscode-high-contrast-light) .call-canvas div.call-node.is-root{background:var(--vscode-editor-background);color:var(--vscode-foreground);border:2px solid var(--ghidra-active-border);outline:2px solid var(--ghidra-hv-border);outline-offset:2px}
body.call-page:is(.vscode-high-contrast,.vscode-high-contrast-light) .call-canvas div.call-node.is-root:is(.selected,:focus-visible,.search-match,.edge-endpoint){outline-color:var(--ghidra-focus)}
body.call-page:is(.vscode-high-contrast,.vscode-high-contrast-light) :is(.call-topbar .call-icon-button[aria-expanded="true"],.call-topbar [aria-expanded="true"],.call-icon-row [aria-pressed="true"]){background:var(--vscode-editor-background);color:var(--vscode-foreground);border:2px solid var(--ghidra-active-border)}
@media(prefers-contrast:more){
  .call-node .call-node-controls{opacity:1;pointer-events:auto;transition:none}
  .call-canvas div.call-node:not(.is-root){border:1.5px solid var(--ghidra-hv-border)}
  .call-page .node-decompile,.call-page .node-branch,.call-page .call-topbar .call-icon-button:not([aria-expanded="true"]),.call-page #call-menu>summary,.call-page #call-function-picker,.call-page .call-icon-row button:not([aria-pressed="true"]),.call-page .selection-buttons button{background:var(--vscode-button-secondaryBackground,var(--vscode-editor-background));color:var(--vscode-foreground);border:1px solid var(--ghidra-hv-border)}
}
@media(forced-colors:active){
  .call-page .call-canvas{background:var(--ghidra-selection-bg)}
  .call-node .call-node-controls{opacity:1;pointer-events:auto;transition:none}
  .call-canvas div.call-node{background:var(--ghidra-selection-bg);color:var(--ghidra-selection-fg);border:1.5px solid var(--ghidra-hv-border);forced-color-adjust:none}
  .call-canvas div.call-node.is-root{background:var(--ghidra-active-selection-bg);color:var(--ghidra-active-selection-fg);border:2px solid var(--ghidra-active-border);outline:2px solid var(--ghidra-hv-border);outline-offset:2px}
  .call-canvas div.call-node.is-root:is(.selected,:focus-visible,.search-match,.edge-endpoint){outline-color:var(--ghidra-focus)}
  .call-canvas div.call-node:not(.is-root):is(.selected,:focus-visible,.search-match,.edge-endpoint){background:var(--ghidra-selection-bg);color:var(--ghidra-selection-fg);border-color:var(--ghidra-active-border);outline:2px solid var(--ghidra-active-border);outline-offset:0}
  .call-canvas div.call-node :is(.node-title,.call-root-address){color:var(--ghidra-selection-fg);opacity:1}
  .call-canvas .call-root-badge{background:var(--ghidra-selection-bg);color:var(--ghidra-selection-fg);border:1.5px solid var(--ghidra-active-border)}
  .call-canvas .call-edge{color:var(--ghidra-selection-fg);opacity:1!important;transition:none}
  .call-canvas .call-edge.is-active,.call-canvas .call-edge.is-hovered,.call-canvas .call-edge:focus-visible{color:var(--ghidra-active-border);opacity:1!important}
  #call-arrow path{fill:var(--ghidra-selection-fg);fill:context-stroke}
  .call-page .node-decompile,.call-page .node-branch,.call-node.selected:not(.is-root) .node-branch,.call-node.is-root .node-branch,.call-node.is-root .node-decompile,.call-page .call-topbar .call-icon-button:not([aria-expanded="true"]),.call-page #call-menu>summary,.call-page #call-function-picker,.call-page .call-icon-row button:not([aria-pressed="true"]),.call-page .selection-buttons button,.call-page .call-zoom button{background:ButtonFace;color:ButtonText;border:1px solid var(--ghidra-hv-border)}
  .call-page .node-branch:hover,.call-page .node-branch:focus-visible,.call-node.is-root :is(.node-branch,.node-decompile):focus-visible{background:ButtonFace;color:ButtonText;outline:2px solid var(--ghidra-focus);outline-offset:1px}
  .call-page .call-topbar .call-icon-button[aria-expanded="true"],.call-page .call-topbar [aria-expanded="true"],.call-page .call-icon-row [aria-pressed="true"]{background:var(--ghidra-pressed-bg);color:var(--ghidra-selection-fg);border:2px solid var(--ghidra-active-border)}
  .call-page .call-menu-content,.call-page .call-zoom,.call-overview,.call-page .call-details{background:var(--ghidra-selection-bg);color:var(--ghidra-selection-fg);border-color:var(--ghidra-hv-border)}
}
@media(max-width:640px){
  .call-page .call-topbar{min-height:40px}
  .call-page .call-topbar h1{font-size:13px}
  .call-page .call-icon-button,.call-page #call-menu>summary{width:28px;height:28px;padding:4px}
  .call-page .call-topbar .call-icon-button[aria-expanded="true"]{width:auto;min-width:28px;min-height:28px;height:auto;padding-inline:5px}
  .call-page .call-search input{min-height:28px}
  .call-page .call-overview{width:min(120px,calc(100% - 16px));right:8px;bottom:42px}
  .call-page .call-overview svg{height:68px}
  .call-page .call-zoom{bottom:8px;right:8px}
  .call-page .call-zoom button{min-width:28px;min-height:28px;padding:3px 6px}
}
@media(max-height:420px){
  .call-page .call-topbar{min-height:32px}
  .call-page .call-topbar #call-function-picker{min-height:24px;padding:2px 5px}
  .call-page .call-icon-button,.call-page #call-menu>summary{width:24px;height:24px;min-width:24px;min-height:24px;padding:2px}
  .call-page .call-topbar .call-icon-button[aria-expanded="true"]{width:auto;min-width:24px;min-height:24px;height:auto;padding-inline:4px}
  .call-page .call-topbar button{min-height:24px}
  .call-page .call-search input{min-height:24px;padding:2px 6px}
  .call-page .call-zoom{bottom:6px;right:6px}
  .call-page .call-zoom button{min-width:24px;min-height:24px;padding:2px 5px}
  .call-page .call-zoom #graph-zoom{min-width:42px;font-size:11px}
  .call-page .call-overview{right:6px;bottom:34px;max-height:calc(100% - 40px)}
  .call-page .call-overview[open]{display:flex;flex-direction:column}
  .call-overview summary{min-height:24px;padding:2px 6px;flex-shrink:0}
  .call-page .call-overview svg{flex:1 1 auto;min-height:24px;height:52px}
  .call-page .call-details{bottom:34px;left:8px;right:8px;padding:6px 10px}
}
`;

/** Runs after the common selection handlers; all browsing controls use the panel's owning program. */
export const callGraphScript = String.raw`
    (()=>{
      const canvas=document.querySelector('[data-call-graph]');if(!canvas||!graphViewport){return}
      const root=canvas.querySelector('.is-root');
      for(const button of canvas.querySelectorAll('.node-decompile')){button.addEventListener('click',event=>{event.stopPropagation();const node=button.closest('.call-node');send('decompile',{entry:node.dataset.entry,address:node.dataset.entry,kind:'function',label:node.dataset.label})});button.addEventListener('dblclick',event=>event.stopPropagation());button.addEventListener('keydown',event=>event.stopPropagation())}

      const centerCurrent=()=>{if(root){graphViewport.center(Number(root.dataset.x)+Number(root.dataset.width)/2,Number(root.dataset.y)+Number(root.dataset.height)/2)}};
      document.getElementById('call-center').addEventListener('click',centerCurrent);
      for(const button of canvas.querySelectorAll('.node-branch')){button.addEventListener('click',event=>{event.stopPropagation();const node=button.closest('.call-node'),view=graphViewport.snapshot();branchAnchor={entry:node.dataset.entry,x:(Number(node.dataset.x)+Number(node.dataset.width)/2)*view.scale+view.x,y:(Number(node.dataset.y)+Number(node.dataset.height)/2)*view.scale+view.y,focusId:button.id};button.disabled=true;persist();send('callGraphToggle',{entry:node.dataset.entry,address:node.dataset.entry,direction:button.dataset.direction,graphRoot:state.entry})});button.addEventListener('dblclick',event=>event.stopPropagation());button.addEventListener('keydown',event=>event.stopPropagation())}
      const details=document.querySelector('.call-details');details.open=samePage&&previous.callDetails===true;details.hidden=!details.open;details.addEventListener('toggle',()=>{details.hidden=!details.open;if(details.open){graphViewport.reveal()}persist()});
      const overview=canvas.querySelector('.call-overview'),map=overview.querySelector('svg'),windowRect=map.querySelector('#call-overview-window');
      overview.open=previous.callOverview===true;overview.hidden=!overview.open;overview.addEventListener('toggle',()=>{overview.hidden=!overview.open;if(graphViewport.snapshot().fitted){graphViewport.fit()}else if(overview.open){graphViewport.reveal()}persist()});
      const update=()=>{const view=graphViewport.snapshot(),box=map.viewBox.baseVal;const left=Math.max(0,Math.min(box.width,-view.x/view.scale)),top=Math.max(0,Math.min(box.height,-view.y/view.scale)),right=Math.max(left,Math.min(box.width,(canvas.clientWidth-view.x)/view.scale)),bottom=Math.max(top,Math.min(box.height,(canvas.clientHeight-view.y)/view.scale));const w=Math.min(box.width,Math.max(4,right-left)),h=Math.min(box.height,Math.max(4,bottom-top)),wx=Math.max(0,Math.min(box.width-w,left)),wy=Math.max(0,Math.min(box.height-h,top));windowRect.setAttribute('x',wx);windowRect.setAttribute('y',wy);windowRect.setAttribute('width',w);windowRect.setAttribute('height',h)};
      canvas.addEventListener('graph-viewport',update);
      let overviewPointer;
      const moveOverview=event=>{const matrix=map.getScreenCTM();if(!matrix){return}const point=map.createSVGPoint();point.x=event.clientX;point.y=event.clientY;const graph=point.matrixTransform(matrix.inverse());graphViewport.center(graph.x,graph.y)};
      map.addEventListener('pointerdown',event=>{if(event.button!==0){return}event.preventDefault();event.stopPropagation();overviewPointer=event.pointerId;map.setPointerCapture(event.pointerId);map.focus({preventScroll:true});moveOverview(event)});
      map.addEventListener('pointermove',event=>{if(event.pointerId===overviewPointer){moveOverview(event)}});
      const endOverview=()=>{overviewPointer=undefined};map.addEventListener('pointerup',endOverview);map.addEventListener('pointercancel',endOverview);map.addEventListener('lostpointercapture',endOverview);
      map.addEventListener('keydown',event=>{const direction={ArrowLeft:[-50,0],ArrowRight:[50,0],ArrowUp:[0,-50],ArrowDown:[0,50]}[event.key];if(!direction){return}event.preventDefault();event.stopPropagation();const view=graphViewport.snapshot();graphViewport.center((canvas.clientWidth/2-view.x+direction[0])/view.scale,(canvas.clientHeight/2-view.y+direction[1])/view.scale)});
      let canvasWidth=canvas.clientWidth;
      new ResizeObserver(()=>{const width=canvas.clientWidth;if(width!==canvasWidth&&width<640&&graphViewport.snapshot().scale<.65){document.getElementById('graph-zoom').click();document.getElementById('call-center').click()}canvasWidth=width}).observe(canvas);
      const menu=document.getElementById('call-menu'),summary=menu.querySelector('summary');
      const nodes=[...canvas.querySelectorAll('.call-node')],edges=[...canvas.querySelectorAll('.call-edge')];
      let tracedNode,activeEdge,hoveredEdge;
      const paintTrace=()=>{canvas.classList.toggle('is-tracing',!!(tracedNode||activeEdge||hoveredEdge));for(const edge of edges){edge.classList.toggle('is-hovered',edge===hoveredEdge||!!tracedNode&&(edge.dataset.from===tracedNode.dataset.node||edge.dataset.to===tracedNode.dataset.node));edge.classList.toggle('is-active',edge===activeEdge);edge.setAttribute('aria-pressed',String(edge===activeEdge))}const relation=hoveredEdge||activeEdge;for(const node of nodes){node.classList.toggle('edge-endpoint',!!relation&&(node.dataset.node===relation.dataset.from||node.dataset.node===relation.dataset.to))}};
      const trace=node=>{tracedNode=node;paintTrace()};
      const activateEdge=edge=>{activeEdge=edge;tracedNode=undefined;paintTrace()};
      for(const node of nodes){node.addEventListener('pointerenter',()=>trace(node));node.addEventListener('pointerleave',()=>trace(document.activeElement?.closest('.call-node')));node.addEventListener('focus',()=>trace(node));node.addEventListener('blur',()=>trace(undefined));node.addEventListener('click',()=>{activeEdge=undefined;paintTrace()})}
      for(const edge of edges){edge.addEventListener('pointerdown',event=>{if(event.button===0){event.stopPropagation()}});edge.addEventListener('pointerenter',()=>{hoveredEdge=edge;tracedNode=undefined;paintTrace()});edge.addEventListener('pointerleave',()=>{hoveredEdge=document.activeElement===edge?edge:undefined;paintTrace()});edge.addEventListener('focus',()=>{hoveredEdge=edge;tracedNode=undefined;paintTrace()});edge.addEventListener('blur',()=>{hoveredEdge=undefined;paintTrace()});edge.addEventListener('click',event=>{event.stopPropagation();activateEdge(edge)});edge.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();activateEdge(edge)}})}
      canvas.addEventListener('click',event=>{if(event.target.closest('.call-node,.call-edge,.call-overview,.call-depth-controls,.call-function-actions')){return}activeEdge=undefined;paintTrace()});
      canvas.addEventListener('keydown',event=>{if(event.key==='Escape'&&activeEdge){event.preventDefault();event.stopPropagation();activeEdge=undefined;hoveredEdge=undefined;tracedNode=undefined;paintTrace();canvas.focus({preventScroll:true})}});
      canvas.addEventListener('pointerleave',()=>trace(document.activeElement?.closest('.call-node')));
      menu.addEventListener('keydown',event=>{if(event.target===summary&&['ArrowDown','ArrowUp'].includes(event.key)){menu.open=true}if(event.target.matches('select,input')||!['ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Home','End'].includes(event.key)){return}const items=[...menu.querySelectorAll('button:not(:disabled),select,summary')].filter(item=>!item.closest('[hidden]')&&item!==summary&&[...menu.querySelectorAll('details:not([open])')].every(details=>!details.contains(item)||details.querySelector(':scope > summary')===item));if(!items.length){return}event.preventDefault();const index=items.indexOf(document.activeElement),next=event.key==='Home'?0:event.key==='End'?items.length-1:(event.key==='ArrowDown'||event.key==='ArrowRight')?(index+1)%items.length:(index<0?items.length-1:(index-1+items.length)%items.length);items[next].focus()});
      menu.addEventListener('focusout',()=>requestAnimationFrame(()=>{if(menu.open&&!menu.contains(document.activeElement)){menu.open=false}}));

      const bindPanel=(id,panel)=>{const button=document.getElementById(id);const sync=()=>button.setAttribute('aria-pressed',String(panel.open));sync();panel.addEventListener('toggle',sync);button.addEventListener('click',()=>{panel.hidden=false;panel.open=!panel.open;menu.open=false;(menu.contains(button)?summary:button).focus();if(panel.open){if(panel===overview&&graphViewport.snapshot().fitted){graphViewport.fit()}else{graphViewport.reveal()}}})};
      bindPanel('call-menu-overview',overview);bindPanel('call-details-toggle',details);
      const searchToggle=document.getElementById('call-search-toggle'),searchHost=search.closest('.call-search');
      const openSearch=()=>{searchHost.hidden=false;searchToggle.setAttribute('aria-expanded','true');search.focus();search.select()};
      const closeSearch=()=>{searchHost.hidden=true;searchToggle.setAttribute('aria-expanded','false');searchToggle.focus()};
      searchToggle.addEventListener('click',()=>{searchHost.hidden=!searchHost.hidden;searchToggle.setAttribute('aria-expanded',String(!searchHost.hidden));if(!searchHost.hidden){search.focus()}else{searchToggle.focus()}});
      search.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();search.value='';search.dispatchEvent(new Event('input'));closeSearch()}});
      if(search.value){searchHost.hidden=false;searchToggle.setAttribute('aria-expanded','true')}
      document.addEventListener('click',event=>{if(menu.open&&(!menu.contains(event.target)||event.target.closest('button[data-action]'))){menu.open=false}});
      document.addEventListener('keydown',event=>{if(event.key==='Escape'&&menu.open){event.preventDefault();menu.open=false;summary.focus()}else if(isModShortcut(event,'f')||(event.key==='/'&&canUseSingleKeyShortcut(event))){event.preventDefault();menu.open=false;openSearch()}});
      document.getElementById('call-center').addEventListener('click',()=>{menu.open=false});
      document.addEventListener('contextmenu',event=>{if(event.target.closest('.call-node')){event.preventDefault();event.target.closest('.call-node').dispatchEvent(new MouseEvent('click',{bubbles:true}));event.target.closest('.call-node').querySelector('.node-decompile')?.focus()}});
      update();
    })();
`;
