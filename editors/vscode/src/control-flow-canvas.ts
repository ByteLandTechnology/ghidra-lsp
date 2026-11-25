// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

/** Shared styles for control-flow, call-graph, and call-column pages. */
export const controlFlowStyles = `
.flow-page{overflow:hidden}
.flow-page main{height:100vh;max-width:none;padding:0;margin:0;position:relative;display:grid;grid-template-columns:minmax(0,1fr);grid-template-rows:auto auto auto minmax(0,1fr);gap:0}
.flow-page .flow-topbar{grid-row:1;position:relative;z-index:4;display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;padding:8px 14px;min-width:0;border-bottom:1px solid var(--vscode-panel-border);background:var(--vscode-editor-background)}
.flow-page .flow-topbar-primary{display:flex;align-items:center;gap:8px;flex:1 1 140px;min-width:min(140px,100%)}
.flow-page .flow-topbar-controls,.flow-page .flow-topbar-actions{display:flex;align-items:center;flex-wrap:wrap;gap:4px;min-width:0;max-width:100%}
.flow-page .flow-topbar-actions{margin-left:auto}
.flow-page .flow-search{flex:1 0 100%;min-width:0}
.flow-page .flow-search input{width:100%;min-width:0;max-width:none;min-height:28px;height:auto}
.flow-page h1{font-size:14px;line-height:1.4;margin:0;min-width:0}
.flow-page .subtitle{font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.flow-page .toolbar{gap:5px;margin:0;flex-wrap:wrap}
.flow-page .search{min-width:70px;flex:1;max-width:none}
.flow-page button{white-space:nowrap;padding:3px 8px}
.flow-page :is(.flow-topbar button,#call-menu>summary,.cfg-zoom button,.call-zoom button,.cfg-overview-close){min-width:24px;min-height:24px}
.flow-page .zoom-step{min-width:28px;font-size:16px;padding:0 7px}
.flow-page #graph-zoom{min-width:51px;font-variant-numeric:tabular-nums}
.flow-page #filter-status,.flow-page .scope{margin:0;padding:4px 12px;font-size:11px;line-height:1.35;overflow-wrap:anywhere;border-bottom:1px solid var(--vscode-panel-border);background:var(--vscode-editor-background)}
.flow-page .selection-tools{flex-wrap:wrap;padding-bottom:6px}
.flow-page .flow-canvas,.flow-page .call-columns{grid-row:4;min-height:0}
.flow-page .flow-canvas{position:relative;width:100%;height:100%;min-height:0;overflow:hidden;cursor:grab;touch-action:none;border-radius:0;background:var(--vscode-sideBar-background,var(--vscode-editor-background))}
.flow-canvas.panning,.flow-canvas.panning .graph-node{cursor:grabbing}
.flow-canvas svg{display:block;width:100%;height:100%;overflow:hidden;user-select:none}
.flow-canvas .graph-cards{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:1}
.flow-canvas .graph-card-world{position:absolute;left:0;top:0;width:4096px;height:0;overflow:visible;transform-origin:0 0;pointer-events:none}
.flow-canvas div.graph-node{position:absolute;pointer-events:auto;box-sizing:border-box;user-select:none}
.flow-canvas .graph-node{outline:none;box-shadow:none;background:none}
.flow-canvas .cfg-node{display:flex;flex-direction:column;width:max-content;min-width:220px;max-width:540px;border:1px solid var(--vscode-contrastBorder,var(--vscode-editorWidget-border,var(--vscode-panel-border)));border-radius:8px;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground,var(--vscode-foreground))}
.flow-canvas .cfg-node .block-header{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;padding:7px 12px;border-bottom:1px solid var(--vscode-panel-border);border-radius:7px 7px 0 0;background:color-mix(in srgb,var(--vscode-foreground) 7%,var(--vscode-editor-background))}
.flow-canvas .cfg-node .block-body{display:flex;flex-direction:column;gap:2px;padding:8px 12px 10px;min-width:0}
.flow-canvas .cfg-node .node-title{color:var(--vscode-foreground);min-width:0;overflow-wrap:anywhere}
.flow-canvas .cfg-node .node-subtitle{color:var(--ghidra-muted);overflow-wrap:anywhere}
.flow-canvas .cfg-node .node-line{color:var(--vscode-editor-foreground,var(--vscode-foreground));white-space:pre-wrap;overflow-wrap:anywhere;min-width:0}
.flow-canvas .graph-node .block-body{fill:var(--vscode-editor-background);stroke:var(--vscode-editorWidget-border,var(--vscode-panel-border));stroke-width:1.2}
.flow-canvas .graph-node .block-header{fill:var(--vscode-editor-inactiveSelectionBackground,var(--vscode-list-inactiveSelectionBackground));stroke:none}
.flow-canvas .graph-node.selected .block-body,.flow-canvas .graph-node:focus-visible .block-body{stroke:var(--ghidra-active-border);stroke-width:2.5}
.flow-canvas .graph-node:hover .block-body,.flow-canvas .graph-node.search-match .block-body{stroke:var(--ghidra-focus);stroke-width:2}
.flow-canvas .node-title{font:600 13px var(--vscode-editor-font-family,monospace);font-variant-numeric:tabular-nums}
.flow-canvas .node-subtitle{font-size:11px;fill:var(--ghidra-muted)}
.flow-canvas .cfg-entry-badge{font-size:11px;font-weight:600;fill:var(--ghidra-accent)}
.flow-canvas .node-line{font:14px var(--vscode-editor-font-family,monospace);font-variant-numeric:tabular-nums;fill:var(--vscode-editor-foreground,var(--vscode-foreground));white-space:pre}
.flow-canvas .tok-mnemonic{font-weight:600}
.flow-page .taken{color:var(--vscode-charts-green,#5fa77f)}
.flow-page .fallthrough{color:var(--vscode-charts-red,#e47777)}
.flow-page .flow{color:var(--vscode-charts-blue,#64a8eb)}
.flow-canvas .edge{stroke:currentColor;stroke-width:1.6;stroke-linejoin:round;fill:none}
.flow-canvas .fallthrough .edge{stroke-dasharray:7 4}
.flow-canvas .backward .edge{stroke-dasharray:3 3}
.flow-canvas .fallthrough.backward .edge{stroke-dasharray:8 3 2 3}
.flow-canvas .cfg-edge-badge{pointer-events:none}
.flow-canvas .cfg-edge-badge rect{fill:var(--vscode-editor-background);stroke:currentColor;stroke-width:1.5;vector-effect:non-scaling-stroke}
.flow-canvas .cfg-edge-badge text{font:700 10px var(--vscode-editor-font-family,monospace);fill:currentColor}
.flow-canvas .cfg-edge.dimmed{opacity:.55}
.flow-canvas .cfg-edge.connected .edge{stroke-width:2.5}
#cfg-arrow-taken path{fill:var(--vscode-charts-green,#5fa77f);fill:context-stroke}
#cfg-arrow-fallthrough path{fill:var(--vscode-charts-red,#e47777);fill:context-stroke}
#cfg-arrow-flow path{fill:var(--vscode-charts-blue,#64a8eb);fill:context-stroke}
.flow-canvas .cfg-node .cfg-entry-badge{padding:0 6px;border:1px solid currentColor;border-radius:999px}
.flow-canvas .cfg-node:is(:hover,.search-match,.edge-endpoint):not(.selected):not(:focus-visible){border-color:var(--ghidra-focus);outline:1px solid var(--ghidra-focus);outline-offset:0}
.flow-canvas .cfg-node:is(.selected,:focus-visible){background:var(--vscode-editor-background);color:var(--vscode-editor-foreground,var(--vscode-foreground));border-color:var(--ghidra-active-border);outline:2px solid var(--ghidra-active-border);outline-offset:0;box-shadow:none}
body.flow-page.vscode-high-contrast .taken{color:#89d185}
body.flow-page.vscode-high-contrast .fallthrough{color:#f48771}
body.flow-page.vscode-high-contrast .flow{color:#75beff}
body.flow-page.vscode-high-contrast-light .taken{color:#136324}
body.flow-page.vscode-high-contrast-light .fallthrough{color:#a61b0b}
body.flow-page.vscode-high-contrast-light .flow{color:#0f4a85}
body.flow-page:is(.vscode-high-contrast,.vscode-high-contrast-light) .flow-canvas .cfg-edge{opacity:1!important}
body.flow-page:is(.vscode-high-contrast,.vscode-high-contrast-light) .flow-canvas .cfg-node{background:var(--vscode-editor-background);color:var(--vscode-foreground);border:1.5px solid var(--ghidra-hv-border)}
body.flow-page:is(.vscode-high-contrast,.vscode-high-contrast-light) .flow-canvas .cfg-node .block-header{background:var(--vscode-editor-background);border-bottom:1px solid var(--ghidra-hv-border)}
body.flow-page:is(.vscode-high-contrast,.vscode-high-contrast-light) .flow-canvas .cfg-node:is(.selected,:focus-visible){background:var(--vscode-editor-background);color:var(--vscode-foreground);border-color:var(--ghidra-active-border);outline:2px solid var(--ghidra-active-border);outline-offset:0}
body.flow-page:is(.vscode-high-contrast,.vscode-high-contrast-light) .flow-canvas .cfg-node :is(.node-title,.node-subtitle,.cfg-entry-badge,.node-line){color:var(--vscode-foreground)}
body.flow-page:is(.vscode-high-contrast,.vscode-high-contrast-light) .flow-canvas svg .graph-node .block-body{stroke:var(--ghidra-hv-border);stroke-width:1.5}
body.flow-page:is(.vscode-high-contrast,.vscode-high-contrast-light) .flow-canvas svg .graph-node .block-header{fill:var(--vscode-editor-background);stroke:var(--ghidra-hv-border);stroke-width:1}
body.flow-page:is(.vscode-high-contrast,.vscode-high-contrast-light) :is(.flow-canvas svg .graph-node.selected .block-body,.flow-canvas svg .graph-node:focus-visible .block-body){stroke:var(--ghidra-active-border);stroke-width:2.5}
body.flow-page:is(.vscode-high-contrast,.vscode-high-contrast-light) .flow-canvas svg :is(.node-title,.node-subtitle,.cfg-entry-badge,.node-line){fill:var(--vscode-foreground)}
@media(prefers-contrast:more){
  .flow-canvas .cfg-node{border:1.5px solid var(--ghidra-hv-border)}
  .flow-canvas .cfg-node .block-header{border-bottom-color:var(--ghidra-hv-border)}
  .flow-canvas svg .graph-node .block-body{stroke:var(--ghidra-hv-border);stroke-width:1.5}
}
@media(forced-colors:active){
  .flow-page .flow-canvas{background:var(--ghidra-selection-bg)}
  .flow-canvas .cfg-node{background:var(--ghidra-selection-bg);color:var(--ghidra-selection-fg);border:1.5px solid var(--ghidra-hv-border);forced-color-adjust:none}
  .flow-canvas .cfg-node .block-header,.flow-canvas .cfg-node.selected .block-header{background:var(--ghidra-selection-bg);color:var(--ghidra-selection-fg);border-bottom:1px solid var(--ghidra-hv-border)}
  .flow-canvas .cfg-node:is(.selected,:focus-visible,.search-match,.edge-endpoint){background:var(--ghidra-active-selection-bg);color:var(--ghidra-active-selection-fg);border-color:var(--ghidra-active-border);outline:2px solid var(--ghidra-active-border);outline-offset:0}
  .flow-canvas .cfg-node :is(.node-title,.node-subtitle,.cfg-entry-badge,.node-line){color:var(--ghidra-selection-fg)}
  .flow-canvas svg .graph-node .block-body{fill:var(--ghidra-selection-bg);stroke:var(--ghidra-hv-border);stroke-width:1.5}
  .flow-canvas svg .graph-node .block-header{fill:var(--ghidra-selection-bg);stroke:var(--ghidra-hv-border);stroke-width:1}
  .flow-canvas svg .graph-node.selected .block-body,.flow-canvas svg .graph-node:focus-visible .block-body,.flow-canvas svg .graph-node.edge-endpoint .block-body{fill:var(--ghidra-active-selection-bg);stroke:var(--ghidra-active-border);stroke-width:2.5}
  .flow-canvas svg .graph-node text,.flow-canvas svg .graph-node tspan,.flow-canvas svg .node-title,.flow-canvas svg .node-subtitle,.flow-canvas svg .cfg-entry-badge,.flow-canvas svg .node-line{fill:var(--ghidra-selection-fg)!important}
  .flow-page .cfg-edge,.flow-page .taken,.flow-page .fallthrough,.flow-page .flow{color:var(--ghidra-selection-fg);opacity:1!important}
  .flow-page .cfg-edge.is-active,.flow-page .cfg-edge.is-hovered,.flow-page .cfg-edge:focus-visible{color:var(--ghidra-active-border);opacity:1!important}
  #cfg-arrow-taken path,#cfg-arrow-fallthrough path,#cfg-arrow-flow path{fill:var(--ghidra-selection-fg);fill:context-stroke}
  .flow-canvas .cfg-edge-badge rect{fill:var(--ghidra-selection-bg);stroke:var(--ghidra-selection-fg)}
  .flow-canvas .cfg-edge-badge text{fill:var(--ghidra-selection-fg)!important}
  .flow-page .cfg-edge.is-active .cfg-edge-badge rect,.flow-page .cfg-edge.is-hovered .cfg-edge-badge rect,.flow-page .cfg-edge:focus-visible .cfg-edge-badge rect{stroke:var(--ghidra-active-border)}
}
@media(max-width:640px){
  .flow-page .flow-topbar{padding:6px 8px;gap:4px 6px}
  .flow-page #filter-status,.flow-page .scope{padding:3px 8px;font-size:11px}
}
@media(max-height:420px){
  .flow-page .flow-topbar{padding:4px 8px;gap:3px 6px}
  .flow-page #filter-status,.flow-page .scope{padding:2px 8px;font-size:10px;line-height:1.25;max-height:24px;overflow-y:auto}
}
`;

/** Runs inside the existing nonce-protected page and uses its persisted view state. */
export const controlFlowScript = String.raw`
    graphViewport=(()=>{
      const canvas=document.querySelector('[data-control-flow],[data-call-graph]');if(!canvas){return undefined}
      const svg=canvas.querySelector('svg'),world=svg.querySelector('.graph-world'),cardWorld=canvas.querySelector('.graph-card-world');
      const width=Number(svg.dataset.width),height=Number(svg.dataset.height);
      const saved=samePage?previous.graphViewport:undefined;
      const restored=saved&&[saved.scale,saved.x,saved.y].every(Number.isFinite)&&saved.scale>0;
      let scale=restored?saved.scale:1,x=restored?saved.x:0,y=restored?saved.y:24,fitted=!!(restored&&saved.fitted),drag;
      let suppressClick=false,firstHighlight=true;
      // Keep both graphs reachable; small CFGs may still be panned inside the viewport.
      const panBounds=()=>{const overview=canvas.querySelector('.call-overview,.cfg-overview'),reserve=fitted&&overview?.open?overview.offsetWidth+20:0;const axis=(viewport,span)=>canvas.hasAttribute('data-control-flow')?{min:Math.min(80,span/2)-span,max:viewport-Math.min(80,span/2)}:({min:Math.min(18,viewport-span-18),max:Math.max(18,viewport-span-18)});return {x:axis(Math.max(1,canvas.clientWidth-reserve),width*scale),y:axis(canvas.clientHeight,height*scale)}};
      const update=()=>{const bounds=panBounds();if(bounds){x=Math.max(bounds.x.min,Math.min(bounds.x.max,x));y=Math.max(bounds.y.min,Math.min(bounds.y.max,y))}world.setAttribute('transform','translate('+x+','+y+') scale('+scale+')');if(cardWorld){cardWorld.style.transform='translate('+x+'px,'+y+'px) scale('+scale+')'}svg.dataset.zoom=String(scale);document.getElementById('graph-zoom').textContent=Math.round(scale*100)+'%';canvas.dispatchEvent(new CustomEvent('graph-viewport'));persist()};
      const fit=()=>{const overview=canvas.querySelector('.call-overview,.cfg-overview'),reserve=overview?.open?overview.offsetWidth+20:0,inset=18,bottom=canvas.hasAttribute('data-control-flow')?Math.min(58,Math.max(18,Math.floor(canvas.clientHeight*.3))):18;scale=Math.min(1,Math.max(1,canvas.clientWidth-reserve-36)/width,Math.max(1,canvas.clientHeight-inset-bottom)/height);x=(canvas.clientWidth-reserve-width*scale)/2;y=inset+(canvas.clientHeight-inset-bottom-height*scale)/2;fitted=true;update()};
      const zoom=(next,px=canvas.clientWidth/2,py=canvas.clientHeight/2)=>{next=Math.max(.05,Math.min(4,next));x=px-(px-x)*next/scale;y=py-(py-y)*next/scale;scale=next;fitted=false;update()};
      const reveal=node=>{const nx=Number(node.dataset.x),ny=Number(node.dataset.y),nw=Number(node.dataset.width),nh=Number(node.dataset.height);
        if(nx*scale+x>=16&&ny*scale+y>=16&&(nx+nw)*scale+x<=canvas.clientWidth-16&&(ny+nh)*scale+y<=canvas.clientHeight-16){return}
        x=(canvas.clientWidth-nw*scale)/2-nx*scale;y=Math.max(16,(canvas.clientHeight-nh*scale)/2)-ny*scale;fitted=false;update()};
      let searchIndex=-1;search.addEventListener('input',()=>{searchIndex=-1});
      search.addEventListener('keydown',event=>{if(event.key!=='Enter'){return}event.preventDefault();const matches=[...canvas.querySelectorAll('.graph-node.search-match')];if(matches.length){searchIndex=(searchIndex+1)%matches.length;reveal(matches[searchIndex])}});
      const select=(rows,follow)=>{const ids=new Set(rows.map(row=>row.dataset.node));svg.querySelectorAll('.cfg-edge,.call-edge').forEach(edge=>{const connected=ids.has(edge.dataset.from)||ids.has(edge.dataset.to);edge.classList.toggle('connected',connected);edge.classList.toggle('dimmed',ids.size>0&&!connected)});
        if(follow&&rows[0]&&!(firstHighlight&&restored)){reveal(rows[0])}if(follow){firstHighlight=false}};
      canvas.addEventListener('focusin',event=>{const node=event.target.closest('.graph-node');if(node?.matches(':focus-visible')){reveal(node)}});
      document.getElementById('graph-fit').addEventListener('click',fit);
      document.getElementById('graph-zoom').addEventListener('click',()=>zoom(1));
      document.getElementById('graph-zoom-in').addEventListener('click',()=>zoom(scale*1.2));
      document.getElementById('graph-zoom-out').addEventListener('click',()=>zoom(scale/1.2));
      canvas.addEventListener('wheel',event=>{event.preventDefault();const r=canvas.getBoundingClientRect();zoom(scale*Math.exp(-event.deltaY*(event.deltaMode===1?16:1)*.002),event.clientX-r.left,event.clientY-r.top)},{passive:false});
      canvas.addEventListener('pointerdown',event=>{suppressClick=false;if(event.target.closest('.call-overview,.cfg-overview,.call-node-controls,.cfg-node-controls')||event.button!==1&&(event.button!==0||event.target.closest('.graph-node'))){return}event.preventDefault();canvas.focus({preventScroll:true});canvas.setPointerCapture(event.pointerId);drag={id:event.pointerId,button:event.button,x:event.clientX,y:event.clientY,ox:x,oy:y}});
      canvas.addEventListener('pointermove',event=>{if(!drag||event.pointerId!==drag.id){return}const dx=event.clientX-drag.x,dy=event.clientY-drag.y;if(Math.hypot(dx,dy)>3){suppressClick=drag.button===0;canvas.classList.add('panning')}x=drag.ox+dx;y=drag.oy+dy;fitted=false;update()});
      const end=()=>{drag=undefined;canvas.classList.remove('panning')};canvas.addEventListener('pointerup',end);canvas.addEventListener('pointercancel',end);canvas.addEventListener('lostpointercapture',end);
      canvas.addEventListener('click',event=>{if(suppressClick){event.preventDefault();event.stopImmediatePropagation();suppressClick=false}},{capture:true});
      canvas.addEventListener('keydown',event=>{if(canUseSingleKeyShortcut(event,canvas)){if(event.key==='+'||event.key==='='){event.preventDefault();zoom(scale*1.2);return}if(event.key==='-'){event.preventDefault();zoom(scale/1.2);return}if(event.key==='0'){event.preventDefault();fit();return}}if(event.target===canvas&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();x+=event.key==='ArrowLeft'?50:event.key==='ArrowRight'?-50:0;y+=event.key==='ArrowUp'?50:event.key==='ArrowDown'?-50:0;fitted=false;update()}});
      let oldWidth=canvas.clientWidth,oldHeight=canvas.clientHeight;
      new ResizeObserver(()=>{if(fitted){fit()}else{x+=(canvas.clientWidth-oldWidth)/2;y+=(canvas.clientHeight-oldHeight)/2;update()}oldWidth=canvas.clientWidth;oldHeight=canvas.clientHeight}).observe(canvas);
      window.addEventListener('message',event=>{const msg=event.data||{};if(msg.action!=='graphLayout'||!Array.isArray(msg.edges)){return}const boxes=Array.isArray(msg.nodes)&&msg.nodes.length?msg.nodes:[...canvas.querySelectorAll('.graph-node')].map(n=>({x:Number(n.dataset.x)||0,y:Number(n.dataset.y)||0,width:Number(n.dataset.width)||0,height:Number(n.dataset.height)||0}));const placed=[],half=10,clear=(cx,cy)=>boxes.every(n=>cx+half<=n.x||cx-half>=n.x+n.width||cy+half<=n.y||cy-half>=n.y+n.height)&&placed.every(b=>Math.abs(cx-b.x)>=half*2||Math.abs(cy-b.y)>=half*2);for(const item of msg.edges){const edgeEl=svg.querySelector('[data-edge-index="'+Number(item.index)+'"]');if(!edgeEl){continue}if(typeof item.path==='string'){for(const p of edgeEl.querySelectorAll('path')){p.setAttribute('d',item.path)}}if(typeof item.backward==='boolean'){edgeEl.classList.toggle('backward',item.backward)}const badgeEl=edgeEl.querySelector('.cfg-edge-badge');if(!badgeEl){continue}let anchor=item.badge&&Number.isFinite(item.badge.x)&&Number.isFinite(item.badge.y)&&clear(item.badge.x,item.badge.y)?item.badge:undefined;if(!anchor){const pathEl=edgeEl.querySelector('path.edge'),total=pathEl?.getTotalLength?.()||0,start=Math.min(16,total/2),endAt=Math.max(start,total-16);for(let d=start;d<=endAt&&total>1;d+=6){const pt=pathEl.getPointAtLength(d),pt2=pathEl.getPointAtLength(Math.min(total,d+1)),dx=pt2.x-pt.x,dy=pt2.y-pt.y,len=Math.hypot(dx,dy)||1,nx=-dy/len,ny=dx/len;for(const off of [0,12,-12]){const cx=Math.round(pt.x+nx*off),cy=Math.round(pt.y+ny*off);if(clear(cx,cy)){anchor={x:cx,y:cy};break}}if(anchor){break}}}if(anchor){placed.push(anchor);badgeEl.removeAttribute('hidden');badgeEl.setAttribute('transform','translate('+anchor.x+','+anchor.y+')')}}});
      requestAnimationFrame(()=>{const anchor=samePage?previous.branchAnchor:undefined;if(restored&&anchor&&Number.isFinite(anchor.x)&&Number.isFinite(anchor.y)){const node=[...canvas.querySelectorAll('.call-node')].find(item=>item.dataset.entry===anchor.entry);if(node){x=anchor.x-(Number(node.dataset.x)+Number(node.dataset.width)/2)*scale;y=anchor.y-(Number(node.dataset.y)+Number(node.dataset.height)/2)*scale;fitted=false}}if(!restored){const first=canvas.querySelector('.is-root')||canvas.querySelector('.graph-node.selected')||canvas.querySelector('.graph-node');if(canvas.hasAttribute('data-call-graph')&&width<=canvas.clientWidth-36&&height<=canvas.clientHeight-36){fit()}else{x=first?(canvas.clientWidth-Number(first.dataset.width))/2-Number(first.dataset.x):(canvas.clientWidth-width)/2;y=(canvas.hasAttribute('data-call-graph')?(canvas.clientHeight-Number(first?.dataset.height||0))/2:24)-Number(first?.dataset.y||0)}}update();select([...canvas.querySelectorAll('.graph-node.selected')],false)});
      return {select,fit,center:(cx,cy)=>{x=canvas.clientWidth/2-cx*scale;y=canvas.clientHeight/2-cy*scale;fitted=false;update()},snapshot:()=>({scale,x,y,fitted,bounds:panBounds()})};
    })();
`;
