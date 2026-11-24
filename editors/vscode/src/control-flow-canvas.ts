// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

/** Scoped to the CFG page; other workbench views keep their existing layout. */
export const controlFlowStyles = `
.flow-page{overflow:hidden}
.flow-page main{height:100vh;max-width:none;padding:10px 12px;display:flex;flex-direction:column;gap:8px}
.flow-page header{display:flex;align-items:baseline;gap:12px;padding:0;margin:0;border:0;min-width:0}
.flow-page h1{font-size:14px;line-height:1.5;margin:0;white-space:nowrap}
.flow-page .subtitle{font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.flow-page .toolbar{gap:5px;margin:0;flex-wrap:nowrap}
.flow-page .search{min-width:70px;flex:1;max-width:none}
.flow-page button{white-space:nowrap;padding:3px 8px}
.flow-page .zoom-step{min-width:28px;font-size:16px;padding:0 7px}
.flow-page #graph-zoom{min-width:51px;font-variant-numeric:tabular-nums}
.flow-page .scope{margin:0;font-size:11px;line-height:1.4}
.flow-page #filter-status{margin:0;font-size:11px}
.flow-page .selection-tools{flex-wrap:wrap;padding-bottom:6px}
.flow-page .flow-canvas{flex:1;min-height:120px;width:100%;overflow:hidden;cursor:grab;touch-action:none;border-radius:3px;background:var(--vscode-sideBar-background,var(--vscode-editor-background))}
.flow-canvas.panning,.flow-canvas.panning .graph-node{cursor:grabbing}
.flow-canvas svg{display:block;width:100%;height:100%;overflow:hidden;user-select:none}
.flow-canvas .graph-node{outline:none;box-shadow:none;background:none}
.flow-canvas .graph-node .block-body{fill:var(--vscode-editor-background);stroke:var(--vscode-editorWidget-border,var(--vscode-panel-border));stroke-width:1.2}
.flow-canvas .graph-node .block-header{fill:var(--vscode-editor-inactiveSelectionBackground,var(--vscode-list-inactiveSelectionBackground));stroke:none}
.flow-canvas .graph-node.selected .block-body,.flow-canvas .graph-node:focus-visible .block-body{stroke:var(--vscode-focusBorder);stroke-width:2.5}
.flow-canvas .graph-node:hover .block-body,.flow-canvas .graph-node.search-match .block-body{stroke:var(--vscode-focusBorder);stroke-width:2}
.flow-canvas .node-title{font:600 13px var(--vscode-editor-font-family,monospace);font-variant-numeric:tabular-nums}
.flow-canvas .node-subtitle{font-size:11px;fill:var(--vscode-descriptionForeground)}
.flow-canvas .cfg-entry-badge{font-size:11px;font-weight:600;fill:var(--vscode-textLink-foreground,var(--vscode-focusBorder))}
.flow-canvas .node-line{font:14px var(--vscode-editor-font-family,monospace);font-variant-numeric:tabular-nums;fill:var(--vscode-editor-foreground,var(--vscode-foreground));white-space:pre}
.flow-canvas .tok-mnemonic{font-weight:600}
.flow-page .taken{color:var(--vscode-charts-green,#5fa77f)}
.flow-page .fallthrough{color:var(--vscode-charts-red,#e47777)}
.flow-page .flow{color:var(--vscode-charts-blue,#64a8eb)}
.flow-canvas .edge{stroke:currentColor;stroke-width:1.6;stroke-linejoin:round;fill:none}
.flow-canvas .backward .edge{stroke-dasharray:5 3}
.flow-canvas .cfg-edge.dimmed{opacity:.55}
.flow-canvas .cfg-edge.connected .edge{stroke-width:2.5}
.flow-canvas .graph-focus-halo{fill:none;stroke:none;opacity:0;pointer-events:none;vector-effect:non-scaling-stroke}
.flow-canvas .graph-node.is-focused .graph-focus-halo{opacity:1;stroke:var(--vscode-focusBorder);stroke-width:2.8;stroke-dasharray:6 3}
.flow-canvas .graph-node.is-edge-focus-endpoint .block-body,.flow-canvas .graph-node.is-edge-focus-endpoint .call-node-body{stroke:var(--vscode-focusBorder);stroke-width:2}
.flow-canvas .edge-focus-halo{fill:none;stroke:none;opacity:0;pointer-events:none;vector-effect:non-scaling-stroke;stroke-linecap:round;stroke-linejoin:round}
.flow-canvas .is-focused>.edge-focus-halo{opacity:.42;stroke:var(--vscode-focusBorder);stroke-width:9}
.flow-canvas .is-focused>.edge{stroke-width:3;opacity:1!important}
#cfg-arrow-taken path{fill:var(--vscode-charts-green,#5fa77f)}
#cfg-arrow-fallthrough path{fill:var(--vscode-charts-red,#e47777)}
#cfg-arrow-flow path{fill:var(--vscode-charts-blue,#64a8eb)}
`;

/** Runs inside the existing nonce-protected page and uses its persisted view state. */
export const controlFlowScript = String.raw`
    graphViewport=(()=>{
      const canvas=document.querySelector('[data-control-flow],[data-call-graph]');if(!canvas){return undefined}
      const svg=canvas.querySelector('svg'),world=svg.querySelector('.graph-world');
      const width=Number(svg.dataset.width),height=Number(svg.dataset.height);
      const saved=samePage?previous.graphViewport:undefined;
      const restored=saved&&[saved.scale,saved.x,saved.y].every(Number.isFinite)&&saved.scale>0;
      let scale=restored?saved.scale:1,x=restored?saved.x:0,y=restored?saved.y:24,fitted=!!(restored&&saved.fitted),drag;
      let suppressClick=false,firstHighlight=true;
      // Keep both graphs reachable; small CFGs may still be panned inside the viewport.
      const panBounds=()=>{const overview=canvas.querySelector('.call-overview,.cfg-overview'),reserve=fitted&&overview?.open?overview.offsetWidth+20:0;const axis=(viewport,span)=>canvas.hasAttribute('data-control-flow')?{min:Math.min(80,span/2)-span,max:viewport-Math.min(80,span/2)}:({min:Math.min(18,viewport-span-18),max:Math.max(18,viewport-span-18)});return {x:axis(Math.max(1,canvas.clientWidth-reserve),width*scale),y:axis(canvas.clientHeight,height*scale)}};
      const update=()=>{const bounds=panBounds();if(bounds){x=Math.max(bounds.x.min,Math.min(bounds.x.max,x));y=Math.max(bounds.y.min,Math.min(bounds.y.max,y))}world.setAttribute('transform','translate('+x+','+y+') scale('+scale+')');svg.dataset.zoom=String(scale);const zoomBtn=document.getElementById('graph-zoom'),pct=Math.round(scale*100)+'%';if(zoomBtn){zoomBtn.textContent=pct;zoomBtn.setAttribute('aria-label',pct+', reset zoom');zoomBtn.title=pct+' · Actual size (100%)'}canvas.dispatchEvent(new CustomEvent('graph-viewport'));persist()};
      const fit=()=>{const overview=canvas.querySelector('.call-overview,.cfg-overview'),reserve=overview?.open?overview.offsetWidth+20:0,inset=18,bottom=canvas.hasAttribute('data-control-flow')?58:18;scale=Math.min(1,Math.max(1,canvas.clientWidth-reserve-36)/width,Math.max(1,canvas.clientHeight-inset-bottom)/height);x=(canvas.clientWidth-reserve-width*scale)/2;y=inset+(canvas.clientHeight-inset-bottom-height*scale)/2;fitted=true;update()};
      const zoom=(next,px=canvas.clientWidth/2,py=canvas.clientHeight/2)=>{next=Math.max(.05,Math.min(4,next));x=px-(px-x)*next/scale;y=py-(py-y)*next/scale;scale=next;fitted=false;update()};
      const reveal=node=>{if(!node){return}const nx=Number(node.dataset.x),ny=Number(node.dataset.y),nw=Number(node.dataset.width),nh=Number(node.dataset.height);
        if(![nx,ny,nw,nh].every(Number.isFinite)){return}
        if(nx*scale+x>=16&&ny*scale+y>=16&&(nx+nw)*scale+x<=canvas.clientWidth-16&&(ny+nh)*scale+y<=canvas.clientHeight-16){return}
        x=(canvas.clientWidth-nw*scale)/2-nx*scale;y=Math.max(16,(canvas.clientHeight-nh*scale)/2)-ny*scale;fitted=false;update()};
      const focusItem=item=>{if(!item){return}const nx=Number(item.dataset.x),ny=Number(item.dataset.y),nw=Number(item.dataset.width),nh=Number(item.dataset.height);
        if(![nx,ny,nw,nh].every(Number.isFinite)){return}
        x=(canvas.clientWidth-nw*scale)/2-nx*scale;y=Math.max(16,(canvas.clientHeight-nh*scale)/2)-ny*scale;fitted=false;update()};
      let searchIndex=-1;search.addEventListener('input',()=>{searchIndex=-1});
      search.addEventListener('keydown',event=>{if(event.key!=='Enter'){return}event.preventDefault();const matches=[...svg.querySelectorAll('.graph-node.search-match')];if(matches.length){searchIndex=(searchIndex+1)%matches.length;reveal(matches[searchIndex])}});
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
      canvas.addEventListener('keydown',event=>{if(event.key==='+'||event.key==='='){event.preventDefault();zoom(scale*1.2)}else if(event.key==='-'){event.preventDefault();zoom(scale/1.2)}else if(event.key==='0'){event.preventDefault();fit()}else if(event.target===canvas&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();x+=event.key==='ArrowLeft'?50:event.key==='ArrowRight'?-50:0;y+=event.key==='ArrowUp'?50:event.key==='ArrowDown'?-50:0;fitted=false;update()}});
      let oldWidth=canvas.clientWidth,oldHeight=canvas.clientHeight;
      new ResizeObserver(()=>{if(fitted){fit()}else{x+=(canvas.clientWidth-oldWidth)/2;y+=(canvas.clientHeight-oldHeight)/2;update()}oldWidth=canvas.clientWidth;oldHeight=canvas.clientHeight}).observe(canvas);
      requestAnimationFrame(()=>{const anchor=samePage?previous.branchAnchor:undefined;if(restored&&anchor&&Number.isFinite(anchor.x)&&Number.isFinite(anchor.y)){const node=[...svg.querySelectorAll('.call-node')].find(item=>item.dataset.entry===anchor.entry);if(node){x=anchor.x-(Number(node.dataset.x)+Number(node.dataset.width)/2)*scale;y=anchor.y-(Number(node.dataset.y)+Number(node.dataset.height)/2)*scale;fitted=false}}if(!restored){const first=svg.querySelector('.graph-node.selected')||svg.querySelector('.graph-node');if(canvas.hasAttribute('data-call-graph')&&width<=canvas.clientWidth-36&&height<=canvas.clientHeight-36){fit()}else{x=first?(canvas.clientWidth-Number(first.dataset.width))/2-Number(first.dataset.x):(canvas.clientWidth-width)/2;y=(canvas.hasAttribute('data-call-graph')?(canvas.clientHeight-Number(first?.dataset.height||0))/2:24)-Number(first?.dataset.y||0)}}update();select([...svg.querySelectorAll('.graph-node.selected')],false)});
      return {select,fit,reveal,focusItem,center:(cx,cy)=>{x=canvas.clientWidth/2-cx*scale;y=canvas.clientHeight/2-cy*scale;fitted=false;update()},snapshot:()=>({scale,x,y,fitted,bounds:panBounds()})};
    })();
`;
