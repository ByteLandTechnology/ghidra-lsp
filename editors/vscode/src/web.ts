// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

import { randomBytes } from 'node:crypto';
import { pageStyles } from './page-styles';
import { iconFontStyles } from './icon-font';
import { viewStyles, webviewPopoverScript } from './view-ui';
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
/** Parse a user-entered type string into a structured server type reference. */
export function typeReference(value: unknown): Data {
    const name = String(value ?? '').trim();
    if (!name) { throw new Error('Choose a data type.'); }
    if (name === 'pointer') { return { kind: 'untyped_pointer' }; }
    const array = /^(.*)\[([0-9]+)\]$/.exec(name);
    if (array) { return { kind: 'array', element: typeReference(array[1]), count: integer(array[2], 'Array length', 1) }; }
    if (/\*$/.test(name)) { return { kind: 'pointer', target: typeReference(name.slice(0, -1)) }; }
    return { kind: 'named', name };
}
/** Parse and validate an integer within inclusive bounds. */
export function integer(value: unknown, label: string, minimum = 0, maximum = 2147483647): number {
    const number = Number(String(value ?? '').trim());
    if (!String(value ?? '').trim() || !Number.isSafeInteger(number) || number < minimum || number > maximum) { throw new Error(`${label} must be an integer between ${minimum} and ${maximum}.`); }
    return number;
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
    const safeId = escape(id);
    return `<button class="icon-button inspector-menu-button" id="${safeId}-button" type="button" popovertarget="${safeId}" aria-label="More actions" title="More actions">${callIcon('more')}</button><div class="inspector-menu-content" id="${safeId}" popover="auto" data-popover-menu data-action-menu role="group" aria-label="More actions">${contents}</div>`;
}
/** Format a deterministic DOM element identifier from a prefix and raw token. */
export function domId(prefix: string, value: unknown): string {
    const slug = String(value ?? '').replace(/[^A-Za-z0-9-]/g, ch => `_${ch.charCodeAt(0).toString(16)}_`);
    return `${prefix}-${slug || 'empty'}`;
}
/** Render shared assertive error alert and polite busy status live regions. */
export const liveRegionsHtml = (busy = false, error = ''): string => `<p id="error" class="error" role="alert">${escape(error)}</p><p id="busy-status" class="sr-status" role="status">${busy ? 'Loading' : ''}</p>`;
/** Render a Go to address form with an inline assertive error region. */
export const gotoFormHtml = (value: string, label: string, placeholder: string): string => `<form id="goto" novalidate><input id="address" aria-label="${escape(label)}" value="${escape(value)}" placeholder="${escape(placeholder)}"><button id="goto-submit" type="submit" aria-label="Go to address" title="Go to address">${callIcon('right')}</button><span id="goto-error" class="goto-error error" role="alert"></span></form>`;
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
    </style></head><body class="${form ? 'edit-page' : 'inspector-page'}${extras.busy ? ' is-busy' : ''}" data-view-kind="${escape(kind)}"${extras.busy ? ' aria-busy="true"' : ''}><main><header><div class="inspector-title"><div><div class="eyebrow">${escape(eyebrow)}</div><h1 tabindex="-1"${extras.titleHint ? ` title="${escape(extras.titleHint)}"` : ''}>${extras.titleHtml ?? breakable(title)}</h1>${subtitle ? `<p class="subtitle" title="${escape(subtitle)}">${subtitleMarkup}</p>` : ''}</div></div>${extras.nav || actions ? `<div class="inspector-tools">${extras.nav ? `<nav class="inspector-nav" aria-label="Inspector history">${extras.nav}</nav>` : ''}${actions ? `<div class="inspector-actions" role="group" aria-label="${escape(eyebrow)} actions">${actions}</div>` : ''}</div>` : ''}</header>${liveRegionsHtml(extras.busy, extras.error ?? '')}${body}</main><script nonce="${nonce}">
    const vscode=acquireVsCodeApi();
    const inspectorState=${stateJson},inspectorPrevious=vscode.getState()||{};
    const inspectorSame=!!inspectorState.kind&&['kind','md5','path','entry','id'].every(key=>inspectorState[key]===inspectorPrevious[key]);
    const inspectorNavigated=!!inspectorState.kind&&!!inspectorPrevious.kind&&!inspectorSame&&!document.body.classList.contains('is-busy');
    {const used={};for(const control of document.querySelectorAll('button,summary,input,select,textarea')){if(control.id){continue}const base=('f-'+(control.dataset.action||control.tagName.toLowerCase())+'-'+(control.dataset.value||control.getAttribute('aria-label')||control.textContent.trim()||'')).slice(0,64).replace(/[^\\w-]/g,'_');used[base]=(used[base]||0)+1;control.id=used[base]>1?base+'-'+used[base]:base}}
    const inspectorDetails=[...document.querySelectorAll('details')];
    let inspectorPersistFrame=0;
    const {focusId:initialInspectorFocusId,...persistedInspectorState}=inspectorState;
    const persistInspectorUi=()=>{if(inspectorPersistFrame){cancelAnimationFrame(inspectorPersistFrame);inspectorPersistFrame=0}vscode.setState({...persistedInspectorState,ui:{scrollX:window.scrollX,scrollY:window.scrollY,focusId:document.activeElement?.id,details:inspectorDetails.map(details=>details.open)}})};
    const scheduleInspectorPersist=()=>{if(!inspectorPersistFrame){inspectorPersistFrame=requestAnimationFrame(()=>{inspectorPersistFrame=0;persistInspectorUi()})}};
    ${webviewPopoverScript}
    if(inspectorSame){inspectorDetails.forEach((details,index)=>{if(typeof inspectorPrevious.ui?.details?.[index]==='boolean'){details.open=inspectorPrevious.ui.details[index]}})}
    for(const details of inspectorDetails){details.addEventListener('toggle',persistInspectorUi)}
    document.addEventListener('click',event=>{const button=event.target.closest('[data-action]');if(button&&!button.disabled){const menu=button.closest('[data-action-menu]');if(menu){focusInvokerAndClose(menu)}persistInspectorUi();vscode.postMessage({action:button.dataset.action,value:button.dataset.value,focusId:document.activeElement?.id||''})}});
    window.addEventListener('scroll',scheduleInspectorPersist,{passive:true});document.addEventListener('focusin',persistInspectorUi);
    window.addEventListener('message',event=>{const status=document.getElementById('busy-status');if(event.data?.action==='busy'){document.body.classList.add('is-busy');document.body.setAttribute('aria-busy','true');status.textContent='Loading'}else if(event.data?.action==='error'){document.body.classList.remove('is-busy');document.body.removeAttribute('aria-busy');status.textContent='';document.getElementById('error').textContent=event.data.error||''}});
    document.addEventListener('keydown',event=>{if(!event.altKey||event.ctrlKey||event.metaKey||!['ArrowLeft','ArrowRight'].includes(event.key)){return}const target=document.querySelector(event.key==='ArrowLeft'?'[data-action="back"]':'[data-action="forward"]');if(target){event.preventDefault();target.click()}});
    requestAnimationFrame(()=>{const savedFocusId=(inspectorSame&&inspectorPrevious.ui?.focusId)||initialInspectorFocusId||'';if(inspectorSame){window.scrollTo(inspectorPrevious.ui?.scrollX||0,inspectorPrevious.ui?.scrollY||0)}if(savedFocusId&&(inspectorSame||initialInspectorFocusId)){restorePopoverAwareFocus(savedFocusId)}else if(inspectorNavigated&&inspectorPrevious.ui?.focusId){document.querySelector('h1')?.focus({preventScroll:true})}if(!document.body.classList.contains('is-busy')){persistInspectorUi()}document.body.dataset.viewReady='true'});
    ${script}</script></body></html>`;
}
