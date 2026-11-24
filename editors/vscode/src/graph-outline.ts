// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

import { callIcon } from './call-graph-icons';
import { toolbarButton } from './toolbar-ui';
import { escape } from './web';

/** Secondary action or branch-expansion button rendered inside a graph outline item. */
export interface OutlineAction {
    /** Optional unique DOM ID for focus restoration. */
    id?: string;
    /** Optional extra CSS class names. */
    className?: string;
    /** Visible button text; the accessible name starts with this text. */
    text: string;
    /** Additional accessible context appended after `text` in `aria-label`. */
    labelDetail?: string;
    /** Separator inserted between `text` and `labelDetail` in `aria-label`. */
    labelSeparator?: ', ' | ' ';
    /** Optional tooltip text. */
    title?: string;
    /** Disclosure state for caller or callee branch controls. */
    expanded?: boolean;
    /** Optional decorative icon HTML placed before `text`. */
    leadingHtml?: string;
    /** Custom `data-*` attributes attached to the action button. */
    dataset?: Record<string, string | undefined>;
}

/** Incoming or outgoing edge jump button rendered inside a graph outline item. */
export interface OutlineEdgeItem {
    /** Unique edge key matching `data-edge-key` on the decorative SVG edge group. */
    key: string;
    /** Source node identifier. */
    from: string;
    /** Target node identifier. */
    to: string;
    /** Connected peer node identifier focused when the user activates this edge button. */
    jumpNodeId: string;
    /** Visible edge button label. */
    text: string;
    /** Optional visual classification (`taken`, `fallthrough`, `flow`, `incoming`, `outgoing`). */
    kind?: string;
    /** Optional tooltip text describing branch type or call sites. */
    title?: string;
}

/** Single block or function entry in the semantic HTML graph outline. */
export interface OutlineNodeItem {
    /** Node identifier matching `data-node` on the decorative SVG node group. */
    id: string;
    /** Primary visible title (basic-block address or function name). */
    title: string;
    /** Optional badge displayed inside the primary node button (for example `"Entry"`). */
    badge?: string;
    /** Optional program address attached as `data-address`. */
    address?: string;
    /** Optional function entry address attached as `data-entry`. */
    entry?: string;
    /** Target entity kind (`block`, `address`, or `function`). */
    targetKind: string;
    /** Optional metadata or subtitle line shown below the item heading. */
    meta?: string;
    /** Optional syntax-highlighted HTML instruction lines rendered in an ordered list. */
    linesHtml?: string[];
    /** Optional action and branch-expansion buttons for this node. */
    actions?: OutlineAction[];
    /** Optional incoming and outgoing edge jump buttons for this node. */
    edges?: OutlineEdgeItem[];
}

/** Complete semantic outline model shared by Control Flow and Call Graph views. */
export interface GraphOutlineModel {
    /** Owning graph view kind. */
    kind: 'controlFlow' | 'callGraph';
    /** Visible heading for the outline panel and narrow-viewport drawer toggle. */
    heading: string;
    /** Ordered node items rendered in the outline list. */
    items: OutlineNodeItem[];
}

/** Render the DOM ID of the primary outline button for `nodeId`. */
export function outlineNodeButtonId(nodeId: string): string {
    return `outline-node-${encodeURIComponent(nodeId)}`;
}

/** Render a split graph stage pairing the semantic HTML outline with a decorative SVG canvas. */
export function renderGraphStage(model: GraphOutlineModel, canvasHtml: string): string {
    const toggleBtn = toolbarButton({
        id: 'graph-outline-toggle',
        className: 'graph-outline-toggle',
        text: model.heading,
        wrapText: true,
        expanded: false,
        controls: 'graph-outline-panel',
        title: `${model.heading} outline`,
        leadingHtml: callIcon('listing'),
    });
    const closeBtn = toolbarButton({
        className: 'graph-outline-close',
        ariaLabel: 'Close outline',
        title: 'Close outline',
        leadingHtml: callIcon('close'),
    });
    const itemsHtml = model.items.map(item => {
        const nodeBtn = `<button type="button" id="${escape(outlineNodeButtonId(item.id))}" class="graph-outline-node"`
            + ` data-outline-node="${escape(item.id)}"`
            + `${item.address ? ` data-address="${escape(item.address)}"` : ''}`
            + `${item.entry ? ` data-entry="${escape(item.entry)}"` : ''}`
            + ` data-kind="${escape(item.targetKind)}"`
            + ` data-label="${escape(item.title)}"`
            + ` aria-pressed="false">`
            + `<span class="graph-outline-title">${escape(item.title)}</span>`
            + `${item.badge ? `<span class="graph-outline-badge">${escape(item.badge)}</span>` : ''}`
            + `</button>`;
        const metaHtml = item.meta ? `<p class="graph-outline-meta">${escape(item.meta)}</p>` : '';
        const linesHtml = item.linesHtml?.length
            ? `<ol class="graph-outline-lines" aria-label="${escape(`Instructions in ${item.title}`)}">${item.linesHtml.map(line => `<li class="graph-outline-line"><code>${line}</code></li>`).join('')}</ol>`
            : '';
        const actionsHtml = item.actions?.length
            ? `<div class="graph-outline-actions" role="group" aria-label="${escape(`Actions for ${item.title}`)}">${item.actions.map(action => toolbarButton({
                id: action.id,
                className: `graph-outline-action${action.className ? ` ${action.className}` : ''}`,
                text: action.text,
                wrapText: true,
                labelDetail: action.labelDetail,
                labelSeparator: action.labelSeparator,
                title: action.title,
                expanded: action.expanded,
                leadingHtml: action.leadingHtml,
                dataset: action.dataset,
            })).join('')}</div>`
            : '';
        const edgesHtml = item.edges?.length
            ? `<ul class="graph-outline-edges" aria-label="${escape(`Edges for ${item.title}`)}">${item.edges.map(edge => `<li><button type="button" class="graph-outline-edge${edge.kind ? ` ${escape(edge.kind)}` : ''}" data-outline-edge="${escape(edge.key)}" data-from="${escape(edge.from)}" data-to="${escape(edge.to)}" data-jump-node="${escape(edge.jumpNodeId)}" aria-pressed="false"${edge.title ? ` title="${escape(edge.title)}"` : ''}>${escape(edge.text)}</button></li>`).join('')}</ul>`
            : '';
        return `<li class="graph-outline-item" data-outline-item="${escape(item.id)}"><h3 class="graph-outline-item-title">${nodeBtn}</h3>${metaHtml}${linesHtml}${actionsHtml}${edgesHtml}</li>`;
    }).join('');

    return `<div class="graph-stage" data-graph-stage="${model.kind}">`
        + `<div class="graph-drawer-bar">${toggleBtn}</div>`
        + `<aside id="graph-outline-panel" class="graph-outline" aria-labelledby="graph-outline-heading">`
        + `<div class="graph-outline-header"><h2 id="graph-outline-heading">${escape(model.heading)}</h2>${closeBtn}</div>`
        + `<ul class="graph-outline-list">${itemsHtml}</ul>`
        + `<p class="graph-outline-empty" hidden>No matching items.</p>`
        + `</aside>`
        + canvasHtml
        + `</div>`;
}

/** Shared CSS rules for the semantic graph outline pane and responsive narrow-viewport drawer. */
export const graphOutlineStyles = `
.graph-stage{display:flex;flex:1;min-height:0;min-width:0;width:100%;overflow:hidden;position:relative}
.graph-drawer-bar{display:none;align-items:center;padding:6px 10px;border-bottom:1px solid var(--vscode-panel-border);background:var(--vscode-sideBar-background,var(--vscode-editor-background));flex-shrink:0}
.flow-page .graph-outline-toggle{display:inline-flex;align-items:center;gap:6px;min-width:24px;min-height:28px;padding:4px 10px;border:1px solid var(--vscode-panel-border);border-radius:6px;background:var(--vscode-editor-background);color:var(--vscode-foreground);font-size:12px;font-weight:600}
.graph-outline{display:flex;flex-direction:column;width:clamp(248px,30%,336px);min-width:0;min-height:0;flex-shrink:0;border-right:1px solid var(--vscode-panel-border);background:var(--vscode-sideBar-background,var(--vscode-editor-background));overflow-y:auto;overscroll-behavior:contain}
.graph-outline-header{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px 8px;border-bottom:1px solid var(--vscode-panel-border);position:sticky;top:0;z-index:1;background:var(--vscode-sideBar-background,var(--vscode-editor-background))}
.graph-outline-header h2{font-size:12px;font-weight:600;line-height:1.4;margin:0;color:var(--vscode-foreground)}
.flow-page .graph-outline-close{display:none;align-items:center;justify-content:center;width:28px;height:28px;min-width:24px;min-height:24px;padding:4px;border:0;border-radius:4px;background:transparent;color:var(--vscode-foreground)}
.graph-outline-list{list-style:none;margin:0;padding:8px;display:flex;flex-direction:column;gap:8px}
.graph-outline-item{margin:0;padding:8px;border:1px solid var(--vscode-panel-border);border-radius:6px;background:var(--vscode-editor-background);display:flex;flex-direction:column;gap:6px;min-width:0}
.graph-outline-item.is-selected{border-color:var(--vscode-focusBorder);box-shadow:inset 2px 0 0 var(--vscode-focusBorder)}
.graph-outline-item.search-match{border-color:var(--vscode-focusBorder)}
.graph-outline-item-title{margin:0;font-size:12px;font-weight:600;line-height:1.35}
.flow-page .graph-outline-node{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;min-width:24px;min-height:28px;padding:4px 8px;border:1px solid transparent;border-radius:4px;background:var(--vscode-editor-inactiveSelectionBackground,var(--vscode-list-inactiveSelectionBackground));color:var(--vscode-foreground);text-align:left;font-size:12px;font-weight:600;white-space:normal;overflow-wrap:anywhere}
.flow-page .graph-outline-node[aria-pressed="true"]{border-color:var(--vscode-focusBorder);background:color-mix(in srgb,var(--vscode-focusBorder) 14%,var(--vscode-editor-background))}
.graph-outline-title{font-family:var(--vscode-editor-font-family,monospace);font-variant-numeric:tabular-nums;min-width:0;overflow-wrap:anywhere}
.call-page .graph-outline-title{font-family:var(--vscode-font-family)}
.graph-outline-badge{flex-shrink:0;font-size:11px;font-weight:600;padding:1px 6px;border-radius:999px;background:color-mix(in srgb,var(--vscode-focusBorder) 16%,var(--vscode-editor-background));color:var(--vscode-textLink-foreground,var(--vscode-foreground))}
.graph-outline-meta{margin:0;padding:0 4px;font:11px/1.4 var(--vscode-editor-font-family,monospace);color:var(--vscode-descriptionForeground);overflow-wrap:anywhere}
.graph-outline-lines{margin:0;padding:2px 4px 2px 22px;display:flex;flex-direction:column;gap:2px;font:11.5px/1.45 var(--vscode-editor-font-family,monospace);color:var(--vscode-editor-foreground,var(--vscode-foreground))}
.graph-outline-line{min-width:0}
.graph-outline-line code{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere}
.graph-outline-actions{display:flex;flex-wrap:wrap;gap:6px}
.flow-page .graph-outline-action{display:inline-flex;align-items:center;gap:5px;min-width:24px;min-height:26px;padding:3px 8px;border:1px solid var(--vscode-panel-border);border-radius:4px;background:transparent;color:var(--vscode-foreground);font-size:11.5px;white-space:normal;text-align:left}
.flow-page .graph-outline-action[aria-expanded="true"]{border-color:var(--vscode-focusBorder);background:color-mix(in srgb,var(--vscode-focusBorder) 12%,var(--vscode-editor-background))}
.flow-page .graph-outline-action[aria-busy="true"]{cursor:wait;opacity:.55}
.graph-outline-edges{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:6px}
.graph-outline-edges>li{margin:0;min-width:0;max-width:100%}
.flow-page .graph-outline-edge{display:inline-flex;align-items:center;min-width:24px;min-height:26px;max-width:100%;padding:3px 8px;border:1px solid var(--vscode-panel-border);border-radius:4px;background:transparent;color:var(--vscode-foreground);font-size:11.5px;line-height:1.3;white-space:normal;overflow-wrap:anywhere;text-align:left}
.flow-page .graph-outline-edge.taken{border-left:3px solid var(--vscode-charts-green,#5fa77f)}
.flow-page .graph-outline-edge.fallthrough{border-left:3px solid var(--vscode-charts-red,#e47777)}
.flow-page .graph-outline-edge.flow{border-left:3px solid var(--vscode-charts-blue,#64a8eb)}
.flow-page .graph-outline-edge[aria-pressed="true"]{border-color:var(--vscode-focusBorder);background:color-mix(in srgb,var(--vscode-focusBorder) 14%,var(--vscode-editor-background));font-weight:600}
.graph-outline-empty{margin:0;padding:12px;font-size:12px;color:var(--vscode-descriptionForeground)}
.graph-stage button:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:1px}
@media(max-width:720px){
  .graph-stage{flex-direction:column}
  .graph-drawer-bar{display:flex}
  .graph-outline{display:none;position:absolute;top:41px;left:0;right:0;bottom:0;z-index:4;width:100%;max-width:100%;border-right:0;box-shadow:0 6px 16px var(--vscode-widget-shadow)}
  .graph-stage.outline-drawer-open .graph-outline{display:flex}
  .flow-page .graph-outline-close{display:inline-flex}
}
`;

/** Client script synchronizing the HTML graph outline with viewport panning, halos, and SVG clicks. */
export const graphOutlineScript = String.raw`
    graphOutline=(()=>{
      const stage=document.querySelector('[data-graph-stage]');if(!stage){return undefined}
      const outline=document.getElementById('graph-outline-panel'),canvas=stage.querySelector('.flow-canvas');
      const toggleBtn=document.getElementById('graph-outline-toggle'),closeBtn=outline.querySelector('.graph-outline-close');
      const nodeButtons=[...outline.querySelectorAll('.graph-outline-node')],edgeButtons=[...outline.querySelectorAll('.graph-outline-edge')];
      const svgNodes=new Map([...canvas.querySelectorAll('.graph-node')].map(node=>[node.dataset.node,node]));
      const svgEdges=new Map([...canvas.querySelectorAll('[data-edge-key]')].map(edge=>[edge.dataset.edgeKey,edge]));
      let pointerOrigin=false;
      const setDrawerOpen=(open,restoreFocus=false)=>{
        stage.classList.toggle('outline-drawer-open',open);
        toggleBtn?.setAttribute('aria-expanded',String(open));
        if(!open&&restoreFocus){toggleBtn?.focus({preventScroll:true})}
        persist();
      };
      if(samePage&&previous.outlineDrawerOpen===true){stage.classList.add('outline-drawer-open');toggleBtn?.setAttribute('aria-expanded','true')}
      if(samePage&&typeof previous.outlineScrollTop==='number'){outline.scrollTop=previous.outlineScrollTop}
      outline.addEventListener('scroll',schedulePersist,{passive:true});
      toggleBtn?.addEventListener('click',()=>{
        const next=!stage.classList.contains('outline-drawer-open');
        setDrawerOpen(next,false);
        if(next){(outline.querySelector('.graph-outline-node[aria-pressed="true"]')||nodeButtons[0])?.focus({preventScroll:true})}
      });
      closeBtn?.addEventListener('click',()=>setDrawerOpen(false,true));
      outline.addEventListener('keydown',event=>{
        if(event.key==='Escape'&&stage.classList.contains('outline-drawer-open')&&window.matchMedia('(max-width: 720px)').matches){
          event.preventDefault();event.stopPropagation();setDrawerOpen(false,true);
        }
      });
      const clearHalos=()=>{
        for(const node of svgNodes.values()){node.classList.remove('is-focused','is-edge-focus-endpoint')}
        for(const edge of svgEdges.values()){edge.classList.remove('is-focused')}
      };
      const syncSelection=()=>{
        const activeIds=new Set([...svgNodes.values()].filter(node=>node.classList.contains('selected')).map(node=>node.dataset.node));
        for(const btn of nodeButtons){
          const isSelected=activeIds.has(btn.dataset.outlineNode);
          btn.setAttribute('aria-pressed',String(isSelected));
          btn.closest('.graph-outline-item')?.classList.toggle('is-selected',isSelected);
        }
      };
      const syncActiveEdge=edgeKey=>{
        for(const btn of edgeButtons){btn.setAttribute('aria-pressed',String(!!edgeKey&&btn.dataset.outlineEdge===edgeKey))}
      };
      const selectByNodeId=(nodeId,notify=true,follow=true)=>{
        const svgNode=svgNodes.get(nodeId);if(!svgNode){return}
        document.querySelectorAll('.selected').forEach(item=>item.classList.remove('selected'));
        svgNode.classList.add('selected');
        selected=svgNode.dataset.address||'';entry=svgNode.dataset.entry||'';selectedKind=svgNode.dataset.kind||'';selectedLabel=svgNode.dataset.label||'';
        graphViewport?.select([svgNode],follow);
        syncSelection();selectionTools();persist();
        if(notify){send('select')}
      };
      outline.addEventListener('focusin',event=>{
        const edgeBtn=event.target.closest('.graph-outline-edge');
        clearHalos();
        if(edgeBtn){
          const svgEdge=svgEdges.get(edgeBtn.dataset.outlineEdge);
          if(svgEdge){
            svgEdge.classList.add('is-focused');
            svgNodes.get(edgeBtn.dataset.from)?.classList.add('is-edge-focus-endpoint');
            svgNodes.get(edgeBtn.dataset.to)?.classList.add('is-edge-focus-endpoint');
            if(!pointerOrigin){(graphViewport?.focusItem||graphViewport?.reveal)?.(svgEdge)}
          }
          return;
        }
        const item=event.target.closest('[data-outline-item]');
        if(item){
          const svgNode=svgNodes.get(item.dataset.outlineItem);
          if(svgNode){
            svgNode.classList.add('is-focused');
            if(!pointerOrigin){(graphViewport?.focusItem||graphViewport?.reveal)?.(svgNode)}
          }
        }
      });
      outline.addEventListener('focusout',()=>requestAnimationFrame(()=>{if(!outline.contains(document.activeElement)){clearHalos()}}));
      for(const btn of nodeButtons){
        btn.addEventListener('click',()=>{
          canvas.dispatchEvent(new CustomEvent('outline-clear-edge'));
          selectByNodeId(btn.dataset.outlineNode,true,!pointerOrigin);
        });
        btn.addEventListener('dblclick',()=>{
          selectByNodeId(btn.dataset.outlineNode,false,false);
          if(primaryAction){send(state.kind==='callGraph'?'focusCallGraph':primaryAction)}
        });
      }
      for(const btn of edgeButtons){
        btn.addEventListener('click',()=>{
          const edgeKey=btn.dataset.outlineEdge,peerId=btn.dataset.jumpNode;
          canvas.dispatchEvent(new CustomEvent('outline-activate-edge',{detail:{edgeKey}}));
          syncActiveEdge(edgeKey);
          const targetBtn=nodeButtons.find(item=>item.dataset.outlineNode===peerId);
          if(targetBtn){
            const hostItem=targetBtn.closest('.graph-outline-item');
            if(hostItem&&hostItem.hidden){hostItem.hidden=false}
            selectByNodeId(peerId,true,true);
            targetBtn.focus();
          }
        });
      }
      for(const actionBtn of outline.querySelectorAll('.graph-outline-action')){
        actionBtn.addEventListener('click',()=>{
          const kind=actionBtn.dataset.outlineAction;
          if(kind==='decompile'){
            send('decompile',{entry:actionBtn.dataset.entry,address:actionBtn.dataset.entry,kind:'function',label:actionBtn.dataset.label});
          }else if(kind==='focusCallGraph'){
            send('focusCallGraph',{entry:actionBtn.dataset.entry,address:actionBtn.dataset.entry,kind:'function',label:actionBtn.dataset.label});
          }else if(kind==='branch'){
            if(actionBtn.getAttribute('aria-busy')==='true'){return}
            const svgNode=svgNodes.get(actionBtn.dataset.nodeId),view=graphViewport?.snapshot();
            if(svgNode&&view){
              branchAnchor={entry:svgNode.dataset.entry,x:(Number(svgNode.dataset.x)+Number(svgNode.dataset.width)/2)*view.scale+view.x,y:(Number(svgNode.dataset.y)+Number(svgNode.dataset.height)/2)*view.scale+view.y,focusId:actionBtn.id};
            }
            actionBtn.setAttribute('aria-busy','true');persist();
            send('callGraphToggle',{entry:actionBtn.dataset.entry,address:actionBtn.dataset.entry,direction:actionBtn.dataset.direction,graphRoot:state.entry});
          }
        });
      }
      const focusFromCanvas=targetEl=>{
        if(!targetEl||outline.offsetParent===null){return}
        pointerOrigin=true;
        targetEl.scrollIntoView({block:'nearest'});
        targetEl.focus({preventScroll:true});
        pointerOrigin=false;
      };
      const focusNode=nodeId=>{
        syncSelection();
        focusFromCanvas(nodeButtons.find(item=>item.dataset.outlineNode===nodeId));
      };
      const focusEdge=edgeKey=>{
        syncActiveEdge(edgeKey);
        const preferred=edgeButtons.find(btn=>btn.dataset.outlineEdge===edgeKey&&btn.closest('.graph-outline-item')?.classList.contains('is-selected'))||edgeButtons.find(btn=>btn.dataset.outlineEdge===edgeKey);
        focusFromCanvas(preferred);
      };
      syncSelection();
      return {syncSelection,syncActiveEdge,focusNode,focusEdge,scrollTop:()=>outline.scrollTop,drawerOpen:()=>stage.classList.contains('outline-drawer-open')};
    })();
`;
