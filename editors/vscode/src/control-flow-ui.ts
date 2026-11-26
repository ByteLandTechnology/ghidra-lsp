// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

import { callIcon } from './call-graph-icons';
import { fitGraphTitle, searchShortcutTitle } from './view-ui';
import { escapeHtml } from './workbench-page';

/** Render the top toolbar and zoom control bar for the control-flow graph view. */
export function controlFlowToolbar(title: string, subtitle: string, active: boolean, singleKeyShortcuts = true): string {
    const disabled = active ? '' : ' disabled';
    return `<div class="flow-topbar cfg-topbar" role="group" aria-label="Control flow tools"><div class="flow-topbar-primary cfg-heading"><div class="cfg-identity"><h1>${escapeHtml(title)}</h1><span class="cfg-function-name" title="${escapeHtml(subtitle)}">${escapeHtml(subtitle)}</span></div></div><div class="flow-topbar-actions cfg-actions"><button type="button" class="cfg-icon-button" id="cfg-search-toggle" aria-label="Find blocks" aria-expanded="false" title="${escapeHtml(searchShortcutTitle('Find blocks', singleKeyShortcuts))}"${disabled}>${callIcon('search')}</button><button type="button" class="cfg-icon-button" id="graph-fit" aria-label="Fit graph" title="${escapeHtml(fitGraphTitle(singleKeyShortcuts))}"${disabled}>${callIcon('fit')}</button><button type="button" class="cfg-icon-button" id="cfg-overview-toggle" aria-label="Toggle overview" aria-pressed="false" title="Show or hide overview"${disabled}>${callIcon('overview')}</button><button type="button" class="cfg-icon-button" id="cfg-refresh" data-action="refresh" aria-label="Refresh graph" title="Refresh graph">${callIcon('refresh')}</button></div><div class="flow-search cfg-search" hidden><input id="search" class="search" aria-label="Find blocks" placeholder="Find blocks…"></div></div><div class="cfg-zoom" role="group" aria-label="Zoom"><button type="button" id="graph-zoom-out" aria-label="Zoom out"${disabled}>${callIcon('minus')}</button><button type="button" id="graph-zoom" aria-label="Actual size" title="Actual size (100%)"${disabled}>100%</button><button type="button" id="graph-zoom-in" aria-label="Zoom in"${disabled}>${callIcon('plus')}</button></div>`;
}

/** CSS styles for the control-flow graph toolbar, edges, zoom widget, and overview map. */
export const controlFlowUiStyles = `
/* Hallmark · v2.0.0 · redesign: full · shape: app screen · genre: modern-minimal · theme: Console (dealt 3/3) · material: VS Code theme tokens · signature: control-flow trace */
/* Hallmark · pre-emit critique: P4 H4 E4 S4 R5 V4 · weakest: hierarchy, distinguish the graph identity from its tools */
.cfg-page{--cfg-ground:var(--vscode-editor-background);--cfg-surface:var(--vscode-sideBar-background,var(--vscode-editor-background));--cfg-ink:var(--vscode-foreground);--cfg-muted:var(--ghidra-muted);--cfg-rule:var(--vscode-panel-border);--cfg-focus:var(--ghidra-focus)}
.flow-page .call-icon{font:16px call-icons;display:inline-block;line-height:1;vertical-align:middle}
.cfg-topbar{min-height:48px;border-bottom:1px solid var(--cfg-rule);background:var(--cfg-ground)}
.cfg-heading{display:flex;align-items:center;gap:10px;flex:1 1 140px;min-width:min(140px,100%)}.cfg-identity{display:flex;flex-direction:column;gap:1px;min-width:0}
.cfg-page .cfg-heading h1{font-size:13px;line-height:1.25;font-weight:600;color:var(--cfg-ink);overflow-wrap:anywhere}
.cfg-function-name{font-size:11px;line-height:1.25;font-weight:400;color:var(--cfg-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.cfg-page .cfg-icon-button{display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:32px;height:32px;min-width:24px;min-height:24px;padding:6px;border:0;border-radius:6px;background:transparent;color:var(--vscode-foreground);cursor:pointer}
.cfg-page button:hover{background:var(--vscode-toolbar-hoverBackground,var(--vscode-list-hoverBackground))}
.cfg-page .cfg-topbar [aria-pressed="true"],.cfg-page .cfg-topbar [aria-expanded="true"]{background:var(--ghidra-pressed-bg);color:var(--ghidra-accent);box-shadow:inset 0 0 0 1px var(--ghidra-focus)}
.cfg-page .cfg-search input{width:100%;min-height:30px;height:auto;min-width:0;border-radius:6px}
.cfg-page .flow-canvas:focus-visible{outline:2px solid var(--cfg-focus);outline-offset:-2px}
.cfg-page .flow-canvas{position:relative;border:0;border-radius:0;background:var(--vscode-editor-background)}
.cfg-page [hidden]{display:none!important}
.cfg-page .cfg-zoom{position:absolute;bottom:14px;right:14px;z-index:2;display:flex;gap:0;border:1px solid var(--vscode-panel-border);border-radius:8px;background:var(--vscode-editor-background);box-shadow:0 2px 8px var(--vscode-widget-shadow)}
.cfg-page .cfg-zoom button{min-height:28px;height:auto;min-width:30px;padding:4px 8px;border:0;border-radius:0;background:transparent;color:var(--vscode-foreground)}
.cfg-page .cfg-zoom #graph-zoom{min-width:50px;font-size:12px;font-variant-numeric:tabular-nums;border-inline:1px solid var(--vscode-panel-border)}
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
.cfg-overview{position:absolute;right:14px;bottom:52px;z-index:2;width:min(160px,calc(100% - 20px));max-height:calc(100% - 58px);padding:0;margin:0;border:1px solid var(--vscode-editorWidget-border,var(--vscode-panel-border));border-radius:8px;background:var(--vscode-editor-background);box-shadow:0 2px 8px var(--vscode-widget-shadow);overflow:hidden}
.cfg-page .cfg-overview summary{touch-action:none;user-select:none;cursor:grab;display:flex;align-items:center;gap:6px;min-height:28px;margin:0;padding:4px 8px;font-size:11px;font-weight:500;list-style:none}
.cfg-overview summary::-webkit-details-marker{display:none}
.cfg-overview summary>span:not(.call-icon){flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cfg-overview summary .call-icon{font-size:13px;flex-shrink:0}.cfg-page .cfg-overview-close{display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;margin-left:auto;width:24px;height:24px;min-width:24px;min-height:24px;padding:4px;border:0;border-radius:4px;background:transparent;color:var(--vscode-foreground);cursor:pointer}
.cfg-overview summary:active{cursor:grabbing}
.cfg-page .cfg-overview svg{display:block;width:100%;height:110px;border-top:1px solid var(--cfg-rule);background:var(--cfg-surface);cursor:crosshair}
.cfg-overview path{fill:none;stroke:var(--vscode-descriptionForeground);stroke-width:2}
.cfg-overview rect{fill:var(--vscode-editorWidget-border,var(--vscode-descriptionForeground));stroke:none}
.cfg-overview .cfg-map-selected{fill:var(--vscode-focusBorder)}
.cfg-overview #cfg-overview-window{fill:var(--vscode-focusBorder);fill-opacity:.12;stroke:var(--vscode-focusBorder);stroke-width:1;vector-effect:non-scaling-stroke;pointer-events:none}
.cfg-page .empty{margin:auto;padding:24px;color:var(--ghidra-muted)}
.cfg-page button:focus-visible,.cfg-page summary:focus-visible,.cfg-page .cfg-overview-close:focus-visible,.cfg-page #cfg-overview-map:focus-visible{outline:2px solid var(--cfg-focus);outline-offset:-2px}.cfg-page button:disabled{opacity:.5;cursor:not-allowed}
.cfg-page button,.cfg-page summary{transition:background-color 120ms ease,color 120ms ease}
@media(prefers-reduced-motion:reduce){.cfg-page *{animation:none!important;transition:none!important}}
.vscode-high-contrast .cfg-edge,.vscode-high-contrast-light .cfg-edge{opacity:1!important}
.cfg-page .cfg-icon-button{display:inline-flex}
.cfg-page .cfg-topbar [aria-pressed="true"],.cfg-page .cfg-topbar [aria-expanded="true"]{width:auto;min-width:32px;gap:3px;padding-inline:6px;border:2px solid var(--ghidra-active-border)}
.cfg-page .cfg-node.edge-endpoint:not(.selected):not(:focus-visible){border-color:var(--ghidra-focus);outline:1px solid var(--ghidra-focus);outline-offset:0}
body.cfg-page:is(.vscode-high-contrast,.vscode-high-contrast-light) :is(.cfg-icon-button:not([aria-pressed="true"]):not([aria-expanded="true"]),.cfg-overview-close){border:1px solid var(--ghidra-hv-border)}
body.cfg-page:is(.vscode-high-contrast,.vscode-high-contrast-light) .cfg-topbar :is([aria-pressed="true"],[aria-expanded="true"]){background:var(--vscode-editor-background);color:var(--vscode-foreground);border:2px solid var(--ghidra-active-border)}
@media(prefers-contrast:more){.cfg-page .cfg-icon-button:not([aria-pressed="true"]):not([aria-expanded="true"]),.cfg-page .cfg-overview-close{border:1px solid var(--ghidra-hv-border)}}
@media(forced-colors:active){
  .cfg-topbar,.cfg-overview,.cfg-page .cfg-zoom{background:var(--ghidra-selection-bg);color:var(--ghidra-selection-fg);border-color:var(--ghidra-hv-border)}
  .cfg-page .cfg-icon-button:not([aria-pressed="true"]):not([aria-expanded="true"]),.cfg-page .cfg-zoom button,.cfg-page .cfg-overview-close{background:ButtonFace;color:ButtonText;border:1px solid var(--ghidra-hv-border)}
  .cfg-page .cfg-topbar [aria-pressed="true"],.cfg-page .cfg-topbar [aria-expanded="true"]{background:var(--ghidra-pressed-bg);color:var(--ghidra-selection-fg);border:2px solid var(--ghidra-active-border)}
  .cfg-page .cfg-edge{opacity:1!important}
  .cfg-page .flow-canvas svg .block-header,.cfg-page .flow-canvas svg .graph-node.selected .block-header{fill:var(--ghidra-selection-bg);stroke:var(--ghidra-hv-border);stroke-width:1}
}
@media(max-width:640px){
  .cfg-topbar{min-height:40px}
  .cfg-heading{gap:6px}
  .cfg-page .cfg-heading h1{font-size:12px}
  .cfg-function-name{font-size:11px}
  .cfg-page .cfg-icon-button{width:28px;height:28px;padding:4px}
  .cfg-page .cfg-topbar :is([aria-pressed="true"],[aria-expanded="true"]){width:auto;min-width:28px;padding-inline:5px}
  .cfg-page .cfg-search input{min-height:28px}
  .cfg-page .cfg-zoom{right:8px;bottom:8px}
  .cfg-page .cfg-zoom button{min-width:28px;min-height:28px;padding:3px 6px}
  .cfg-overview{width:min(130px,calc(100% - 16px));right:8px;bottom:42px}
  .cfg-page .cfg-overview svg{height:76px}
}
@media(max-height:420px){
  .cfg-topbar{min-height:32px}
  .cfg-page .cfg-icon-button{width:24px;height:24px;min-width:24px;min-height:24px;padding:2px}
  .cfg-page .cfg-topbar :is([aria-pressed="true"],[aria-expanded="true"]){width:auto;min-width:24px;padding-inline:4px}
  .cfg-page .cfg-search input{min-height:24px;padding:2px 6px}
  .cfg-page .cfg-zoom{right:6px;bottom:6px}
  .cfg-page .cfg-zoom button{min-width:24px;min-height:24px;padding:2px 5px}
  .cfg-page .cfg-zoom #graph-zoom{min-width:42px;font-size:11px}
  .cfg-overview{right:6px;bottom:34px;max-height:calc(100% - 40px)}
  .cfg-overview[open]{display:flex;flex-direction:column}
  .cfg-page .cfg-overview summary{min-height:24px;padding:2px 6px;flex-shrink:0}
  .cfg-page .cfg-overview svg{flex:1 1 auto;min-height:24px;height:52px}
}
`;

/** Client-side script for block search, edge tracing, and keyboard shortcuts in CFG views. */
export const controlFlowUiScript = String.raw`
    let cfgUiCleanup,mountControlFlowUi;
    (()=>{
      const searchToggle=document.getElementById('cfg-search-toggle'),searchHost=search?.closest('.cfg-search'),overviewToggle=document.getElementById('cfg-overview-toggle');
      let toggleOverviewFn;
      const openSearch=()=>{if(!searchHost||!searchToggle||searchToggle.disabled){return}searchHost.hidden=false;searchToggle.setAttribute('aria-expanded','true');search.focus();search.select()};
      const closeSearch=()=>{if(!searchHost||!searchToggle){return}searchHost.hidden=true;searchToggle.setAttribute('aria-expanded','false');if(!searchToggle.disabled){searchToggle.focus()}};
      if(searchToggle&&!searchToggle.dataset.cfgBound){
        searchToggle.dataset.cfgBound='true';
        searchToggle.addEventListener('click',()=>searchHost.hidden?openSearch():closeSearch());
        search.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();search.value='';search.dispatchEvent(new Event('input'));closeSearch()}});
        overviewToggle?.addEventListener('click',()=>toggleOverviewFn?.());
        document.addEventListener('keydown',event=>{if(!document.querySelector('[data-control-flow]')){return}if(isModShortcut(event,'f')||(event.key==='/'&&canUseSingleKeyShortcut(event))){event.preventDefault();openSearch()}});
        if(search.value&&!searchToggle.disabled){searchHost.hidden=false;searchToggle.setAttribute('aria-expanded','true')}
      }
      mountControlFlowUi=(preserveState=false,saved={})=>{
        cfgUiCleanup?.();cfgUiCleanup=undefined;toggleOverviewFn=undefined;
        const canvas=document.querySelector('[data-control-flow]');
        if(!canvas||!graphViewport){overviewToggle?.setAttribute('aria-pressed','false');if(searchHost&&searchToggle?.disabled){searchHost.hidden=true;searchToggle.setAttribute('aria-expanded','false')}return}
        const nodes=[...canvas.querySelectorAll('.graph-node')],edges=[...canvas.querySelectorAll('.cfg-edge')],svg=canvas.querySelector('svg');
        const wantedEdge=preserveState?saved.activeEdge:(samePage?previous.cfgActiveEdge:undefined);
        let activeEdge=wantedEdge?edges.find(edge=>edge.dataset.edgeKey===wantedEdge):undefined,hoveredEdge,tracedNode;
        const paint=()=>{canvas.classList.toggle('is-tracing',!!(hoveredEdge||tracedNode));for(const edge of edges){edge.classList.toggle('is-active',edge===activeEdge);edge.classList.toggle('is-hovered',edge===hoveredEdge||!!tracedNode&&(edge.dataset.from===tracedNode.dataset.node||edge.dataset.to===tracedNode.dataset.node));edge.setAttribute('aria-pressed',String(edge===activeEdge))}const current=hoveredEdge||activeEdge;for(const node of nodes){node.classList.toggle('edge-endpoint',!!current&&(node.dataset.node===current.dataset.from||node.dataset.node===current.dataset.to))}};
        const activate=edge=>{activeEdge=edge;tracedNode=undefined;paint();persist()};
        for(const edge of edges){edge.addEventListener('pointerdown',event=>{if(event.button===0){event.stopPropagation()}});edge.addEventListener('pointerenter',()=>{hoveredEdge=edge;tracedNode=undefined;paint()});edge.addEventListener('pointerleave',()=>{hoveredEdge=undefined;paint()});edge.addEventListener('focus',()=>{hoveredEdge=edge;paint()});edge.addEventListener('blur',()=>{hoveredEdge=undefined;paint()});edge.addEventListener('click',event=>{event.stopPropagation();activate(edge)});edge.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();activate(edge)}})}
        for(const node of nodes){node.addEventListener('pointerenter',()=>{tracedNode=node;hoveredEdge=undefined;paint()});node.addEventListener('pointerleave',()=>{tracedNode=undefined;paint()});node.addEventListener('click',()=>{activeEdge=undefined;paint();persist()})}
        canvas.addEventListener('click',event=>{if(!event.target.closest('.graph-node,.cfg-edge,.cfg-overview')){activate(undefined)}});
        canvas.addEventListener('keydown',event=>{if(event.key==='Escape'&&activeEdge){event.preventDefault();event.stopPropagation();hoveredEdge=undefined;tracedNode=undefined;activate(undefined);canvas.focus({preventScroll:true})}});
        const overview=canvas.querySelector('.cfg-overview'),map=overview.querySelector('svg'),windowRect=map.querySelector('#cfg-overview-window');
        overview.open=preserveState?saved.overview===true:(samePage&&previous.cfgOverview===true);overview.hidden=!overview.open;
        const syncOverview=()=>{overview.hidden=!overview.open;overviewToggle?.setAttribute('aria-pressed',String(overview.open))};
        const setPosition=(x,y)=>{const left=Math.max(0,Math.min(Math.max(0,canvas.clientWidth-overview.offsetWidth),x)),top=Math.max(0,Math.min(Math.max(0,canvas.clientHeight-overview.offsetHeight),y));overview.style.left=left+'px';overview.style.top=top+'px';overview.style.right='auto';overview.style.bottom='auto';cfgOverviewPosition={x:left,y:top}};
        const placeOverview=()=>{const bounds=canvas.getBoundingClientRect(),w=overview.offsetWidth,h=overview.offsetHeight,pad=Math.min(16,Math.max(6,Math.floor(canvas.clientHeight*.06))),zoomEl=document.querySelector('.cfg-zoom'),bottomClear=zoomEl?Math.max(pad,canvas.clientHeight-(zoomEl.getBoundingClientRect().top-bounds.top)+6):58;const candidates=[[pad,pad],[Math.max(pad,canvas.clientWidth-w-pad),pad],[pad,Math.max(pad,canvas.clientHeight-h-bottomClear)],[Math.max(pad,canvas.clientWidth-w-pad),Math.max(pad,canvas.clientHeight-h-bottomClear)]];const blocks=[...nodes.map(node=>(node.classList.contains('cfg-node')?node:node.querySelector('.block-body')||node).getBoundingClientRect()),...(zoomEl?[zoomEl.getBoundingClientRect()]:[])];const overlap=([x,y])=>blocks.reduce((sum,block)=>sum+Math.max(0,Math.min(bounds.left+x+w,block.right)-Math.max(bounds.left+x,block.left))*Math.max(0,Math.min(bounds.top+y+h,block.bottom)-Math.max(bounds.top+y,block.top)),0);candidates.sort((a,b)=>overlap(a)-overlap(b));setPosition(...candidates[0])};
        syncOverview();if(overview.open&&cfgOverviewPosition){setPosition(cfgOverviewPosition.x,cfgOverviewPosition.y)}
        if(preserveState&&overview.open&&graphViewport.snapshot().fitted){graphViewport.fit()}
        overview.addEventListener('toggle',()=>{syncOverview();if(overview.open){graphViewport.reveal()}persist()});
        toggleOverviewFn=()=>{overview.open=!overview.open;cfgOverviewDismissed=!overview.open;syncOverview();if(overview.open){if(cfgOverviewPosition){setPosition(cfgOverviewPosition.x,cfgOverviewPosition.y)}else{placeOverview()}graphViewport.reveal()}persist()};
        const handle=overview.querySelector('summary'),close=overview.querySelector('.cfg-overview-close');let overviewDrag;
        close.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();overview.open=false;cfgOverviewDismissed=true;syncOverview();persist()});
        close.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();close.click()}});
        handle.addEventListener('pointerdown',event=>{if(event.button!==0||event.target.closest('button,.cfg-overview-close')){return}event.preventDefault();event.stopPropagation();const box=overview.getBoundingClientRect(),bounds=canvas.getBoundingClientRect();overviewDrag={id:event.pointerId,x:event.clientX,y:event.clientY,left:box.left-bounds.left,top:box.top-bounds.top};handle.setPointerCapture(event.pointerId)});
        handle.addEventListener('pointermove',event=>{if(!overviewDrag||event.pointerId!==overviewDrag.id){return}setPosition(overviewDrag.left+event.clientX-overviewDrag.x,overviewDrag.top+event.clientY-overviewDrag.y)});
        const endDrag=event=>{if(overviewDrag&&event.pointerId===overviewDrag.id){overviewDrag=undefined;persist()}};handle.addEventListener('pointerup',endDrag);handle.addEventListener('pointercancel',endDrag);handle.addEventListener('lostpointercapture',endDrag);
        handle.addEventListener('click',event=>event.preventDefault());handle.addEventListener('keydown',event=>{const delta={ArrowLeft:[-16,0],ArrowRight:[16,0],ArrowUp:[0,-16],ArrowDown:[0,16]}[event.key];if(delta){event.preventDefault();event.stopPropagation();const box=overview.getBoundingClientRect(),bounds=canvas.getBoundingClientRect();setPosition(box.left-bounds.left+delta[0],box.top-bounds.top+delta[1]);persist()}});
        const resizeObserver=new ResizeObserver(()=>{if(overview.open&&cfgOverviewPosition){setPosition(cfgOverviewPosition.x,cfgOverviewPosition.y);persist()}});
        resizeObserver.observe(canvas);
        const autoOverview=()=>{const view=graphViewport.snapshot(),width=Number(svg.dataset.width)*view.scale,height=Number(svg.dataset.height)*view.scale,compact=canvas.clientWidth<=480||canvas.clientHeight<=320;const clipped=view.x < -1||view.y < -1||view.x+width>canvas.clientWidth+1||view.y+height>canvas.clientHeight+1;if(clipped&&!compact&&!overview.open&&!cfgOverviewDismissed){overview.open=true;syncOverview();if(cfgOverviewPosition){setPosition(cfgOverviewPosition.x,cfgOverviewPosition.y)}else{placeOverview()}graphViewport.reveal();persist()}};
        canvas.addEventListener('graph-viewport',autoOverview);
        const updateMap=()=>{const view=graphViewport.snapshot(),box=map.viewBox.baseVal,left=Math.max(0,Math.min(box.width,-view.x/view.scale)),top=Math.max(0,Math.min(box.height,-view.y/view.scale)),right=Math.max(left,Math.min(box.width,(canvas.clientWidth-view.x)/view.scale)),bottom=Math.max(top,Math.min(box.height,(canvas.clientHeight-view.y)/view.scale));const w=Math.min(box.width,Math.max(4,right-left)),h=Math.min(box.height,Math.max(4,bottom-top)),wx=Math.max(0,Math.min(box.width-w,left)),wy=Math.max(0,Math.min(box.height-h,top));windowRect.setAttribute('x',wx);windowRect.setAttribute('y',wy);windowRect.setAttribute('width',w);windowRect.setAttribute('height',h);const ids=new Set(nodes.filter(node=>node.classList.contains('selected')).map(node=>node.dataset.node));for(const rect of map.querySelectorAll('[data-map-node]')){rect.classList.toggle('cfg-map-selected',ids.has(rect.dataset.mapNode))}};
        canvas.addEventListener('graph-viewport',updateMap);
        const mutationObserver=new MutationObserver(updateMap);
        mutationObserver.observe(canvas.querySelector('.graph-card-world')||canvas.querySelector('.graph-world'),{subtree:true,attributes:true,attributeFilter:['class']});
        cfgUiCleanup=()=>{resizeObserver.disconnect();mutationObserver.disconnect()};
        let pointer;const move=event=>{const matrix=map.getScreenCTM();if(!matrix){return}const p=map.createSVGPoint();p.x=event.clientX;p.y=event.clientY;const target=p.matrixTransform(matrix.inverse());graphViewport.center(target.x,target.y)};
        map.addEventListener('pointerdown',event=>{if(event.button!==0){return}event.preventDefault();event.stopPropagation();pointer=event.pointerId;map.setPointerCapture(pointer);map.focus({preventScroll:true});move(event)});map.addEventListener('pointermove',event=>{if(pointer===event.pointerId){move(event)}});for(const event of ['pointerup','pointercancel','lostpointercapture']){map.addEventListener(event,()=>{pointer=undefined})}
        map.addEventListener('keydown',event=>{const delta={ArrowLeft:[-50,0],ArrowRight:[50,0],ArrowUp:[0,-50],ArrowDown:[0,50]}[event.key];if(delta){event.preventDefault();event.stopPropagation();const view=graphViewport.snapshot();graphViewport.center((canvas.clientWidth/2-view.x+delta[0])/view.scale,(canvas.clientHeight/2-view.y+delta[1])/view.scale)}});
        paint();updateMap();
      };
      mountControlFlowUi(false);
    })();
`;
