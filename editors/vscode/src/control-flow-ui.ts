// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

import { callIcon } from './call-graph-icons';
import { escapeHtml } from './workbench-page';

/** Render the top toolbar for the control-flow graph view. */
export function controlFlowToolbar(title: string, subtitle: string, active: boolean): string {
    const disabled = active ? '' : ' disabled';
    return `<div class="cfg-topbar" role="group" aria-label="Control flow tools"><div class="cfg-heading"><div class="cfg-identity"><h1>${escapeHtml(title)}</h1><span class="cfg-function-name" title="${escapeHtml(subtitle)}">${escapeHtml(subtitle)}</span></div></div><div class="cfg-search" hidden><input id="search" class="search" aria-label="Find blocks" placeholder="Find blocks…"></div><button class="cfg-icon-button" id="cfg-search-toggle" aria-label="Find blocks" aria-expanded="false" title="Find blocks (/)"${disabled}>${callIcon('search')}</button><button class="cfg-icon-button" id="graph-fit" aria-label="Fit graph" title="Fit the entire graph (0)"${disabled}>${callIcon('fit')}</button><button class="cfg-icon-button" id="cfg-overview-toggle" aria-label="Toggle overview" aria-pressed="false" title="Show or hide overview"${disabled}>${callIcon('overview')}</button><button class="cfg-icon-button" id="cfg-refresh" data-action="refresh" aria-label="Refresh graph" title="Refresh graph">${callIcon('refresh')}</button></div>`;
}

/** Render the docked zoom control bar for the control-flow graph view. */
export function controlFlowZoom(active: boolean): string {
    const disabled = active ? '' : ' disabled';
    return `<div class="cfg-zoom" role="group" aria-label="Zoom"><button id="graph-zoom-out" aria-label="Zoom out"${disabled}>${callIcon('minus')}</button><button id="graph-zoom" aria-label="Actual size" title="Actual size (100%)"${disabled}>100%</button><button id="graph-zoom-in" aria-label="Zoom in"${disabled}>${callIcon('plus')}</button></div>`;
}

/** CSS styles for the control-flow graph toolbar, edges, zoom widget, and overview map. */
export const controlFlowUiStyles = `
/* Hallmark · v2.0.0 · redesign: full · shape: app screen · genre: modern-minimal · theme: Console (dealt 3/3) · material: VS Code theme tokens · signature: control-flow trace */
/* Hallmark · pre-emit critique: P4 H4 E4 S4 R5 V4 · weakest: hierarchy, distinguish the graph identity from its tools */
.cfg-page{--cfg-ground:var(--vscode-editor-background);--cfg-surface:var(--vscode-sideBar-background,var(--vscode-editor-background));--cfg-ink:var(--vscode-foreground);--cfg-muted:var(--vscode-descriptionForeground);--cfg-rule:var(--vscode-panel-border);--cfg-focus:var(--vscode-focusBorder)}
.cfg-page main{display:grid;grid-template-columns:minmax(0,1fr) auto auto;grid-template-rows:auto auto minmax(0,1fr) auto;height:100vh;max-width:none;padding:0;gap:0;position:relative}
.flow-page .call-icon{font:16px call-icons;display:inline-block;line-height:1;vertical-align:middle}
.cfg-topbar{grid-column:1/-1;grid-row:1;display:flex;align-items:center;gap:4px;min-height:56px;padding:8px 14px;border-bottom:1px solid var(--cfg-rule);background:var(--cfg-ground)}
.cfg-heading{display:flex;align-items:center;gap:10px;flex:1;min-width:0}.cfg-identity{display:flex;flex-direction:column;gap:1px;min-width:0}
.cfg-page .cfg-heading h1{font-size:13px;line-height:1.25;font-weight:600;color:var(--cfg-ink)}
.cfg-function-name{font-size:11px;line-height:1.25;font-weight:400;color:var(--cfg-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.cfg-page .cfg-icon-button{display:flex;align-items:center;justify-content:center;flex-shrink:0;width:32px;height:32px;min-height:0;padding:6px;border:0;border-radius:6px;background:transparent;color:var(--vscode-foreground);cursor:pointer}
.cfg-page button:hover{background:var(--vscode-toolbar-hoverBackground,var(--vscode-list-hoverBackground))}
.cfg-page .cfg-topbar [aria-pressed="true"],.cfg-page .cfg-topbar [aria-expanded="true"]{background:var(--vscode-toolbar-activeBackground,var(--vscode-list-hoverBackground));color:var(--vscode-focusBorder)}
.cfg-search{flex:0 1 230px;min-width:0}
.cfg-page .cfg-search input{width:100%;height:32px;min-width:0;border-radius:6px}
.cfg-page .flow-canvas:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:-1px}
.cfg-page .flow-canvas{grid-column:1/3;grid-row:3;min-width:0;min-height:0;width:100%;height:100%;position:relative;border:0;border-bottom:1px solid var(--cfg-rule);border-radius:0;background:var(--vscode-editor-background)}
.cfg-page .scope{grid-column:1;grid-row:4;align-self:center;min-width:0;margin:0;padding:6px 14px;background:var(--vscode-editor-background);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cfg-page #filter-status{grid-column:1/-1;grid-row:2;margin:0;padding:4px 14px;border-bottom:1px solid var(--cfg-rule);background:var(--vscode-editor-background);font-size:11px}
.cfg-page [hidden]{display:none!important}
.cfg-page .cfg-zoom{grid-column:2/4;grid-row:4;justify-self:end;align-self:center;display:flex;gap:0;margin:6px 12px;border:1px solid var(--vscode-panel-border);border-radius:8px;background:var(--vscode-editor-background)}
.cfg-page .cfg-zoom button{height:32px;min-width:32px;min-height:0;padding:5px 8px;border:0;border-radius:0;background:transparent;color:var(--vscode-foreground)}
.cfg-page .cfg-zoom #graph-zoom{min-width:52px;font-size:12px;font-variant-numeric:tabular-nums;border-inline:1px solid var(--vscode-panel-border)}
.cfg-page .cfg-zoom button:first-child{border-radius:7px 0 0 7px}.cfg-page .cfg-zoom button:last-child{border-radius:0 7px 7px 0}
.cfg-page .cfg-edge{cursor:pointer;outline:none;transition:opacity 120ms ease}
.cfg-edge-hit{fill:none;stroke:transparent;stroke-width:14;vector-effect:non-scaling-stroke;pointer-events:stroke}
.cfg-page .cfg-edge .edge{pointer-events:none;vector-effect:non-scaling-stroke;stroke-width:1.3}
.cfg-page .cfg-edge.dimmed{opacity:.4}
.cfg-page .cfg-edge.connected{opacity:.9}
.cfg-page .cfg-edge.connected .edge{stroke-width:1.8}
.cfg-page .cfg-edge.is-hovered,.cfg-page .cfg-edge.is-active,.cfg-page .cfg-edge:focus-visible{opacity:1!important}
.cfg-page .cfg-edge.is-hovered .edge{stroke-width:2.5}
.cfg-page .cfg-edge.is-active .edge,.cfg-page .cfg-edge:focus-visible .edge{stroke-width:3}
.cfg-page .flow-canvas.is-tracing .cfg-edge:not(.is-hovered):not(.is-active){opacity:.25}
.cfg-page .graph-node.edge-endpoint .block-body{stroke:var(--vscode-focusBorder);stroke-width:2}
.cfg-page .flow-canvas .block-body{stroke-width:1;vector-effect:non-scaling-stroke}
.cfg-page .flow-canvas .block-header{fill:color-mix(in srgb,var(--cfg-ink) 7%,var(--cfg-ground))}
.cfg-page .flow-canvas .tok-mnemonic{font-weight:500}
.cfg-page .flow-canvas .node-title{font-weight:500}
.cfg-page .flow-canvas .graph-node.selected .block-header{fill:color-mix(in srgb,var(--vscode-focusBorder) 10%,var(--vscode-editor-background))}
.cfg-overview{grid-column:3;grid-row:3;width:160px;min-height:0;padding:0;margin:0;border:0;border-left:1px solid var(--cfg-rule);border-bottom:1px solid var(--cfg-rule);border-radius:0;background:var(--vscode-editor-background);overflow:hidden;align-self:stretch}
.cfg-page .cfg-overview summary{user-select:none;cursor:pointer;display:flex;align-items:center;gap:6px;margin:0;padding:6px 8px;font-size:11px;font-weight:500;list-style:none}
.cfg-overview summary::-webkit-details-marker{display:none}
.cfg-overview summary .call-icon{font-size:13px}.cfg-page .cfg-overview-close{display:inline-flex;align-items:center;justify-content:center;margin-left:auto;width:24px;height:24px;min-height:0;padding:4px;border:0;border-radius:4px;background:transparent;color:var(--vscode-foreground);cursor:pointer}
.cfg-page .cfg-overview svg{display:block;width:100%;height:110px;border-top:1px solid var(--cfg-rule);background:var(--cfg-surface);cursor:crosshair}
.cfg-overview path{fill:none;stroke:var(--vscode-descriptionForeground);stroke-width:2}
.cfg-overview rect{fill:var(--vscode-editorWidget-border,var(--vscode-descriptionForeground));stroke:none}
.cfg-overview .cfg-map-selected{fill:var(--vscode-focusBorder)}
.cfg-overview #cfg-overview-window{fill:var(--vscode-focusBorder);fill-opacity:.12;stroke:var(--vscode-focusBorder);stroke-width:1;vector-effect:non-scaling-stroke;pointer-events:none}
.cfg-page .empty{grid-column:1/-1;grid-row:3;margin:auto;padding:24px;color:var(--vscode-descriptionForeground)}
.cfg-page button:focus-visible,.cfg-page summary:focus-visible,.cfg-page .cfg-overview-close:focus-visible,.cfg-page #cfg-overview-map:focus-visible{outline:2px solid var(--cfg-focus);outline-offset:-2px}.cfg-page button:disabled{opacity:.5;cursor:not-allowed}
.cfg-page button,.cfg-page summary{transition:background-color 120ms ease,color 120ms ease}
@media(prefers-reduced-motion:reduce){.cfg-page *{animation:none!important;transition:none!important}}
.vscode-high-contrast .cfg-edge,.vscode-high-contrast-light .cfg-edge{opacity:1!important}
@media(max-width:640px){.cfg-page main{grid-template-rows:auto auto minmax(120px,1fr) auto auto}.cfg-topbar{min-height:48px;padding:8px 10px;gap:6px 3px;flex-wrap:wrap}.cfg-heading{gap:6px}.cfg-page .cfg-heading h1{font-size:12px}.cfg-function-name{font-size:11px}.cfg-search{flex:1 1 100%;order:10}.cfg-page .flow-canvas{grid-column:1/-1;grid-row:3}.cfg-overview{grid-column:1/-1;grid-row:4;width:100%;border-left:0}.cfg-page .cfg-overview svg{height:90px}.cfg-page .scope{grid-row:5;padding:6px 10px;font-size:10px}.cfg-page .cfg-zoom{grid-row:5;margin:6px 10px}}
`;

/** Client-side script for block search, edge tracing, and keyboard shortcuts in CFG views. */
export const controlFlowUiScript = String.raw`
    (()=>{
      const canvas=document.querySelector('[data-control-flow]');if(!canvas||!graphViewport){return}
      const nodes=[...canvas.querySelectorAll('.graph-world>.graph-node')],edges=[...canvas.querySelectorAll('.cfg-edge')],svg=canvas.querySelector('svg');
      const searchToggle=document.getElementById('cfg-search-toggle'),searchHost=search.closest('.cfg-search');
      const openSearch=()=>{searchHost.hidden=false;searchToggle.setAttribute('aria-expanded','true');search.focus();search.select()};
      const closeSearch=()=>{searchHost.hidden=true;searchToggle.setAttribute('aria-expanded','false');searchToggle.focus()};
      searchToggle.addEventListener('click',()=>searchHost.hidden?openSearch():closeSearch());if(search.value){searchHost.hidden=false;searchToggle.setAttribute('aria-expanded','true')}
      search.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();search.value='';search.dispatchEvent(new Event('input'));closeSearch()}});
      let activeEdge=samePage?edges.find(edge=>edge.dataset.edgeKey===previous.cfgActiveEdge):undefined,hoveredEdge,tracedNode;
      const paint=()=>{canvas.classList.toggle('is-tracing',!!(hoveredEdge||tracedNode));for(const edge of edges){edge.classList.toggle('is-active',edge===activeEdge);edge.classList.toggle('is-hovered',edge===hoveredEdge||!!tracedNode&&(edge.dataset.from===tracedNode.dataset.node||edge.dataset.to===tracedNode.dataset.node));edge.setAttribute('aria-pressed',String(edge===activeEdge))}const current=hoveredEdge||activeEdge;for(const node of nodes){node.classList.toggle('edge-endpoint',!!current&&(node.dataset.node===current.dataset.from||node.dataset.node===current.dataset.to))}};
      const activate=edge=>{activeEdge=edge;tracedNode=undefined;paint();persist()};
      for(const edge of edges){edge.addEventListener('pointerdown',event=>{if(event.button===0){event.stopPropagation()}});edge.addEventListener('pointerenter',()=>{hoveredEdge=edge;tracedNode=undefined;paint()});edge.addEventListener('pointerleave',()=>{hoveredEdge=undefined;paint()});edge.addEventListener('focus',()=>{hoveredEdge=edge;paint()});edge.addEventListener('blur',()=>{hoveredEdge=undefined;paint()});edge.addEventListener('click',event=>{event.stopPropagation();activate(edge)});edge.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();activate(edge)}})}
      for(const node of nodes){node.addEventListener('pointerenter',()=>{tracedNode=node;hoveredEdge=undefined;paint()});node.addEventListener('pointerleave',()=>{tracedNode=undefined;paint()});node.addEventListener('click',()=>{activeEdge=undefined;paint();persist()})}
      canvas.addEventListener('click',event=>{if(!event.target.closest('.graph-node,.cfg-edge')){activate(undefined)}});
      canvas.addEventListener('keydown',event=>{if(event.key==='Escape'&&activeEdge){event.preventDefault();event.stopPropagation();hoveredEdge=undefined;tracedNode=undefined;activate(undefined);if(!canvas.contains(document.activeElement)){canvas.querySelector('.graph-world [tabindex="0"]')?.focus({preventScroll:true})}}});
      const overview=document.querySelector('.cfg-overview'),overviewSummary=overview.querySelector(':scope > summary'),map=overview.querySelector('svg'),windowRect=map.querySelector('#cfg-overview-window'),overviewToggle=document.getElementById('cfg-overview-toggle');
      overview.open=samePage&&previous.cfgOverview===true;overview.hidden=!overview.open;
      const syncOverview=()=>{const restoreFocus=!overview.open&&(overview.contains(document.activeElement)||document.activeElement===document.body);overview.hidden=!overview.open;overviewToggle.setAttribute('aria-pressed',String(overview.open));if(restoreFocus){overviewToggle.focus({preventScroll:true})}};
      syncOverview();
      overviewSummary.addEventListener('click',event=>{if(event.target.closest('.cfg-overview-close')){return}event.preventDefault();overview.open=!overview.open;if(!overview.open){cfgOverviewDismissed=true}syncOverview();persist()});
      overview.addEventListener('toggle',()=>{if(!overview.open){cfgOverviewDismissed=true}syncOverview();persist()});
      overviewToggle.addEventListener('click',()=>{if(overview.open){overview.open=false;cfgOverviewDismissed=true}else{overview.hidden=false;overview.open=true;cfgOverviewDismissed=false}syncOverview();persist()});
      const close=overview.querySelector('.cfg-overview-close');
      close.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();overview.open=false;cfgOverviewDismissed=true;syncOverview();persist()});
      close.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();close.click()}});
      const autoOverview=()=>{const view=graphViewport.snapshot(),width=Number(svg.dataset.width)*view.scale,height=Number(svg.dataset.height)*view.scale;const clipped=view.x < -1||view.y < -1||view.x+width>canvas.clientWidth+1||view.y+height>canvas.clientHeight+1;if(clipped&&!overview.open&&!cfgOverviewDismissed){overview.hidden=false;overview.open=true;syncOverview();persist()}};
      canvas.addEventListener('graph-viewport',autoOverview);
      const updateMap=()=>{const view=graphViewport.snapshot(),box=map.viewBox.baseVal,left=Math.max(0,Math.min(box.width,-view.x/view.scale)),top=Math.max(0,Math.min(box.height,-view.y/view.scale)),right=Math.max(left,Math.min(box.width,(canvas.clientWidth-view.x)/view.scale)),bottom=Math.max(top,Math.min(box.height,(canvas.clientHeight-view.y)/view.scale));const w=Math.min(box.width,Math.max(4,right-left)),h=Math.min(box.height,Math.max(4,bottom-top)),wx=Math.max(0,Math.min(box.width-w,left)),wy=Math.max(0,Math.min(box.height-h,top));windowRect.setAttribute('x',wx);windowRect.setAttribute('y',wy);windowRect.setAttribute('width',w);windowRect.setAttribute('height',h);const ids=new Set(nodes.filter(node=>node.classList.contains('selected')).map(node=>node.dataset.node));for(const rect of map.querySelectorAll('[data-map-node]')){rect.classList.toggle('cfg-map-selected',ids.has(rect.dataset.mapNode))}};
      canvas.addEventListener('graph-viewport',updateMap);new MutationObserver(updateMap).observe(canvas.querySelector('.graph-world'),{subtree:true,attributes:true,attributeFilter:['class']});
      let pointer;const move=event=>{const matrix=map.getScreenCTM();if(!matrix){return}const p=map.createSVGPoint();p.x=event.clientX;p.y=event.clientY;const target=p.matrixTransform(matrix.inverse());graphViewport.center(target.x,target.y)};
      map.addEventListener('pointerdown',event=>{if(event.button!==0){return}event.preventDefault();event.stopPropagation();pointer=event.pointerId;map.setPointerCapture(pointer);map.focus({preventScroll:true});move(event)});map.addEventListener('pointermove',event=>{if(pointer===event.pointerId){move(event)}});for(const event of ['pointerup','pointercancel','lostpointercapture']){map.addEventListener(event,()=>{pointer=undefined})}
      map.addEventListener('keydown',event=>{const delta={ArrowLeft:[-50,0],ArrowRight:[50,0],ArrowUp:[0,-50],ArrowDown:[0,50]}[event.key];if(delta){event.preventDefault();event.stopPropagation();const view=graphViewport.snapshot();graphViewport.center((canvas.clientWidth/2-view.x+delta[0])/view.scale,(canvas.clientHeight/2-view.y+delta[1])/view.scale)}});
      document.addEventListener('keydown',event=>{if(((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='f')||event.key==='/'&&!event.target.closest('input,textarea')){event.preventDefault();openSearch()}});
      paint();updateMap();
    })();
`;
