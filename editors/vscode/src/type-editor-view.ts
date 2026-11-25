// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

import * as vscode from 'vscode';
import { applyEdits, modify, parse, ParseError } from 'jsonc-parser';
import { typePath } from './type-files';
import { typeEditorViewId } from './virtual-files';
import { callIcon } from './call-graph-icons';
import { Data, escape, object, page, properties, reference, rows } from './web';
import { Call } from './memory';
import { kindOf, parseType, reorderTypeMembers, typeModel, typeMutations } from './type-model';

/** Custom editor viewType identifier for the graphical data type editor. */
export const typeEditorView = typeEditorViewId;
/** Control focus restoration target sent to the type editor webview. */
interface EditorFocus { path?: (string | number)[]; move?: { key: string; index: number }; sort?: { key: string; field: string }; start?: number | null; end?: number | null; }
/** Active table sort field and direction inside the type editor webview. */
interface EditorSort { field: string; direction: 'ascending' | 'descending'; }
/** Structured metadata summary rendered below the data type editor heading. */
interface TypeHeaderSummary {
    /** Plain-text metadata summary used for tooltips. */
    subtitle: string;
    /** Rich HTML metadata containing the kind badge, path, total bytes, and member count. */
    subtitleHtml: string;
    /** Byte-length label when known from the definition. */
    bytesLabel?: string;
    /** Member-count label for fields, enum values, or function parameters. */
    countLabel?: string;
}

/** Build structured header metadata from a parsed data type model. */
function typeHeaderSummary(model: unknown, fallbackPath: string, readonly: boolean, fallbackBytes?: number): TypeHeaderSummary {
    const m = object(model);
    const rawKind = typeof m.kind === 'string' && m.kind ? kindOf(m) : 'type';
    const kind = rawKind.toLowerCase();
    const path = typeof m.path === 'string' && m.path ? m.path : fallbackPath;
    const explicitSize = typeof m.length === 'number' && m.length >= 0 ? m.length
        : typeof m.size === 'number' && m.size >= 0 ? m.size : undefined;
    let totalBytes = explicitSize;
    if (totalBytes === undefined && Array.isArray(m.fields)) {
        if (!m.fields.length) {
            totalBytes = 0;
        } else if (kind === 'struct') {
            const valid = m.fields.every((field: unknown) => {
                const item = object(field);
                return typeof item.offset === 'number' && item.offset >= 0 && typeof item.length === 'number' && item.length > 0;
            });
            if (valid) {
                totalBytes = m.fields.reduce<number>((end, field) => Math.max(end, Number(object(field).offset) + Number(object(field).length)), 0);
            }
        } else if (kind === 'union') {
            const valid = m.fields.every((field: unknown) => typeof object(field).length === 'number' && Number(object(field).length) > 0);
            if (valid) {
                totalBytes = m.fields.reduce<number>((maxLen, field) => Math.max(maxLen, Number(object(field).length)), 0);
            }
        }
    }
    if (totalBytes === undefined && typeof fallbackBytes === 'number' && fallbackBytes >= 0) {
        totalBytes = fallbackBytes;
    }
    const bytesLabel = totalBytes !== undefined ? `${totalBytes} ${totalBytes === 1 ? 'byte' : 'bytes'}` : undefined;
    let countLabel: string | undefined;
    if (Array.isArray(m.fields)) {
        countLabel = `${m.fields.length} ${m.fields.length === 1 ? 'field' : 'fields'}`;
    } else if (Array.isArray(m.values)) {
        countLabel = `${m.values.length} ${m.values.length === 1 ? 'value' : 'values'}`;
    } else if (m.signature) {
        const params = object(m.signature).parameters;
        if (Array.isArray(params)) {
            const count = params.length;
            countLabel = `${count} ${count === 1 ? 'parameter' : 'parameters'}`;
        }
    }
    const subtitle = [kind, ...(readonly ? ['read-only'] : []), path, bytesLabel, countLabel].filter(Boolean).join(' · ');
    const subtitleHtml = [
        `<span class="type-kind-badge">${escape(kind)}</span>`,
        readonly ? '<span class="type-kind-badge is-readonly">read-only</span>' : '',
        `<code class="mono type-meta-path">${escape(path)}</code>`,
        `<span class="type-meta-sep" aria-hidden="true"${bytesLabel ? '' : ' hidden'}>·</span><span class="type-meta-stat" data-meta-bytes${bytesLabel ? '' : ' hidden'}>${escape(bytesLabel || '')}</span>`,
        countLabel ? `<span class="type-meta-sep" aria-hidden="true">·</span><span class="type-meta-stat" data-meta-count>${escape(countLabel)}</span>` : '',
    ].filter(Boolean).join('');
    return { subtitle, subtitleHtml, bytesLabel, countLabel };
}

/** A form representation of the same JSONC document; native Save owns persistence. */
export class DataTypeEditorView implements vscode.CustomTextEditorProvider, vscode.Disposable {
    /** VS Code custom editor provider registration handle. */
    private readonly registration: vscode.Disposable;
    /** Register the `ghidra.dataTypeEditor` custom text editor provider. */
    constructor(private readonly call: Call) {
        this.registration = vscode.window.registerCustomEditorProvider(typeEditorView, this, {
            webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: true,
        });
    }
    /** Bind a graphical form webview to an open `ghidra-type://` JSONC document. */
    async resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): Promise<void> {
        typePath(document.uri);
        panel.webview.options = { enableScripts: true, localResourceRoots: [] };
        const stat = await vscode.workspace.fs.stat(document.uri);
        const readonly = !!(stat.permissions && (stat.permissions & vscode.FilePermission.Readonly));
        let applying = false, panelVersion = document.version, generation = 0;
        let completedUpdateGeneration: number | undefined;
        let editorFocus: EditorFocus | undefined;
        let cachedRawBytes: number | undefined;
        const sorts: Record<string, EditorSort> = {};
        let typeOptions = ['void', 'pointer', 'int', 'char', 'byte', 'undefined1', 'undefined4', 'uint', 'long'];
        const render = (focus?: EditorFocus, saving = false, statusMessage?: string): void => {
            const renderGeneration = ++generation; panelVersion = document.version;
            const errors: ParseError[] = [];
            const model = parse(document.getText(), errors, { allowTrailingComma: true, disallowComments: false });
            const modelKind = model && typeof model === 'object' && !Array.isArray(model) ? kindOf(object(model)) : '';
            const input = (path: (string | number)[], value: unknown, label: string, inline = false, newKey = '', describedBy = ''): string => {
                const encoded = escape(JSON.stringify(path));
                const ariaDesc = describedBy ? ` aria-describedby="${escape(describedBy)}"` : '';
                if (typeof value === 'boolean') { return `<label class="type-flag"><input type="checkbox" data-path="${encoded}" ${value ? 'checked' : ''}${readonly ? ' disabled' : ''}${ariaDesc}>${escape(label)}</label>`; }
                const optionalLength = path[path.length - 1] === 'length';
                const typeReference = ['type', 'return_type'].includes(String(path[path.length - 1]));
                const control = `<input ${typeReference ? 'list="type-options" ' : ''}aria-label="${escape(label)}"${ariaDesc} data-path="${encoded}" data-number="${typeof value === 'number' || ['offset', 'length', 'value'].includes(String(path[path.length - 1]))}" value="${escape(value ?? '')}"${newKey ? ` data-new-key="${escape(newKey)}" placeholder="+ Add ${newKey === 'fields' ? 'field' : newKey === 'values' ? 'value' : 'parameter'}"` : optionalLength && !readonly ? ' placeholder="Auto"' : ''}${readonly ? ' readonly' : ''}>`;
                return inline ? control : `<label>${escape(label)}${control}</label>`;
            };
            const list = (key: string, rows: unknown[], fields: string[]): string => {
                const singular = key === 'fields' ? 'field' : key === 'values' ? 'value' : 'parameter';
                const columns = fields.filter(field => field !== 'offset' || modelKind === 'struct');
                const base: (string | number)[] = key === 'parameters' ? ['signature', key] : [key];
                const canMove = !readonly && (key === 'fields' || key === 'parameters');
                const moveHintId = canMove ? `type-move-hint-${key}` : '';
                const lengthHintId = !readonly && columns.includes('length') ? `type-length-hint-${key}` : '';
                const entry = (item: unknown, index: number, rowNumber: number, isNew = false): string => {
                    const data = item && typeof item === 'object' ? item as Record<string, unknown> : {};
                    const cells = columns.map(field => {
                        const isNewName = isNew && field === 'name';
                        const desc = readonly ? 'type-readonly-hint' : field === 'length' ? lengthHintId : '';
                        return `<td data-field="${escape(field)}" data-label="${escape(field[0].toUpperCase() + field.slice(1))}">${input([...base, index, field], data[field], isNewName ? `Add ${singular}` : `${singular} ${rowNumber} ${field}`, true, isNewName ? key : '', desc)}</td>`;
                    }).join('');
                    const move = canMove ? `<td class="type-row-handle"><button type="button" class="type-icon type-move" data-move aria-label="Move ${singular} ${rowNumber}" aria-describedby="${escape(moveHintId)}" title="Move ${singular}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 3h2v2H4zm6 0h2v2h-2zM4 7h2v2H4zm6 0h2v2h-2zM4 11h2v2H4zm6 0h2v2h-2z"/></svg></button></td>` : '';
                    const remove = readonly ? '' : `<td class="type-row-action"><button type="button" class="type-icon" data-action="remove" aria-label="Remove ${singular} ${rowNumber}" title="Remove ${singular}">${callIcon('trash')}</button></td>`;
                    return `<tr data-index="${index}"${isNew ? ' data-new="true"' : ''}>${move}${cells}${remove}</tr>`;
                };
                const indexed = rows.map((item, index) => ({ item, index }));
                if (key === 'fields' && modelKind === 'struct') { indexed.sort((a, b) => Number(object(a.item).offset) - Number(object(b.item).offset)); }
                const contents = indexed.map(({ item, index }, position) => entry(item, index, position + 1)).join('');
                const nextOffset = rows.reduce<number>((end, item) => Math.max(end, Number(object(item).offset || 0) + Number(object(item).length || 1)), 0);
                const newItem = key === 'values' ? { name: '', value: 0 } : key === 'parameters' ? { name: '', type: 'int' } : { offset: nextOffset, name: '', type: 'undefined1' };
                const blank = readonly ? '' : entry(newItem, rows.length, indexed.length + 1, true);
                const heading = key === 'parameters' ? '<h2>Parameters</h2>' : '';
                const hints = [
                    moveHintId ? `<span id="${escape(moveHintId)}">Drag or use arrow keys to move a ${singular}.</span>` : '',
                    lengthHintId ? `<span id="${escape(lengthHintId)}">Leave length empty to use the natural size.</span>` : '',
                ].filter(Boolean).join(' ');
                const hintMarkup = hints ? `<p class="hint type-table-hint">${hints}</p>` : '';
                const headers = columns.map(field => `<th scope="col" data-field="${escape(field)}" aria-sort="${field === 'offset' ? 'ascending' : 'none'}"><button type="button" class="type-sort" data-sort="${escape(field)}" aria-label="Sort by ${escape(field)}">${escape(field[0].toUpperCase() + field.slice(1))}<span aria-hidden="true"></span></button></th>`).join('');
                return `<section class="type-list">${heading}${hintMarkup}<div class="type-table-wrap"><table class="type-table" data-type-list="${escape(key)}" data-kind="${escape(modelKind)}" data-readonly="${readonly}"><thead><tr>${canMove ? '<th class="type-handle-col" scope="col"><span class="type-sr-only">Move</span></th>' : ''}${headers}${readonly ? '' : '<th class="type-action-col" scope="col"><span class="type-sr-only">Actions</span></th>'}</tr></thead><tbody>${contents}${blank}</tbody></table></div></section>`;
            };
            let body = '';
            if (readonly && !errors.length && model && typeof model === 'object' && !Array.isArray(model)) {
                const m = model as Record<string, any>;
                const reason = document.getText().split('\n').find(line => line.startsWith('// Read-only: '))?.slice('// Read-only: '.length) || 'This type is read-only.';
                const hasReasonPrefix = /^read-only\b/i.test(reason) || reason === 'This type is read-only.';
                const information: [string, unknown][] = [['Kind', m.kind ? kindOf(m) : m.kind], ['Size', m.length ?? m.size]];
                if (m.base_type) { information.push(['Base type', reference(m.base_type)]); }
                body = `<section class="type-definition"><div id="type-readonly-hint" class="type-readonly-banner" role="note" aria-label="Read-only data type">${hasReasonPrefix ? `<span>${escape(reason)}</span>` : `<strong>Read-only:</strong> <span>${escape(reason)}</span>`}</div>${properties(information)}</section>`;
                if (Array.isArray(m.fields)) { body += list('fields', m.fields.map((field: unknown) => ({ ...object(field), type: reference(object(field).data_type) })), ['offset', 'name', 'type', 'length']); }
                if (Array.isArray(m.values)) { body += list('values', m.values, ['name', 'value']); }
                if (m.signature && typeof m.signature === 'object') {
                    const sig = object(m.signature);
                    body += `<section><h2>Signature</h2>${properties([['Return type', reference(sig.return_type)], ['Calling convention', sig.calling_convention], ['Variadic', sig.has_var_args === true ? 'Yes' : 'No']])}</section>`;
                    if (Array.isArray(sig.parameters)) { body += list('parameters', sig.parameters.map((param: unknown) => ({ ...object(param), type: reference(object(param).data_type) })), ['name', 'type']); }
                }
                body += `<details class="type-raw"><summary>Raw definition</summary><pre>${escape(document.getText())}</pre></details>`;
            } else if (errors.length || !model || typeof model !== 'object' || Array.isArray(model)) {
                body = `<section class="type-definition"><p class="error">The definition contains invalid JSONC. Use Reopen Editor With… to correct it.</p></section>`;
            } else {
                const m = model as Record<string, any>;
                body = '';
                if (Array.isArray(m.fields)) { body += list('fields', m.fields, ['offset', 'name', 'type', 'length']); }
                if (Array.isArray(m.values)) { body += list('values', m.values, ['name', 'value']); }
                if (m.signature && typeof m.signature === 'object') {
                    const sig = m.signature as Record<string, any>;
                    const labels: Record<string, string> = { return_type: 'Return type', calling_convention: 'Calling convention', has_var_args: 'Variadic arguments', has_no_return: 'Does not return' };
                    const controls = (keys: string[]): string => keys.filter(key => key in sig).map(key => input(['signature', key], sig[key], labels[key])).join('');
                    const advanced = ['calling_convention', 'has_var_args', 'has_no_return'].filter(key => key in sig && (key === 'calling_convention' ? ['default', 'unknown'].includes(String(sig[key])) : sig[key] === false));
                    const visible = ['calling_convention', 'has_var_args', 'has_no_return'].filter(key => !advanced.includes(key));
                    body += `<section class="type-definition"><div class="form-grid">${controls(['return_type', ...visible.filter(key => key === 'calling_convention')])}</div><div class="type-flags">${controls(visible.filter(key => key !== 'calling_convention'))}</div></section>`;
                    if (advanced.length) { body += `<details class="signature-options"><summary>Signature options</summary><div class="form-grid">${controls(advanced.filter(key => key === 'calling_convention'))}</div><div class="type-flags">${controls(advanced.filter(key => key !== 'calling_convention'))}</div></details>`; }
                    if (Array.isArray(sig.parameters)) { body += list('parameters', sig.parameters, ['name', 'type']); }
                }
            }
            if (!body) { body = '<p class="type-empty">No editable fields.</p>'; }
            const script = `
              let draftVersion=${document.version}, draftDirty=${document.isDirty}, busy=false, busyAction='', saveQueued=false, dragging=null, busyFocus=null;
              document.body.dataset.draftVersion=String(draftVersion);
              const focusInfo=()=>{
                const el=document.activeElement;if(!el)return null;
                if(el.dataset.path)return {path:JSON.parse(el.dataset.path),start:el.selectionStart,end:el.selectionEnd};
                if(el.hasAttribute('data-move')){const row=el.closest('tr');return {move:{key:row.closest('table').dataset.typeList,index:Number(row.dataset.index)}}}
                if(el.dataset.sort)return {sort:{key:el.closest('table').dataset.typeList,field:el.dataset.sort}};
                return null;
              };
              const restoreFocus=focus=>{
                if(!focus)return;const target=focus.path?[...document.querySelectorAll('[data-path]')].find(el=>el.dataset.path===JSON.stringify(focus.path))
                  :focus.move?document.querySelector('table[data-type-list="'+focus.move.key+'"] tr[data-index="'+focus.move.index+'"] [data-move]')
                  :focus.sort?document.querySelector('table[data-type-list="'+focus.sort.key+'"] [data-sort="'+focus.sort.field+'"]'):null;
                if(!target)return;target.focus({preventScroll:true});
                if(typeof focus.start==='number'&&typeof focus.end==='number'&&typeof target.setSelectionRange==='function'){try{target.setSelectionRange(focus.start,focus.end)}catch{}}
              };
              const setBusy=(next,action='save')=>{
                if(next===busy)return;if(next)busyFocus=focusInfo();busy=next;busyAction=next?action:'';
                for(const element of document.querySelectorAll('input,button')){
                  if(busy){element.dataset.wasDisabled=String(element.disabled);element.disabled=true}
                  else if(element.dataset.wasDisabled!==undefined){element.disabled=element.dataset.wasDisabled==='true';delete element.dataset.wasDisabled}
                }
                const status=document.querySelector('.type-status');
                if(status){status.textContent=busy?(action==='save'?'Saving…':'Updating…'):(draftDirty?'Unsaved changes':'');status.dataset.state=busy?'saving':(draftDirty?'dirty':'clean')}
                if(!busy){restoreFocus(busyFocus);busyFocus=null}
              };
              const enqueue=item=>{item.generation=${renderGeneration};vscode.postMessage(item)};
              document.addEventListener('focusin',()=>{if(!busy)enqueue({action:'focus',focus:focusInfo()})});
              document.addEventListener('selectionchange',()=>{if(!busy&&document.activeElement?.dataset.path)enqueue({action:'focus',focus:focusInfo()})});
              window.addEventListener('blur',()=>{if(!busy)enqueue({action:'focus',focus:null})});
              const reindex=table=>{
                if(!table?.tBodies[0])return;
                const key=table.dataset.typeList,singular=key==='fields'?'field':key==='values'?'value':'parameter';
                Array.from(table.tBodies[0].rows).forEach((row,position)=>{
                  const number=position+1;
                  for(const el of row.querySelectorAll('[data-path]')){
                    const field=el.closest('td')?.dataset.field||JSON.parse(el.dataset.path).slice(-1)[0];
                    el.id='type-'+key+'-'+number+'-'+field;
                    el.setAttribute('aria-label',el.dataset.newKey?'Add '+singular:singular+' '+number+' '+field);
                  }
                  const moveBtn=row.querySelector('[data-move]'),removeBtn=row.querySelector('[data-action=remove]');
                  if(moveBtn){moveBtn.id='type-'+key+'-'+number+'-move';moveBtn.setAttribute('aria-label','Move '+singular+' '+number)}
                  if(removeBtn){removeBtn.id='type-'+key+'-'+number+'-remove';removeBtn.setAttribute('aria-label','Remove '+singular+' '+number)}
                });
              };
              const nextBlank=row=>{
                const blank=row.cloneNode(true), index=Number(row.dataset.index)+1;
                blank.dataset.index=String(index);
                for(const el of blank.querySelectorAll('[id]'))el.removeAttribute('id');
                for(const el of blank.querySelectorAll('[data-path]')){
                  const path=JSON.parse(el.dataset.path);path[path.length-2]=index;el.dataset.path=JSON.stringify(path);
                  delete el.dataset.edited;
                  if(el.dataset.newKey)el.value='';
                }
                row.after(blank);
              };
              const edit=el=>{
                if(!el||el.readOnly||el.disabled)return;
                if(el.dataset.newKey){
                  if(!el.value)return;
                  const key=el.dataset.newKey,row=el.closest('tr'),table=row.closest('table'),index=Number(row.dataset.index),name=el.value;
                  nextBlank(row);delete row.dataset.new;delete el.dataset.newKey;el.removeAttribute('placeholder');
                  reindex(table);
                  enqueue({action:'add',key,index,name});return;
                }
                el.dataset.edited='true';let value=el.type==='checkbox'?el.checked:el.value;
                if(el.dataset.number==='true'&&typeof value==='string'&&value.trim()!==''){const number=Number(value);if(Number.isFinite(number))value=number}
                enqueue({action:'change',path:JSON.parse(el.dataset.path),value});
              };
              const sort=(table,field,direction)=>{
                const body=table.tBodies[0], items=[...body.querySelectorAll('tr[data-index]:not([data-new])')], blank=body.querySelector('tr[data-new]');
                const isStructFields=['struct','structure'].includes(table.dataset.kind)&&table.dataset.typeList==='fields';
                const value=(row,key)=>row.querySelector('td[data-field="'+key+'"] input')?.value||'';
                items.sort((a,b)=>{
                  if(direction==='none')return isStructFields?(Number(value(a,'offset'))-Number(value(b,'offset'))):Number(a.dataset.index)-Number(b.dataset.index);
                  const x=value(a,field),y=value(b,field), numeric=['offset','length','value'].includes(field);
                  const result=numeric?(Number(x)-Number(y)):x.localeCompare(y,undefined,{numeric:true,sensitivity:'base'});
                  return (direction==='ascending'?1:-1)*result||Number(a.dataset.index)-Number(b.dataset.index);
                });
                for(const row of items)body.append(row);if(blank)body.append(blank);
                const defaultOffset=direction==='none'&&isStructFields;
                for(const head of table.querySelectorAll('th[data-field]'))head.setAttribute('aria-sort',defaultOffset&&head.dataset.field==='offset'?'ascending':head.dataset.field===field?direction:'none');
                reindex(table);
              };
              const initialSort=${JSON.stringify(sorts).replace(/</g, '\\u003c')};
              for(const table of document.querySelectorAll('.type-table')){const saved=initialSort[table.dataset.typeList];if(saved&&table.querySelector('[data-sort="'+saved.field+'"]'))sort(table,saved.field,saved.direction);else reindex(table)}
              const move=(row,target,before)=>{
                if(!row||!target||row===target||busy)return;
                const table=row.closest('table');if(table!==target.closest('table'))return;
                const key=table.dataset.typeList,order=[...table.tBodies[0].querySelectorAll('tr[data-index]:not([data-new])')].map(item=>Number(item.dataset.index));
                setBusy(true,'move');enqueue({action:'move',key,from:Number(row.dataset.index),to:Number(target.dataset.index),before,order});
              };
              window.addEventListener('message',event=>{
                if(event.data.action==='type-diagnostics'){const notice=document.getElementById('type-validation');if(notice){const errors=event.data.errors;notice.hidden=!errors.length;notice.textContent=errors.length?errors[0]+(errors.length>1?' (+'+(errors.length-1)+')':''):''}return}
                if(event.data.action==='type-options'){const list=document.getElementById('type-options');if(list){list.replaceChildren(...event.data.values.map(value=>{const option=document.createElement('option');option.value=value;return option}))}return}
                if(event.data.action==='type-meta'){const bytesEl=document.querySelector('[data-meta-bytes]');if(bytesEl&&!draftDirty&&event.data.bytesLabel){bytesEl.textContent=event.data.bytesLabel;bytesEl.hidden=false;const sep=bytesEl.previousElementSibling;if(sep?.classList.contains('type-meta-sep'))sep.hidden=false}return}
                if(event.data.action==='save-failed'){setBusy(false);return}
                if(event.data.action==='draft-version'){
                  draftVersion=event.data.version;draftDirty=!!event.data.dirty;document.body.dataset.draftVersion=String(draftVersion);
                  if(event.data.added?.offset!==undefined){const row=document.querySelector('table[data-type-list="'+event.data.added.key+'"] tr[data-index="'+event.data.added.index+'"]');const offset=row?.querySelector('td[data-field=offset] input');if(offset&&!offset.dataset.edited)offset.value=String(event.data.added.offset)}
                  if(event.data.meta){const bytesEl=document.querySelector('[data-meta-bytes]'),countEl=document.querySelector('[data-meta-count]');if(bytesEl&&event.data.meta.bytesLabel!==undefined){bytesEl.textContent=event.data.meta.bytesLabel||'';bytesEl.hidden=!event.data.meta.bytesLabel;const sep=bytesEl.previousElementSibling;if(sep?.classList.contains('type-meta-sep'))sep.hidden=!event.data.meta.bytesLabel}if(countEl&&event.data.meta.countLabel){countEl.textContent=event.data.meta.countLabel}}
                  const status=document.querySelector('.type-status');if(status&&!busy){status.textContent=draftDirty?'Unsaved changes':'';status.dataset.state=draftDirty?'dirty':'clean'}
                }
              });
              document.addEventListener('input',event=>{if(!event.isComposing)edit(event.target.closest('[data-path]'))});
              document.addEventListener('compositionend',event=>edit(event.target.closest('[data-path]')));
              document.addEventListener('click',event=>{
                const jsoncButton=event.target.closest('[data-open-jsonc]');if(jsoncButton){event.preventDefault();event.stopPropagation();enqueue({action:'open-jsonc'});return}
                const sortButton=event.target.closest('[data-sort]');if(sortButton){const head=sortButton.closest('th'),current=head.getAttribute('aria-sort'),next=current==='none'?'ascending':current==='ascending'?'descending':'none',table=sortButton.closest('table');sort(table,sortButton.dataset.sort,next);enqueue({action:'sort',key:table.dataset.typeList,field:sortButton.dataset.sort,direction:next});return}
                const button=event.target.closest('[data-action=remove]');if(!button||button.disabled)return;
                event.preventDefault();event.stopPropagation();const row=button.closest('tr');setBusy(true,'remove');enqueue({action:'remove',key:row.closest('table').dataset.typeList,index:Number(row.dataset.index)});
              },true);
              const clearDrag=()=>{dragging=null;for(const row of document.querySelectorAll('.is-dragging,.type-drop-before,.type-drop-after'))row.classList.remove('is-dragging','type-drop-before','type-drop-after')};
              document.addEventListener('pointerdown',event=>{const handle=event.target.closest('[data-move]');if(!handle||busy||event.button!==0)return;dragging={row:handle.closest('tr'),handle,id:event.pointerId,x:event.clientX,y:event.clientY,active:false,target:null};handle.setPointerCapture(event.pointerId)});
              document.addEventListener('pointermove',event=>{if(!dragging||dragging.id!==event.pointerId)return;if(!dragging.active&&Math.hypot(event.clientX-dragging.x,event.clientY-dragging.y)>4){dragging.active=true;dragging.row.classList.add('is-dragging')}if(!dragging.active)return;event.preventDefault();const row=document.elementFromPoint(event.clientX,event.clientY)?.closest('tr[data-index]:not([data-new])');for(const other of document.querySelectorAll('.type-drop-before,.type-drop-after'))other.classList.remove('type-drop-before','type-drop-after');dragging.target=row&&row.closest('table')===dragging.row.closest('table')?row:null;if(dragging.target){const bounds=row.getBoundingClientRect();dragging.before=event.clientY<bounds.top+bounds.height/2;row.classList.add(dragging.before?'type-drop-before':'type-drop-after')}});
              document.addEventListener('pointerup',event=>{if(!dragging||dragging.id!==event.pointerId)return;const state=dragging;if(state.handle.hasPointerCapture(event.pointerId))state.handle.releasePointerCapture(event.pointerId);clearDrag();if(state.active)move(state.row,state.target,state.before)});
              document.addEventListener('pointercancel',clearDrag);
              document.addEventListener('keydown',event=>{
                const handle=event.target.closest('[data-move]');if(handle&&(event.key==='ArrowUp'||event.key==='ArrowDown')){event.preventDefault();if(busy)return;const row=handle.closest('tr'),table=row.closest('table'),items=[...table.tBodies[0].querySelectorAll('tr[data-index]:not([data-new])')],index=items.indexOf(row),up=event.key==='ArrowUp',target=items[index+(up?-1:1)];if(!target){const status=document.querySelector('.type-status');if(status&&index>=0){const singular=table.dataset.typeList==='fields'?'field':'parameter',name=(row.querySelector('td[data-field="name"] input')?.value||'').trim(),label=singular[0].toUpperCase()+singular.slice(1)+(name?' '+name:'');status.textContent=label+' is at row '+(index+1)+' of '+items.length+(draftDirty?' · Unsaved changes':'');status.dataset.state=draftDirty?'dirty':'clean'}return}move(row,target,up);return}
                if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();event.stopPropagation();if(${readonly})return;if(busy){if(busyAction!=='save'&&!saveQueued){saveQueued=true;enqueue({action:'save-after-update'})}return}setBusy(true);enqueue({action:'save',focus:busyFocus})}
              },true);
              const focusTarget=${JSON.stringify(focus || null).replace(/</g, '\\u003c')};if(${saving}){setBusy(true);busyFocus=focusTarget}else if(focusTarget)requestAnimationFrame(()=>restoreFocus(focusTarget));
              enqueue({action:'ready'});
            `;
            const path = typePath(document.uri);
            const summary = typeHeaderSummary(!errors.length ? model : undefined, path, readonly, document.isDirty ? undefined : cachedRawBytes);
            const statusText = statusMessage ? `${statusMessage}${document.isDirty ? ' · Unsaved changes' : ''}` : document.isDirty ? 'Unsaved changes' : '';
            const actions = `<div class="type-actions"><span class="type-status" data-state="${document.isDirty ? 'dirty' : 'clean'}" role="status">${escape(statusText)}</span><button type="button" data-open-jsonc aria-label="Open JSONC text editor beside" title="Open raw JSONC text editor beside">${callIcon('edit')}<span>JSONC</span></button></div>`;
            panel.webview.html = page(path.split('/').pop() || 'Data type', 'Data type editor', summary.subtitle, `<p id="type-validation" class="type-validation" role="alert" hidden></p>` + body + `<datalist id="type-options">${typeOptions.map(value => `<option value="${escape(value)}"></option>`).join('')}</datalist>`, script, { kind: 'type-editor', md5: document.uri.authority, path }, actions, { subtitleHtml: summary.subtitleHtml });
        };
        const diagnostics = (): string[] => vscode.languages.getDiagnostics(document.uri).filter(item => item.source === 'Ghidra type' && item.severity === vscode.DiagnosticSeverity.Error).map(item => item.message);
        const listener = vscode.workspace.onDidChangeTextDocument(event => { if (event.document.uri.toString() === document.uri.toString() && !applying) { render(panel.active ? editorFocus : undefined); } });
        const diagnosticListener = vscode.languages.onDidChangeDiagnostics(event => {
            if (event.uris.some(uri => uri.toString() === document.uri.toString())) { void panel.webview.postMessage({ action: 'type-diagnostics', errors: diagnostics() }); }
        });
        panel.onDidDispose(() => { listener.dispose(); diagnosticListener.dispose(); });
        const post = async (message: unknown): Promise<void> => { try { await panel.webview.postMessage(message); } catch { /* The native editor may have replaced this view. */ } };
        let pending: Promise<void> = Promise.resolve();
        panel.webview.onDidReceiveMessage(message => {
          pending = pending.then(async () => {
            try {
                if (message.action === 'save-after-update') {
                    if (readonly || completedUpdateGeneration !== message.generation || generation !== message.generation + 1 || panelVersion !== document.version) { return; }
                    completedUpdateGeneration = undefined;
                    const focus = editorFocus;
                    render(focus, true);
                    if (!await document.save()) { throw new Error('Could not save the data type. Check the document diagnostics.'); }
                    render(panel.active ? focus : undefined);
                    return;
                }
                if (message.generation !== generation) { return; }
                if (message.action === 'open-jsonc') {
                    await vscode.commands.executeCommand('vscode.openWith', document.uri, 'default', vscode.ViewColumn.Beside);
                    return;
                }
                if (message.action === 'ready') {
                    await post({ action: 'type-options', values: typeOptions });
                    await post({ action: 'type-diagnostics', errors: diagnostics() });
                    if (cachedRawBytes !== undefined && !document.isDirty) {
                        await post({ action: 'type-meta', bytesLabel: `${cachedRawBytes} ${cachedRawBytes === 1 ? 'byte' : 'bytes'}` });
                    }
                    return;
                }
                if (message.action === 'focus') { editorFocus = message.focus || undefined; return; }
                if (message.action === 'sort') {
                    if (!['fields', 'values', 'parameters'].includes(message.key)) { return; }
                    if (message.direction === 'none') { delete sorts[message.key]; }
                    else if (['ascending', 'descending'].includes(message.direction) && ['offset', 'name', 'type', 'length', 'value'].includes(message.field)) { sorts[message.key] = { field: message.field, direction: message.direction }; }
                    return;
                }
                if (panelVersion !== document.version) { render(); throw new Error('The definition changed in another view. Review the current values.'); }
                if (message.action === 'save') { editorFocus = message.focus || undefined; if (!await document.save()) { throw new Error('Could not save the data type. Check the document diagnostics.'); } render(panel.active ? editorFocus : undefined); return; }
                if ((message.action === 'add' || message.action === 'remove' || message.action === 'move') && !readonly) {
                    const request = message;
                    if (!['fields', 'values', 'parameters'].includes(request.key)) { return; }
                    const text = document.getText(), model = parse(text), path: (string | number)[] = request.key === 'parameters' ? ['signature', 'parameters'] : [request.key];
                    const items: any[] = request.key === 'parameters' ? model.signature?.parameters : model[request.key];
                    if (!Array.isArray(items)) { return; }
                    if (message.action === 'remove' && (!Number.isInteger(request.index) || request.index < 0 || request.index >= items.length)) { return; }
                    let next: string, offset: number | string | undefined, focus: EditorFocus | undefined, statusMessage: string | undefined;
                    const normalizedKind = kindOf(object(model));
                    if (message.action === 'move') {
                        if (!['fields', 'parameters'].includes(request.key)) { return; }
                        if (!Number.isInteger(request.from) || !Number.isInteger(request.to) || request.from < 0 || request.to < 0 || request.from >= items.length || request.to >= items.length || typeof request.before !== 'boolean') { return; }
                        const hasVisualOrder = Array.isArray(request.order)
                            && request.order.length === items.length
                            && request.order.every((idx: unknown) => typeof idx === 'number' && Number.isInteger(idx) && idx >= 0 && idx < items.length)
                            && new Set(request.order).size === items.length;
                        const order: number[] = hasVisualOrder ? [...request.order] : items.map((_, index) => index);
                        if (!hasVisualOrder && request.key === 'fields' && normalizedKind === 'struct') { order.sort((a, b) => Number(items[a].offset) - Number(items[b].offset)); }
                        const source = order.indexOf(request.from), target = order.indexOf(request.to);
                        let destination = target + (request.before ? 0 : 1);
                        if (source < destination) { destination--; }
                        const singular = request.key === 'fields' ? 'field' : 'parameter';
                        if (destination === source) {
                            const memberName = String(object(items[request.from]).name ?? '').trim();
                            const label = `${singular[0].toUpperCase()}${singular.slice(1)}${memberName ? ` ${memberName}` : ''}`;
                            editorFocus = { move: { key: request.key, index: request.from } };
                            completedUpdateGeneration = request.generation;
                            render(editorFocus, false, `${label} is at row ${source + 1} of ${items.length}`);
                            return;
                        }
                        const raw = await this.call<Data>('ghidra.type', { md5: document.uri.authority, path: typePath(document.uri) });
                        if (request.generation !== generation || panelVersion !== document.version) { return; }
                        const moved = reorderTypeMembers(text, raw, request.key, request.from, order[destination], order);
                        const original = typeModel(raw), draft = parseType(moved.text, original);
                        typeMutations(original, draft, raw);
                        delete sorts[request.key];
                        next = moved.text; focus = { move: { key: request.key, index: moved.index } };
                        const movedItems = request.key === 'parameters' ? rows(draft.signature?.parameters) : rows(draft.fields);
                        const memberName = String(object(movedItems[moved.index] ?? items[request.from]).name ?? '').trim();
                        statusMessage = `Moved ${singular}${memberName ? ` ${memberName}` : ''} to row ${moved.index + 1} of ${movedItems.length || items.length}`;
                    } else {
                        if (message.action === 'add' && (request.index !== items.length || typeof request.name !== 'string')) { render(); throw new Error('The member list changed. Try adding it again.'); }
                        if (message.action === 'add' && request.key === 'fields' && normalizedKind === 'struct') {
                            const raw = await this.call<Data>('ghidra.type', { md5: document.uri.authority, path: typePath(document.uri) }).catch(() => undefined);
                            if (request.generation !== generation || panelVersion !== document.version) { return; }
                            const original = raw ? typeModel(raw).fields || [] : [], source = rows(raw?.fields).filter(field => field.is_undefined !== true);
                            let unknownLength = false;
                            const end = items.reduce((end, field) => {
                                const previous = original.find(item => item.id === field.id);
                                const rawLength = previous && field.type === previous.type ? Number(source[Number(previous.id)]?.length) : 0;
                                const explicit = Number(field.length);
                                const length = Number.isSafeInteger(explicit) && explicit > 0 && (previous ? field.type === previous.type || field.length !== previous.length : field.id === undefined) ? explicit
                                    : rawLength || (field.id === undefined && field.type === 'undefined1' ? 1 : 0);
                                if (!length) { unknownLength = true; }
                                return Math.max(end, Number(field.offset || 0) + length);
                            }, 0);
                            offset = unknownLength ? '' : end;
                        }
                        const item = request.key === 'values' ? { name: request.name, value: 0 } : request.key === 'parameters' ? { name: request.name, type: 'int' } : { ...(normalizedKind === 'struct' ? { offset } : {}), name: request.name, type: 'undefined1' };
                        const edits = modify(text, [...path, message.action === 'remove' ? request.index : -1], message.action === 'remove' ? undefined : item, { isArrayInsertion: message.action === 'add', formattingOptions: { insertSpaces: true, tabSize: 2, eol: '\n' } });
                        next = applyEdits(text, edits);
                        if (message.action === 'remove') { focus = { path: [...path, Math.max(0, Math.min(request.index, items.length - 2)), 'name'] }; }
                    }
                    if (next !== text) {
                        const edit = new vscode.WorkspaceEdit(); edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(text.length)), next);
                        applying = true; try { if (!await vscode.workspace.applyEdit(edit)) { throw new Error('Could not update the data type draft.'); } } finally { applying = false; }
                    }
                    panelVersion = document.version;
                    const meta = typeHeaderSummary(parse(next), typePath(document.uri), readonly);
                    if (message.action === 'add') { await post({ action: 'draft-version', version: document.version, dirty: document.isDirty, added: { key: request.key, index: request.index, offset }, meta: { bytesLabel: meta.bytesLabel || '', countLabel: meta.countLabel || '' } }); }
                    else { editorFocus = focus; completedUpdateGeneration = request.generation; render(focus, false, statusMessage); }
                    return;
                }
                if (message.action !== 'change' || readonly || !Array.isArray(message.path)) { return; }
                if (message.path[0] === 'path' || message.path[0] === 'kind') { return; }
                const text = document.getText();
                const value = message.path[message.path.length - 1] === 'length' && message.value === '' ? undefined : message.value;
                const edits = modify(text, message.path, value, { formattingOptions: { insertSpaces: true, tabSize: 2, eol: '\n' } });
                const next = applyEdits(text, edits);
                const edit = new vscode.WorkspaceEdit();
                edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(text.length)), next);
                applying = true;
                try { if (!await vscode.workspace.applyEdit(edit)) { throw new Error('Could not update the data type draft.'); } }
                finally { applying = false; }
                panelVersion = document.version;
                const meta = typeHeaderSummary(parse(next), typePath(document.uri), readonly);
                await post({ action: 'draft-version', version: document.version, dirty: document.isDirty, meta: { bytesLabel: meta.bytesLabel || '', countLabel: meta.countLabel || '' } });
            } catch (error) { await post({ action: 'save-failed' }); void vscode.window.showErrorMessage(String(error)); }
          });
        });
        render();
        if (!readonly) {
            void this.call<Data>('ghidra.type', { md5: document.uri.authority, path: typePath(document.uri) }).then(raw => {
                const rawLen = typeof raw.length === 'number' && raw.length >= 0 ? raw.length
                    : typeof raw.size === 'number' && raw.size >= 0 ? raw.size : undefined;
                if (rawLen !== undefined) {
                    cachedRawBytes = rawLen;
                    if (!document.isDirty) {
                        void post({ action: 'type-meta', bytesLabel: `${rawLen} ${rawLen === 1 ? 'byte' : 'bytes'}` });
                    }
                }
            }).catch(() => {});
        }
        if (!readonly) { void this.call<{ items: { name?: string; path?: string }[] }>('ghidra.types', { md5: document.uri.authority }).then(result => {
            typeOptions = [...new Set([...typeOptions, ...result.items.flatMap(item => [item.path, item.name].filter((value): value is string => typeof value === 'string' && !!value))])].sort();
            return panel.webview.postMessage({ action: 'type-options', values: typeOptions });
        }).catch(() => {}); }
    }
    /** Unregister the graphical data type custom editor provider. */
    dispose(): void { this.registration.dispose(); }
}
