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
      let suppressClick=false,firstHighlight=true,pointerFocus=false;
      // Keep both graphs reachable; small graphs stay centered while edge controls can pan into view.
      const panBounds=()=>{const axis=(viewport,span)=>({min:Math.min(80,span/2)-span,max:viewport-Math.min(80,span/2)});return {x:axis(Math.max(1,canvas.clientWidth),width*scale),y:axis(Math.max(1,canvas.clientHeight),height*scale)}};
      const update=()=>{const bounds=panBounds();if(bounds){x=Math.max(bounds.x.min,Math.min(bounds.x.max,x));y=Math.max(bounds.y.min,Math.min(bounds.y.max,y))}world.setAttribute('transform','translate('+x+','+y+') scale('+scale+')');svg.dataset.zoom=String(scale);document.getElementById('graph-zoom').textContent=Math.round(scale*100)+'%';canvas.dispatchEvent(new CustomEvent('graph-viewport'));persist()};
      const fit=()=>{const inset=18;scale=Math.min(1,Math.max(1,canvas.clientWidth-inset*2)/width,Math.max(1,canvas.clientHeight-inset*2)/height);x=(canvas.clientWidth-width*scale)/2;y=(canvas.clientHeight-height*scale)/2;fitted=true;update()};
      const zoom=(next,px=canvas.clientWidth/2,py=canvas.clientHeight/2)=>{next=Math.max(.05,Math.min(4,next));x=px-(px-x)*next/scale;y=py-(py-y)*next/scale;scale=next;fitted=false;update()};
      const focusTarget=el=>el?.closest?.('.node-decompile,.node-branch,.cfg-edge,.call-edge,.graph-node');
      const itemBox=item=>{
        if(!item){return undefined}
        if(item.matches('.node-decompile,.node-branch')){
          const fo=item.closest('foreignObject'),host=item.closest('.graph-node');
          if(fo&&host){return {x:Number(host.dataset.x)+Number(fo.getAttribute('x')),y:Number(host.dataset.y)+Number(fo.getAttribute('y')),width:Number(fo.getAttribute('width')),height:Number(fo.getAttribute('height'))}}
        }
        if(item.classList.contains('graph-node')){return {x:Number(item.dataset.x),y:Number(item.dataset.y),width:Number(item.dataset.width),height:Number(item.dataset.height)}}
        const shape=item.querySelector?.('.edge')||item;
        if(shape?.getBBox){
          const b=shape.getBBox(),mid=shape.getPointAtLength&&shape.getTotalLength?shape.getPointAtLength(shape.getTotalLength()/2):{x:b.x+b.width/2,y:b.y+b.height/2};
          return {x:b.x,y:b.y,width:Math.max(1,b.width),height:Math.max(1,b.height),mx:mid.x,my:mid.y};
        }
        return undefined;
      };
      const reveal=item=>{
        const box=itemBox(item);if(!box){return}
        const pad=10,vw=canvas.clientWidth,vh=canvas.clientHeight,bw=box.width*scale,bh=box.height*scale;
        const fitsX=bw<=vw-pad*2,fitsY=bh<=vh-pad*2;
        const okX=fitsX?(box.x*scale+x>=pad&&(box.x+box.width)*scale+x<=vw-pad):(box.x*scale+x<=pad&&(box.x+box.width)*scale+x>=vw-pad&&(box.mx===undefined||(box.mx*scale+x>=pad&&box.mx*scale+x<=vw-pad)));
        const okY=fitsY?(box.y*scale+y>=pad&&(box.y+box.height)*scale+y<=vh-pad):(box.y*scale+y<=pad&&(box.y+box.height)*scale+y>=vh-pad&&(box.my===undefined||(box.my*scale+y>=pad&&box.my*scale+y<=vh-pad)));
        if(okX&&okY){return}
        if(!okX){x=fitsX?(vw-bw)/2-box.x*scale:Math.max(vw-pad-(box.x+box.width)*scale,Math.min(pad-box.x*scale,vw/2-(box.mx??box.x+box.width/2)*scale))}
        if(!okY){y=fitsY?Math.max(pad,(vh-bh)/2)-box.y*scale:Math.max(vh-pad-(box.y+box.height)*scale,Math.min(pad-box.y*scale,vh/2-(box.my??box.y+box.height/2)*scale))}
        fitted=false;update();
      };
      let searchIndex=-1;search.addEventListener('input',()=>{searchIndex=-1});
      search.addEventListener('keydown',event=>{if(event.key!=='Enter'){return}event.preventDefault();const matches=[...svg.querySelectorAll('.graph-node.search-match')];if(matches.length){searchIndex=(searchIndex+1)%matches.length;reveal(matches[searchIndex])}});
      const select=(rows,follow)=>{const ids=new Set(rows.map(row=>row.dataset.node));svg.querySelectorAll('.cfg-edge,.call-edge').forEach(edge=>{const connected=ids.has(edge.dataset.from)||ids.has(edge.dataset.to);edge.classList.toggle('connected',connected);edge.classList.toggle('dimmed',ids.size>0&&!connected)});
        const active=focusTarget(document.activeElement);if(follow&&rows[0]&&!(firstHighlight&&restored)&&(!active||rows.includes(active))){reveal(rows[0])}if(follow){firstHighlight=false}};
      canvas.addEventListener('pointerdown',()=>{pointerFocus=true;requestAnimationFrame(()=>{pointerFocus=false})},{capture:true});
      canvas.addEventListener('focusin',event=>{const item=focusTarget(event.target);if(item&&!pointerFocus){reveal(item)}});
      document.getElementById('graph-fit').addEventListener('click',fit);
      document.getElementById('graph-zoom').addEventListener('click',()=>zoom(1));
      document.getElementById('graph-zoom-in').addEventListener('click',()=>zoom(scale*1.2));
      document.getElementById('graph-zoom-out').addEventListener('click',()=>zoom(scale/1.2));
      canvas.addEventListener('wheel',event=>{event.preventDefault();const r=canvas.getBoundingClientRect();zoom(scale*Math.exp(-event.deltaY*(event.deltaMode===1?16:1)*.002),event.clientX-r.left,event.clientY-r.top)},{passive:false});
      canvas.addEventListener('pointerdown',event=>{suppressClick=false;if(event.target.closest('.call-node-controls,.cfg-node-controls')||event.button!==1&&(event.button!==0||event.target.closest('.graph-node'))){return}event.preventDefault();canvas.focus({preventScroll:true});canvas.setPointerCapture(event.pointerId);drag={id:event.pointerId,button:event.button,x:event.clientX,y:event.clientY,ox:x,oy:y}});
      canvas.addEventListener('pointermove',event=>{if(!drag||event.pointerId!==drag.id){return}const dx=event.clientX-drag.x,dy=event.clientY-drag.y;if(Math.hypot(dx,dy)>3){suppressClick=drag.button===0;canvas.classList.add('panning')}x=drag.ox+dx;y=drag.oy+dy;fitted=false;update()});
      const end=()=>{drag=undefined;canvas.classList.remove('panning')};canvas.addEventListener('pointerup',end);canvas.addEventListener('pointercancel',end);canvas.addEventListener('lostpointercapture',end);
      canvas.addEventListener('click',event=>{if(suppressClick){event.preventDefault();event.stopImmediatePropagation();suppressClick=false}},{capture:true});
      canvas.addEventListener('keydown',event=>{if(event.key==='+'||event.key==='='){event.preventDefault();zoom(scale*1.2)}else if(event.key==='-'){event.preventDefault();zoom(scale/1.2)}else if(event.key==='0'){event.preventDefault();fit()}else if(event.target===canvas&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();x+=event.key==='ArrowLeft'?50:event.key==='ArrowRight'?-50:0;y+=event.key==='ArrowUp'?50:event.key==='ArrowDown'?-50:0;fitted=false;update()}});
      let oldWidth=canvas.clientWidth,oldHeight=canvas.clientHeight;
      new ResizeObserver(()=>{if(fitted){fit()}else{x+=(canvas.clientWidth-oldWidth)/2;y+=(canvas.clientHeight-oldHeight)/2;update()}const active=focusTarget(document.activeElement);if(active){reveal(active)}oldWidth=canvas.clientWidth;oldHeight=canvas.clientHeight}).observe(canvas);
      requestAnimationFrame(()=>{const anchor=samePage?previous.branchAnchor:undefined;if(restored&&anchor&&Number.isFinite(anchor.x)&&Number.isFinite(anchor.y)){const node=[...svg.querySelectorAll('.call-node')].find(item=>item.dataset.entry===anchor.entry);if(node){x=anchor.x-(Number(node.dataset.x)+Number(node.dataset.width)/2)*scale;y=anchor.y-(Number(node.dataset.y)+Number(node.dataset.height)/2)*scale;fitted=false}}if(!restored){const first=svg.querySelector('.graph-node.selected')||svg.querySelector('.graph-node');if(canvas.hasAttribute('data-call-graph')&&width<=canvas.clientWidth-36&&height<=canvas.clientHeight-36){fit()}else{x=first?(canvas.clientWidth-Number(first.dataset.width))/2-Number(first.dataset.x):(canvas.clientWidth-width)/2;y=(canvas.hasAttribute('data-call-graph')?(canvas.clientHeight-Number(first?.dataset.height||0))/2:24)-Number(first?.dataset.y||0)}}update();select([...svg.querySelectorAll('.graph-node.selected')],false);const active=focusTarget(document.activeElement);if(active){reveal(active)}});
      return {select,fit,reveal,center:(cx,cy)=>{x=canvas.clientWidth/2-cx*scale;y=canvas.clientHeight/2-cy*scale;fitted=false;update()},snapshot:()=>({scale,x,y,fitted,bounds:panBounds()})};
    })();
`;
