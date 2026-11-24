// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

import { randomBytes } from 'node:crypto';
import { pageStyles } from './page-styles';
import { iconFontStyles } from './icon-font';
import { viewStyles } from './view-ui';
import { callIcon, callIcons } from './call-graph-icons';
import { displayAddress } from './names';
/** Generic JSON object map used for RPC payloads and webview state. */
export type Data = Record<string, unknown>;
/** Coerce an unknown value to a plain record object. */
export const object = (value: unknown): Data => value && typeof value === 'object' && !Array.isArray(value) ? value as Data : {};
/** Coerce an unknown array value to an array of record objects. */
export const rows = (value: unknown): Data[] => Array.isArray(value) ? value.map(object) : [];
/** Escape HTML special characters for safe webview interpolation. */
export const escape = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
/** Convert a string or number to text, or return an em dash when absent. */
export const text = (value: unknown): string => typeof value === 'string' || typeof value === 'number' ? String(value) : '—';
/** Convert a string or number to text, or return an empty string when absent. */
export const stringOf = (value: unknown): string => typeof value === 'string' || typeof value === 'number' ? String(value) : '';
/** Format a structured type reference into C-like declaration syntax. */
export function reference(value: unknown): string {
    if (typeof value === 'string') { return value; }
    const ref = object(value);
    switch (ref.kind) {
        case 'named': return text(ref.name);
        case 'pointer': return `${reference(ref.target)} *`;
        case 'untyped_pointer': return 'pointer';
        case 'array': return `${reference(ref.element)}[${text(ref.count)}]`;
        default: return text(ref.name);
    }
}
/** JSON path segments that identify a form control or data-type member field. */
export type FieldPath = (string | number)[];
/** Validation error bound to a structured control `path`. */
export class FieldError extends Error {
    /** Create a validation error attached to control `path`. */
    constructor(message: string, readonly path: FieldPath = []) { super(message); }
}
/** Build a deterministic HTML element ID for a control at `path`. */
export const fieldControlId = (path: FieldPath): string => 'field-' + path.map(part => String(part).replace(/[^A-Za-z0-9_]/g, ch => `_${ch.charCodeAt(0).toString(16)}_`)).join('--');
/** Read a non-empty trimmed string value or throw a {@link FieldError} at `path`. */
export function requiredText(value: unknown, label: string, path: FieldPath = []): string {
    const trimmed = String(value ?? '').trim();
    if (!trimmed) { throw new FieldError(`${label} is required.`, path); }
    return trimmed;
}
/** Parse a user-entered type string into a structured server type reference. */
export function typeReference(value: unknown, path: FieldPath = [], label?: string): Data {
    const name = String(value ?? '').trim();
    if (!name) { throw new FieldError(label ? `${label} is required. Choose a data type.` : 'Choose a data type.', path); }
    if (name === 'pointer') { return { kind: 'untyped_pointer' }; }
    const array = /^(.*)\[([0-9]+)\]$/.exec(name);
    if (array) { return { kind: 'array', element: typeReference(array[1], path, label), count: integer(array[2], 'Array length', 1, 2147483647, path) }; }
    if (/\*$/.test(name)) { return { kind: 'pointer', target: typeReference(name.slice(0, -1), path, label) }; }
    return { kind: 'named', name };
}
/** Parse and validate an integer within inclusive bounds. */
export function integer(value: unknown, label: string, minimum = 0, maximum = 2147483647, path: FieldPath = []): number {
    const raw = String(value ?? '').trim();
    const number = Number(raw);
    if (!raw || !Number.isSafeInteger(number) || number < minimum || number > maximum) { throw new FieldError(`${label} must be an integer between ${minimum} and ${maximum}.`, path); }
    return number;
}
/** Options to render an accessible HTML form control with {@link formControl}. */
export interface FormControlOptions {
    /** Explicit HTML element ID that overrides {@link fieldControlId}. */
    id?: string;
    /** Structured path that identifies this control for focus and error state. */
    path: FieldPath;
    /** Visible or accessible label that gives the control purpose. */
    label: string;
    /** Initial scalar or boolean value rendered in the control. */
    value?: unknown;
    /** Control input presentation kind. */
    kind?: 'text' | 'number' | 'textarea' | 'checkbox' | 'type';
    /** Optional HTML `name` attribute for form submission data. */
    name?: string;
    /** Optional `data-column` attribute for editable table cells. */
    column?: string;
    /** Render without a visible `<label>` wrapper and set `aria-label` on the control. */
    inline?: boolean;
    /** Mark the control as mandatory when editable. */
    required?: boolean;
    /** Mark placeholder row cells that become mandatory once the row is promoted. */
    requiredWhenActive?: boolean;
    /** Render the text control as `readonly`. */
    readonly?: boolean;
    /** Render the control as `disabled`. */
    disabled?: boolean;
    /** Request initial focus when the form opens. */
    autofocus?: boolean;
    /** Optional input placeholder text. */
    placeholder?: string;
    /** Optional tooltip text on the control. */
    title?: string;
    /** CSS class applied to checkbox `<label>` wrappers. */
    checkboxClass?: string;
    /** Extra `data-*` attributes keyed without the `data-` prefix. */
    data?: Record<string, string | boolean | undefined>;
}
/** Render a labeled HTML form control paired with a field error description element. */
export function formControl(options: FormControlOptions): string {
    const id = options.id || fieldControlId(options.path);
    const errorId = `${id}-error`;
    const isRequired = Boolean(options.required && !options.readonly && !options.disabled);
    const extraData = Object.entries(options.data || {})
        .filter(([, entryValue]) => entryValue !== undefined)
        .map(([key, entryValue]) => ` data-${escape(key)}="${escape(entryValue)}"`)
        .join('');
    const common = `id="${escape(id)}" data-path="${escape(JSON.stringify(options.path))}" data-error-id="${escape(errorId)}"`
        + (options.name ? ` name="${escape(options.name)}"` : '')
        + (options.column ? ` data-column="${escape(options.column)}"` : '')
        + (options.inline ? ` aria-label="${escape(options.label)}"` : '')
        + (isRequired ? ' required aria-required="true"' : '')
        + (options.requiredWhenActive ? ' data-required-when-active="true"' : '')
        + (options.readonly ? ' readonly' : '')
        + (options.disabled ? ' disabled' : '')
        + (options.autofocus ? ' autofocus' : '')
        + (options.placeholder !== undefined ? ` placeholder="${escape(options.placeholder)}"` : '')
        + (options.title !== undefined ? ` title="${escape(options.title)}"` : '')
        + extraData;
    const errorSpan = `<span id="${escape(errorId)}" class="field-error" hidden></span>`;
    if (options.kind === 'checkbox') {
        const cls = options.checkboxClass || 'checkbox';
        const control = `<input ${common} type="checkbox"${isRequired ? ' aria-invalid="false"' : ''}${options.value === true ? ' checked' : ''}>`;
        return options.inline ? `${control}${errorSpan}`
            : `<div class="form-field form-field-check"><label class="${escape(cls)}" for="${escape(id)}">${control}${escape(options.label)}</label>${errorSpan}</div>`;
    }
    const control = options.kind === 'textarea'
        ? `<textarea ${common}>${escape(options.value)}</textarea>`
        : `<input ${common} type="${options.kind === 'number' ? 'number' : 'text'}" value="${escape(options.value)}"${options.kind === 'type' ? ' list="type-options"' : ''}>`;
    if (options.inline) { return `${control}${errorSpan}`; }
    return `<div class="form-field${options.kind === 'textarea' ? ' full' : ''}"><label for="${escape(id)}">${escape(options.label)}</label>${control}${errorSpan}</div>`;
}
/** Render a titled HTML section block. */
export const section = (title: string, body: string): string => `<section><h2>${escape(title)}</h2>${body}</section>`;
/** Render a definition list of key-value pairs. */
export const properties = (values: [string, unknown][]): string => `<dl>${values.map(([key, value]) => `<div><dt>${escape(key)}</dt><dd>${escape(value ?? '—')}</dd></div>`).join('')}</dl>`;
/** Render an HTML table inside a horizontally scrollable wrapper. */
export const table = (headers: string[], values: unknown[][]): string => `<div class="table-wrap"><table><thead><tr>${headers.map(h => `<th scope="col">${escape(h)}</th>`).join('')}</tr></thead><tbody>${values.map(row => `<tr>${row.map(cell => `<td>${escape(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
/** Render a labeled action button for a webview toolbar or form. */
export const button = (label: string, action: string, value?: unknown, variant: 'primary' | 'secondary' | 'danger' = 'secondary'): string => `<button class="${variant}" type="button" data-action="${escape(action)}"${value === undefined ? '' : ` data-value="${escape(value)}"`}><span>${escape(label)}</span></button>`;
/** Icon-only toolbar action, like VS Code's editor title actions; the label is the accessible name and the tooltip. */
export const iconButton = (icon: keyof typeof callIcons, label: string, action: string, value?: unknown, variant = ''): string => `<button class="icon-button${variant ? ` ${variant}` : ''}" type="button" data-action="${escape(action)}"${value === undefined ? '' : ` data-value="${escape(value)}"`} aria-label="${escape(label)}" title="${escape(label)}">${callIcon(icon)}</button>`;
/** Render an expandable overflow menu containing secondary actions. */
export function actionsMenu(contents: string, id = 'inspector-more'): string {
    return `<details class="inspector-menu" id="${escape(id)}" data-action-menu><summary aria-label="More actions" title="More actions">${callIcon('more')}</summary><div class="inspector-menu-content" role="group" aria-label="More actions">${contents}</div></details>`;
}
/** Formats addresses, offsets, storage locations, and raw identifiers as code. */
export const code = (value: unknown): string => {
    const full = text(value), shown = displayAddress(full);
    return `<code class="mono"${shown !== full ? ` title="${escape(full)}"` : ''}>${escape(shown)}</code>`;
};
/** Long demangled C++ names break after scope, template and argument separators instead of mid-token. */
export const breakable = (value: unknown): string => escape(value).replace(/(::|&lt;|,)/g, '$1<wbr>');
/** Optional presentation and state arguments for {@link page}. */
export interface PageExtras {
    /** Leading header navigation (Back / Forward), already rendered. */
    nav?: string;
    /** Raw identity shown as the title tooltip, such as the mangled name. */
    titleHint?: string;
    /** Rendered subtitle markup; `subtitle` stays as the plain-text tooltip. */
    subtitleHtml?: string;
    /** Render as loading: native-style progress bar and aria-busy. */
    busy?: boolean;
    /** Rendered title markup, such as a syntax-highlighted C++ name; `title` stays plain text. */
    titleHtml?: string;
    /** Failure shown in the page's single alert region. */
    error?: string;
}
/** Render a complete CSP-protected HTML page for a VS Code webview panel. */
export function page(title: string, eyebrow: string, subtitle: unknown, body: string, script = '', state?: Data, actions = '', extras: PageExtras = {}): string {
    const nonce = randomBytes(18).toString('base64');
    const stateJson = JSON.stringify(state || {}).replace(/</g, '\\u003c');
    const form = body.includes('id="edit-form"');
    const kind = String(state?.kind || (form ? 'edit' : 'inspector'));
    const subtitleMarkup = extras.subtitleHtml ?? escape(subtitle);
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';"><title>${escape(title)}</title><style nonce="${nonce}">
    ${pageStyles}
    ${iconFontStyles}
    ${viewStyles}
    </style></head><body class="${form ? 'edit-page' : 'inspector-page'}${extras.busy ? ' is-busy' : ''}" data-view-kind="${escape(kind)}"${extras.busy ? ' aria-busy="true"' : ''}><main><header><div class="inspector-title"><div><div class="eyebrow">${escape(eyebrow)}</div><h1 tabindex="-1"${extras.titleHint ? ` title="${escape(extras.titleHint)}"` : ''}>${extras.titleHtml ?? breakable(title)}</h1>${subtitle ? `<p class="subtitle" title="${escape(subtitle)}">${subtitleMarkup}</p>` : ''}</div></div>${extras.nav || actions ? `<div class="inspector-tools">${extras.nav ? `<nav class="inspector-nav" aria-label="Inspector history">${extras.nav}</nav>` : ''}${actions ? `<div class="inspector-actions" role="group" aria-label="${escape(eyebrow)} actions">${actions}</div>` : ''}</div>` : ''}</header><p id="error" class="error" role="alert">${escape(extras.error ?? '')}</p><p id="busy-status" class="sr-status" role="status">${extras.busy ? 'Loading' : ''}</p>${body}</main><script nonce="${nonce}">
    const vscode=acquireVsCodeApi();
    const inspectorState=${stateJson},inspectorPrevious=vscode.getState()||{};
    const inspectorSame=!!inspectorState.kind&&['kind','md5','path','entry','id'].every(key=>inspectorState[key]===inspectorPrevious[key]);
    const inspectorNavigated=!!inspectorState.kind&&!!inspectorPrevious.kind&&!inspectorSame&&!document.body.classList.contains('is-busy');
    const ghidraA11y=(()=>{
      const fieldId=path=>'field-'+path.map(part=>String(part).replace(/[^A-Za-z0-9_]/g,ch=>'_'+ch.charCodeAt(0).toString(16)+'_')).join('--');
      const openDetails=el=>{let changed=false,start=el?.tagName==='SUMMARY'?el.parentElement?.parentElement:el;for(let d=start?.closest?.('details');d;d=d.parentElement?.closest('details')){if(!d.open){d.open=true;changed=true}}return changed};
      const focus=(el,options={})=>{if(!el)return false;openDetails(el);el.focus({preventScroll:!!options.preventScroll});if(typeof options.start==='number'&&typeof options.end==='number'&&typeof el.setSelectionRange==='function'){try{el.setSelectionRange(options.start,options.end)}catch{}}return document.activeElement===el};
      const announce=(target,next)=>{
        const el=typeof target==='string'?document.getElementById(target):target;if(!el)return;
        const value=String(next??'');
        if(el._a11yFrame){cancelAnimationFrame(el._a11yFrame);el._a11yFrame=0}
        if(!value){
          if(el.textContent){el._a11yLast=el.textContent;el._a11yCleared=true;el.textContent='';el._a11yFrame=requestAnimationFrame(()=>{el._a11yFrame=0;el._a11yCleared=false;if(!el.textContent)el._a11yLast=''})}
          else{el.textContent=''}
          return;
        }
        if(el.textContent===value||(el._a11yCleared&&el._a11yLast===value)){
          el.textContent='';el._a11yCleared=false;
          el._a11yFrame=requestAnimationFrame(()=>{el._a11yFrame=0;el.textContent=value;el._a11yLast=value});
        }else{el.textContent=value;el._a11yLast=value;el._a11yCleared=false}
      };
      const findField=(path,root=document)=>{
        if(!Array.isArray(path)||!path.length)return null;
        const encoded=JSON.stringify(path),controls=[...root.querySelectorAll('[data-path]:not([data-new-key])')];
        const exact=controls.find(el=>el.dataset.path===encoded);if(exact)return exact;
        if(path.length>=2&&typeof path[1]==='number'){const row=root.querySelector('table[data-type-list="'+path[0]+'"] tr[data-index="'+path[1]+'"]:not([data-new]) [data-path],table[data-table="'+path[0]+'"] tbody tr:nth-child('+(path[1]+1)+') [data-path]');if(row)return row}
        if(path[0]==='signature'&&path[1]==='parameters'&&typeof path[2]==='number'){const row=root.querySelector('table[data-type-list="parameters"] tr[data-index="'+path[2]+'"]:not([data-new]) [data-path]');if(row)return row}
        return controls.find(el=>{try{const candidate=JSON.parse(el.dataset.path);return Array.isArray(candidate)&&path.every((seg,idx)=>candidate[idx]===seg)}catch{return false}})||null;
      };
      const clearFieldError=el=>{
        if(!el||el.getAttribute?.('aria-invalid')!=='true')return;
        if(el.type==='checkbox'&&el.required)el.setAttribute('aria-invalid','false');else el.removeAttribute('aria-invalid');
        const errEl=el.dataset?.errorId?document.getElementById(el.dataset.errorId):null;
        if(errEl){errEl.textContent='';errEl.hidden=true}
        const removeIds=new Set([el.dataset?.errorId,'error','type-validation'].filter(Boolean));
        const kept=(el.getAttribute('aria-describedby')||'').split(/\\s+/).filter(id=>id&&!removeIds.has(id));
        if(kept.length)el.setAttribute('aria-describedby',kept.join(' '));else el.removeAttribute('aria-describedby');
      };
      const clearErrors=(root=document)=>{
        for(const el of root.querySelectorAll('[aria-invalid="true"]'))clearFieldError(el);
        for(const err of root.querySelectorAll('.field-error')){err.textContent='';err.hidden=true}
      };
      const markErrors=(issues,options={})=>{
        const root=options.root||document;if(!options.append)clearErrors(root);
        let first=null;
        for(const issue of issues||[]){
          const el=findField(issue?.path,root);if(!el)continue;
          openDetails(el);el.setAttribute('aria-invalid','true');
          const errEl=el.dataset.errorId?document.getElementById(el.dataset.errorId):null;
          let descId=options.fallbackId||'';
          if(errEl&&issue.message){errEl.textContent=String(issue.message);errEl.hidden=false;descId=errEl.id}
          if(descId){const ids=new Set((el.getAttribute('aria-describedby')||'').split(/\\s+/).filter(Boolean));ids.add(descId);el.setAttribute('aria-describedby',[...ids].join(' '))}
          if(!first)first=el;
        }
        if(options.focus&&first)focus(first);
        return first;
      };
      const setBusy=(controls,isBusy,container)=>{
        if(container){if(isBusy)container.setAttribute('aria-busy','true');else container.removeAttribute('aria-busy')}
        for(const el of controls||[]){
          if(isBusy){if(el.dataset.wasAriaDisabled===undefined)el.dataset.wasAriaDisabled=el.getAttribute('aria-disabled')??'';el.setAttribute('aria-disabled','true');el.setAttribute('aria-busy','true')}
          else if(el.dataset.wasAriaDisabled!==undefined){if(el.dataset.wasAriaDisabled)el.setAttribute('aria-disabled',el.dataset.wasAriaDisabled);else el.removeAttribute('aria-disabled');el.removeAttribute('aria-busy');delete el.dataset.wasAriaDisabled}
        }
      };
      const syncTable=table=>{
        if(!table?.tBodies?.[0])return;
        const key=table.dataset.table,singular=table.dataset.singular||'row',prefix=singular[0].toUpperCase()+singular.slice(1);
        [...table.tBodies[0].rows].forEach((row,rowIndex)=>{
          const number=rowIndex+1;
          for(const el of row.querySelectorAll('[data-column]')){
            const path=[key,rowIndex,el.dataset.column],id=table.dataset.singular?'grid-'+key+'-'+number+'-'+el.dataset.column:fieldId(path),prevErrId=el.dataset.errorId,nextErrId=id+'-error';
            const errEl=prevErrId?row.querySelector('#'+CSS.escape(prevErrId)):el.nextElementSibling;
            el.id=id;el.dataset.path=JSON.stringify(path);el.dataset.errorId=nextErrId;
            if(el.dataset.label||table.dataset.singular)el.setAttribute('aria-label',prefix+' '+number+' '+(el.dataset.label||el.dataset.column).toLowerCase());
            if(errEl?.classList.contains('field-error'))errEl.id=nextErrId;
            if(prevErrId&&el.hasAttribute('aria-describedby')){el.setAttribute('aria-describedby',el.getAttribute('aria-describedby').split(/\\s+/).map(item=>item===prevErrId?nextErrId:item).join(' '))}
          }
          const button=row.querySelector('[data-remove-row]');
          if(button){button.id='grid-'+key+'-'+number+'-remove';button.setAttribute('aria-label','Remove '+singular+' '+number)}
        });
      };
      return {fieldId,openDetails,focus,announce,findField,clearFieldError,clearErrors,markErrors,setBusy,syncTable};
    })();
    {const used={};for(const control of document.querySelectorAll('button,summary,input,select,textarea')){if(control.id){continue}const base=('f-'+(control.dataset.action||control.tagName.toLowerCase())+'-'+(control.dataset.value||control.getAttribute('aria-label')||control.textContent.trim()||'')).slice(0,64).replace(/[^\\w-]/g,'_');used[base]=(used[base]||0)+1;control.id=used[base]>1?base+'-'+used[base]:base}}
    const inspectorDetails=[...document.querySelectorAll('details:not([data-action-menu])')];
    let inspectorPersistFrame=0;
    const persistInspectorUi=()=>{if(inspectorPersistFrame){cancelAnimationFrame(inspectorPersistFrame);inspectorPersistFrame=0}vscode.setState({...inspectorState,ui:{scrollX:window.scrollX,scrollY:window.scrollY,focusId:document.activeElement?.id,details:inspectorDetails.map(details=>details.open)}})};
    const scheduleInspectorPersist=()=>{if(!inspectorPersistFrame){inspectorPersistFrame=requestAnimationFrame(()=>{inspectorPersistFrame=0;persistInspectorUi()})}};
    if(inspectorSame){inspectorDetails.forEach((details,index)=>{if(typeof inspectorPrevious.ui?.details?.[index]==='boolean'){details.open=inspectorPrevious.ui.details[index]}})}
    for(const details of inspectorDetails){details.addEventListener('toggle',persistInspectorUi)}
    document.addEventListener('click',event=>{const button=event.target.closest('[data-action]');if(button&&!button.disabled&&button.getAttribute('aria-disabled')!=='true'){const menu=button.closest('[data-action-menu]');if(menu){menu.open=false}persistInspectorUi();vscode.postMessage({action:button.dataset.action,value:button.dataset.value})}for(const menu of document.querySelectorAll('[data-action-menu][open]')){if(!menu.contains(event.target)){menu.open=false}}});
    for(const menu of document.querySelectorAll('[data-action-menu]')){menu.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();menu.open=false;menu.querySelector('summary').focus();return}if(!['ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Home','End'].includes(event.key)){return}event.preventDefault();menu.open=true;const items=[...menu.querySelectorAll('button:not(:disabled):not([aria-disabled="true"])')],index=items.indexOf(document.activeElement),forward=event.key==='ArrowDown'||event.key==='ArrowRight',next=event.key==='Home'?0:event.key==='End'?items.length-1:forward?(index+1)%items.length:(index<=0?items.length-1:index-1);items[next]?.focus()});menu.addEventListener('focusout',()=>requestAnimationFrame(()=>{if(!menu.contains(document.activeElement)){menu.open=false}}))}
    window.addEventListener('scroll',scheduleInspectorPersist,{passive:true});document.addEventListener('focusin',persistInspectorUi);
    window.addEventListener('message',event=>{const status=document.getElementById('busy-status');if(event.data?.action==='busy'){document.body.classList.add('is-busy');document.body.setAttribute('aria-busy','true');ghidraA11y.announce(status,'Loading')}else if(event.data?.action==='error'){document.body.classList.remove('is-busy');document.body.removeAttribute('aria-busy');ghidraA11y.announce(status,'');ghidraA11y.announce('error',event.data.error||'')}});
    document.addEventListener('keydown',event=>{if(!event.altKey||event.ctrlKey||event.metaKey||!['ArrowLeft','ArrowRight'].includes(event.key)){return}const target=document.querySelector(event.key==='ArrowLeft'?'[data-action="back"]':'[data-action="forward"]');if(target&&!target.disabled&&target.getAttribute('aria-disabled')!=='true'){event.preventDefault();target.click()}});
    requestAnimationFrame(()=>{if(inspectorSame){window.scrollTo(inspectorPrevious.ui?.scrollX||0,inspectorPrevious.ui?.scrollY||0);if(inspectorPrevious.ui?.focusId&&document.activeElement===document.body){document.getElementById(inspectorPrevious.ui.focusId)?.focus({preventScroll:true})}}else if(inspectorNavigated&&inspectorPrevious.ui?.focusId){document.querySelector('h1')?.focus({preventScroll:true})}if(!document.body.classList.contains('is-busy')){persistInspectorUi()}document.body.dataset.viewReady='true'});
    ${script}</script></body></html>`;
}
