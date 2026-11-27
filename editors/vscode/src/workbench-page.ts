// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

import { randomBytes } from 'node:crypto';
import { pageStyles } from './page-styles';
import { displayAddress } from './names';
import { iconFontStyles } from './icon-font';
import { domId, escape as escapeHtml, gotoFormHtml, liveRegionsHtml, object } from './web';
import { browserLiveRegions, browserStateScript, browserViewScript, fitGraphTitle, moreActionsPopover, pageOptionsPopover, searchShortcutTitle, viewStyles, webviewPopoverScript, webviewShortcutScript } from './view-ui';
import { controlFlowStyles, controlFlowScript } from './control-flow-canvas';
import { controlFlowToolbar, controlFlowUiStyles, controlFlowUiScript } from './control-flow-ui';
import { callIcon, callIcons } from './call-graph-icons';
import { callGraphStyles, callGraphScript } from './call-graph-canvas';
import { callColumnsStyles, callColumnsScript, callViewScript } from './call-columns-canvas';

/** Target entity kind attached to interactive rows and graph nodes. */
export type TargetKind = 'instruction' | 'data' | 'bytes' | 'function' | 'block' | 'symbol' | 'address' | 'reference-source' | 'reference-destination';
/** Table row descriptor for workbench browser pages. */
export type Row = { cells: string[]; address?: string; entry?: string; label?: string; kind?: TargetKind; detail?: string; selected?: boolean };
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
export function table(headers: string[], rows: Row[]): string {
    const seen = new Map<string, number>();
    const rowIdAttr = (row: Row): string => {
        if (!row.address && !row.entry) { return ''; }
        const base = domId('row', `${row.kind || ''}-${row.address || ''}-${row.entry || ''}`);
        const count = (seen.get(base) || 0) + 1;
        seen.set(base, count);
        return ` id="${count > 1 ? `${base}-${count}` : base}"`;
    };
    return `<div class="table-wrap"><table><thead><tr>${headers.map(h => `<th scope="col">${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => {
        const focusable = Boolean(row.address || row.entry);
        const active = Boolean(focusable && row.selected);
        return `<tr${rowIdAttr(row)}${targetAttributes(row)}${focusable ? ' tabindex="0"' : ''}${active ? ' class="selected" aria-current="true"' : ''}>${row.cells.map((cell, index) => `<td${addrHeaders.has(headers[index]) ? ' class="addr"' : ''}>${row.detail && index === row.cells.length - 1 ? `<span class="cell-main">${escapeHtml(cell)}</span><span class="cell-detail">${escapeHtml(row.detail)}</span>` : addressCell(cell)}</td>`).join('')}</tr>`;
    }).join('')}</tbody></table></div>`;
}
/** Configuration options for rendering a workbench webview page. */
export interface PageOptions { title: string; subtitle: string; body: string; address?: string; next?: boolean; previous?: boolean; scope?: string; scopeSummary?: string; actions?: boolean; graph?: boolean; controlFlow?: boolean; callGraph?: boolean; viewKind?: string; callView?: 'graph' | 'columns'; callTools?: string; callName?: string; callBack?: boolean; singleKeyShortcuts?: boolean; state?: unknown; busy?: boolean; error?: string }
/** Render one Codicon glyph from a hexadecimal code point string. */
const icon = (code: string): string => `<span class="call-icon" aria-hidden="true">&#x${code};</span>`;
/** Render a complete CSP-protected HTML workbench page. */
export function page(options: PageOptions): string {
    const nonce = randomBytes(18).toString('base64');
    const stateObj = object(options.state);
    const singleKeyShortcuts = options.singleKeyShortcuts ?? (typeof stateObj.singleKeyShortcuts === 'boolean' ? stateObj.singleKeyShortcuts : true);
    const initialState = { ...stateObj, singleKeyShortcuts };
    const flow = options.controlFlow || options.callGraph;
    const cfg = options.controlFlow && !options.callGraph;
    const browser = !flow;
    const browserOptions = `${options.viewKind === 'listing' ? '<label><input id="listing-details" type="checkbox">Show bytes and kind</label>' : ''}${['strings', 'references', 'callers', 'callees', 'imports', 'exports'].includes(options.viewKind || '') ? '<label><input id="extra-columns" type="checkbox">Show details</label>' : ''}<div id="page-options-scope">${options.scope ? `<p>${escapeHtml(options.subtitle)}</p><p>${escapeHtml(options.scope)}</p>` : ''}</div>`;
    const browserTools = browser ? `<h1 id="page-title" class="page-context">${escapeHtml(options.title)}</h1><p id="browser-subtitle-scope" class="scope"${['callers', 'callees'].includes(options.viewKind || '') ? '' : ' hidden'}>${escapeHtml(options.subtitle)}</p><div class="toolbar" role="group" aria-label="Page tools">${options.address !== undefined ? gotoFormHtml(displayAddress(options.address ?? ''), 'Address', 'Go to address…') : ''}<div class="browser-search">${callIcon('search')}<input class="search" id="search" aria-label="Filter displayed rows" placeholder="Filter rows…"></div>${pageOptionsPopover(browserOptions)}</div>${options.actions ? `<div class="toolbar selection-tools" role="group" aria-label="Selected item actions" aria-describedby="selection-label" hidden><span id="selection-label"></span><div id="selection-primary" class="selection-buttons"></div>${moreActionsPopover()}</div>` : ''}` : '';
    const bodyClass = `${flow ? `flow-page${options.callGraph ? ' call-page' : cfg ? ' cfg-page' : ''}` : 'browser-page'}${options.busy ? ' is-busy' : ''}`;
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';"><title>${escapeHtml(options.title)}</title><style nonce="${nonce}">
    ${pageStyles}
    main{max-width:1450px}
    #goto{display:flex;gap:6px;flex:0 1 auto;min-width:0}
    #address{width:190px;font-family:var(--vscode-editor-font-family,monospace)}
    .search{flex:1 1 180px;max-width:480px}
    .selection-tools{padding-bottom:12px;border-bottom:1px solid var(--vscode-panel-border)}
    .selection-buttons{display:flex;flex-wrap:wrap;gap:8px;min-width:0}
    #selection-label{flex:0 1 auto;margin-right:4px;font-size:12px;color:var(--ghidra-muted);overflow-wrap:anywhere}
    td{white-space:pre-wrap}
    tr[data-address],tr[data-entry]{cursor:pointer}
    .mono table{table-layout:fixed;min-width:760px}
    .mono th:nth-child(1){width:150px}.mono th:nth-child(3){width:210px}.mono th:nth-child(4){width:100px}
    .mono td:nth-child(-n+3),.hex td,.node-line{font-family:var(--vscode-editor-font-family,monospace)}
    .listing-meta{display:none}
    .listing-options{display:flex;align-items:center;gap:8px;margin-bottom:8px}
    .listing:not(.show-details) th:nth-child(n+3),.listing:not(.show-details) td:nth-child(n+3){display:none}
    .listing-meta{margin-top:5px;color:var(--ghidra-muted);font-size:11px}
    .listing-meta span{display:block;white-space:pre-wrap;overflow-wrap:anywhere}
    .hex table{min-width:780px}.hex td:nth-child(2){white-space:pre}
    .scope,.notice{font-size:12px;color:var(--ghidra-muted);margin:12px 0}
    .graph-wrap{max-width:100%;overflow:auto;border:1px solid var(--vscode-panel-border);border-radius:2px}
    .graph-node{cursor:pointer}.graph-node.search-muted{opacity:.35}
    .node-title{font-weight:600;font-size:14px}
    .node-subtitle,.node-line{font-size:11px}.node-subtitle{color:var(--ghidra-muted);fill:var(--ghidra-muted)}
    .edge{fill:none;stroke:var(--vscode-charts-blue);stroke-width:1.5}marker path{fill:var(--vscode-charts-blue)}
    .edge-label{fill:var(--ghidra-muted);font-size:10px}
    .pagination{display:flex;gap:8px;margin-top:16px}
    .pagination[hidden]{display:none}
    @media(max-width:720px){.listing table{min-width:0}.listing th:first-child{width:126px}.listing td:first-child{white-space:normal;overflow-wrap:anywhere}.listing th:nth-child(n+3),.listing td:nth-child(n+3){display:none}.listing-options{display:flex;align-items:center;gap:8px;margin-bottom:8px}.listing.show-details .listing-meta{display:block}}
    @media(max-width:640px){#selection-label{flex-basis:100%}#goto{flex:1 1 100%}#address{flex:1;width:0}.search{max-width:none}#goto button{white-space:nowrap}}
    ${flow ? controlFlowStyles : ''}
    ${cfg ? controlFlowUiStyles : ''}
    ${iconFontStyles}
    ${options.callGraph ? callGraphStyles + callColumnsStyles : ''}
    ${browser ? viewStyles : ''}
    </style></head><body class="${bodyClass}" data-view-kind="${escapeHtml(options.viewKind || '')}"${options.busy ? ' aria-busy="true"' : ''}><main>${options.callGraph ? `<div class="flow-topbar call-topbar" role="group" aria-label="Call graph tools"><div class="flow-topbar-primary call-topbar-primary"><button type="button" id="call-graph-back" class="call-icon-button" data-action="callGraphBack" aria-label="Back" title="Back" ${options.callBack ? '' : 'disabled'}>${icon('ea9b')}</button><h1 class="call-function-title" title="${escapeHtml(options.callName)}"><button type="button" id="call-function-picker" data-action="pickCallGraphFunction" aria-label="Choose function: ${escapeHtml(options.callName)}" title="${escapeHtml(options.callName)} · Choose function">${callIcon('function')}<span class="call-function-name">${escapeHtml(options.callName)}</span>${callIcon('down')}</button></h1></div><div class="flow-topbar-controls call-view-switch" role="group" aria-label="Call graph presentation"><button type="button" id="call-view-graph" data-call-view="graph" aria-label="Graph view" title="Graph view" aria-pressed="${options.callView !== 'columns'}">${callIcon('graph')}<span>Graph</span></button><button type="button" id="call-view-columns" data-call-view="columns" aria-label="Columns view" title="Columns view" aria-pressed="${options.callView === 'columns'}">${callIcon('columns')}<span>Columns</span></button></div><div class="flow-topbar-actions call-topbar-actions"><button type="button" id="call-search-toggle" class="call-icon-button" aria-label="Find functions" aria-expanded="false" title="${escapeHtml(searchShortcutTitle('Find functions', singleKeyShortcuts))}">${icon('ea6d')}</button><button type="button" id="graph-fit" class="call-icon-button" aria-label="Fit graph" title="${escapeHtml(fitGraphTitle(singleKeyShortcuts))}"${options.callView === 'columns' ? ' hidden' : ''}>${callIcon('fit')}</button><details id="call-menu"><summary aria-label="Graph options" title="Graph options">${icon('ea7c')}</summary><div class="call-menu-content">${options.callTools || ''}</div></details></div><div class="flow-search call-search" hidden><input id="search" class="search" aria-label="Find functions" placeholder="Find functions…"></div></div><div id="call-zoom" class="call-zoom" role="group" aria-label="Zoom"${options.callView === 'columns' ? ' hidden' : ''}><button type="button" id="graph-zoom-out" aria-label="Zoom out">${icon('eb3b')}</button><button type="button" id="graph-zoom" aria-label="Actual size" title="Actual size (100%)">100%</button><button type="button" id="graph-zoom-in" aria-label="Zoom in">${icon('ea60')}</button></div>` : cfg ? controlFlowToolbar(options.title, options.subtitle, options.body.includes('data-control-flow'), singleKeyShortcuts) : browserTools}
    ${liveRegionsHtml(options.busy, options.error ?? '')}
    ${browserLiveRegions}${!browser ? `<p id="flow-scope" class="scope"${options.scope ? '' : ' hidden'}>${escapeHtml(options.scope ?? '')}</p>` : ''}<div id="page-body">${options.body}</div>${browser ? `<div class="no-results" hidden><span>No matching rows.</span><button type="button" id="clear-filter" class="icon-button" aria-label="Clear filter" title="Clear filter">${callIcon('close')}</button></div><div id="pagination" class="pagination"${options.next || options.previous ? '' : ' hidden'}><button type="button" id="page-previous" class="icon-button" data-action="previous" aria-label="Previous page" title="Previous page"${!options.previous ? ' disabled' : ''}>${callIcon('left')}</button><button type="button" id="page-next" class="icon-button" data-action="next" aria-label="Next page" title="Next page"${!options.next ? ' disabled' : ''}>${callIcon('right')}</button></div>` : ''}</main><script nonce="${nonce}">
    const vscode=acquireVsCodeApi();const previous=vscode.getState()||{};const state=${JSON.stringify(initialState).replace(/</g, '\\u003c')};
    ${browserStateScript}
    const flowPage=${Boolean(flow)},cfgPage=${Boolean(cfg)},browserPage=${Boolean(browser)};
    let samePage=previous.md5===state.md5&&previous.kind===state.kind&&previous.address===state.address${flow ? '&&previous.entry===state.entry' : ''};
    let selected=samePage?previous.selected||state.selected||'':state.selected||'';let entry=samePage?previous.selectedEntry||'':state.selectedEntry||'';
    let selectedKind=samePage?previous.selectedKind||'':'';let selectedLabel=samePage?previous.selectedLabel||'':'';let primaryAction='decompile';
    let selectable=[...document.querySelectorAll('tr[data-address],tr[data-entry],.graph-node')];
    const search=document.getElementById('search');search.value=state.kind==='callGraph'&&!samePage?'':previous.filter||'';
    const addressInput=document.getElementById('address');if(addressInput&&samePage&&typeof previous.addressDraft==='string'){addressInput.value=previous.addressDraft}
    const extraColumns=document.getElementById('extra-columns');if(extraColumns){extraColumns.checked=samePage&&previous.extraColumns===true;document.body.classList.toggle('show-extra-columns',extraColumns.checked)}
    let memoryMap=document.querySelector('.memory-map');if(memoryMap&&samePage){memoryMap.open=previous.mapOpen===true}
    const listingDetails=document.getElementById('listing-details');if(listingDetails){listingDetails.checked=samePage&&previous.listingDetails===true;document.querySelector('.listing')?.classList.toggle('show-details',listingDetails.checked)}
    let graphViewport;let branchAnchor;let cfgOverviewPosition=samePage?previous.cfgOverviewPosition:undefined;let cfgOverviewDismissed=samePage&&previous.cfgOverviewDismissed===true;let columnUi=samePage?previous.columnUi:undefined;
    let persistFrame=0,inPageUpdate=false;
    const initialFocusId=state.focusId||'';delete state.focusId;
    const shortAddr=value=>/^ram:[0-9a-f]+$/i.test(value||'')?value.slice(4):String(value||'');
    const inClosedDetails=node=>{let cur=node;while(cur){const det=cur.parentElement?.closest('details:not([open])');if(!det){return false}if(cur.tagName==='SUMMARY'&&cur.parentElement===det){cur=det;continue}return true}return false};
    const inClosedPopover=el=>{const pop=el?.closest?.('[popover]');if(!pop){return false}try{return !pop.matches(':popover-open')}catch{return false}};
    const canFocus=el=>{if(!el||!el.isConnected||el.disabled||el.closest('[hidden]')||inClosedDetails(el)||inClosedPopover(el)){return false}const cs=getComputedStyle(el);return cs.display!=='none'&&cs.visibility!=='hidden'};
    const tryFocus=el=>{if(!canFocus(el)){return false}el.focus({preventScroll:true});return document.activeElement===el};
    const persist=()=>{if(persistFrame){cancelAnimationFrame(persistFrame);persistFrame=0}vscode.setState({...state,selected,selectedEntry:entry,selectedKind,selectedLabel,filter:search.value,addressDraft:addressInput?.value,mapOpen:memoryMap?.open,listingDetails:listingDetails?.checked,extraColumns:extraColumns?.checked,branchAnchor,callDetails:document.querySelector('.call-details')?.open??(samePage?previous.callDetails:undefined),callOverview:document.querySelector('.call-overview')?.open??(samePage?previous.callOverview:undefined),cfgOverview:document.querySelector('.cfg-overview')?.open,cfgOverviewPosition,cfgOverviewDismissed,cfgActiveEdge:document.querySelector('.cfg-edge.is-active')?.dataset.edgeKey,tableScroll:[...document.querySelectorAll('.table-wrap')].map(table=>({top:table.scrollTop,left:table.scrollLeft})),scrollX:window.scrollX,scrollY:window.scrollY,focusId:branchAnchor?.focusId||document.activeElement?.id,columnUi,graphViewport:graphViewport?.snapshot()||(samePage?previous.graphViewport:undefined)})};
    const schedulePersist=()=>{if(!persistFrame){persistFrame=requestAnimationFrame(()=>{persistFrame=0;persist()})}};
    ${webviewShortcutScript}
    ${browser ? webviewPopoverScript : ''}
    const bindMemoryMap=()=>{memoryMap=document.querySelector('.memory-map');if(memoryMap&&!memoryMap.dataset.mapBound){memoryMap.dataset.mapBound='true';memoryMap.addEventListener('toggle',()=>{filter();persist()})}};
    bindMemoryMap();
    ${flow ? controlFlowScript : ''}
    listingDetails?.addEventListener('change',()=>{document.querySelector('.listing')?.classList.toggle('show-details',listingDetails.checked);persist()});
    extraColumns?.addEventListener('change',()=>{document.body.classList.toggle('show-extra-columns',extraColumns.checked);persist()});
    const target=()=>{
      const fn=entry||(!selected?state.entry||'':'');const address=selected||state.address||fn||'';
      const currentRow=document.querySelector('table:not([role="grid"]) tr[aria-current="true"],.graph-node.selected');
      const row=(currentRow&&(!address||sameAddr(currentRow.dataset.address,address))&&(!fn||sameAddr(currentRow.dataset.entry,fn))?currentRow:undefined)||selectable.find(item=>address&&sameAddr(item.dataset.address,address)&&(!fn||sameAddr(item.dataset.entry,fn)));
      return {address,entry:fn,kind:row?.dataset.kind||selectedKind||(fn?'function':state.kind==='memory'?'bytes':'address'),label:row?.dataset.label||selectedLabel||''};
    };
    const reloadActions=new Set(['refresh','previous','next','callGraphBack','focusCallGraph']);
    const send=(action,extra={})=>{if(reloadActions.has(action)){setBusyState(true)}vscode.postMessage({action,...target(),...extra})};
    const more=document.getElementById('more-actions');const moreSummary=document.getElementById('more-actions-button');
    const selectionTools=()=>{
      if(state.kind==='callGraph'){primaryAction='decompile';const focus=document.getElementById('call-focus');if(focus){const fn=target().entry;const hadFocus=document.activeElement===focus;focus.disabled=!fn||fn===state.entry;focus.hidden=focus.disabled;if(hadFocus&&focus.disabled&&!inPageUpdate){tryFocus(document.querySelector('#call-menu>summary'))||tryFocus(document.querySelector('.call-node.is-root'))}}return}
      const label=document.getElementById('selection-label');if(!label){return}
      const toolsHost=label.closest('.selection-tools');
      const hadToolsFocus=Boolean(toolsHost?.contains(document.activeElement));
      const focusedAction=hadToolsFocus?(document.activeElement===moreSummary?'__more__':(document.activeElement?.dataset?.action||'')):'';
      const activeRow=document.querySelector('table:not([role="grid"]) tr[aria-current="true"],.graph-node.selected')||selectable.find(row=>selected?sameAddr(row.dataset.address,selected):entry&&sameAddr(row.dataset.entry,entry));
      const visibleSelection=!!activeRow&&!activeRow.hidden&&!activeRow.closest('details:not([open])');
      if(!visibleSelection&&more&&typeof closePopover==='function'){closePopover(more)}
      toolsHost.hidden=!visibleSelection;document.body.classList.toggle('has-selection',visibleSelection);
      if(!visibleSelection){if(hadToolsFocus&&!inPageUpdate){const clearBtn=document.getElementById('clear-filter');if(clearBtn&&!clearBtn.closest('[hidden]')){clearBtn.focus({preventScroll:true})}else{tryFocus(activeRow)||tryFocus(search)||tryFocus(addressInput)}}return}
      const current=target();const at=current.address;const fn=current.entry;const kind=current.kind;
      const focusGraph=document.getElementById('call-focus');if(focusGraph){focusGraph.disabled=!fn||fn===state.entry;focusGraph.hidden=focusGraph.disabled}
      const nouns={instruction:'Instruction',data:'Data',bytes:'Byte address',block:'Block',symbol:'Symbol',address:'Address','reference-source':'Reference source','reference-destination':'Reference destination'};
      label.title=[fn,at].filter(Boolean).join(' · ');label.textContent=fn?'Function '+(current.label&&kind==='function'?current.label+' · ':'')+shortAddr(fn)+(at&&at!==fn?' · Location '+shortAddr(at):''):at?(nouns[kind]||'Address')+(kind==='symbol'&&current.label?' '+current.label+' · ':' ')+shortAddr(at):'Select a row or node';
      if(state.kind==='callGraph'&&fn){const name=document.createElement('strong'),atEl=document.createElement('span');name.textContent=current.label||fn;atEl.textContent=fn;label.replaceChildren(name,atEl)}
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
      const hosts=[document.getElementById('selection-primary'),more];
      for(const [index,actions] of [main,extra].entries()){
        hosts[index].replaceChildren(...actions.map(item=>{const button=document.createElement('button');const destination=['decompile','callGraph','controlFlow'].includes(item.action)&&fn?fn:at;button.type='button';button.id='action-'+item.action;button.dataset.action=item.action;button.textContent=document.body.classList.contains('browser-page')?({listing:'Listing',memory:'Bytes',references:'References',callGraph:'Call graph',controlFlow:'Control flow',decompile:fn||kind==='instruction'||kind==='block'?'Decompile':'Open'}[item.action]||item.label):item.label;if(document.body.classList.contains('browser-page')||state.kind==='callGraph'){button.textContent='';const glyph=document.createElement('span');glyph.className='call-icon';glyph.setAttribute('aria-hidden','true');glyph.textContent=String.fromCodePoint((${JSON.stringify(callIcons)})[item.action]||${callIcons.function});button.append(glyph);button.classList.add('icon-only');button.setAttribute('aria-label',item.label)}button.title=item.label+(destination?' · '+destination:'');button.disabled=!at&&!fn;if(item.action===primaryAction&&document.body.classList.contains('browser-page')){button.classList.add('primary')}return button}));
      }
      if(!extra.length&&more&&typeof closePopover==='function'){closePopover(more)}
      moreSummary.hidden=!extra.length;moreSummary.title='More actions'+(current.label?' for '+current.label:at?' at '+at:'');moreSummary.setAttribute('aria-label',moreSummary.title);
      const popoverOpen=Boolean(more&&typeof isPopoverOpen==='function'&&isPopoverOpen(more));
      if(popoverOpen&&typeof positionPopover==='function'){positionPopover(more)}
      if(focusedAction){
        if(focusedAction==='__more__'){((!moreSummary.hidden?moreSummary:null)||document.querySelector('#selection-primary button:not(:disabled)'))?.focus({preventScroll:true})}
        else{const candidate=document.getElementById('action-'+focusedAction);const restore=(candidate&&(!more?.contains(candidate)||popoverOpen))?candidate:(popoverOpen?((typeof menuButtons==='function'&&menuButtons(more)[0])||(!moreSummary.hidden?moreSummary:null)||document.querySelector('#selection-primary button:not(:disabled)')):(document.querySelector('#selection-primary button:not(:disabled)')||(!moreSummary.hidden?moreSummary:null)));restore?.focus({preventScroll:true})}
      }
    };
    document.addEventListener('click',event=>{const button=event.target.closest('button[data-action]');if(button&&!button.disabled){const menu=button.closest('[data-popover-menu]');if(menu&&typeof focusInvokerAndClose==='function'){focusInvokerAndClose(menu)}persist();send(button.dataset.action,{focusId:document.activeElement?.id||''})}});
    bindGotoForm(raw=>send('goto',{address:raw,fromGoto:true,focusId:document.activeElement?.id||''}),persist);
    const bindSelectableRows=()=>{
      selectable=[...document.querySelectorAll('tr[data-address],tr[data-entry],.graph-node')];
      const matchesInitial=row=>(selected&&sameAddr(row.dataset.address,selected))||(!selected&&entry&&sameAddr(row.dataset.entry,entry));
      const initialItem=(selectedLabel&&selectable.find(row=>matchesInitial(row)&&row.dataset.label===selectedLabel))||selectable.find(matchesInitial);
      document.querySelectorAll('.graph-node.selected').forEach(item=>item.classList.remove('selected'));
      if(initialItem){if(initialItem.tagName==='TR'){setCurrentRow(initialItem)}else{setCurrentRow(null);initialItem.classList.add('selected')}}else{setCurrentRow(null)}
      selectable.forEach(row=>{
        if(row.dataset.selectBound){return}
        row.dataset.selectBound='true';
        const pick=(notify=true)=>{document.querySelectorAll('.graph-node.selected').forEach(item=>item.classList.remove('selected'));if(row.tagName==='TR'){setCurrentRow(row)}else{setCurrentRow(null);row.classList.add('selected')}selected=row.dataset.address||'';entry=row.dataset.entry||'';selectedKind=row.dataset.kind||'';selectedLabel=row.dataset.label||'';graphViewport?.select([row],false);selectionTools();persist();if(notify){send('select')}};
        row.addEventListener('click',event=>{if(!event.target.closest('.call-node-controls,.cfg-node-controls,button')){pick()}});row.addEventListener('dblclick',event=>{if(event.target.closest('.call-node-controls,.cfg-node-controls,button')){return}pick(false);if(primaryAction){send(state.kind==='callGraph'?'focusCallGraph':primaryAction)}});row.addEventListener('keydown',event=>{if(event.target.closest('.call-node-controls,.cfg-node-controls,button')){return}if(event.key==='Enter'){event.preventDefault();pick();if(primaryAction){send(state.kind==='callGraph'?'focusCallGraph':primaryAction)}}else if(event.key===' '){event.preventDefault();pick()}});
      });
    };
    bindSelectableRows();
    selectionTools();
    const filter=()=>{
      if(document.querySelector('[data-call-columns]')){if(typeof filterCallColumns==='function'){filterCallColumns()}return}
      const query=search.value.trim().toLowerCase(),rows=[...document.querySelectorAll('tbody tr')];let visible=0,total=0;
      for(const row of rows){row.hidden=!!query&&!row.textContent.toLowerCase().includes(query);if(!browserPage||!row.closest('details:not([open])')){total++;if(!row.hidden){visible++}}}
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
      const empty=document.querySelector('.no-results');
      const collapsedMatches=browserPage&&!!query&&rows.some(row=>!row.hidden&&row.closest('.memory-map:not([open])'));
      if(empty){empty.hidden=!query||visible>0;empty.querySelector('span').textContent=collapsedMatches?'Matches in collapsed memory map.':'No matching rows.'}
      updateFilterStatus({
        query,
        visible:nodes.length?matched+visible:visible,
        total,
        visuallyHidden:empty?visible===0:false,
        matchText:nodes.length?matched+' of '+nodes.length+' nodes match'+(total?'; '+visible+' of '+total+' rows match.':'.'):undefined,
        emptyText:nodes.length?'0 of '+nodes.length+' nodes match'+(total?'; 0 of '+total+' rows match.':'.'):collapsedMatches?'Matches in collapsed memory map.':'No displayed rows match this filter.',
        restoredText:nodes.length?'Filter cleared. Showing all '+nodes.length+' nodes.':undefined
      });
    };
    search.addEventListener('input',()=>{filter();persist()});filter();
    window.addEventListener('scroll',schedulePersist,{passive:true});document.addEventListener('focusin',persist);
    const focusColumnControl=colIndex=>{
      const columns=[...document.querySelectorAll('.call-column')];if(!columns.length){return false}
      const column=columns[Math.max(0,Math.min(colIndex,columns.length-1))];
      return tryFocus(column?.querySelector('.call-column-row:not([hidden]) .call-column-pick[aria-pressed="true"]:not(:disabled)'))||tryFocus(column?.querySelector('.call-column-row:not([hidden]) .call-column-pick:not(:disabled)'))||tryFocus(column?.querySelector('.call-column-source-code'));
    };
    const restoreFocusAfterUpdate=(reason,snap,hadFocus)=>{
      if(reason==='goto'&&tryFocus(addressInput)){return}
      if(reason==='focusCallGraph'){if(tryFocus(document.querySelector('.call-node.is-root'))||focusColumnControl(0)){return}}
      if(reason==='callGraphBack'){if(tryFocus(document.getElementById('call-graph-back'))||tryFocus(document.querySelector('.call-node.is-root'))||focusColumnControl(0)){return}}
      if(reason==='callGraphToggle'){if((snap.branchFocusId&&tryFocus(document.getElementById(snap.branchFocusId)))||(snap.branchNodeId&&tryFocus(document.getElementById(snap.branchNodeId)))||tryFocus(document.querySelector('.call-node.is-root'))){return}}
      if(reason==='callColumnTrail'){if((document.activeElement&&document.activeElement!==document.body&&canFocus(document.activeElement))||focusColumnControl(0)){return}}
      if(reason==='callColumnSelect'){if(document.activeElement&&document.activeElement!==document.body&&canFocus(document.activeElement)){return}if(snap.id&&tryFocus(document.getElementById(snap.id))){return}}
      if((reason==='callGraphView'||reason==='callColumnDirection')&&snap.id&&tryFocus(document.getElementById(snap.id))){return}
      if(reason==='pagination'){if((snap.id&&tryFocus(document.getElementById(snap.id)))||tryFocus(document.getElementById('page-previous'))||tryFocus(document.getElementById('page-next'))){return}}
      if(!hadFocus&&!['goto','focusCallGraph','callGraphBack','callGraphToggle','callColumnTrail','callColumnSelect','callGraphView','callColumnDirection','pagination'].includes(reason)){return}
      if(document.activeElement&&document.activeElement!==document.body&&canFocus(document.activeElement)){
        if(snap.inputSel&&(document.activeElement===search||document.activeElement===addressInput)){try{document.activeElement.setSelectionRange(snap.inputSel.start,snap.inputSel.end)}catch{}}
        return;
      }
      if(snap.id&&tryFocus(document.getElementById(snap.id))){return}
      if(snap.inSelectionTools){if((snap.action&&tryFocus(document.getElementById('action-'+snap.action)))||tryFocus(document.querySelector('#selection-primary button:not(:disabled)'))){return}}
      if(snap.nodeId||snap.rowAddress||snap.rowEntry){
        const matchRow=selectable.find(r=>!r.hidden&&((snap.nodeId&&r.dataset.node===snap.nodeId)||(snap.rowAddress&&sameAddr(r.dataset.address,snap.rowAddress)&&(!snap.rowEntry||sameAddr(r.dataset.entry,snap.rowEntry)))||(snap.rowEntry&&sameAddr(r.dataset.entry,snap.rowEntry))));
        if(tryFocus(matchRow)){return}
      }
      if(snap.edgeKey&&tryFocus([...document.querySelectorAll('.cfg-edge')].find(e=>e.dataset.edgeKey===snap.edgeKey))){return}
      if(snap.callEdgeFrom&&tryFocus([...document.querySelectorAll('.call-edge')].find(e=>e.dataset.from===snap.callEdgeFrom&&e.dataset.to===snap.callEdgeTo))){return}
      if(snap.columnIndex!==undefined){
        const col=document.querySelector('.call-column[data-column="'+snap.columnIndex+'"]')||[...document.querySelectorAll('.call-column')].pop();
        if(snap.isColumnSourceCode&&tryFocus(col?.querySelector('.call-column-source-code'))){return}
        if(snap.columnRowEntry){
          const row=[...(col?.querySelectorAll('.call-column-row')||[])].find(r=>sameAddr(r.dataset.entry,snap.columnRowEntry));
          if(snap.isColumnCode&&tryFocus(row?.querySelector('.call-column-code'))){return}
          if(tryFocus(row?.querySelector('.call-column-pick'))){return}
        }
        if(focusColumnControl(Number(snap.columnIndex))){return}
      }
      const fallbacks=[document.querySelector('.call-node.is-root'),document.querySelector('.graph-node.selected'),...selectable,document.querySelector('.call-column-pick:not(:disabled)'),document.querySelector('.call-column-source-code'),addressInput,search,document.getElementById('cfg-refresh'),document.getElementById('call-function-picker'),document.getElementById('page-options-button'),document.querySelector('#page-options>summary'),...document.querySelectorAll('button,summary,input,[tabindex="0"]')];
      for(const candidate of fallbacks){if(tryFocus(candidate)){return}}
    };
    const applyPageUpdate=(nextOpts,reason='refresh')=>{
      inPageUpdate=true;
      try{
        const activeEl=document.activeElement;
        const hadFocus=Boolean(activeEl&&activeEl!==document.body&&activeEl!==document.documentElement);
        const snap={
          id:activeEl?.id||'',
          inSelectionTools:Boolean(activeEl?.closest?.('.selection-tools')),
          action:activeEl?.dataset?.action||'',
          rowAddress:activeEl?.closest?.('tr[data-address],.graph-node')?.dataset?.address||'',
          rowEntry:activeEl?.closest?.('tr[data-entry],.graph-node')?.dataset?.entry||'',
          nodeId:activeEl?.closest?.('.graph-node')?.dataset?.node||'',
          edgeKey:activeEl?.closest?.('.cfg-edge')?.dataset?.edgeKey||'',
          callEdgeFrom:activeEl?.closest?.('.call-edge')?.dataset?.from||'',
          callEdgeTo:activeEl?.closest?.('.call-edge')?.dataset?.to||'',
          branchFocusId:branchAnchor?.focusId||(activeEl?.classList?.contains('node-branch')?activeEl.id:''),
          branchNodeId:branchAnchor?.nodeId||'',
          columnIndex:activeEl?.closest?.('.call-column')?.dataset?.column,
          columnRowEntry:activeEl?.closest?.('.call-column-row')?.dataset?.entry||'',
          isColumnCode:Boolean(activeEl?.classList?.contains('call-column-code')),
          isColumnSourceCode:Boolean(activeEl?.classList?.contains('call-column-source-code')),
          inputSel:(activeEl===search||activeEl===addressInput)?{start:activeEl.selectionStart,end:activeEl.selectionEnd}:undefined
        };
        const prevTableScroll=[...document.querySelectorAll('.table-wrap')].map(t=>({top:t.scrollTop,left:t.scrollLeft}));
        const prevScrollX=window.scrollX,prevScrollY=window.scrollY;
        const prevEntry=state.entry,prevAddress=state.address,prevCallView=state.callView;
        const prevViewport=graphViewport?.snapshot();
        const prevCfgActiveEdge=document.querySelector('.cfg-edge.is-active')?.dataset.edgeKey;
        const prevCfgOverview=document.querySelector('.cfg-overview')?.open;
        const prevCallDetails=document.querySelector('.call-details')?.open;
        const prevCallOverview=document.querySelector('.call-overview')?.open;
        const prevMemoryMapOpen=document.querySelector('.memory-map')?.open;
        const prevColumnUi=columnUi?{...columnUi,lists:{...(columnUi.lists||{})}}:undefined;
        graphViewport?.destroy?.();graphViewport=undefined;
        if(typeof cfgUiCleanup==='function'){cfgUiCleanup()}
        if(typeof callGraphCleanup==='function'){callGraphCleanup()}
        setViewError(nextOpts.error||'');
        const nextStateObj=nextOpts.state&&typeof nextOpts.state==='object'?{...nextOpts.state}:{};
        delete nextStateObj.focusId;
        const sameTarget=nextStateObj.md5===state.md5&&nextStateObj.kind===state.kind&&(flowPage?nextStateObj.entry===prevEntry:nextStateObj.address===prevAddress);
        samePage=sameTarget;
        Object.assign(state,nextStateObj);
        if(typeof nextOpts.singleKeyShortcuts==='boolean'){setSingleKeyShortcuts(nextOpts.singleKeyShortcuts)}
        if(reason==='focusCallGraph'||reason==='callGraphBack'){
          selected=state.selected||'';entry=state.selectedEntry||'';selectedKind='';selectedLabel='';
          search.value='';resetFilterStatus();const sh=search.closest('.call-search');if(sh){sh.hidden=true;document.getElementById('call-search-toggle')?.setAttribute('aria-expanded','false')}
        }else if(!sameTarget&&nextStateObj.selected!==undefined){
          selected=nextStateObj.selected||'';entry=nextStateObj.selectedEntry||'';selectedKind='';selectedLabel='';
        }
        if(nextOpts.title){document.title=nextOpts.title}
        if(addressInput){
          if(reason==='goto'){setSyncedAddressValue(shortAddr(nextOpts.address??''),true)}
          else if(nextOpts.address!==undefined){setSyncedAddressValue(shortAddr(nextOpts.address),false)}
        }
        if(browserPage){
          const titleEl=document.getElementById('page-title');if(titleEl&&nextOpts.title){titleEl.textContent=nextOpts.title}
          const subScope=document.getElementById('browser-subtitle-scope');
          if(subScope){subScope.textContent=nextOpts.subtitle||'';subScope.hidden=!['callers','callees'].includes(state.kind||'')}
          const optScope=document.getElementById('page-options-scope');
          if(optScope){optScope.replaceChildren();if(nextOpts.scope){for(const line of [nextOpts.subtitle,nextOpts.scope]){const p=document.createElement('p');p.textContent=line||'';optScope.append(p)}}}
          const pager=document.getElementById('pagination'),prevBtn=document.getElementById('page-previous'),nextBtn=document.getElementById('page-next');
          if(pager){pager.hidden=!nextOpts.next&&!nextOpts.previous}
          if(prevBtn){prevBtn.disabled=!nextOpts.previous}
          if(nextBtn){nextBtn.disabled=!nextOpts.next}
        }
        if(state.kind==='callGraph'){
          const backBtn=document.getElementById('call-graph-back');if(backBtn){backBtn.disabled=!nextOpts.callBack}
          const fnTitle=document.querySelector('.call-function-title'),picker=document.getElementById('call-function-picker');
          if(fnTitle){fnTitle.title=nextOpts.callName||''}
          if(picker){picker.setAttribute('aria-label','Choose function: '+(nextOpts.callName||''));picker.title=(nextOpts.callName||'')+' · Choose function';const nm=picker.querySelector('.call-function-name');if(nm){nm.textContent=nextOpts.callName||''}}
          state.callView=nextOpts.callView==='columns'?'columns':'graph';
          for(const btn of document.querySelectorAll('[data-call-view]')){btn.setAttribute('aria-pressed',String(btn.dataset.callView===state.callView))}
          const fitBtn=document.getElementById('graph-fit'),zoomWrap=document.getElementById('call-zoom');
          if(fitBtn){fitBtn.hidden=state.callView==='columns'}
          if(zoomWrap){zoomWrap.hidden=state.callView==='columns'}
          const menuContent=document.querySelector('#call-menu .call-menu-content');
          if(menuContent&&nextOpts.callTools!==undefined){menuContent.innerHTML=nextOpts.callTools}
        }
        if(cfgPage){
          const h1=document.querySelector('.cfg-heading h1'),sub=document.querySelector('.cfg-function-name');
          if(h1&&nextOpts.title){h1.textContent=nextOpts.title}
          if(sub){sub.textContent=nextOpts.subtitle||'';sub.title=nextOpts.subtitle||''}
          const cfgActive=String(nextOpts.body||'').includes('data-control-flow');
          for(const id of ['cfg-search-toggle','graph-fit','cfg-overview-toggle','graph-zoom-out','graph-zoom','graph-zoom-in']){const el=document.getElementById(id);if(el){el.disabled=!cfgActive}}
        }
        if(!browserPage){
          const flowScope=document.getElementById('flow-scope');
          if(flowScope){flowScope.textContent=nextOpts.scope||'';flowScope.hidden=!nextOpts.scope}
        }
        document.getElementById('page-body').innerHTML=nextOpts.body||'';
        if(listingDetails){document.querySelector('.listing')?.classList.toggle('show-details',listingDetails.checked)}
        bindMemoryMap();if(memoryMap&&sameTarget){memoryMap.open=prevMemoryMapOpen===true}
        bindSelectableRows();
        if(flowPage&&typeof mountGraphViewport==='function'){
          const preserveViewport=sameTarget&&!['focusCallGraph','callGraphBack','callGraphView'].includes(reason);
          mountGraphViewport(preserveViewport,prevViewport);
        }
        selectionTools();filter();
        if(browserPage&&typeof mountBrowserView==='function'){
          mountBrowserView();
          const wraps=[...document.querySelectorAll('.table-wrap')];
          if(sameTarget&&reason!=='pagination'&&reason!=='goto'){
            wraps.forEach((t,i)=>{t.scrollTop=prevTableScroll[i]?.top||0;t.scrollLeft=prevTableScroll[i]?.left||0});
            window.scrollTo(prevScrollX,prevScrollY);
          }else{
            wraps.forEach(t=>{t.scrollTop=0});window.scrollTo(0,0);
          }
        }
        if(state.kind==='callGraph'){
          if(typeof mountCallGraphUi==='function'){mountCallGraphUi(sameTarget&&prevCallView==='graph',{callDetails:prevCallDetails,callOverview:prevCallOverview})}
          if(typeof mountCallColumnsUi==='function'){mountCallColumnsUi(sameTarget&&prevCallView==='columns',prevColumnUi)}
        }
        if(cfgPage&&typeof mountControlFlowUi==='function'){mountControlFlowUi(sameTarget,{activeEdge:prevCfgActiveEdge,overview:prevCfgOverview})}
        restoreFocusAfterUpdate(reason,snap,hadFocus);
        persist();
      }finally{
        inPageUpdate=false;
      }
    };
    window.addEventListener('message',event=>{
      const msg=event.data||{};
      if(msg.action==='pageUpdate'&&msg.options){applyPageUpdate(msg.options,msg.reason)}
      else if(msg.action==='highlight'){document.querySelectorAll('.graph-node.selected').forEach(item=>item.classList.remove('selected'));const addresses=(msg.addresses||[msg.address]).filter(Boolean);const rows=selectable.filter(item=>addresses.some(addr=>sameAddr(item.dataset.address,addr)));const firstTr=rows.find(item=>item.tagName==='TR');setCurrentRow(firstTr||null);rows.filter(item=>item.tagName!=='TR').forEach(node=>node.classList.add('selected'));graphViewport?.select(rows,true);const row=firstTr||rows[0];if(row){if(!graphViewport){row.scrollIntoView({block:'nearest'})}selected=row.dataset.address||'';entry=row.dataset.entry||'';selectedKind=row.dataset.kind||'';selectedLabel=row.dataset.label||'';selectionTools();persist()}}
    });
    ${browser ? browserViewScript : ''}
    ${options.callGraph ? callViewScript + callGraphScript + callColumnsScript : cfg ? controlFlowUiScript : ''}
    requestAnimationFrame(()=>{if(state.analysisUri){send('ready')}const savedFocusId=(samePage&&previous.focusId)||initialFocusId||'';if(samePage){[...document.querySelectorAll('.table-wrap')].forEach((table,index)=>{table.scrollTop=previous.tableScroll?.[index]?.top||0;table.scrollLeft=previous.tableScroll?.[index]?.left||0});window.scrollTo(previous.scrollX||0,previous.scrollY||0)}if(savedFocusId&&(samePage||initialFocusId)){if(typeof restorePopoverAwareFocus==='function'){restorePopoverAwareFocus(savedFocusId)}else{document.getElementById(savedFocusId)?.focus({preventScroll:true})}}persist();document.body.dataset.viewReady='true'});
    </script></body></html>`;
}
