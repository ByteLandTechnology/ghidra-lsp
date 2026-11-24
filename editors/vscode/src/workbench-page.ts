// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

import { randomBytes } from 'node:crypto';
import { pageStyles } from './page-styles';
import { displayAddress } from './names';
import { iconFontStyles } from './icon-font';
import { escape as escapeHtml } from './web';
import { browserViewScript, viewStyles } from './view-ui';
import { controlFlowStyles, controlFlowScript } from './control-flow-canvas';
import { controlFlowToolbar, controlFlowUiStyles, controlFlowUiScript } from './control-flow-ui';
import { callIcon, callIcons } from './call-graph-icons';
import { callGraphStyles, callGraphScript } from './call-graph-canvas';
import { callColumnsStyles, callColumnsScript, callViewScript } from './call-columns-canvas';

/** Target entity kind attached to interactive rows and graph nodes. */
export type TargetKind = 'instruction' | 'data' | 'bytes' | 'function' | 'block' | 'symbol' | 'address' | 'reference-source' | 'reference-destination';
/** Table row descriptor for workbench browser pages. */
export type Row = { cells: string[]; address?: string; entry?: string; label?: string; kind?: TargetKind; detail?: string };
/** Graph node descriptor shared by control-flow and call graphs. */
export type GraphNode = { id: string; title: string; subtitle?: string; lines?: string[]; address?: string; entry?: string; column?: number; kind?: TargetKind };
/** Directed graph edge descriptor shared by control-flow and call graphs. */
export type GraphEdge = { from: string; to: string; label?: string };
export { escapeHtml };
/** Render `data-*` target attributes for a selectable row or node. */
function targetAttributes(target: Pick<Row, 'address' | 'entry' | 'kind' | 'label'>): string {
    return `${target.address ? ` data-address="${escapeHtml(target.address)}"` : ''}${target.entry ? ` data-entry="${escapeHtml(target.entry)}"` : ''} data-kind="${escapeHtml(target.kind || (target.entry ? 'function' : 'address'))}"${target.label ? ` data-label="${escapeHtml(target.label)}"` : ''}`;
}
/** Column headers whose cells hold formatted addresses. */
const addrHeaders = new Set(['Address', 'Start', 'End', 'Entry', 'Call site', 'From', 'To']);
/** Plain cells; a `ram:` address shows the short form Ghidra uses, with the full address as its tooltip. */
const addressCell = (cell: unknown): string => {
    const full = String(cell ?? ''), shown = displayAddress(full);
    return shown === full ? escapeHtml(full) : `<span title="${escapeHtml(full)}">${escapeHtml(shown)}</span>`;
};
/** Render an interactive data table for a workbench browser panel. */
export const table = (headers: string[], rows: Row[]): string => `<div class="table-wrap"><table><thead><tr>${headers.map(h => `<th scope="col">${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr${targetAttributes(row)}${row.address || row.entry ? ' tabindex="0"' : ''}>${row.cells.map((cell, index) => `<td${addrHeaders.has(headers[index]) ? ' class="addr"' : ''}>${row.detail && index === row.cells.length - 1 ? `<span class="cell-main">${escapeHtml(cell)}</span><span class="cell-detail">${escapeHtml(row.detail)}</span>` : addressCell(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
/** Configuration options for rendering a workbench webview page. */
export interface PageOptions { title: string; subtitle: string; body: string; address?: string; next?: boolean; previous?: boolean; scope?: string; scopeSummary?: string; actions?: boolean; graph?: boolean; controlFlow?: boolean; callGraph?: boolean; viewKind?: string; callView?: 'graph' | 'columns'; callTools?: string; callName?: string; callBack?: boolean; state?: unknown }
/** Render one Codicon glyph from a hexadecimal code point string. */
const icon = (code: string): string => `<span class="call-icon" aria-hidden="true">&#x${code};</span>`;
/** Render a complete CSP-protected HTML workbench page. */
export function page(options: PageOptions): string {
    const nonce = randomBytes(18).toString('base64');
    const flow = options.controlFlow || options.callGraph;
    const cfg = options.controlFlow && !options.callGraph;
    const browser = !flow;
    const browserTools = browser ? `<h1 class="page-context">${escapeHtml(options.title)}</h1>${['callers', 'callees'].includes(options.viewKind || '') ? `<p class="scope">${escapeHtml(options.subtitle)}</p>` : ''}<div class="toolbar" role="group" aria-label="Page tools">${options.address !== undefined ? `<form id="goto"><input id="address" aria-label="Address" value="${escapeHtml(displayAddress(options.address ?? ''))}" placeholder="Go to address…"><button type="submit" aria-label="Go to address" title="Go to address">${callIcon('right')}</button></form>` : ''}<div class="browser-search">${callIcon('search')}<input class="search" id="search" aria-label="Filter displayed rows" placeholder="Filter rows…"></div><details id="page-options" class="page-options"><summary id="page-options-summary" aria-label="View options" title="View options">${callIcon('more')}</summary><div class="page-options-content"><div class="page-options-actions" role="group" aria-label="Page actions"><button id="page-refresh" class="icon-button" data-action="refresh" aria-label="Refresh" title="Refresh">${callIcon('refresh')}</button></div>${options.viewKind === 'listing' ? '<label><input id="listing-details" type="checkbox">Show bytes and kind</label>' : ''}${['strings', 'references', 'callers', 'callees', 'imports', 'exports'].includes(options.viewKind || '') ? '<label><input id="extra-columns" type="checkbox">Show details</label>' : ''}${options.scope ? `<p>${escapeHtml(options.subtitle)}</p><p>${escapeHtml(options.scope)}</p>` : ''}</div></details></div>${options.actions ? `<div class="toolbar selection-tools" role="group" aria-label="Selected item actions" aria-describedby="selection-label" hidden><span id="selection-label"></span><div id="selection-primary" class="selection-buttons"></div><details id="more-actions" class="more-actions" hidden><summary id="more-summary" aria-label="More actions" title="More actions">${callIcon('more')}</summary><div id="selection-more" class="selection-buttons" role="group" aria-label="Additional actions"></div></details></div>` : ''}` : '';
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';"><title>${escapeHtml(options.title)}</title><style nonce="${nonce}">
    ${pageStyles}
    main{max-width:1450px}
    #goto{display:flex;gap:6px;flex:0 1 auto;min-width:0}
    #address{width:190px;font-family:var(--vscode-editor-font-family,monospace)}
    .search{flex:1 1 180px;max-width:480px}
    .selection-tools{padding-bottom:12px;border-bottom:1px solid var(--vscode-panel-border)}
    .selection-buttons{display:flex;flex-wrap:wrap;gap:8px;min-width:0}
    .more-actions{margin:0;padding:0;border:0;max-width:100%}
    .more-actions>summary{font-weight:400;min-height:28px;padding:4px 10px;border:1px solid var(--vscode-contrastBorder,var(--vscode-panel-border));border-radius:2px;background:var(--vscode-button-secondaryBackground,var(--vscode-input-background));color:var(--vscode-button-secondaryForeground,var(--vscode-foreground))}
    .more-actions>summary:hover{background:var(--vscode-button-secondaryHoverBackground,var(--vscode-list-hoverBackground))}
    .more-actions[open]{flex-basis:100%}.more-actions[open]>summary{display:list-item;width:fit-content;margin-bottom:8px}
    #selection-label{flex:0 1 auto;margin-right:4px;font-size:12px;color:var(--vscode-descriptionForeground);overflow-wrap:anywhere}
    td{white-space:pre-wrap}
    tr[data-address],tr[data-entry]{cursor:pointer}
    .mono table{table-layout:fixed;min-width:760px}
    .mono th:nth-child(1){width:150px}.mono th:nth-child(3){width:210px}.mono th:nth-child(4){width:100px}
    .mono td:nth-child(-n+3),.hex td,.node-line{font-family:var(--vscode-editor-font-family,monospace)}
    .listing-meta{display:none}
    .listing-options{display:flex;align-items:center;gap:8px;margin-bottom:8px}
    .listing:not(.show-details) th:nth-child(n+3),.listing:not(.show-details) td:nth-child(n+3){display:none}
    .listing-meta{margin-top:5px;color:var(--vscode-descriptionForeground);font-size:11px}
    .listing-meta span{display:block;white-space:pre-wrap;overflow-wrap:anywhere}
    .hex table{min-width:780px}.hex td:nth-child(2){white-space:pre}
    .scope,.notice{font-size:12px;color:var(--vscode-descriptionForeground);margin:12px 0}
    .graph-wrap{max-width:100%;overflow:auto;border:1px solid var(--vscode-panel-border);border-radius:2px}
    .graph-node{cursor:pointer}.graph-node rect{fill:var(--vscode-editor-background);stroke:var(--vscode-panel-border)}
    .graph-node:hover rect,.graph-node.selected rect,.graph-node:focus-visible rect{stroke:var(--vscode-focusBorder);stroke-width:2}
    .graph-node.search-muted{opacity:.35}.graph-node.search-match rect{stroke:var(--vscode-focusBorder);stroke-width:2}
    .graph-node text{fill:var(--vscode-foreground);pointer-events:none}.node-title{font-weight:600;font-size:14px}
    .node-subtitle,.node-line{font-size:11px}.node-subtitle{fill:var(--vscode-descriptionForeground)}
    .edge{fill:none;stroke:var(--vscode-charts-blue);stroke-width:1.5}marker path{fill:var(--vscode-charts-blue)}
    .edge-label{fill:var(--vscode-descriptionForeground);font-size:10px}
    .pagination{display:flex;gap:8px;margin-top:16px}
    @media(max-width:720px){.listing table{min-width:0}.listing th:first-child{width:126px}.listing td:first-child{white-space:normal;overflow-wrap:anywhere}.listing th:nth-child(n+3),.listing td:nth-child(n+3){display:none}.listing-options{display:flex;align-items:center;gap:8px;margin-bottom:8px}.listing.show-details .listing-meta{display:block}}
    @media(max-width:640px){#selection-label{flex-basis:100%}#goto{flex:1 1 100%}#address{flex:1;width:0}.search{max-width:none}#goto button{white-space:nowrap}}
    ${flow ? controlFlowStyles : ''}
    ${cfg ? controlFlowUiStyles : ''}
    ${iconFontStyles}
    ${options.callGraph ? callGraphStyles + callColumnsStyles : ''}
    ${browser ? viewStyles : ''}
    </style></head><body${flow ? ` class="flow-page${options.callGraph ? ' call-page' : cfg ? ' cfg-page' : ''}"` : ' class="browser-page"'} data-view-kind="${escapeHtml(options.viewKind || '')}"><main>${options.callGraph ? `<div class="call-topbar" role="group" aria-label="Call graph tools"><button id="call-back" class="call-icon-button" data-action="callGraphBack" aria-label="Back" title="Back" ${options.callBack ? '' : 'disabled'}>${icon('ea9b')}</button><h1 class="call-function-title" title="${escapeHtml(options.callName)}"><button id="call-function-picker" data-action="pickCallGraphFunction" aria-label="Choose function: ${escapeHtml(options.callName)}" title="${escapeHtml(options.callName)} · Choose function">${callIcon('function')}<span class="call-function-name">${escapeHtml(options.callName)}</span>${callIcon('down')}</button></h1><div class="call-search" hidden><input id="search" class="search" aria-label="Find functions" placeholder="Find functions…"></div><div class="call-view-switch" role="group" aria-label="Call graph presentation"><button id="call-view-graph" data-call-view="graph" aria-label="Graph view" title="Graph view" aria-pressed="${options.callView !== 'columns'}">${callIcon('graph')}<span>Graph</span></button><button id="call-view-columns" data-call-view="columns" aria-label="Column view" title="Column view" aria-pressed="${options.callView === 'columns'}">${callIcon('columns')}<span>Columns</span></button></div><button id="call-search-toggle" class="call-icon-button" aria-label="Find functions" aria-expanded="false" title="Find functions (/)">${icon('ea6d')}</button>${options.callView !== 'columns' ? `<button id="graph-fit" class="call-icon-button" aria-label="Fit graph" title="Fit the entire graph (0)">${callIcon('fit')}</button>` : ''}<details id="call-menu"><summary id="call-menu-summary" aria-label="Graph options" title="Graph options">${icon('ea7c')}</summary><div class="call-menu-content">${options.callTools || ''}</div></details></div>${options.callView !== 'columns' ? `<div class="call-zoom" role="group" aria-label="Zoom"><button id="graph-zoom-out" aria-label="Zoom out">${icon('eb3b')}</button><button id="graph-zoom" aria-label="Actual size" title="Actual size (100%)">100%</button><button id="graph-zoom-in" aria-label="Zoom in">${icon('ea60')}</button></div>` : ''}` : cfg ? controlFlowToolbar(options.title, options.subtitle, options.body.includes('data-control-flow')) : browserTools}

    <p id="filter-status" role="status" aria-live="polite" hidden></p>${options.scope && !browser ? `<p class="scope">${escapeHtml(options.scope)}</p>` : ''}${options.body}${browser ? '<div class="no-results" hidden><span>No matching rows.</span><button type="button" id="clear-filter" class="icon-button" aria-label="Clear filter" title="Clear filter">' + callIcon('close') + '</button></div>' : ''}${options.next || options.previous ? `<div class="pagination"><button class="icon-button" data-action="previous" aria-label="Previous page" title="Previous page" ${!options.previous ? 'disabled' : ''}>${callIcon('left')}</button><button class="icon-button" data-action="next" aria-label="Next page" title="Next page" ${!options.next ? 'disabled' : ''}>${callIcon('right')}</button></div>` : ''}</main><script nonce="${nonce}">
    const vscode=acquireVsCodeApi();const previous=vscode.getState()||{};const state=${JSON.stringify(options.state ?? {}).replace(/</g, '\\u003c')};
    const samePanel=previous.md5===state.md5&&previous.kind===state.kind;
    const samePage=samePanel&&previous.address===state.address${flow ? '&&previous.entry===state.entry' : ''};
    let selected=samePage?previous.selected||state.selected||'':state.selected||'';let entry=samePage?previous.selectedEntry||'':state.selectedEntry||'';
    let selectedKind=samePage?previous.selectedKind||'':'';let selectedLabel=samePage?previous.selectedLabel||'':'';let primaryAction='decompile';
    const selectable=[...document.querySelectorAll('tr[data-address],tr[data-entry],.graph-node')];
    const search=document.getElementById('search');search.value=state.kind==='callGraph'&&!samePage?'':previous.filter||'';
    const addressInput=document.getElementById('address');if(addressInput&&samePage&&typeof previous.addressDraft==='string'){addressInput.value=previous.addressDraft}
    const extraColumns=document.getElementById('extra-columns');if(extraColumns){extraColumns.checked=samePage&&previous.extraColumns===true;document.body.classList.toggle('show-extra-columns',extraColumns.checked)}
    const memoryMap=document.querySelector('.memory-map');if(memoryMap&&samePage){memoryMap.open=previous.mapOpen===true}
    const listingDetails=document.getElementById('listing-details');if(listingDetails){listingDetails.checked=samePage&&previous.listingDetails===true;document.querySelector('.listing').classList.toggle('show-details',listingDetails.checked)}
    let graphViewport;let branchAnchor;let cfgOverviewPosition=samePage?previous.cfgOverviewPosition:undefined;let cfgOverviewDismissed=samePage&&previous.cfgOverviewDismissed===true;let columnUi=samePage?previous.columnUi:undefined;
    let persistFrame=0;
    const closePanel=(panel,trigger)=>{if(!panel){return}if(panel.contains(document.activeElement)){trigger?.focus({preventScroll:true})}panel.open=false;panel.hidden=true};
    const persist=()=>{if(persistFrame){cancelAnimationFrame(persistFrame);persistFrame=0}vscode.setState({...state,selected,selectedEntry:entry,selectedKind,selectedLabel,filter:search.value,addressDraft:addressInput?.value,mapOpen:memoryMap?.open,listingDetails:listingDetails?.checked,extraColumns:extraColumns?.checked,branchAnchor,callDetails:document.querySelector('.call-details')?.open??(samePage?previous.callDetails:undefined),callOverview:document.querySelector('.call-overview')?.open??(samePage?previous.callOverview:undefined),cfgOverview:document.querySelector('.cfg-overview')?.open,cfgOverviewPosition,cfgOverviewDismissed,cfgActiveEdge:document.querySelector('.cfg-edge.is-active')?.dataset.edgeKey,tableScroll:[...document.querySelectorAll('.table-wrap')].map(table=>({top:table.scrollTop,left:table.scrollLeft})),scrollX:window.scrollX,scrollY:window.scrollY,focusId:branchAnchor?.focusId||document.activeElement?.id,hadFocus:!!document.activeElement&&document.activeElement!==document.body,columnUi,graphViewport:graphViewport?.snapshot()||(samePage?previous.graphViewport:undefined)})};
    const schedulePersist=()=>{if(!persistFrame){persistFrame=requestAnimationFrame(()=>{persistFrame=0;persist()})}};
    memoryMap?.addEventListener('toggle',persist);
    for(const wrap of document.querySelectorAll('.table-wrap')){wrap.addEventListener('scroll',schedulePersist,{passive:true})}
    ${flow ? controlFlowScript : ''}
    listingDetails?.addEventListener('change',()=>{document.querySelector('.listing').classList.toggle('show-details',listingDetails.checked);persist()});
    extraColumns?.addEventListener('change',()=>{document.body.classList.toggle('show-extra-columns',extraColumns.checked);persist()});
    const menus=[...document.querySelectorAll('#call-menu,#page-options,#more-actions')];
    const closeMenu=(menu,restore=false)=>{if(!menu?.open){return}const summary=menu.querySelector(':scope > summary');if(restore||menu.contains(document.activeElement)){summary?.focus({preventScroll:true})}menu.open=false};
    for(const menu of menus){
      const summary=menu.querySelector(':scope > summary');
      menu.addEventListener('keydown',event=>{
        if(event.key==='Escape'&&menu.open){event.preventDefault();event.stopPropagation();closeMenu(menu,true);persist();return}
        if(event.target.matches('select,input:not([type="checkbox"]),textarea')||!['ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Home','End'].includes(event.key)){return}
        if(!menu.open){if(!['ArrowDown','ArrowUp'].includes(event.key)){return}menu.open=true}
        const items=[...menu.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),summary')].filter(item=>item!==summary&&!item.closest('[hidden]')&&[...menu.querySelectorAll('details:not([open])')].every(d=>!d.contains(item)||d.querySelector(':scope > summary')===item));
        if(!items.length){return}
        event.preventDefault();event.stopPropagation();
        const index=items.indexOf(document.activeElement),forward=event.key==='ArrowDown'||event.key==='ArrowRight';
        const next=event.key==='Home'?0:event.key==='End'?items.length-1:forward?(index+1)%items.length:(index<=0?items.length-1:index-1);
        items[next]?.focus()
      });
      menu.addEventListener('focusout',event=>{
        if(event.relatedTarget&&!menu.contains(event.relatedTarget)){menu.open=false}
        else if(!event.relatedTarget){requestAnimationFrame(()=>{if(menu.open&&!menu.contains(document.activeElement)){menu.open=false}})}
      });
      menu.addEventListener('click',event=>{
        const button=event.target.closest('button');
        if(button&&!button.disabled&&!summary?.contains(button)){closeMenu(menu,true);persist()}
      });
    }
    const target=()=>{
      const fn=entry||(!selected?state.entry||'':'');const address=selected||state.address||fn||'';
      const row=selectable.find(item=>address&&item.dataset.address===address&&(!fn||item.dataset.entry===fn));
      return {address,entry:fn,kind:row?.dataset.kind||selectedKind||(fn?'function':state.kind==='memory'?'bytes':'address'),label:row?.dataset.label||selectedLabel||''};
    };
    const send=(action,extra={})=>vscode.postMessage({action,...target(),...extra});
    const more=document.getElementById('more-actions');const moreSummary=document.getElementById('more-summary');
    const selectionTools=()=>{
      if(state.kind==='callGraph'){primaryAction='decompile';const focus=document.getElementById('call-focus');if(focus){const fn=target().entry;focus.disabled=!fn||fn===state.entry;focus.hidden=focus.disabled}return}
      const label=document.getElementById('selection-label');if(!label){return}
      const activeRow=selectable.find(row=>selected?row.dataset.address===selected:entry&&row.dataset.entry===entry);
      const visibleSelection=!!activeRow&&!activeRow.hidden&&!activeRow.closest('details:not([open])');
      label.closest('.selection-tools').hidden=!visibleSelection;document.body.classList.toggle('has-selection',visibleSelection);
      const current=target();const at=current.address;const fn=current.entry;const kind=current.kind;
      const focusGraph=document.getElementById('call-focus');if(focusGraph){focusGraph.disabled=!fn||fn===state.entry;focusGraph.hidden=focusGraph.disabled}
      const nouns={instruction:'Instruction',data:'Data',bytes:'Byte address',block:'Block',symbol:'Symbol',address:'Address','reference-source':'Reference source','reference-destination':'Reference destination'};
      const short=value=>/^ram:[0-9a-f]+$/i.test(value||'')?value.slice(4):value;label.title=[fn,at].filter(Boolean).join(' · ');label.textContent=fn?'Function '+(current.label&&kind==='function'?current.label+' · ':'')+short(fn)+(at&&at!==fn?' · Location '+short(at):''):at?(nouns[kind]||'Address')+(kind==='symbol'&&current.label?' '+current.label+' · ':' ')+short(at):'Select a row or node';
      if(state.kind==='callGraph'&&fn){const name=document.createElement('strong'),at=document.createElement('span');name.textContent=current.label||fn;at.textContent=fn;label.replaceChildren(name,at)}
      label.title=label.textContent;
      const canFunction=!!fn||kind==='instruction'||kind==='block';
      const navigation=fn?'Decompile function':kind==='instruction'?'Decompile containing function':kind==='symbol'?'Go to symbol address':kind==='reference-source'?'Go to source address':kind==='reference-destination'?'Go to destination address':'Go to address';
      const items=[
        {action:'decompile',label:navigation,available:canFunction||!['data','bytes','block'].includes(kind)},
        {action:'listing',label:kind==='block'?'Show block in Listing':kind==='data'?'Show data in Listing':'Show location in Listing',available:true},
        {action:'memory',label:state.kind==='memory'?'Read selected bytes':'Read bytes at location',available:true},
        {action:'references',label:'References at location',available:true},
        {action:'callGraph',label:fn?'Calls for function':'Calls for containing function',available:canFunction&&state.kind!=='callGraph'},
        {action:'controlFlow',label:fn?'Control flow of function':'Control flow of containing function',available:canFunction}
      ].filter(item=>item.available&&(item.action!==state.kind||(['callGraph','controlFlow'].includes(state.kind)?!!entry&&entry!==state.entry:['memory','references'].includes(state.kind)?!!selected&&selected!==state.address:false)));
      primaryAction=kind==='block'?'listing':fn||kind==='instruction'?'decompile':['data','bytes'].includes(kind)?state.kind==='listing'?'memory':'listing':'decompile';
      if(!items.some(item=>item.action===primaryAction)){primaryAction=items[0]?.action||''}
      const main=items.filter(item=>item.action===primaryAction).sort((a,b)=>Number(b.action===primaryAction)-Number(a.action===primaryAction));
      const extra=items.filter(item=>!main.includes(item));
      const active=document.activeElement?.dataset.action;const hosts=[document.getElementById('selection-primary'),document.getElementById('selection-more')];
      for(const [index,actions] of [main,extra].entries()){
        hosts[index].replaceChildren(...actions.map(item=>{const button=document.createElement('button');const destination=['decompile','callGraph','controlFlow'].includes(item.action)&&fn?fn:at;button.type='button';button.id='action-'+item.action;button.dataset.action=item.action;button.textContent=document.body.classList.contains('browser-page')?({listing:'Listing',memory:'Bytes',references:'References',callGraph:'Call graph',controlFlow:'Control flow',decompile:fn||kind==='instruction'||kind==='block'?'Decompile':'Open'}[item.action]||item.label):item.label;if(document.body.classList.contains('browser-page')||state.kind==='callGraph'){button.textContent='';const glyph=document.createElement('span');glyph.className='call-icon';glyph.setAttribute('aria-hidden','true');glyph.textContent=String.fromCodePoint((${JSON.stringify(callIcons)})[item.action]||${callIcons.function});button.append(glyph);button.classList.add('icon-only');button.setAttribute('aria-label',item.label)}button.title=item.label+(destination?' · '+destination:'');button.disabled=!at&&!fn;if(item.action===primaryAction&&document.body.classList.contains('browser-page')){button.classList.add('primary')}return button}));
      }
      more.hidden=!extra.length;moreSummary.title='More actions'+(current.label?' for '+current.label:at?' at '+at:'');moreSummary.setAttribute('aria-label',moreSummary.title);
      if(active){const restore=document.getElementById('action-'+active);if(restore){restore.focus({preventScroll:true})}}
    };selectionTools();
    document.addEventListener('click',event=>{for(const menu of menus){if(menu.open&&!menu.contains(event.target)){menu.open=false}}const button=event.target.closest('button[data-action]');if(button&&!button.disabled){persist();send(button.dataset.action)}});
    document.addEventListener('keydown',event=>{if(event.key==='Escape'){const openMenu=menus.find(menu=>menu.open);if(openMenu){event.preventDefault();closeMenu(openMenu,true);persist()}}});
    document.getElementById('goto')?.addEventListener('submit',event=>{event.preventDefault();send('goto',{address:document.getElementById('address').value})});
    selectable.forEach(row=>{
      if((selected&&row.dataset.address===selected)||(!selected&&entry&&row.dataset.entry===entry)){row.classList.add('selected')}
      const pick=(notify=true)=>{document.querySelectorAll('.selected').forEach(item=>item.classList.remove('selected'));row.classList.add('selected');selected=row.dataset.address||'';entry=row.dataset.entry||'';selectedKind=row.dataset.kind||'';selectedLabel=row.dataset.label||'';graphViewport?.select([row],false);selectionTools();persist();if(notify){send('select')}};
      row.addEventListener('click',event=>{if(!event.target.closest('.call-node-controls,.cfg-node-controls')){pick()}});row.addEventListener('dblclick',event=>{if(event.target.closest('.call-node-controls,.cfg-node-controls')){return}pick(false);if(primaryAction){send(state.kind==='callGraph'?'focusCallGraph':primaryAction)}});row.addEventListener('keydown',event=>{if(event.target.closest('.call-node-controls,.cfg-node-controls')){return}if(event.key==='Enter'){event.preventDefault();pick();if(primaryAction){send(state.kind==='callGraph'?'focusCallGraph':primaryAction)}}else if(event.key===' '){event.preventDefault();pick()}else if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){const tbody=row.closest('tbody');if(!tbody){return}const rows=[...tbody.querySelectorAll('tr[data-address]:not([hidden]),tr[data-entry]:not([hidden])')],index=rows.indexOf(row),next=event.key==='Home'?0:event.key==='End'?rows.length-1:Math.max(0,Math.min(rows.length-1,index+(event.key==='ArrowDown'?1:-1)));event.preventDefault();rows[next]?.focus();rows[next]?.scrollIntoView({block:'nearest'})}});
    });
    const filter=()=>{
      if(document.querySelector('[data-call-columns]')){return}
      const query=search.value.toLowerCase(),rows=[...document.querySelectorAll('tbody tr')],browserPage=document.body.classList.contains('browser-page');let visible=0,total=0;
      for(const row of rows){row.hidden=!row.textContent.toLowerCase().includes(query);if(!browserPage||!row.closest('details:not([open])')){total++;if(!row.hidden){visible++}}}
      const nodes=[...document.querySelectorAll('.graph-node')];let matched=0;
      for(const node of nodes){const match=!!query&&(node.textContent.toLowerCase().includes(query)||(node.dataset.address||'').toLowerCase().includes(query));node.classList.toggle('search-match',match);node.classList.toggle('search-muted',!!query&&!match);if(match){matched++}}
      if(browserPage){
        for(const table of document.querySelectorAll('.table-wrap')){
          const tableRows=[...table.querySelectorAll('tbody tr')],hasMatch=tableRows.some(row=>!row.hidden);
          table.hidden=!tableRows.length||!!query&&!hasMatch;
          if(state.kind==='references'||state.kind==='memory'&&table.closest('.hex')){const section=table.closest('section');if(section)section.hidden=!!query&&!hasMatch}
        }
        selectionTools();for(const message of document.querySelectorAll('.table-empty,.empty'))message.hidden=!!query;
      }
      const status=document.getElementById('filter-status'),empty=document.querySelector('.no-results');
      const collapsedMatches=browserPage&&!!query&&rows.some(row=>!row.hidden&&row.closest('.memory-map:not([open])'));
      if(empty){empty.hidden=!query||visible>0;empty.querySelector('span').textContent=collapsedMatches?'Matches in collapsed memory map.':'No matching rows.'}status.hidden=!query;status.classList.toggle('sr-filter-status',!!empty&&!!query&&!visible);
      status.textContent=nodes.length?matched+' of '+nodes.length+' nodes match'+(total?'; '+visible+' of '+total+' rows match.':'.'):visible?visible+' of '+total+' displayed rows match.':collapsedMatches?'Matches in collapsed memory map.':'No displayed rows match this filter.';
    };
    search.addEventListener('input',()=>{filter();persist()});memoryMap?.addEventListener('toggle',filter);addressInput?.addEventListener('input',persist);filter();
    window.addEventListener('scroll',schedulePersist,{passive:true});document.addEventListener('focusin',persist);
    window.addEventListener('message',event=>{if(event.data.action==='highlight'){document.querySelectorAll('.selected').forEach(item=>item.classList.remove('selected'));const addresses=event.data.addresses||[event.data.address];const rows=selectable.filter(item=>addresses.includes(item.dataset.address));rows.forEach(row=>row.classList.add('selected'));graphViewport?.select(rows,true);const row=rows[0];if(row){if(!graphViewport){row.scrollIntoView({block:'nearest'})}selected=row.dataset.address||'';entry=row.dataset.entry||'';selectedKind=row.dataset.kind||'';selectedLabel=row.dataset.label||'';selectionTools();persist()}}});
    ${browser ? browserViewScript : ''}
    ${options.callGraph ? callViewScript + callGraphScript + callColumnsScript : cfg ? controlFlowUiScript : ''}
    requestAnimationFrame(()=>{if(state.analysisUri){send('ready')}if(samePage){[...document.querySelectorAll('.table-wrap')].forEach((table,index)=>{table.scrollTop=previous.tableScroll?.[index]?.top||0;table.scrollLeft=previous.tableScroll?.[index]?.left||0});window.scrollTo(previous.scrollX||0,previous.scrollY||0)}if(samePanel&&!(samePage&&previous.columnUi?.pendingFocus!==undefined)){const target=previous.focusId?document.getElementById(previous.focusId):null;const usable=target&&!target.disabled&&!target.closest('[hidden]')&&[...document.querySelectorAll('details:not([open])')].every(d=>!d.contains(target)||d.querySelector(':scope > summary')===target)?target:null;if(usable){usable.focus({preventScroll:true})}else if(previous.focusId||previous.hadFocus){(document.querySelector('.call-node.is-root')||document.querySelector('.call-column-row:not([hidden]) .call-column-pick:not(:disabled)')||document.querySelector('#call-function-picker,#address,#search')||document.querySelector('button:not(:disabled)'))?.focus({preventScroll:true})}}persist();document.body.dataset.viewReady='true'});
    </script></body></html>`;
}
