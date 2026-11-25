// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

/** Shared styles for control-flow, call-graph, and call-column pages. */
export const controlFlowStyles = `
.flow-page{overflow:hidden;overflow:clip}
.flow-page main{height:100vh;max-width:none;padding:0;margin:0;position:relative;display:grid;grid-template-columns:minmax(0,1fr);grid-template-rows:auto auto auto minmax(0,1fr);gap:0}
.flow-page .flow-topbar{grid-row:1;position:relative;z-index:4;display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:6px 8px;padding:8px 14px;min-width:0;border-bottom:1px solid var(--vscode-panel-border);background:var(--vscode-editor-background)}
.flow-page .flow-topbar:not(:has(.flow-topbar-controls)){grid-template-columns:minmax(0,1fr) auto}
.flow-page .flow-topbar-primary{display:flex;align-items:center;gap:8px;min-width:0}
.flow-page .flow-topbar-controls,.flow-page .flow-topbar-actions{display:flex;align-items:center;flex-wrap:wrap;gap:4px;min-width:0}
.flow-page .flow-topbar-actions{justify-self:end}
.flow-page .flow-search{grid-column:1/-1;min-width:0}
.flow-page .flow-search input{width:100%;min-width:0;max-width:none;min-height:28px;height:auto}
.flow-page h1{font-size:14px;line-height:1.4;margin:0;min-width:0}
.flow-page .subtitle{font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.flow-page .toolbar{gap:5px;margin:0;flex-wrap:wrap}
.flow-page .search{min-width:70px;flex:1;max-width:none}
.flow-page button{white-space:nowrap;padding:3px 8px}
.flow-page :is(button:not(.link),#call-menu>summary,.cfg-overview-close){min-width:24px;min-height:24px}
.flow-page .zoom-step{min-width:28px;font-size:16px;padding:0 7px}
.flow-page #graph-zoom{min-width:51px;font-variant-numeric:tabular-nums}
.flow-page #filter-status{grid-row:2;margin:0;padding:4px 12px;font-size:11px;line-height:1.4;border-bottom:1px solid var(--vscode-panel-border);background:var(--vscode-editor-background);color:var(--vscode-foreground)}
.flow-page .scope{grid-row:3;margin:0;padding:4px 12px;font-size:11px;line-height:1.4;border-bottom:1px solid var(--vscode-panel-border);background:var(--vscode-editor-background);color:var(--ghidra-muted)}
.flow-page .selection-tools{flex-wrap:wrap;padding-bottom:6px}
.flow-page .flow-canvas,.flow-page .call-columns,.flow-page main>.empty,.flow-page main>.error{grid-row:4;min-width:0;min-height:0}
.flow-page .flow-canvas{position:relative;width:100%;height:100%;overflow:hidden;overflow:clip;cursor:grab;touch-action:none;border:0;border-radius:0;background:var(--vscode-editor-background)}
.flow-canvas.panning,.flow-canvas.panning .graph-node{cursor:grabbing}
.flow-canvas>svg{display:block;width:100%;height:100%;overflow:visible;user-select:none}
.flow-canvas .graph-cards{position:absolute;inset:0;overflow:hidden;overflow:clip;pointer-events:none;z-index:1}
.flow-canvas .graph-card-world{position:absolute;left:0;top:0;width:4096px;height:0;overflow:visible;transform-origin:0 0;pointer-events:none}
.flow-canvas .graph-node{position:absolute;pointer-events:auto;box-sizing:border-box;outline:none;box-shadow:none;user-select:none}
.flow-canvas .cfg-node{display:flex;flex-direction:column;width:max-content;min-width:220px;max-width:540px;border:1px solid var(--vscode-contrastBorder,var(--vscode-editorWidget-border,var(--vscode-panel-border)));border-radius:8px;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground,var(--vscode-foreground))}
.flow-canvas .cfg-node .block-header{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;padding:7px 12px;border-bottom:1px solid var(--vscode-panel-border);border-radius:7px 7px 0 0;background:color-mix(in srgb,var(--vscode-foreground) 7%,var(--vscode-editor-background))}
.flow-canvas .cfg-node .block-body{display:flex;flex-direction:column;gap:2px;padding:8px 12px 10px;min-width:0}
.flow-canvas .cfg-node:hover,.flow-canvas .cfg-node.search-match,.flow-canvas .cfg-node.edge-endpoint{border-color:var(--ghidra-focus);outline:1px solid var(--ghidra-focus);outline-offset:0}
.flow-canvas .cfg-node.selected,.flow-canvas .cfg-node:focus-visible{background:var(--vscode-editor-background);color:var(--vscode-editor-foreground,var(--vscode-foreground));border-color:var(--ghidra-focus);outline:2px solid var(--ghidra-focus);outline-offset:0;box-shadow:none}
.flow-canvas .cfg-node.selected .block-header{background:color-mix(in srgb,var(--ghidra-focus) 12%,var(--vscode-editor-background))}
.flow-canvas .cfg-node .node-title{font:500 13px/1.35 var(--vscode-editor-font-family,monospace);font-variant-numeric:tabular-nums;color:var(--vscode-foreground);min-width:0;overflow-wrap:anywhere}
.flow-canvas .cfg-node .node-subtitle{font-size:11px;line-height:1.4;color:var(--ghidra-muted);overflow-wrap:anywhere}
.flow-canvas .cfg-node .cfg-entry-badge{flex-shrink:0;font-size:11px;line-height:1.35;font-weight:600;color:var(--ghidra-accent)}
.flow-canvas .cfg-node .node-line{font:13px/1.45 var(--vscode-editor-font-family,monospace);font-variant-numeric:tabular-nums;color:var(--vscode-editor-foreground,var(--vscode-foreground));white-space:pre-wrap;overflow-wrap:anywhere;min-width:0}
.flow-canvas .tok-mnemonic{font-weight:500}
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
@media(forced-colors:active){
.flow-page .flow-topbar,.flow-page #filter-status,.flow-page .scope{border-color:CanvasText}
.flow-page :is(button:not(.link),#call-menu>summary,.cfg-overview-close){border:1px solid ButtonText}
.flow-page [aria-pressed="true"],.flow-page [aria-expanded="true"],.flow-page [aria-current]{border-color:Highlight;outline:1px solid Highlight}
.flow-canvas .cfg-node,.flow-canvas .cfg-node .block-header{border-color:CanvasText;forced-color-adjust:none;background:Canvas;color:CanvasText}
.flow-canvas .cfg-node.selected,.flow-canvas .cfg-node:focus-visible,.flow-canvas .cfg-node.search-match,.flow-canvas .cfg-node.edge-endpoint{border-color:Highlight;outline:2px solid Highlight}
.flow-canvas .cfg-edge{opacity:1!important}
}
@media(max-width:640px){
.flow-page .flow-topbar{grid-template-columns:minmax(0,1fr) auto;padding:6px 8px;gap:4px 6px}
.flow-page .flow-topbar:has(.flow-topbar-controls) .flow-topbar-primary{grid-column:1/-1}
.flow-page .flow-topbar-controls{grid-column:1;justify-self:start}
.flow-page .flow-topbar:has(.flow-topbar-controls) .flow-topbar-actions{grid-column:2;justify-self:end}
.flow-page .flow-topbar-actions{gap:2px}
.flow-page #filter-status,.flow-page .scope{padding:3px 8px}
}
@media(max-width:300px){
.flow-page .flow-topbar{grid-template-columns:minmax(0,1fr)}
.flow-page .flow-topbar-controls,.flow-page .flow-topbar:has(.flow-topbar-controls) .flow-topbar-actions,.flow-page .flow-topbar-actions{grid-column:1/-1;justify-self:start}
}
`;

/** Runs inside the existing nonce-protected page and uses its persisted view state. */
export const controlFlowScript = String.raw`
    graphViewport=(()=>{
      const canvas=document.querySelector('[data-control-flow],[data-call-graph]');if(!canvas){return undefined}
      const svg=canvas.querySelector('svg'),world=svg.querySelector('.graph-world'),cards=canvas.querySelector('.graph-cards'),cardWorld=canvas.querySelector('.graph-card-world'),host=canvas.closest('main')||document;
      let width=Math.max(1,Number(svg.dataset.width)||1),height=Math.max(1,Number(svg.dataset.height)||1);
      const saved=samePage?previous.graphViewport:undefined;
      const restored=saved&&[saved.scale,saved.x,saved.y].every(Number.isFinite)&&saved.scale>0;
      let scale=restored?saved.scale:1,x=restored?saved.x:0,y=restored?saved.y:24,fitted=!!(restored&&saved.fitted),userMoved=Boolean(restored),drag;
      let suppressClick=false,firstHighlight=true,pointerFocus=false;
      // Remove visible floating overlays from the viewport area.
      const safeBoxes=()=>{
        const rect=canvas.getBoundingClientRect(),vw=canvas.clientWidth||rect.width,vh=canvas.clientHeight||rect.height,pad=Math.min(12,Math.max(4,Math.floor(Math.min(vw,vh)*.04)));
        const base={left:pad,top:pad,right:Math.max(pad+1,vw-pad),bottom:Math.max(pad+1,vh-pad)};
        let boxes=[base];
        for(const el of host.querySelectorAll('.cfg-zoom,.cfg-overview,.call-zoom,.call-overview,.call-details')){
          if(el.hidden||el.closest('[hidden]')){continue}
          const r=el.getBoundingClientRect();if(r.width<=0||r.height<=0){continue}
          const gap=Math.min(8,pad),ox0=r.left-rect.left-gap,oy0=r.top-rect.top-gap,ox1=r.right-rect.left+gap,oy1=r.bottom-rect.top+gap,next=[];
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
      // Keep the graph in view and let edge items move clear of overlays.
      const panBounds=()=>{const boxes=safeBoxes(),sLeft=Math.min(...boxes.map(b=>b.left)),sRight=Math.max(...boxes.map(b=>b.right)),sTop=Math.min(...boxes.map(b=>b.top)),sBottom=Math.max(...boxes.map(b=>b.bottom));const axis=(sMin,sMax,span)=>{const keep=Math.min(16,span/2);return {min:sMin+keep-span-8,max:sMax-keep+8}};return {x:axis(sLeft,sRight,width*scale),y:axis(sTop,sBottom,height*scale)}};
      const update=()=>{if(canvas.scrollLeft||canvas.scrollTop){canvas.scrollLeft=canvas.scrollTop=0}if(cards&&(cards.scrollLeft||cards.scrollTop)){cards.scrollLeft=cards.scrollTop=0}const bounds=panBounds();if(bounds){x=Math.max(bounds.x.min,Math.min(bounds.x.max,x));y=Math.max(bounds.y.min,Math.min(bounds.y.max,y))}world.setAttribute('transform','translate('+x+','+y+') scale('+scale+')');if(cardWorld){cardWorld.style.transform='translate('+x+'px,'+y+'px) scale('+scale+')'}svg.dataset.zoom=String(scale);document.getElementById('graph-zoom').textContent=Math.round(scale*100)+'%';canvas.dispatchEvent(new CustomEvent('graph-viewport'));persist()};
      const fit=()=>{const safe=largestSafe(),sw=Math.max(1,safe.right-safe.left),sh=Math.max(1,safe.bottom-safe.top);scale=Math.min(1,sw/width,sh/height);x=safe.left+(sw-width*scale)/2;y=safe.top+(sh-height*scale)/2;fitted=true;userMoved=true;update()};
      const zoom=(next,px=canvas.clientWidth/2,py=canvas.clientHeight/2)=>{next=Math.max(.05,Math.min(4,next));x=px-(px-x)*next/scale;y=py-(py-y)*next/scale;scale=next;fitted=false;userMoved=true;update()};
      const placeInitial=()=>{
        const safe=largestSafe(),sw=Math.max(1,safe.right-safe.left),sh=Math.max(1,safe.bottom-safe.top);
        const first=canvas.querySelector('.is-root')||canvas.querySelector('.graph-node.selected')||canvas.querySelector('.graph-node');
        if(canvas.hasAttribute('data-call-graph')&&width<=sw&&height<=sh){scale=1;x=safe.left+(sw-width)/2;y=safe.top+(sh-height)/2}
        else{x=first?safe.left+(sw-Number(first.dataset.width)*scale)/2-Number(first.dataset.x)*scale:safe.left+(sw-width*scale)/2;y=(canvas.hasAttribute('data-call-graph')?safe.top+(sh-Number(first?.dataset.height||0)*scale)/2:Math.max(safe.top,24))-Number(first?.dataset.y||0)*scale}
      };
      const boundsOf=item=>{
        if(!item||!(world.contains(item)||cardWorld?.contains(item))){return undefined}
        const node=item.closest('.graph-node');
        if(node&&item!==node){
          const nr=node.getBoundingClientRect(),ir=item.getBoundingClientRect();
          if(nr.width>0&&ir.width>0){return {x:(Number(node.dataset.x)||0)+(ir.left-nr.left)/scale,y:(Number(node.dataset.y)||0)+(ir.top-nr.top)/scale,width:Math.max(4,ir.width/scale),height:Math.max(4,ir.height/scale)}}
        }
        if(item.matches('.graph-node')){const w=Number(item.dataset.width)||item.offsetWidth,h=Number(item.dataset.height)||item.offsetHeight;return w>0&&h>0?{x:Number(item.dataset.x)||0,y:Number(item.dataset.y)||0,width:w,height:h}:undefined}
        if(typeof item.getBBox==='function'){try{const box=item.getBBox(),path=item.querySelector('path.edge'),len=path&&typeof path.getTotalLength==='function'?path.getTotalLength():0,anchor=len>0?path.getPointAtLength(len/2):undefined,w=Math.max(8,box.width),h=Math.max(8,box.height);return {x:box.x-(w-box.width)/2,y:box.y-(h-box.height)/2,width:w,height:h,anchor}}catch{return undefined}}
        return undefined
      };
      const focusSelector='.node-decompile,.node-branch,.cfg-edge,.call-edge,.graph-node';
      const activeTarget=()=>canvas.contains(document.activeElement)&&document.activeElement.closest(focusSelector);
      const reveal=(item=activeTarget()||canvas.querySelector('.graph-node.selected')||canvas.querySelector('.cfg-edge.is-active,.call-edge.is-active'))=>{
        if(drag){return}
        const target=boundsOf(item);if(!target){return}
        const tw=target.width*scale,th=target.height*scale,sx0=target.x*scale+x,sx1=sx0+tw,sy0=target.y*scale+y,sy1=sy0+th;
        if(safeBoxes().some(b=>{const bw=b.right-b.left,bh=b.bottom-b.top,okX=tw<=bw?(sx0>=b.left&&sx1<=b.right):target.anchor?(target.anchor.x*scale+x>=b.left+4&&target.anchor.x*scale+x<=b.right-4):(sx0<=b.left&&sx1>=b.right),okY=th<=bh?(sy0>=b.top&&sy1<=b.bottom):target.anchor?(target.anchor.y*scale+y>=b.top+4&&target.anchor.y*scale+y<=b.bottom-4):(sy0<=b.top&&sy1>=b.bottom);return okX&&okY})){return}
        const safe=bestSafe(tw,th),bw=safe.right-safe.left,bh=safe.bottom-safe.top;
        const ax=tw<=bw||!target.anchor?target.x+target.width/2:target.anchor.x;
        const ay=th<=bh||!target.anchor?target.y+target.height/2:target.anchor.y;
        const nx=(safe.left+safe.right)/2-ax*scale,ny=(safe.top+safe.bottom)/2-ay*scale;
        if(Math.abs(nx-x)<.5&&Math.abs(ny-y)<.5){return}
        x=nx;y=ny;fitted=false;userMoved=true;update()
      };
      let searchIndex=-1;search.addEventListener('input',()=>{searchIndex=-1});
      search.addEventListener('keydown',event=>{if(event.key!=='Enter'){return}event.preventDefault();const matches=[...canvas.querySelectorAll('.graph-node.search-match')];if(matches.length){searchIndex=(searchIndex+1)%matches.length;reveal(matches[searchIndex])}});
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
      canvas.addEventListener('pointermove',event=>{if(!drag||event.pointerId!==drag.id){return}const dx=event.clientX-drag.x,dy=event.clientY-drag.y;if(Math.hypot(dx,dy)>3){suppressClick=drag.button===0;canvas.classList.add('panning')}x=drag.ox+dx;y=drag.oy+dy;fitted=false;userMoved=true;update()});
      const end=()=>{drag=undefined;canvas.classList.remove('panning')};canvas.addEventListener('pointerup',end);canvas.addEventListener('pointercancel',end);canvas.addEventListener('lostpointercapture',end);
      canvas.addEventListener('click',event=>{if(suppressClick){event.preventDefault();event.stopImmediatePropagation();suppressClick=false}},{capture:true});
      canvas.addEventListener('keydown',event=>{if(canUseSingleKeyShortcut(event,canvas)){if(event.key==='+'||event.key==='='){event.preventDefault();zoom(scale*1.2);return}if(event.key==='-'){event.preventDefault();zoom(scale/1.2);return}if(event.key==='0'){event.preventDefault();fit();return}}if(event.target===canvas&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();x+=event.key==='ArrowLeft'?50:event.key==='ArrowRight'?-50:0;y+=event.key==='ArrowUp'?50:event.key==='ArrowDown'?-50:0;fitted=false;userMoved=true;update()}});
      let oldWidth=canvas.clientWidth,oldHeight=canvas.clientHeight;
      new ResizeObserver(()=>{if(fitted){fit()}else if(!userMoved){placeInitial();update()}else{x+=(canvas.clientWidth-oldWidth)/2;y+=(canvas.clientHeight-oldHeight)/2;update()}oldWidth=canvas.clientWidth;oldHeight=canvas.clientHeight}).observe(canvas);
      let measureFrame=0,measureTimer=0,requestSeq=0,appliedSeq=0,lastSent='';
      const readSizes=()=>{
        const nodes=[...canvas.querySelectorAll('.graph-node')],sizes=[];let changed=false;
        for(const node of nodes){
          const cs=getComputedStyle(node);
          const nw=Math.max(24,Math.ceil(Math.max(parseFloat(cs.width)||0,node.offsetWidth)-.01));
          const nh=Math.max(24,Math.ceil(Math.max(parseFloat(cs.height)||0,node.offsetHeight)-.01));
          if(Math.abs(nw-(Number(node.dataset.width)||0))>=1||Math.abs(nh-(Number(node.dataset.height)||0))>=1){changed=true}
          sizes.push({id:node.dataset.node,width:nw,height:nh});
        }
        return {sizes,changed,sig:sizes.map(item=>item.id+':'+item.width+'x'+item.height).join('|')};
      };
      const flushMeasure=()=>{
        measureFrame=0;measureTimer=0;
        const {sizes,changed,sig}=readSizes();
        if(!sizes.length||(!changed&&sig===lastSent)||sig===lastSent){return}
        lastSent=sig;
        vscode.postMessage({action:'measureGraph',requestId:++requestSeq,graphRoot:state.entry,sizes});
      };
      const scheduleMeasure=()=>{
        if(measureTimer){clearTimeout(measureTimer)}
        if(measureFrame){cancelAnimationFrame(measureFrame)}
        measureFrame=requestAnimationFrame(()=>{measureFrame=0;measureTimer=setTimeout(flushMeasure,20)});
      };
      if(cardWorld){
        const cardObserver=new ResizeObserver(scheduleMeasure);
        for(const node of cardWorld.querySelectorAll('.graph-node')){cardObserver.observe(node)}
        const styleObserver=new MutationObserver(scheduleMeasure);
        styleObserver.observe(document.head,{childList:true,subtree:true,characterData:true,attributes:true});
        styleObserver.observe(document.documentElement,{attributes:true,attributeFilter:['style','class']});
        styleObserver.observe(document.body,{attributes:true,attributeFilter:['style','class']});
        document.fonts?.ready?.then(scheduleMeasure);
        window.addEventListener('resize',scheduleMeasure);
        window.visualViewport?.addEventListener('resize',scheduleMeasure);
      }
      window.addEventListener('message',event=>{
        const msg=event.data||{};if(msg.action!=='graphLayout'){return}
        if(typeof msg.requestId==='number'){if(msg.requestId<appliedSeq){return}appliedSeq=msg.requestId}
        const anchorEl=document.activeElement?.closest?.('.graph-node')||canvas.querySelector('.graph-node.selected')||canvas.querySelector('.is-root')||canvas.querySelector('.graph-node');
        const anchorX=anchorEl?(Number(anchorEl.dataset.x)+Number(anchorEl.dataset.width)/2)*scale+x:0;
        const anchorY=anchorEl?(Number(anchorEl.dataset.y)+Number(anchorEl.dataset.height)/2)*scale+y:0;
        if(Number(msg.width)>0){width=Math.ceil(Number(msg.width));svg.dataset.width=String(width)}
        if(Number(msg.height)>0){height=Math.ceil(Number(msg.height));svg.dataset.height=String(height)}
        const nodeMap=new Map([...canvas.querySelectorAll('.graph-node')].map(node=>[node.dataset.node,node]));
        const mapSvg=canvas.querySelector('#cfg-overview-map,#call-overview-map');
        if(mapSvg){mapSvg.setAttribute('viewBox','0 0 '+width+' '+height)}
        const mapNodes=new Map([...(mapSvg?.querySelectorAll('[data-map-node]')||[])].map(rect=>[rect.dataset.mapNode,rect]));
        for(const item of msg.nodes||[]){
          const node=nodeMap.get(item.id);
          if(node){
            node.dataset.x=String(item.x);node.dataset.y=String(item.y);
            node.dataset.width=String(item.width);node.dataset.height=String(item.height);
            node.style.left=item.x+'px';node.style.top=item.y+'px';
          }
          const rect=mapNodes.get(item.id);
          if(rect){
            rect.setAttribute('x',String(item.x));rect.setAttribute('y',String(item.y));
            rect.setAttribute('width',String(item.width));rect.setAttribute('height',String(item.height));
          }
        }
        const edgeEls=new Map([...svg.querySelectorAll('[data-edge-index]')].map(edge=>[Number(edge.dataset.edgeIndex),edge]));
        const mapEdges=new Map([...(mapSvg?.querySelectorAll('[data-map-edge]')||[])].map(path=>[Number(path.dataset.mapEdge),path]));
        for(const item of msg.edges||[]){
          const edgeEl=edgeEls.get(Number(item.index));
          if(edgeEl&&typeof item.path==='string'){
            for(const pathEl of edgeEl.querySelectorAll('path')){pathEl.setAttribute('d',item.path)}
            if(typeof item.backward==='boolean'){edgeEl.classList.toggle('backward',item.backward)}
          }
          const mapPath=mapEdges.get(Number(item.index));
          if(mapPath&&typeof item.path==='string'){mapPath.setAttribute('d',item.path)}
        }
        if(Array.isArray(msg.nodes)&&msg.nodes.length){lastSent=msg.nodes.map(item=>item.id+':'+item.width+'x'+item.height).join('|')}
        if(fitted){fit()}else if(!userMoved){placeInitial();update()}else if(anchorEl){x=anchorX-(Number(anchorEl.dataset.x)+Number(anchorEl.dataset.width)/2)*scale;y=anchorY-(Number(anchorEl.dataset.y)+Number(anchorEl.dataset.height)/2)*scale;update()}else{update()}
        if(activeTarget()){reveal()}
        canvas.dataset.layoutSettled=String(msg.requestId||'true');
        canvas.dispatchEvent(new CustomEvent('graph-layout-settled'));
        scheduleMeasure();
      });
      requestAnimationFrame(()=>{const anchor=samePage?previous.branchAnchor:undefined;if(restored&&anchor&&Number.isFinite(anchor.x)&&Number.isFinite(anchor.y)){const node=[...canvas.querySelectorAll('.call-node')].find(item=>item.dataset.entry===anchor.entry);if(node){x=anchor.x-(Number(node.dataset.x)+Number(node.dataset.width)/2)*scale;y=anchor.y-(Number(node.dataset.y)+Number(node.dataset.height)/2)*scale;fitted=false;userMoved=true}}if(!restored){placeInitial()}update();select([...canvas.querySelectorAll('.graph-node.selected')],false);scheduleMeasure()});
      return {select,fit,reveal,center:(cx,cy)=>{x=canvas.clientWidth/2-cx*scale;y=canvas.clientHeight/2-cy*scale;fitted=false;userMoved=true;update()},snapshot:()=>({scale,x,y,fitted,bounds:panBounds()})};
    })();
`;
