// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

/** CSS styles for the call-column navigation view. */
export const callColumnsStyles = `
/* Hallmark · app · call columns · VS Code theme · direct function navigation */
/* Critique: keep the path readable and reveal row actions in context. */
.call-page .call-view-switch{display:inline-flex;align-items:center;flex-shrink:0;gap:2px;padding:2px;border:1px solid var(--vscode-panel-border);border-radius:8px;background:var(--vscode-sideBar-background,var(--vscode-editor-background))}
.call-page .call-view-switch button{display:inline-flex;align-items:center;justify-content:center;gap:6px;width:auto;height:26px;min-height:0;padding:0 10px;border:0;border-radius:6px;background:transparent;color:var(--ghidra-muted);font-size:12px;font-weight:500;line-height:1;white-space:nowrap}
.call-page .call-view-switch button:hover:not([aria-pressed="true"]){background:var(--vscode-list-hoverBackground);color:var(--vscode-foreground)}
.call-page .call-view-switch [aria-pressed="true"]{background:var(--vscode-button-background,var(--ghidra-active-selection-bg));color:var(--vscode-button-foreground,var(--ghidra-active-selection-fg));box-shadow:inset 0 0 0 1px var(--vscode-contrastBorder,transparent);font-weight:600}
.call-page .call-view-switch .call-icon{font-size:14px}
.call-columns{display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden}
.call-column-navigation{display:flex;align-items:center;gap:16px;min-height:46px;padding:8px 20px;border-bottom:1px solid var(--vscode-panel-border)}
.call-direction{display:inline-flex;gap:2px;flex-shrink:0;background:var(--vscode-sideBar-background,var(--vscode-editor-background));padding:2px;border:1px solid var(--vscode-panel-border);border-radius:8px}
.call-page .call-direction button{display:inline-flex;align-items:center;justify-content:center;gap:5px;border:0;min-height:26px;height:26px;padding:0 9px;border-radius:6px;background:transparent;color:var(--ghidra-muted);font-size:12px;font-weight:500;white-space:nowrap}
.call-page .call-direction button .call-icon{font-size:14px}
.call-page .call-direction [aria-pressed="true"]{background:var(--ghidra-selection-bg);color:var(--ghidra-selection-fg);box-shadow:inset 0 0 0 1px var(--ghidra-focus);font-weight:600}
.call-column-trail{display:flex;align-items:center;gap:4px;min-width:0;overflow:auto;white-space:nowrap;scrollbar-width:thin}
.call-column-trail .call-icon{font-size:12px;color:var(--ghidra-muted)}
.call-page .call-column-trail button{border:0;background:transparent;padding:2px 4px;min-height:24px;color:var(--ghidra-muted);font-size:11px;max-width:200px;overflow:hidden;text-overflow:ellipsis;flex-shrink:0}
.call-page .call-column-trail [aria-current]{color:var(--vscode-foreground)}
.call-column-strip{display:flex;flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin}
.call-page .call-column{display:flex;flex-direction:column;flex:0 0 280px;width:280px;min-width:0;min-height:0;margin:0;padding:0;border:0;border-right:1px solid var(--vscode-panel-border)}
.call-page .call-column-heading{display:grid;grid-template-columns:minmax(0,1fr) 28px;align-items:center;gap:2px 8px;flex-shrink:0;padding:16px 16px 12px;margin:0;border-bottom:1px solid var(--vscode-panel-border)}
.call-page .call-column-heading h2{font-size:12px;font-weight:600;line-height:1.5;margin:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.call-column-heading>span{font-size:11px;color:var(--ghidra-muted)}
.call-page .call-column-code,.call-page .call-column-source-code{display:flex;align-items:center;justify-content:center;width:28px;height:28px;min-height:0;padding:4px;border:0;border-radius:3px;background:transparent;color:var(--ghidra-muted)}
.call-column-source-code{grid-column:2;grid-row:1/3}
.call-column-list{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:8px;scrollbar-width:thin}
.call-column-row{display:flex;align-items:center;gap:2px;position:relative;border-radius:3px;color:var(--vscode-foreground)}
.call-page .call-column-pick{display:flex;align-items:center;gap:6px;flex:1;min-width:0;min-height:36px;border:0;border-radius:3px;padding:7px 4px 7px 8px;text-align:left;background:transparent;color:inherit}
.call-column-pick>.call-icon:first-child{color:var(--ghidra-muted);font-size:14px}
.call-column-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}
.call-column-addr{flex:0 1 auto;min-width:0;max-width:96px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:11px var(--vscode-editor-font-family,monospace);font-variant-numeric:tabular-nums;color:var(--ghidra-muted)}
.call-column-chevron{flex-shrink:0;font-size:12px;color:var(--ghidra-muted)}
.call-page .call-column-row>.call-column-code{flex-shrink:0;margin-right:4px;color:inherit;opacity:.75;transition:opacity 120ms ease}
@media(hover:hover){.call-page .call-column-row>.call-column-code{opacity:0}}
.call-column-row:hover>.call-column-code,.call-column-row:focus-within>.call-column-code{opacity:1}
.call-column-row:hover{background:var(--vscode-list-hoverBackground)}
.call-column-row.is-selected{background:var(--ghidra-selection-bg);color:var(--ghidra-selection-fg)}
.call-column-row:focus-within{background:var(--ghidra-active-selection-bg);color:var(--ghidra-active-selection-fg)}
.call-column-row.is-selected :is(.call-column-pick>.call-icon,.call-column-addr,.call-column-chevron),.call-column-row:focus-within :is(.call-column-pick>.call-icon,.call-column-addr,.call-column-chevron){color:inherit}
.call-page .call-column-pick:hover{background:transparent}
.call-column-row:focus-within :is(.call-column-pick,.call-column-code):focus-visible{outline:2px solid var(--ghidra-active-selection-fg);outline-offset:-2px}
.call-column-empty{padding:36px 16px;color:var(--ghidra-muted);text-align:center;font-size:12px;overflow-wrap:anywhere}
.call-column-no-matches{padding:12px;font-size:12px;color:var(--ghidra-muted)}
.call-column-limit{flex-shrink:0;margin:0;padding:8px 12px;font-size:11px;color:var(--ghidra-muted);border-top:1px solid var(--vscode-panel-border)}
.call-column-row[aria-busy="true"] .call-column-chevron{opacity:.4}
.sr-only{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
@media(max-width:640px){.call-column-navigation{padding:8px 10px;gap:10px}.call-page .call-column{flex-basis:min(280px,calc(100% - 24px));width:min(280px,calc(100% - 24px))}.call-page .call-view-switch button,.call-page .call-direction button{padding:0 7px;gap:4px;font-size:11px}}
.call-page .call-view-switch button{gap:5px;padding:0 9px}
.call-page .call-view-switch [aria-pressed="true"],.call-page .call-direction [aria-pressed="true"]{border:2px solid var(--ghidra-active-border)}
.call-column-pick[aria-pressed="true"]::before{color:var(--ghidra-focus);font-size:12px}
.call-column-row:focus-within .call-column-pick[aria-pressed="true"]::before{color:inherit}
.call-column-row.is-selected{outline:2px solid var(--ghidra-active-border);outline-offset:-2px}
.call-page .call-column-pick:focus-visible{outline:2px solid var(--ghidra-focus);outline-offset:-2px}
body.call-page:is(.vscode-high-contrast,.vscode-high-contrast-light) .call-column-row>.call-column-code{opacity:1;transition:none}
body.call-page:is(.vscode-high-contrast,.vscode-high-contrast-light) :is(.call-column-code,.call-column-source-code,.call-view-switch button:not([aria-pressed="true"]),.call-direction button:not([aria-pressed="true"]),.call-column-trail button){border:1px solid var(--ghidra-hv-border);color:var(--vscode-foreground)}
body.call-page:is(.vscode-high-contrast,.vscode-high-contrast-light) :is(.call-view-switch [aria-pressed="true"],.call-direction [aria-pressed="true"]){background:var(--vscode-editor-background);color:var(--vscode-foreground);border:2px solid var(--ghidra-active-border)}
body.call-page:is(.vscode-high-contrast,.vscode-high-contrast-light) :is(.call-column-row.is-selected,.call-column-row:focus-within){background:var(--vscode-editor-background);color:var(--vscode-foreground);outline:2px solid var(--ghidra-active-border);outline-offset:-2px}
body.call-page:is(.vscode-high-contrast,.vscode-high-contrast-light) .call-column-row:focus-within :is(.call-column-pick,.call-column-code):focus-visible{outline-color:var(--ghidra-active-border)}
@media(prefers-contrast:more){
  .call-page .call-column-row>.call-column-code{opacity:1;transition:none}
  .call-page .call-column-code,.call-page .call-column-source-code,.call-page .call-view-switch button:not([aria-pressed="true"]),.call-page .call-direction button:not([aria-pressed="true"]),.call-page .call-column-trail button{border:1px solid var(--ghidra-hv-border);color:var(--vscode-foreground)}
}
@media(forced-colors:active){
  .call-page .call-column-row>.call-column-code{opacity:1;transition:none}
  .call-page .call-column-code,.call-page .call-column-source-code,.call-page .call-view-switch button:not([aria-pressed="true"]),.call-page .call-direction button:not([aria-pressed="true"]),.call-page .call-column-trail button{background:ButtonFace;color:ButtonText;border:1px solid var(--ghidra-hv-border)}
  .call-page .call-view-switch [aria-pressed="true"],.call-page .call-direction [aria-pressed="true"]{background:var(--ghidra-pressed-bg);color:var(--ghidra-selection-fg);border:2px solid var(--ghidra-active-border)}
  .call-column-row.is-selected,.call-column-row:focus-within{background:var(--ghidra-selection-bg);color:var(--ghidra-selection-fg);outline:2px solid var(--ghidra-active-border);outline-offset:-2px}
  .call-page .call-column-pick{background:transparent;color:var(--ghidra-selection-fg);border:0}
  .call-column-pick>.call-icon,.call-column-pick[aria-pressed="true"]::before,.call-column-addr,.call-column-chevron{color:var(--ghidra-muted)}
  .call-column-row:focus-within :is(.call-column-pick,.call-column-code):focus-visible,.call-page .call-column-pick:focus-visible{outline:2px solid var(--ghidra-focus);outline-offset:-2px}
}
@media(max-width:640px){.call-page .call-view-switch button,.call-page .call-direction button{padding:0 6px;gap:3px}}
`;

/** Both presentations share the toolbar and the owning program, without sharing layout state. */
export const callViewScript = String.raw`
    for(const button of document.querySelectorAll('[data-call-view]')){button.addEventListener('click',()=>{if(button.getAttribute('aria-pressed')==='true'){return}for(const peer of document.querySelectorAll('[data-call-view]')){peer.setAttribute('aria-pressed',String(peer===button))}state.callView=button.dataset.callView==='columns'?'columns':'graph';persist();button.disabled=true;send('callGraphView',{view:state.callView})})}
`;

/** Client-side script for call-column selection, keyboard navigation, and scrolling. */
export const callColumnsScript = String.raw`
    (()=>{
      const browser=document.querySelector('[data-call-columns]');if(!browser){return}
      const strip=browser.querySelector('.call-column-strip'),columns=[...browser.querySelectorAll('.call-column')],path=browser.dataset.path,direction=browser.dataset.direction;
      const saved=samePage?previous.columnUi:undefined;
      columnUi={left:saved?.left||0,lists:saved?.lists||{},path,direction};
      const captureUi=()=>{columnUi.left=strip.scrollLeft;for(const column of columns){columnUi.lists[column.dataset.source]=column.querySelector('.call-column-list').scrollTop}};
      const snapshot=()=>{captureUi();persist()};
      const scheduleSnapshot=()=>{captureUi();schedulePersist()};
      strip.addEventListener('scroll',scheduleSnapshot,{passive:true});for(const column of columns){column.querySelector('.call-column-list').addEventListener('scroll',scheduleSnapshot,{passive:true})}
      const request=(action,extra,focusColumn)=>{columnUi.pendingFocus=focusColumn;persist();browser.setAttribute('aria-busy','true');send(action,{graphRoot:state.entry,direction,...extra})};
      const pick=(button,keyboard=false)=>{const index=Number(button.dataset.columnIndex),cycle=button.dataset.cycleAt;if(button.getAttribute('aria-pressed')==='true'){if(keyboard){columns[index+1]?.querySelector('.call-column-pick:not(:disabled)')?.focus()}return}button.closest('.call-column-row').setAttribute('aria-busy','true');request('callColumnSelect',{entry:button.dataset.entry,index},keyboard?cycle!==undefined?Number(cycle):index+1:undefined)};
      for(const button of browser.querySelectorAll('.call-column-pick')){
        button.addEventListener('click',()=>{if(!button.disabled){pick(button)}});
        button.addEventListener('keydown',event=>{const index=Number(button.dataset.columnIndex),rows=[...button.closest('.call-column-list').querySelectorAll('.call-column-row:not([hidden]) .call-column-pick:not(:disabled)')],at=rows.indexOf(button);if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?rows.length-1:Math.max(0,Math.min(rows.length-1,at+(event.key==='ArrowDown'?1:-1)));rows[next]?.focus()}else if(event.key==='ArrowRight'||event.key==='Enter'){event.preventDefault();pick(button,true)}else if(event.key==='ArrowLeft'){event.preventDefault();columns[index-1]?.querySelector('.call-column-pick[aria-pressed="true"]')?.focus()}})
      }
      for(const button of browser.querySelectorAll('.call-column-code,.call-column-source-code')){button.addEventListener('click',event=>{event.stopPropagation();const fn=button.classList.contains('call-column-source-code')?button:button.closest('.call-column-row');send('decompile',{entry:fn.dataset.entry,address:fn.dataset.entry,kind:'function',label:fn.dataset.label})})}
      for(const button of browser.querySelectorAll('[data-column-direction]')){button.addEventListener('click',()=>{if(button.dataset.columnDirection===direction){return}button.disabled=true;request('callColumnDirection',{direction:button.dataset.columnDirection})})}
      for(const button of browser.querySelectorAll('[data-column-trail]')){button.addEventListener('click',()=>request('callColumnTrail',{index:Number(button.dataset.columnTrail)}))}
      const homeBtn=document.getElementById('call-column-home');if(homeBtn&&!homeBtn.dataset.callBound){homeBtn.dataset.callBound='true';homeBtn.addEventListener('click',()=>request('callColumnTrail',{index:0}))}
      const searchToggle=document.getElementById('call-search-toggle'),searchHost=search.closest('.call-search');
      const openSearch=()=>{searchHost.hidden=false;searchToggle.setAttribute('aria-expanded','true');search.focus();search.select()};
      const closeSearch=()=>{searchHost.hidden=true;searchToggle.setAttribute('aria-expanded','false');searchToggle.focus()};
      searchToggle.addEventListener('click',()=>searchHost.hidden?openSearch():closeSearch());
      filterCallColumns=()=>{const activeBrowser=document.querySelector('[data-call-columns]');if(!activeBrowser){return}const activeColumns=[...activeBrowser.querySelectorAll('.call-column')],query=search.value.trim().toLowerCase();let found=0,total=0;for(const column of activeColumns){let count=0;for(const row of column.querySelectorAll('.call-column-row')){total++;row.hidden=!!query&&!((row.dataset.label+' '+row.dataset.entry).toLowerCase().includes(query));if(!row.hidden){count++;found++}}column.querySelector('.call-column-no-matches').hidden=!query||count>0||!column.querySelector('.call-column-row')}updateFilterStatus({query,visible:found,total,visuallyHidden:false,matchText:found+' of '+total+' displayed functions match.',emptyText:'0 of '+total+' displayed functions match.',restoredText:'Filter cleared. Showing all '+total+' displayed functions.'})};
      search.addEventListener('input',()=>{filterCallColumns();persist()});search.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();search.value='';filterCallColumns();closeSearch()}else if(event.key==='Enter'){event.preventDefault();browser.querySelector('.call-column-row:not([hidden]) .call-column-pick:not(:disabled)')?.focus()}});if(search.value){openSearch()}filterCallColumns();
      const menu=document.getElementById('call-menu'),summary=menu.querySelector('summary');
      menu.addEventListener('keydown',event=>{if(!['ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Home','End'].includes(event.key)){return}event.preventDefault();menu.open=true;const items=[...menu.querySelectorAll('button')],at=items.indexOf(document.activeElement),next=event.key==='Home'?0:event.key==='End'?items.length-1:(event.key==='ArrowDown'||event.key==='ArrowRight')?(at+1)%items.length:(at<=0?items.length-1:at-1);items[next]?.focus()});
      document.addEventListener('click',event=>{if(menu.open&&(!menu.contains(event.target)||event.target.closest('button'))){menu.open=false}});
      document.addEventListener('keydown',event=>{if(event.key==='Escape'&&menu.open){event.preventDefault();menu.open=false;summary.focus()}else if(isModShortcut(event,'f')||(event.key==='/'&&canUseSingleKeyShortcut(event))){event.preventDefault();menu.open=false;openSearch()}});
      requestAnimationFrame(()=>{strip.scrollLeft=saved?.left||0;for(const column of columns){column.querySelector('.call-column-list').scrollTop=saved?.lists?.[column.dataset.source]||0}if(saved?.path!==path||saved?.direction!==direction){columns[columns.length-1]?.scrollIntoView({block:'nearest',inline:'nearest'})}if(saved?.pendingFocus!==undefined){setTimeout(()=>{const column=columns[Math.min(saved.pendingFocus,columns.length-1)];const button=column?.querySelector('.call-column-row:not([hidden]) .call-column-pick:not(:disabled)');if(button){button.focus()}else{column?.querySelector('.call-column-source-code')?.focus()}snapshot()},0)}snapshot()});
    })();
`;
