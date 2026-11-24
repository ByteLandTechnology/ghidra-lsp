// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

/** Call graph uses the existing themed graph viewport, with function-focused controls. */
export const callGraphStyles = `
.call-page{padding:0}
.call-page main{padding:0;gap:0;position:relative}
.call-page .call-topbar{display:flex;align-items:center;gap:10px;min-height:56px;padding:10px 20px;border-bottom:1px solid var(--vscode-panel-border);flex-shrink:0}
.call-page .call-topbar h1{font-size:14px;letter-spacing:.01em;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin:0}
.call-page .call-topbar .call-function-title{display:flex;align-items:center}
.call-page .call-topbar #call-function-picker{display:flex;align-items:center;gap:8px;max-width:100%;min-width:0;padding:4px 6px;margin-left:-6px;border:0;border-radius:3px;color:inherit;font:inherit;letter-spacing:inherit;text-align:left}
.call-function-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.call-function-title .call-icon:first-child{color:var(--vscode-descriptionForeground)}
.call-function-title .call-icon:last-child{font-size:12px;color:var(--vscode-descriptionForeground)}
.call-icon{font:16px call-icons;display:inline-block;line-height:1;vertical-align:middle}
.call-page .call-icon-button,.call-page #call-menu>summary{width:32px;height:32px;padding:7px;border:0;background:transparent;text-align:center;cursor:pointer;flex-shrink:0}
.call-page .call-topbar button{background:transparent;border:1px solid var(--vscode-panel-border);height:32px}
.call-page .call-topbar .call-icon-button{border:0}
.call-page button:hover,.call-page #call-menu>summary:hover{background:var(--vscode-toolbar-hoverBackground,var(--vscode-list-hoverBackground))}
.call-page #call-menu{margin:0;border:0;padding:0;flex-shrink:0}
.call-page #call-menu>summary{list-style:none;display:block;margin:0}
.call-page #call-menu>summary::-webkit-details-marker{display:none}
.call-menu-content{position:absolute;z-index:5;right:12px;top:52px;width:min(320px,calc(100vw - 24px));max-height:calc(100vh - 76px);overflow:auto;background:var(--vscode-menu-background,var(--vscode-editor-background));color:var(--vscode-menu-foreground,var(--vscode-foreground));border:1px solid var(--vscode-menu-border,var(--vscode-panel-border));box-shadow:0 4px 12px var(--vscode-widget-shadow);padding:8px;cursor:default}
.call-page #call-menu[open] .call-menu-content{animation:call-reveal 140ms cubic-bezier(.2,.8,.2,1)}
.call-page .selection-tools{display:flex;flex-direction:column;gap:4px;margin:0;padding:4px 0 8px;border-bottom:1px solid var(--vscode-panel-border)}
.call-page #selection-label{display:flex;flex-direction:column;font-size:12px;line-height:1.6;padding:2px 8px 8px;overflow-wrap:anywhere;color:var(--vscode-descriptionForeground)}
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
.call-page .call-topbar [aria-pressed="true"],.call-page .call-topbar [aria-expanded="true"]{color:var(--vscode-focusBorder);background:var(--vscode-toolbar-activeBackground,var(--vscode-list-hoverBackground))}
.call-page .call-controls{display:flex;flex-direction:column;gap:2px;padding-top:8px;font-size:13px}
.call-page .call-controls label{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:5px 8px}
.call-page .call-controls button{text-align:left}
.call-page .call-icon-row,.call-page .selection-buttons{flex-direction:row;flex-wrap:wrap;align-items:center;gap:2px;padding:4px}
.call-page .call-icon-row button,.call-page .selection-buttons button{width:32px;min-width:32px;justify-content:center;padding:6px}
.call-page .call-icon-row [aria-pressed="true"]{color:var(--vscode-focusBorder);background:var(--vscode-toolbar-activeBackground,var(--vscode-list-hoverBackground))}
.call-divider{width:1px;align-self:stretch;margin:6px 3px;background:var(--vscode-panel-border)}
.call-page .call-search{flex:0 1 240px;min-width:0}
.call-page .call-search input{width:100%;height:32px;border-radius:3px}
.call-page .call-search:not([hidden]){animation:call-reveal 140ms cubic-bezier(.2,.8,.2,1)}
.call-page .call-canvas{position:relative;min-height:160px;border:0;border-radius:0;background:var(--vscode-editor-background)}
.call-canvas svg{overflow:visible}
.call-node-controls{overflow:visible}
.call-node .call-node-controls{opacity:0;pointer-events:none;transition:opacity 140ms ease}
.call-node:hover .call-node-controls,.call-node:focus-within .call-node-controls{opacity:1;pointer-events:auto}
.node-control-content{display:flex;align-items:center;justify-content:center;width:100%;height:100%;font:12px var(--vscode-font-family);color:var(--vscode-foreground);cursor:default}
.call-node-controls .call-icon{font-size:16px;flex-shrink:0}
.call-page .node-decompile{display:flex;align-items:center;justify-content:center;width:28px;height:28px;min-height:0;padding:3px;background:transparent;border:0;border-radius:3px;color:var(--vscode-descriptionForeground)}
.call-node:hover .node-decompile,.call-node:focus-within .node-decompile{color:var(--vscode-foreground)}
.call-node .node-decompile:hover{background:var(--vscode-list-hoverBackground)}
.call-node.is-root .node-decompile{color:var(--vscode-list-activeSelectionForeground,var(--vscode-foreground))}
.call-page .node-branch{display:inline-flex;align-items:center;justify-content:center;width:52px;height:12px;min-height:0;padding:0;border:0;border-radius:6px;background:transparent;color:color-mix(in srgb,var(--vscode-foreground) 32%,transparent);box-shadow:none;cursor:pointer;box-sizing:border-box;transition:color 150ms ease,transform 100ms ease-out}
.call-node.is-root .node-branch{color:color-mix(in srgb,var(--vscode-list-activeSelectionForeground,var(--vscode-foreground)) 36%,transparent)}
.call-page .node-branch[aria-expanded="true"]{color:color-mix(in srgb,var(--vscode-focusBorder) 55%,transparent)}
.call-node.is-root .node-branch[aria-expanded="true"]{color:color-mix(in srgb,var(--vscode-list-activeSelectionForeground,var(--vscode-foreground)) 38%,transparent)}
.call-page .node-branch svg.branch-bar{width:48px;height:12px;flex:none;overflow:visible}
.call-page .node-branch .branch-bar-path{stroke-width:3.4;d:path("M6 6 Q24 6 42 6");transition:d 180ms cubic-bezier(.23,1,.32,1),stroke-width 180ms ease}
.call-page .node-branch[aria-expanded="true"] .branch-bar-path{stroke-width:2.8;d:path("M13 6 Q24 6 35 6")}
.call-page .node-branch:hover,.call-page .node-branch:focus-visible{background:transparent;color:var(--vscode-foreground);box-shadow:none}
body.vscode-dark .call-page .node-branch:hover,body.vscode-dark .call-page .node-branch:focus-visible,.call-node.is-root .node-branch:hover,.call-node.is-root .node-branch:focus-visible{color:rgba(255,255,255,0.94)}
.call-page .node-branch[data-direction="callers"][aria-expanded="false"]:hover .branch-bar-path,.call-page .node-branch[data-direction="callers"][aria-expanded="false"]:focus-visible .branch-bar-path{stroke-width:3.6;d:path("M3 7.1 Q24 1.8 45 7.1")}
.call-page .node-branch[data-direction="callees"][aria-expanded="false"]:hover .branch-bar-path,.call-page .node-branch[data-direction="callees"][aria-expanded="false"]:focus-visible .branch-bar-path{stroke-width:3.6;d:path("M3 4.9 Q24 10.2 45 4.9")}
.call-page .node-branch[data-direction="callers"][aria-expanded="true"]:hover .branch-bar-path,.call-page .node-branch[data-direction="callers"][aria-expanded="true"]:focus-visible .branch-bar-path{stroke-width:3.2;d:path("M10 5 Q24 9.4 38 5")}
.call-page .node-branch[data-direction="callees"][aria-expanded="true"]:hover .branch-bar-path,.call-page .node-branch[data-direction="callees"][aria-expanded="true"]:focus-visible .branch-bar-path{stroke-width:3.2;d:path("M10 7 Q24 2.6 38 7")}
.call-page .node-branch:active{transform:scale(0.95)}
.call-page .node-branch:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:0}
.call-page .node-branch:disabled{cursor:wait;opacity:.45}
.call-edge{cursor:pointer;outline:none}
.call-edge-hit{fill:none;stroke:transparent;stroke-width:14;vector-effect:non-scaling-stroke;pointer-events:stroke}
.call-canvas .call-edge .edge{pointer-events:none}
.call-canvas .call-node.edge-endpoint .call-node-body{stroke:var(--vscode-focusBorder);stroke-width:2}
.call-page .call-canvas:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:-3px}
.call-page .call-zoom{position:absolute;z-index:2;bottom:16px;right:16px;display:flex;gap:0;border:1px solid var(--vscode-panel-border);border-radius:8px;background:var(--vscode-editor-background);box-shadow:0 2px 8px var(--vscode-widget-shadow);overflow:visible}
.call-page .call-zoom button{height:32px;background:transparent;border:0;border-radius:0;min-width:32px}
.call-page .call-zoom #graph-zoom{font-size:12px;border-inline:1px solid var(--vscode-panel-border);font-variant-numeric:tabular-nums;min-width:52px}
.call-page .call-zoom button:first-child{border-radius:7px 0 0 7px}
.call-page .call-zoom button:last-child{border-radius:0 7px 7px 0}
.call-page .scope,.call-page #filter-status{position:absolute;z-index:2;top:58px;left:20px;margin:0;font-size:11px;background:var(--vscode-editor-background)}
.call-page:has([data-call-columns]) #filter-status{top:104px}
.call-page .scope{top:80px;color:var(--vscode-descriptionForeground)}
.call-page [hidden]{display:none!important}
.call-canvas .call-node-body{fill:var(--vscode-editor-background);stroke:var(--vscode-editorWidget-border,var(--vscode-panel-border));stroke-width:1;vector-effect:non-scaling-stroke;transition:stroke-width 120ms ease}
.call-canvas .is-root .call-node-body{fill:var(--vscode-list-activeSelectionBackground);stroke:var(--vscode-focusBorder);stroke-width:2}
.call-canvas .call-node.selected .call-node-body,.call-canvas .call-node:focus-visible .call-node-body{stroke:var(--vscode-focusBorder);stroke-width:2}
.call-canvas .call-node .node-title{font:500 14px var(--vscode-font-family);fill:var(--vscode-foreground)}
.call-canvas .is-root .node-title{font-size:15px;font-weight:600}
.call-canvas .is-root .call-root-address{font:500 11.5px var(--vscode-editor-font-family,monospace);font-variant-numeric:tabular-nums;opacity:.85}
.call-canvas .call-node:hover:not(.is-root) .call-node-body{fill:var(--vscode-list-hoverBackground);stroke:var(--vscode-focusBorder)}
.call-canvas .call-node.selected:not(.is-root) .call-node-body{fill:var(--vscode-list-inactiveSelectionBackground,var(--vscode-list-hoverBackground))}
.call-canvas .is-root text{fill:var(--vscode-list-activeSelectionForeground,var(--vscode-foreground))!important}
.call-canvas .call-edge{color:var(--vscode-charts-blue,#64a8eb);opacity:.65;transition:opacity 120ms ease}
.call-canvas .call-edge .edge{stroke-width:1.25;vector-effect:non-scaling-stroke}
.call-canvas .call-edge.is-hovered{color:var(--vscode-focusBorder);opacity:1}
.call-canvas.is-tracing .call-edge:not(.is-hovered):not(.is-active){opacity:.4}
.call-canvas .call-edge.dimmed{opacity:.6}
.call-canvas .call-edge.connected{opacity:.8}
.call-canvas .call-edge.connected .edge{stroke-width:1.6}
.call-canvas .call-edge.is-active,.call-canvas .call-edge:focus-visible{color:var(--vscode-focusBorder);opacity:1!important}
.call-canvas .call-edge.is-active .edge,.call-canvas .call-edge:focus-visible .edge{stroke-width:3}
.call-canvas .call-edge.is-hovered .edge{stroke-width:2.5}
#call-arrow path{fill:var(--vscode-descriptionForeground);fill:context-stroke}
.call-overview{margin:0;padding:0;position:absolute;right:16px;bottom:58px;width:176px;background:var(--vscode-editor-background);border:1px solid var(--vscode-editorWidget-border,var(--vscode-panel-border));border-radius:8px;box-shadow:0 2px 8px var(--vscode-widget-shadow);overflow:hidden;opacity:.95;cursor:default}
.call-overview summary{display:flex;align-items:center;gap:6px;margin:0!important;padding:6px 8px;font-size:11px;font-weight:500;cursor:pointer;user-select:none;list-style:none}
.call-overview summary::-webkit-details-marker{display:none}
.call-overview summary .call-icon{font-size:13px}
.call-overview summary .call-icon:last-child{margin-left:auto}
.call-canvas .call-overview svg{display:block;width:100%;height:110px;border-top:1px solid var(--vscode-panel-border);cursor:crosshair;background:var(--vscode-sideBar-background)}
.call-overview path{fill:none;stroke:var(--vscode-descriptionForeground);stroke-width:2}
.call-overview rect{fill:var(--vscode-editorWidget-border,var(--vscode-descriptionForeground));stroke:none}
.call-overview .overview-root{fill:var(--vscode-focusBorder)}
.call-overview #call-overview-window{fill:var(--vscode-focusBorder);fill-opacity:.12;stroke:var(--vscode-focusBorder);stroke-width:1;vector-effect:non-scaling-stroke;pointer-events:none}
.call-page .call-details{position:absolute;z-index:3;bottom:58px;left:20px;right:20px;margin:0;padding:10px 14px;max-height:40vh;overflow:auto;font-size:12px;background:var(--vscode-editor-background);border:1px solid var(--vscode-panel-border)}
.call-page .call-details summary{padding:5px 0;cursor:pointer}
.call-page .call-details .table-wrap{max-height:190px;overflow:auto}
.call-page .call-details th,.call-page .call-details td{padding:7px 10px;font-size:12px}
.call-page button,.call-page summary{transition:background-color 120ms ease,color 120ms ease}
@keyframes call-reveal{from{opacity:0;transform:translateY(-3px)}to{opacity:1;transform:translateY(0)}}
@media(prefers-reduced-motion:reduce){.call-page *{animation:none!important;transition:none!important}}
.vscode-high-contrast .call-canvas .call-edge,.vscode-high-contrast-light .call-canvas .call-edge{opacity:1!important}
@media(forced-colors:active){.call-canvas .call-node-body{stroke:CanvasText}.call-canvas .is-root .call-node-body{fill:Highlight;stroke:Highlight}.call-canvas .call-node.selected .call-node-body,.call-canvas .call-node:focus-visible .call-node-body{stroke:Highlight}.call-canvas .call-edge{color:CanvasText}.call-page .call-menu-content,.call-page .call-zoom{border-color:CanvasText}.call-page .node-branch{color:ButtonText}}
@media(max-width:640px){.call-page .call-topbar{padding:8px 10px;gap:5px;min-height:48px}.call-page .call-topbar h1{font-size:13px}.call-page .call-search{position:absolute;z-index:4;top:52px;left:10px;right:10px;background:var(--vscode-editor-background)}.call-page .call-overview{width:120px;right:10px;bottom:54px}.call-page .call-overview svg{height:82px}.call-page .call-zoom{bottom:12px;right:10px}}

@media(hover:none) and (pointer:coarse){.call-node.is-root .call-node-controls,.call-node.selected .call-node-controls{opacity:1;pointer-events:auto}}
.call-page .call-icon-button,.call-page #call-menu>summary{display:inline-flex;align-items:center;justify-content:center}
.call-page .call-topbar .call-icon-button[aria-expanded="true"],.call-page .call-icon-row [aria-pressed="true"]{width:auto;min-width:32px;gap:3px;padding-inline:6px;border:2px solid var(--ghidra-active-border)}
.call-node.is-root .node-decompile{color:var(--vscode-foreground)}
.call-page .node-branch{height:14px}
.call-node.is-root .node-branch{color:var(--gh-port-stroke,color-mix(in srgb,var(--vscode-foreground) 78%,var(--vscode-editor-background)))}
.call-node.is-root .node-branch[aria-expanded="true"]{color:var(--gh-port-expanded-stroke,var(--vscode-focusBorder))}
.call-node.is-root .node-branch:is(:hover,:focus-visible){color:var(--vscode-foreground)}
.call-page .node-branch:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:0}
.call-canvas .is-root .call-node-body{fill:var(--vscode-editor-background);stroke:var(--ghidra-active-border);stroke-width:3}
.call-canvas .call-root-ring{fill:none;stroke:color-mix(in srgb,var(--ghidra-active-border) 62%,var(--vscode-foreground));stroke-width:1;vector-effect:non-scaling-stroke;pointer-events:none}
.call-canvas .call-root-badge{pointer-events:none}
.call-canvas .call-root-badge rect{fill:var(--vscode-editor-background);stroke:var(--ghidra-active-border);stroke-width:1.4;vector-effect:non-scaling-stroke}
.call-canvas .call-root-badge text{font:700 9.5px var(--vscode-font-family);letter-spacing:.06em;fill:var(--vscode-foreground)}
.call-canvas .call-node.selected:not(.is-root) .call-node-body,.call-canvas .call-node:focus-visible:not(.is-root) .call-node-body{stroke:var(--ghidra-active-border);stroke-width:2.5}
.call-canvas .is-root .call-root-address{fill:var(--vscode-foreground);opacity:1}
.call-canvas .is-root text{fill:var(--vscode-foreground)!important}
body.call-page:is(.vscode-high-contrast,.vscode-high-contrast-light) .call-node .call-node-controls{opacity:1;pointer-events:auto;transition:none}
body.call-page:is(.vscode-high-contrast,.vscode-high-contrast-light) :is(.node-decompile,.node-branch,.call-topbar .call-icon-button:not([aria-expanded="true"]),#call-menu>summary,#call-function-picker,.call-icon-row button:not([aria-pressed="true"]),.selection-buttons button){background:var(--vscode-button-secondaryBackground,var(--vscode-editor-background));color:var(--vscode-foreground);border:1px solid var(--ghidra-hv-border)}
body.call-page.vscode-high-contrast .call-canvas .call-edge{color:var(--vscode-charts-blue,#75beff);opacity:1!important}
body.call-page.vscode-high-contrast-light .call-canvas .call-edge{color:#0f4a85;opacity:1!important}
body.call-page:is(.vscode-high-contrast,.vscode-high-contrast-light) .call-canvas .call-node:not(.is-root) .call-node-body{stroke:var(--ghidra-hv-border);stroke-width:1.5}
body.call-page:is(.vscode-high-contrast,.vscode-high-contrast-light) .call-canvas .call-node.selected:not(.is-root) .call-node-body{fill:var(--vscode-editor-background);stroke:var(--ghidra-active-border);stroke-width:2.5}
body.call-page:is(.vscode-high-contrast,.vscode-high-contrast-light) .call-canvas .call-node.selected:not(.is-root) text{fill:var(--vscode-foreground)}
body.call-page:is(.vscode-high-contrast,.vscode-high-contrast-light) :is(.call-topbar .call-icon-button[aria-expanded="true"],.call-topbar [aria-expanded="true"],.call-icon-row [aria-pressed="true"]){background:var(--vscode-editor-background);color:var(--vscode-foreground);border:2px solid var(--ghidra-active-border)}
@media(prefers-contrast:more){
  .call-node .call-node-controls{opacity:1;pointer-events:auto;transition:none}
  .call-page .node-decompile,.call-page .node-branch,.call-page .call-topbar .call-icon-button:not([aria-expanded="true"]),.call-page #call-menu>summary,.call-page #call-function-picker,.call-page .call-icon-row button:not([aria-pressed="true"]),.call-page .selection-buttons button{background:var(--vscode-button-secondaryBackground,var(--vscode-editor-background));color:var(--vscode-foreground);border:1px solid var(--ghidra-hv-border)}
}
@media(forced-colors:active){
  .call-page .call-canvas{background:Canvas}
  .call-node .call-node-controls{opacity:1;pointer-events:auto;transition:none}
  .call-canvas .call-node-body{fill:Canvas;stroke:CanvasText;stroke-width:1.5}
  .call-canvas .is-root .call-node-body{fill:Canvas;stroke:Highlight;stroke-width:3}
  .call-canvas .call-root-ring{stroke:CanvasText}
  .call-canvas .call-root-badge rect{fill:Canvas;stroke:Highlight}
  .call-canvas .call-node text,.call-canvas .call-node.selected:not(.is-root) text,.call-canvas .is-root text,.call-canvas .is-root .call-root-address,.call-canvas .call-root-badge text{fill:CanvasText!important;opacity:1}
  .call-canvas .call-node.selected:not(.is-root) .call-node-body,.call-canvas .call-node:focus-visible:not(.is-root) .call-node-body,.call-canvas .call-node.edge-endpoint .call-node-body{fill:Canvas;stroke:Highlight;stroke-width:2.5}
  .call-canvas .call-edge{color:CanvasText;opacity:1!important}
  .call-canvas .call-edge.is-active,.call-canvas .call-edge.is-hovered,.call-canvas .call-edge:focus-visible{color:Highlight;opacity:1!important}
  #call-arrow path{fill:CanvasText;fill:context-stroke}
  .call-page .node-decompile,.call-page .node-branch,.call-node.selected:not(.is-root) .node-branch,.call-node.is-root .node-branch,.call-node.is-root .node-decompile,.call-page .call-topbar .call-icon-button:not([aria-expanded="true"]),.call-page #call-menu>summary,.call-page #call-function-picker,.call-page .call-icon-row button:not([aria-pressed="true"]),.call-page .selection-buttons button,.call-page .call-zoom button{background:ButtonFace;color:ButtonText;border:1px solid ButtonText}
  .call-page .node-branch:hover,.call-page .node-branch:focus-visible{background:ButtonFace;color:ButtonText;outline:2px solid Highlight;outline-offset:1px}
  .call-page .call-topbar .call-icon-button[aria-expanded="true"],.call-page .call-topbar [aria-expanded="true"],.call-page .call-icon-row [aria-pressed="true"]{background:Canvas;color:CanvasText;border:2px solid Highlight}
  .call-page .call-menu-content,.call-page .call-zoom,.call-overview,.call-page .call-details{background:Canvas;color:CanvasText;border-color:CanvasText}
}
@media(max-width:640px){.call-page .call-topbar{padding:8px 8px;gap:4px}}
`;

/** Runs after the common selection handlers; all browsing controls use the panel's owning program. */
export const callGraphScript = String.raw`
    (()=>{
      const canvas=document.querySelector('[data-call-graph]');if(!canvas||!graphViewport){return}
      const root=canvas.querySelector('.is-root');
      for(const button of canvas.querySelectorAll('.node-decompile')){button.addEventListener('click',event=>{event.stopPropagation();const node=button.closest('.call-node');send('decompile',{entry:node.dataset.entry,address:node.dataset.entry,kind:'function',label:node.dataset.label})});button.addEventListener('dblclick',event=>event.stopPropagation());button.addEventListener('keydown',event=>event.stopPropagation())}

      const centerCurrent=()=>graphViewport.center(Number(root.dataset.x)+Number(root.dataset.width)/2,Number(root.dataset.y)+Number(root.dataset.height)/2);
      document.getElementById('call-center').addEventListener('click',centerCurrent);
      for(const button of canvas.querySelectorAll('.node-branch')){button.addEventListener('click',event=>{event.stopPropagation();const node=button.closest('.call-node'),view=graphViewport.snapshot();branchAnchor={entry:node.dataset.entry,x:(Number(node.dataset.x)+Number(node.dataset.width)/2)*view.scale+view.x,y:(Number(node.dataset.y)+Number(node.dataset.height)/2)*view.scale+view.y,focusId:button.id};button.disabled=true;persist();send('callGraphToggle',{entry:node.dataset.entry,address:node.dataset.entry,direction:button.dataset.direction,graphRoot:state.entry})});button.addEventListener('dblclick',event=>event.stopPropagation());button.addEventListener('keydown',event=>event.stopPropagation())}
      const details=document.querySelector('.call-details');details.open=samePage&&previous.callDetails===true;details.hidden=!details.open;details.addEventListener('toggle',()=>{details.hidden=!details.open;persist()});
      const overview=canvas.querySelector('.call-overview'),map=overview.querySelector('svg'),windowRect=map.querySelector('#call-overview-window');
      overview.open=previous.callOverview===true;overview.hidden=!overview.open;overview.addEventListener('toggle',()=>{overview.hidden=!overview.open;if(graphViewport.snapshot().fitted){graphViewport.fit()}persist()});
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

      const bindPanel=(id,panel)=>{const button=document.getElementById(id);const sync=()=>button.setAttribute('aria-pressed',String(panel.open));sync();panel.addEventListener('toggle',sync);button.addEventListener('click',()=>{panel.hidden=false;panel.open=!panel.open;menu.open=false;(menu.contains(button)?summary:button).focus()})};
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
