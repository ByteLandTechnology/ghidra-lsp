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
      const svg=canvas.querySelector('svg'),world=svg.querySelector('.graph-world'),host=canvas.closest('main')||document;
      const width=Number(svg.dataset.width),height=Number(svg.dataset.height);
      const saved=samePage?previous.graphViewport:undefined;
      const restored=saved&&[saved.scale,saved.x,saved.y].every(Number.isFinite)&&saved.scale>0;
      let scale=restored?saved.scale:1,x=restored?saved.x:0,y=restored?saved.y:24,fitted=!!(restored&&saved.fitted),drag;
      let suppressClick=false,firstHighlight=true,pointerFocus=false;
      // Subtract visible floating widgets to find clear viewport areas.
      const safeBoxes=()=>{
        const rect=canvas.getBoundingClientRect(),vw=canvas.clientWidth||rect.width,vh=canvas.clientHeight||rect.height,pad=12;
        const base={left:pad,top:pad,right:Math.max(pad+1,vw-pad),bottom:Math.max(pad+1,vh-pad)};
        let boxes=[base];
        for(const el of host.querySelectorAll('.cfg-zoom,.cfg-overview,.scope,.call-zoom,.call-overview,.call-details,#filter-status,.cfg-search,.call-search')){
          if(el.hidden||el.closest('[hidden]')){continue}
          const r=el.getBoundingClientRect();if(r.width<=0||r.height<=0){continue}
          const ox0=r.left-rect.left-8,oy0=r.top-rect.top-8,ox1=r.right-rect.left+8,oy1=r.bottom-rect.top+8,next=[];
          for(const b of boxes){
            if(ox1<=b.left||ox0>=b.right||oy1<=b.top||oy0>=b.bottom){next.push(b);continue}
            if(ox0>b.left){next.push({left:b.left,top:b.top,right:ox0,bottom:b.bottom})}
            if(ox1<b.right){next.push({left:ox1,top:b.top,right:b.right,bottom:b.bottom})}
            if(oy0>b.top){next.push({left:b.left,top:b.top,right:b.right,bottom:oy0})}
            if(oy1<b.bottom){next.push({left:b.left,top:oy1,right:b.right,bottom:b.bottom})}
          }
          boxes=next.filter(b=>b.right-b.left>=16&&b.bottom-b.top>=16).filter((a,i,arr)=>!arr.some((b,j)=>i!==j&&b.left<=a.left&&b.top<=a.top&&b.right>=a.right&&b.bottom>=a.bottom))
        }
        return boxes.length?boxes:[base]
      };
      const boxArea=b=>Math.max(0,b.right-b.left)*Math.max(0,b.bottom-b.top);
      const largestSafe=()=>safeBoxes().reduce((best,b)=>boxArea(b)>boxArea(best)?b:best);
      const bestSafe=(tw,th)=>safeBoxes().reduce((best,b)=>{const fitA=Math.min(b.right-b.left,tw)*Math.min(b.bottom-b.top,th),fitB=Math.min(best.right-best.left,tw)*Math.min(best.bottom-best.top,th);return fitA>fitB+.5||Math.abs(fitA-fitB)<=.5&&boxArea(b)>boxArea(best)?b:best});
      const panBounds=()=>{const boxes=safeBoxes(),sLeft=Math.min(...boxes.map(b=>b.left)),sRight=Math.max(...boxes.map(b=>b.right)),sTop=Math.min(...boxes.map(b=>b.top)),sBottom=Math.max(...boxes.map(b=>b.bottom)),minW=Math.min(...boxes.map(b=>b.right-b.left)),minH=Math.min(...boxes.map(b=>b.bottom-b.top));const axis=(sMin,sMax,minSpan,span)=>{const keep=Math.min(24,span/2,Math.max(1,minSpan)/2);return {min:sMin+keep-span-8,max:sMax-keep+8}};return {x:axis(sLeft,sRight,minW,width*scale),y:axis(sTop,sBottom,minH,height*scale)}};
      const update=()=>{const bounds=panBounds();if(bounds){x=Math.max(bounds.x.min,Math.min(bounds.x.max,x));y=Math.max(bounds.y.min,Math.min(bounds.y.max,y))}world.setAttribute('transform','translate('+x+','+y+') scale('+scale+')');svg.dataset.zoom=String(scale);document.getElementById('graph-zoom').textContent=Math.round(scale*100)+'%';canvas.dispatchEvent(new CustomEvent('graph-viewport'));persist()};
      const fit=()=>{const safe=largestSafe(),sw=Math.max(1,safe.right-safe.left),sh=Math.max(1,safe.bottom-safe.top);scale=Math.min(1,sw/width,sh/height);x=safe.left+(sw-width*scale)/2;y=safe.top+(sh-height*scale)/2;fitted=true;update()};
      const zoom=(next,px=canvas.clientWidth/2,py=canvas.clientHeight/2)=>{next=Math.max(.05,Math.min(4,next));x=px-(px-x)*next/scale;y=py-(py-y)*next/scale;scale=next;fitted=false;update()};
      const boundsOf=item=>{
        if(!item||!world.contains(item)){return undefined}
        const fo=item.closest('foreignObject');
        if(fo){const node=fo.closest('.graph-node');return {x:Number(node?.dataset.x||0)+Number(fo.getAttribute('x')||0),y:Number(node?.dataset.y||0)+Number(fo.getAttribute('y')||0),width:Math.max(4,Number(fo.getAttribute('width')||0)),height:Math.max(4,Number(fo.getAttribute('height')||0))}}
        if(item.classList.contains('graph-node')){return {x:Number(item.dataset.x),y:Number(item.dataset.y),width:Number(item.dataset.width),height:Number(item.dataset.height)}}
        if(typeof item.getBBox==='function'){try{const box=item.getBBox(),path=item.querySelector('path.edge'),len=path&&typeof path.getTotalLength==='function'?path.getTotalLength():0,anchor=len>0?path.getPointAtLength(len/2):undefined,w=Math.max(8,box.width),h=Math.max(8,box.height);return {x:box.x-(w-box.width)/2,y:box.y-(h-box.height)/2,width:w,height:h,anchor}}catch{return undefined}}
        return undefined
      };
      const focusSelector='.node-decompile,.node-branch,.cfg-edge,.call-edge,.graph-node';
      const reveal=(item=canvas.contains(document.activeElement)?document.activeElement.closest(focusSelector):svg.querySelector('.graph-node.selected'))=>{
        if(drag){return}
        const target=boundsOf(item);if(!target){return}
        const tw=target.width*scale,th=target.height*scale,sx0=target.x*scale+x,sx1=sx0+tw,sy0=target.y*scale+y,sy1=sy0+th;
        if(safeBoxes().some(b=>sx0>=b.left&&sx1<=b.right&&sy0>=b.top&&sy1<=b.bottom)){return}
        const safe=bestSafe(tw,th),bw=safe.right-safe.left,bh=safe.bottom-safe.top;
        const ax=tw<=bw||!target.anchor?target.x+target.width/2:target.anchor.x;
        const ay=th<=bh||!target.anchor?target.y+target.height/2:target.anchor.y;
        const nx=(safe.left+safe.right)/2-ax*scale,ny=(safe.top+safe.bottom)/2-ay*scale;
        if(Math.abs(nx-x)<.5&&Math.abs(ny-y)<.5){return}
        x=nx;y=ny;fitted=false;update()
      };
      let searchIndex=-1;search.addEventListener('input',()=>{searchIndex=-1});
      search.addEventListener('keydown',event=>{if(event.key!=='Enter'){return}event.preventDefault();const matches=[...svg.querySelectorAll('.graph-node.search-match')];if(matches.length){searchIndex=(searchIndex+1)%matches.length;reveal(matches[searchIndex])}});
      const select=(rows,follow)=>{const ids=new Set(rows.map(row=>row.dataset.node));svg.querySelectorAll('.cfg-edge,.call-edge').forEach(edge=>{const connected=ids.has(edge.dataset.from)||ids.has(edge.dataset.to);edge.classList.toggle('connected',connected);edge.classList.toggle('dimmed',ids.size>0&&!connected)});
        if(follow&&rows[0]&&!(firstHighlight&&restored)){reveal(rows[0])}if(follow){firstHighlight=false}};
      document.addEventListener('pointerdown',()=>{pointerFocus=true;requestAnimationFrame(()=>{pointerFocus=false})},true);
      document.addEventListener('keydown',event=>{if(!['Control','Shift','Alt','Meta'].includes(event.key)){pointerFocus=false}},true);
      canvas.addEventListener('focusin',event=>{const item=event.target.closest(focusSelector);if(item&&(!pointerFocus||item.matches?.(':focus-visible'))){reveal(item)}});
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
      requestAnimationFrame(()=>{const anchor=samePage?previous.branchAnchor:undefined;if(restored&&anchor&&Number.isFinite(anchor.x)&&Number.isFinite(anchor.y)){const node=[...svg.querySelectorAll('.call-node')].find(item=>item.dataset.entry===anchor.entry);if(node){x=anchor.x-(Number(node.dataset.x)+Number(node.dataset.width)/2)*scale;y=anchor.y-(Number(node.dataset.y)+Number(node.dataset.height)/2)*scale;fitted=false}}if(!restored){const safe=largestSafe(),sw=safe.right-safe.left,sh=safe.bottom-safe.top,first=svg.querySelector('.graph-node.selected')||svg.querySelector('.graph-node');if(canvas.hasAttribute('data-call-graph')&&width<=sw&&height<=sh){fit()}else{x=first?safe.left+(sw-Number(first.dataset.width))/2-Number(first.dataset.x):safe.left+(sw-width)/2;y=(canvas.hasAttribute('data-call-graph')?safe.top+(sh-Number(first?.dataset.height||0))/2:Math.max(safe.top,24))-Number(first?.dataset.y||0)}}update();select([...svg.querySelectorAll('.graph-node.selected')],false)});
      return {select,fit,reveal,center:(cx,cy)=>{x=canvas.clientWidth/2-cx*scale;y=canvas.clientHeight/2-cy*scale;fitted=false;update()},snapshot:()=>({scale,x,y,fitted,bounds:panBounds()})};
    })();
`;
