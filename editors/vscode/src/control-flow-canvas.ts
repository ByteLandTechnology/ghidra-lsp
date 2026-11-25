// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

import { graphPathScript } from './graph-layout';

/** Scoped to the CFG page; other workbench views keep their existing layout. */
export const controlFlowStyles = `
.flow-page{overflow-x:hidden;overflow-y:auto}
.flow-page main{height:100vh;max-width:none;padding:10px 12px;display:flex;flex-direction:column;gap:8px}
.flow-page header{display:flex;flex-wrap:wrap;align-items:baseline;gap:12px;padding:0;margin:0;border:0;min-width:0}
.flow-page h1{font-size:14px;line-height:1.5;margin:0;white-space:nowrap}
.flow-page .subtitle{font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.flow-page .toolbar{gap:5px;margin:0;flex-wrap:wrap}
.flow-page .search{min-width:70px;flex:1;max-width:none}
.flow-page button{white-space:nowrap;padding:3px 8px}
.flow-page .zoom-step{min-width:28px;font-size:16px;padding:0 7px}
.flow-page #graph-zoom{min-width:51px;font-variant-numeric:tabular-nums}
.flow-page .scope,.flow-page #filter-status{flex-shrink:0;margin:0;padding:4px 14px;border-bottom:1px solid var(--vscode-panel-border);background:var(--vscode-editor-background);font-size:11px;line-height:1.4;white-space:normal;overflow-wrap:anywhere}
.flow-page .scope{color:var(--vscode-descriptionForeground)}
.flow-page #filter-status{color:var(--vscode-foreground)}
.flow-page .selection-tools{flex-wrap:wrap;padding-bottom:6px}
.flow-page .flow-canvas{flex:1;min-height:120px;width:100%;overflow:hidden;cursor:grab;touch-action:none;border-radius:3px;background:var(--vscode-sideBar-background,var(--vscode-editor-background))}
@media(max-width:640px){.flow-page .scope,.flow-page #filter-status{padding:3px 10px}}
@media(max-height:420px){.flow-page .flow-canvas{min-height:48px}.flow-page .scope,.flow-page #filter-status{padding:2px 8px}}
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
export const controlFlowScript = `
    ${graphPathScript}
` + String.raw`
    graphViewport=(()=>{
      const canvas=document.querySelector('[data-control-flow],[data-call-graph]');if(!canvas){return undefined}
      const svg=canvas.querySelector('svg'),world=svg.querySelector('.graph-world'),isCall=canvas.hasAttribute('data-call-graph');
      const baseGraphWidth=Number(svg.dataset.baseWidth||(svg.dataset.baseWidth=svg.dataset.width));
      const baseGraphHeight=Number(svg.dataset.baseHeight||(svg.dataset.baseHeight=svg.dataset.height));
      let width=baseGraphWidth,height=baseGraphHeight;
      const parsePoints=raw=>(raw||'').trim().split(/\s+/).filter(Boolean).map(pair=>{const [px,py]=pair.split(',').map(Number);return {x:px,y:py}}).filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y));
      const safeBox=el=>{if(!el){return {x:0,y:0,width:0,height:0}}try{const b=el.getBBox();return {x:b.x||0,y:b.y||0,width:b.width||0,height:b.height||0}}catch{return {x:0,y:0,width:0,height:0}}};
      const cssLinePx=el=>{if(!el){return 0}const v=parseFloat(getComputedStyle(el).lineHeight);return Number.isFinite(v)?v:0};
      const overviewSvg=canvas.querySelector('#cfg-overview-map,#call-overview-map');
      const mapNodes=new Map([...(overviewSvg?.querySelectorAll('[data-map-node]')||[])].map(el=>[el.dataset.mapNode,el]));
      const mapEdges=[...(overviewSvg?.querySelectorAll('[data-map-edge]')||[])];
      const nodeSpecs=[...world.querySelectorAll(':scope > .graph-node')].map(node=>({
        node,
        baseX:Number(node.dataset.baseX||(node.dataset.baseX=node.dataset.x)),
        baseY:Number(node.dataset.baseY||(node.dataset.baseY=node.dataset.y)),
        baseW:Number(node.dataset.baseWidth||(node.dataset.baseWidth=node.dataset.width)),
        baseH:Number(node.dataset.baseHeight||(node.dataset.baseHeight=node.dataset.height)),
        body:node.querySelector('.block-body,.call-node-body'),
        header:node.querySelector('.block-header'),
        titles:[...node.querySelectorAll('.node-title')],
        badge:node.querySelector('.cfg-entry-badge'),
        subtitle:node.querySelector('.node-subtitle:not(.cfg-entry-badge):not(.call-root-address)'),
        rootAddr:node.querySelector('.call-root-address'),
        lines:[...node.querySelectorAll('.node-line')],
        codeCtrl:node.querySelector('.node-code'),
        callersCtrl:node.querySelector('.node-callers'),
        calleesCtrl:node.querySelector('.node-callees')
      }));
      const edgeSpecs=[...world.querySelectorAll('.cfg-edge,.call-edge')].map((edge,idx)=>({edge,points:parsePoints(edge.dataset.points),paths:[...edge.querySelectorAll('path')],mapPath:mapEdges[idx]}));
      const scaleGraphBounds=()=>{
        if(!nodeSpecs.length){return false}
        const measured=nodeSpecs.map(spec=>{
          if(isCall){
            const tbs=spec.titles.map(safeBox),ab=spec.rootAddr?safeBox(spec.rootAddr):undefined;
            const maxTitleH=tbs.length?Math.max(...tbs.map(b=>b.height)):16;
            const titleStep=Math.max(18,Math.ceil(cssLinePx(spec.titles[0])),Math.ceil(maxTitleH+4));
            const addrStep=ab?Math.max(19,Math.ceil(cssLinePx(spec.rootAddr)),Math.ceil(ab.height+5)):0;
            const firstY=spec.titles[0]?Number(spec.titles[0].getAttribute('y')):14;
            const firstAscent=tbs[0]&&tbs[0].height>0?firstY-tbs[0].y:12;
            const lastEl=spec.rootAddr||spec.titles[spec.titles.length-1],lastBox=ab||tbs[tbs.length-1];
            const lastDescent=lastEl&&lastBox&&lastBox.height>0?lastBox.y+lastBox.height-Number(lastEl.getAttribute('y')):4;
            const textBlockH=firstAscent+Math.max(0,spec.titles.length-1)*titleStep+addrStep+lastDescent;
            const maxTextW=Math.max(0,...tbs.map(b=>b.width),ab?ab.width:0);
            return {spec,reqW:Math.max(spec.baseW,Math.ceil(maxTextW+92)),reqH:Math.max(spec.baseH,Math.ceil(textBlockH+34)),titleStep,addrStep,firstAscent,textBlockH};
          }
          const titleEl=spec.titles[0],tb=safeBox(titleEl),bb=spec.badge?safeBox(spec.badge):undefined;
          const titleAscent=tb.height>0?Number(titleEl.getAttribute('y'))-tb.y:12;
          const badgeAscent=bb&&bb.height>0?Number(spec.badge.getAttribute('y'))-bb.y:10;
          const glyphH=Math.max(tb.height||14,bb?bb.height:0);
          const headerH=Math.max(33,Math.ceil(Math.max(glyphH,cssLinePx(titleEl))+14));
          const headerBaseline=Math.round((1+headerH-glyphH)/2+Math.max(titleAscent,bb?badgeAscent:0));
          const reqHeaderW=Math.max(12+tb.width,tb.x+tb.width)+(bb?16+bb.width:0)+14;
          let reqBodyW=0,reqBodyH=1+headerH+20,lineStep=20,firstLineY=52,subY=54;
          if(spec.lines.length){
            const lbs=spec.lines.map(safeBox),heights=lbs.filter(b=>b.height>0).map(b=>b.height);
            const maxLineH=heights.length?Math.max(...heights):14;
            lineStep=Math.max(20,Math.ceil(cssLinePx(spec.lines[0])),Math.ceil(maxLineH+4));
            const firstIdx=lbs.findIndex(b=>b.height>0);
            const firstAscent=firstIdx>=0?Number(spec.lines[firstIdx].getAttribute('y'))-lbs[firstIdx].y:12;
            let lastIdx=lbs.length-1;while(lastIdx>=0&&lbs[lastIdx].height<=0){lastIdx--}
            const lastDescent=lastIdx>=0?lbs[lastIdx].y+lbs[lastIdx].height-Number(spec.lines[lastIdx].getAttribute('y')):4;
            firstLineY=Math.max(52,Math.ceil(1+headerH+8+firstAscent));
            reqBodyH=Math.ceil(firstLineY+(spec.lines.length-1)*lineStep+lastDescent+14);
            reqBodyW=Math.max(...lbs.map(b=>Math.max(14+b.width,b.x+b.width)+16));
          }else if(spec.subtitle){
            const sb=safeBox(spec.subtitle);
            const subAscent=sb.height>0?Number(spec.subtitle.getAttribute('y'))-sb.y:10;
            const subDescent=sb.height>0?sb.y+sb.height-Number(spec.subtitle.getAttribute('y')):3;
            subY=Math.max(54,Math.ceil(1+headerH+10+subAscent));
            reqBodyH=Math.ceil(subY+subDescent+14);
            reqBodyW=Math.max(14+sb.width,sb.x+sb.width)+16;
          }
          return {spec,reqW:Math.max(spec.baseW,Math.ceil(Math.max(reqHeaderW,reqBodyW))),reqH:Math.max(spec.baseH,Math.ceil(reqBodyH)),headerH,headerBaseline,lineStep,firstLineY,subY};
        });
        const sx=Math.max(1,...measured.map(m=>m.reqW>m.spec.baseW?(m.reqW+1)/m.spec.baseW:1));
        const sy=Math.max(1,...measured.map(m=>m.reqH>m.spec.baseH?(m.reqH+1)/m.spec.baseH:1));
        const prevW=width,prevH=height;
        width=Number(formatCoord(baseGraphWidth*sx));height=Number(formatCoord(baseGraphHeight*sy));
        svg.dataset.width=String(width);svg.dataset.height=String(height);
        for(const m of measured){
          const {spec}=m,nx=Number(formatCoord(spec.baseX*sx)),ny=Number(formatCoord(spec.baseY*sy)),nw=Number(formatCoord(spec.baseW*sx)),nh=Number(formatCoord(spec.baseH*sy));
          spec.node.dataset.x=String(nx);spec.node.dataset.y=String(ny);spec.node.dataset.width=String(nw);spec.node.dataset.height=String(nh);
          spec.node.setAttribute('transform','translate('+nx+','+ny+')');
          spec.body?.setAttribute('width',String(nw));spec.body?.setAttribute('height',String(nh));
          if(isCall){
            const topBaseline=Number(formatCoord((nh-m.textBlockH)/2+m.firstAscent)),cx=Number(formatCoord(nw/2));
            spec.titles.forEach((el,i)=>{el.setAttribute('x',String(cx));el.setAttribute('y',String(Number(formatCoord(topBaseline+i*m.titleStep))))});
            if(spec.rootAddr){spec.rootAddr.setAttribute('x',String(cx));spec.rootAddr.setAttribute('y',String(Number(formatCoord(topBaseline+Math.max(0,spec.titles.length-1)*m.titleStep+m.addrStep))))}
            if(spec.codeCtrl){spec.codeCtrl.setAttribute('x',String(Number(formatCoord(nw-34))));spec.codeCtrl.setAttribute('y',String(Math.round(nh/2-14)))}
            const portX=String(Math.round(nw/2-26));
            if(spec.callersCtrl){spec.callersCtrl.setAttribute('x',portX);spec.callersCtrl.setAttribute('y','-14')}
            if(spec.calleesCtrl){spec.calleesCtrl.setAttribute('x',portX);spec.calleesCtrl.setAttribute('y',String(Math.round(nh-12)))}
          }else{
            if(spec.header){spec.header.setAttribute('width',String(Math.max(0,Number(formatCoord(nw-2)))));spec.header.setAttribute('height',String(m.headerH))}
            if(spec.titles[0]){spec.titles[0].setAttribute('y',String(m.headerBaseline))}
            if(spec.badge){spec.badge.setAttribute('x',String(Number(formatCoord(nw-12))));spec.badge.setAttribute('y',String(m.headerBaseline))}
            if(spec.subtitle){spec.subtitle.setAttribute('y',String(m.subY))}
            spec.lines.forEach((el,i)=>el.setAttribute('y',String(m.firstLineY+i*m.lineStep)));
          }
          const mapRect=mapNodes.get(spec.node.dataset.node);
          if(mapRect){mapRect.setAttribute('x',String(nx));mapRect.setAttribute('y',String(ny));mapRect.setAttribute('width',String(nw));mapRect.setAttribute('height',String(nh))}
        }
        for(const e of edgeSpecs){
          const d=roundedOrthogonalPath(e.points.map(p=>({x:p.x*sx,y:p.y*sy})),8);
          for(const pathEl of e.paths){pathEl.setAttribute('d',d)}
          if(e.mapPath){e.mapPath.setAttribute('d',d)}
        }
        if(overviewSvg){overviewSvg.setAttribute('viewBox','0 0 '+width+' '+height)}
        return prevW!==width||prevH!==height;
      };
      scaleGraphBounds();
      const saved=samePage?previous.graphViewport:undefined;
      const restored=saved&&[saved.scale,saved.x,saved.y].every(Number.isFinite)&&saved.scale>0;
      let scale=restored?saved.scale:1,x=restored?saved.x:0,y=restored?saved.y:24,fitted=!!(restored&&saved.fitted),userFitted=fitted,drag;
      let suppressClick=false,firstHighlight=true;
      // Keep both graphs reachable; small CFGs may still be panned inside the viewport.
      const panBounds=()=>{const overview=canvas.querySelector('.call-overview,.cfg-overview'),reserve=fitted&&overview?.open?overview.offsetWidth+20:0;const axis=(viewport,span)=>canvas.hasAttribute('data-control-flow')?{min:Math.min(80,span/2)-span,max:viewport-Math.min(80,span/2)}:({min:Math.min(18,viewport-span-18),max:Math.max(18,viewport-span-18)});return {x:axis(Math.max(1,canvas.clientWidth-reserve),width*scale),y:axis(canvas.clientHeight,height*scale)}};
      const update=()=>{const bounds=panBounds();if(bounds){x=Math.max(bounds.x.min,Math.min(bounds.x.max,x));y=Math.max(bounds.y.min,Math.min(bounds.y.max,y))}world.setAttribute('transform','translate('+x+','+y+') scale('+scale+')');svg.dataset.zoom=String(scale);document.getElementById('graph-zoom').textContent=Math.round(scale*100)+'%';canvas.dispatchEvent(new CustomEvent('graph-viewport'));persist()};
      const fit=(explicit=false)=>{if(explicit){userFitted=true}const overview=canvas.querySelector('.call-overview,.cfg-overview'),reserve=overview?.open?overview.offsetWidth+20:0,inset=18,bottom=canvas.hasAttribute('data-control-flow')?Math.min(58,Math.max(18,Math.floor(canvas.clientHeight*.3))):18;scale=Math.min(1,Math.max(1,canvas.clientWidth-reserve-36)/width,Math.max(1,canvas.clientHeight-inset-bottom)/height);x=(canvas.clientWidth-reserve-width*scale)/2;y=inset+(canvas.clientHeight-inset-bottom-height*scale)/2;fitted=true;update()};
      const zoom=(next,px=canvas.clientWidth/2,py=canvas.clientHeight/2)=>{next=Math.max(.05,Math.min(4,next));x=px-(px-x)*next/scale;y=py-(py-y)*next/scale;scale=next;fitted=false;userFitted=false;update()};
      const reveal=node=>{const nx=Number(node.dataset.x),ny=Number(node.dataset.y),nw=Number(node.dataset.width),nh=Number(node.dataset.height);
        if(nx*scale+x>=16&&ny*scale+y>=16&&(nx+nw)*scale+x<=canvas.clientWidth-16&&(ny+nh)*scale+y<=canvas.clientHeight-16){return}
        x=(canvas.clientWidth-nw*scale)/2-nx*scale;y=Math.max(16,(canvas.clientHeight-nh*scale)/2)-ny*scale;fitted=false;userFitted=false;update()};
      const resyncScale=()=>{
        if(!scaleGraphBounds()){return}
        if(userFitted){fit(true);return}
        if(isCall&&width<=canvas.clientWidth-36&&height<=canvas.clientHeight-36){fit(false);return}
        fitted=false;
        const focusNode=svg.querySelector('.graph-node.selected')||svg.querySelector('.is-root')||svg.querySelector('.graph-node');
        if(focusNode&&scale===1){
          x=(canvas.clientWidth-Number(focusNode.dataset.width))/2-Number(focusNode.dataset.x);
          y=(isCall?(canvas.clientHeight-Number(focusNode.dataset.height))/2:24)-Number(focusNode.dataset.y);
        }
        update();
      };
      if(document.head){new MutationObserver(resyncScale).observe(document.head,{childList:true,subtree:true,characterData:true,attributes:true})}
      new MutationObserver(resyncScale).observe(document.documentElement,{attributes:true,attributeFilter:['style','class']});
      if(document.body){new MutationObserver(records=>{if(records.some(r=>r.type==='attributes'||[...r.addedNodes,...r.removedNodes].some(n=>n.nodeName==='STYLE'||n.nodeName==='LINK'))){resyncScale()}}).observe(document.body,{childList:true,attributes:true,attributeFilter:['style','class']})}
      document.fonts?.ready?.then(resyncScale);
      let searchIndex=-1;search.addEventListener('input',()=>{searchIndex=-1});
      search.addEventListener('keydown',event=>{if(event.key!=='Enter'){return}event.preventDefault();const matches=[...svg.querySelectorAll('.graph-node.search-match')];if(matches.length){searchIndex=(searchIndex+1)%matches.length;reveal(matches[searchIndex])}});
      const select=(rows,follow)=>{const ids=new Set(rows.map(row=>row.dataset.node));svg.querySelectorAll('.cfg-edge,.call-edge').forEach(edge=>{const connected=ids.has(edge.dataset.from)||ids.has(edge.dataset.to);edge.classList.toggle('connected',connected);edge.classList.toggle('dimmed',ids.size>0&&!connected)});
        if(follow&&rows[0]&&!(firstHighlight&&restored)){reveal(rows[0])}if(follow){firstHighlight=false}};
      canvas.addEventListener('focusin',event=>{const node=event.target.closest('.graph-node');if(node?.matches(':focus-visible')){reveal(node)}});
      document.getElementById('graph-fit').addEventListener('click',()=>fit(true));
      document.getElementById('graph-zoom').addEventListener('click',()=>zoom(1));
      document.getElementById('graph-zoom-in').addEventListener('click',()=>zoom(scale*1.2));
      document.getElementById('graph-zoom-out').addEventListener('click',()=>zoom(scale/1.2));
      canvas.addEventListener('wheel',event=>{event.preventDefault();const r=canvas.getBoundingClientRect();zoom(scale*Math.exp(-event.deltaY*(event.deltaMode===1?16:1)*.002),event.clientX-r.left,event.clientY-r.top)},{passive:false});
      canvas.addEventListener('pointerdown',event=>{suppressClick=false;if(event.target.closest('.call-overview,.cfg-overview,.call-node-controls,.cfg-node-controls')||event.button!==1&&(event.button!==0||event.target.closest('.graph-node'))){return}event.preventDefault();canvas.focus({preventScroll:true});canvas.setPointerCapture(event.pointerId);drag={id:event.pointerId,button:event.button,x:event.clientX,y:event.clientY,ox:x,oy:y}});
      canvas.addEventListener('pointermove',event=>{if(!drag||event.pointerId!==drag.id){return}const dx=event.clientX-drag.x,dy=event.clientY-drag.y;if(Math.hypot(dx,dy)>3){suppressClick=drag.button===0;canvas.classList.add('panning')}x=drag.ox+dx;y=drag.oy+dy;fitted=false;userFitted=false;update()});
      const end=()=>{drag=undefined;canvas.classList.remove('panning')};canvas.addEventListener('pointerup',end);canvas.addEventListener('pointercancel',end);canvas.addEventListener('lostpointercapture',end);
      canvas.addEventListener('click',event=>{if(suppressClick){event.preventDefault();event.stopImmediatePropagation();suppressClick=false}},{capture:true});
      canvas.addEventListener('keydown',event=>{if(canUseSingleKeyShortcut(event,canvas)){if(event.key==='+'||event.key==='='){event.preventDefault();zoom(scale*1.2);return}if(event.key==='-'){event.preventDefault();zoom(scale/1.2);return}if(event.key==='0'){event.preventDefault();fit(true);return}}if(event.target===canvas&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();x+=event.key==='ArrowLeft'?50:event.key==='ArrowRight'?-50:0;y+=event.key==='ArrowUp'?50:event.key==='ArrowDown'?-50:0;fitted=false;userFitted=false;update()}});
      let oldWidth=canvas.clientWidth,oldHeight=canvas.clientHeight;
      new ResizeObserver(()=>{if(fitted){fit(userFitted)}else{x+=(canvas.clientWidth-oldWidth)/2;y+=(canvas.clientHeight-oldHeight)/2;update()}oldWidth=canvas.clientWidth;oldHeight=canvas.clientHeight}).observe(canvas);
      requestAnimationFrame(()=>{scaleGraphBounds();const anchor=samePage?previous.branchAnchor:undefined;if(restored&&anchor&&Number.isFinite(anchor.x)&&Number.isFinite(anchor.y)){const node=[...svg.querySelectorAll('.call-node')].find(item=>item.dataset.entry===anchor.entry);if(node){x=anchor.x-(Number(node.dataset.x)+Number(node.dataset.width)/2)*scale;y=anchor.y-(Number(node.dataset.y)+Number(node.dataset.height)/2)*scale;fitted=false;userFitted=false}}if(!restored){const first=svg.querySelector('.graph-node.selected')||svg.querySelector('.graph-node');if(canvas.hasAttribute('data-call-graph')&&width<=canvas.clientWidth-36&&height<=canvas.clientHeight-36){fit(false)}else{x=first?(canvas.clientWidth-Number(first.dataset.width))/2-Number(first.dataset.x):(canvas.clientWidth-width)/2;y=(canvas.hasAttribute('data-call-graph')?(canvas.clientHeight-Number(first?.dataset.height||0))/2:24)-Number(first?.dataset.y||0)}}update();select([...svg.querySelectorAll('.graph-node.selected')],false)});
      return {select,fit:()=>fit(true),center:(cx,cy)=>{x=canvas.clientWidth/2-cx*scale;y=canvas.clientHeight/2-cy*scale;fitted=false;userFitted=false;update()},snapshot:()=>({scale,x,y,fitted,bounds:panBounds()})};
    })();
`;
