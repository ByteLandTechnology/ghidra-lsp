// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

import { applyEdits, createScanner, findNodeAtLocation, getNodeValue, modify, Node, ParseError, parseTree, printParseErrorCode, SyntaxKind } from 'jsonc-parser';
import { Data, FieldError, FieldPath, object, reference, rows, typeReference } from './web';

/** Single backend mutation operation derived from a data type edit. */
export interface TypeMutation { method: string; arguments: Data; }
/** Editable JSONC model representation of a Ghidra struct, union, enum, or function definition. */
export interface TypeModel { path: string; kind: string; fields?: Data[]; values?: Data[]; signature?: Data; }
/** JSON path segment sequence locating a field inside a type document. */
type JsonPath = FieldPath;
/** Validation or schema error carrying the offending JSON path or character span. */
export class TypeEditError extends FieldError {
    /** Create a type edit error attached to `path` and an optional source span. */
    constructor(message: string, path: JsonPath = [], readonly offset?: number, readonly length?: number) { super(message, path); }
}
/** Deeply compare two JSON values for structural equality. */
export const sameTypeData = (a: unknown, b: unknown): boolean => {
    if (Array.isArray(a) || Array.isArray(b)) { return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => sameTypeData(item, b[i])); }
    if (a && b && typeof a === 'object' && typeof b === 'object') {
        const left = object(a), right = object(b);
        return Object.keys(left).length === Object.keys(right).length && Object.keys(left).every(key => key in right && sameTypeData(left[key], right[key]));
    }
    return a === b;
};
/** Normalize backend type kind strings to `struct`, `union`, `enum`, or `function`. */
const kindOf = (data: Data): string => ({ structure: 'struct', function_definition: 'function' }[String(data.kind)] || String(data.kind));
/** Return the human-readable reason why `data` is read-only, or undefined when editable. */
export function readonlyTypeReason(data: Data): string | undefined {
    const kind = kindOf(data);
    if (!['struct', 'union', 'enum', 'function'].includes(kind)) { return 'This kind of data type is read-only in the Ghidra bridge.'; }
    if (kind === 'function' && !Object.keys(object(data.signature)).length) { return 'The backend does not expose a structured function signature.'; }
    if (kind === 'enum' && rows(data.values).some(value => !Number.isSafeInteger(value.value))) { return 'This enum contains integers outside the lossless JSON number range. Edit it in Ghidra.'; }
    const fields = rows(data.fields).filter(field => field.is_undefined !== true);
    if (fields.some(field => Number(field.length) <= 0 || /:\d+$/.test(String(object(field.data_type).name)))
        || (kind === 'struct' && new Set(fields.map(field => field.offset)).size !== fields.length)) {
        return 'This layout contains zero-length or overlapping/bit fields that the bridge cannot safely edit.';
    }
    if (fields.filter(field => !field.name).length > (kind === 'union' ? 0 : 1)) {
        return 'Name the anonymous members in Ghidra before editing this layout.';
    }
    return undefined;
}

/** Only expose properties that the bridge can write. IDs retain members across renames. */
export function typeModel(data: Data): TypeModel {
    const kind = kindOf(data);
    const result: TypeModel = { path: String(data.path), kind };
    if (kind === 'struct' || kind === 'union') {
        result.fields = rows(data.fields).filter(field => field.is_undefined !== true).map((field, index) => ({
            id: String(index), ...(kind === 'struct' ? { offset: field.offset } : {}), name: field.name || '',
            type: reference(field.data_type), ...(object(field.data_type).kind === 'array' ? {} : { length: field.length }),
        }));
    } else if (kind === 'enum') {
        result.values = rows(data.values).map((value, index) => ({ id: String(index), name: value.name, value: value.value }));
    } else if (kind === 'function') {
        const signature = object(data.signature);
        result.signature = {
            return_type: reference(signature.return_type), calling_convention: signature.calling_convention || 'default',
            has_var_args: signature.has_var_args === true, has_no_return: signature.has_no_return === true,
            parameters: rows(signature.parameters).map(param => ({ name: param.name || '', type: reference(param.data_type) })),
        };
    }
    return result;
}

/** Throw a {@link TypeEditError} at `path`. */
function fail(message: string, path: JsonPath): never { throw new TypeEditError(message, path); }
/** Validate that `value` is a plain object containing only allowed `keys`. */
function record(value: unknown, path: JsonPath, keys: string[]): Data {
    if (!value || typeof value !== 'object' || Array.isArray(value)) { fail('Expected an object.', path); }
    const data = object(value);
    for (const key of Object.keys(data)) { if (!keys.includes(key)) { fail(`Unsupported property "${key}".`, [...path, key]); } }
    return data;
}
/** Validate that `value` is a string, optionally rejecting blank text. */
function string(value: unknown, path: JsonPath, empty = false): string {
    if (typeof value !== 'string' || (!empty && !value.trim())) { fail('Expected a non-empty string.', path); }
    return value as string;
}
/** Validate that `value` is a safe integer within `[min, max]`. */
function number(value: unknown, path: JsonPath, min = 0, max = 2147483647): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) { fail(`Expected an integer from ${min} to ${max}.`, path); }
    return value as number;
}
/** Validate that `value` is an array of member objects. */
function array(value: unknown, path: JsonPath): Data[] {
    if (!Array.isArray(value)) { fail('Expected an array. Use [] to remove all members.', path); }
    return value as Data[];
}
/** Validate and parse a string data type reference at `path`. */
function type(value: unknown, path: JsonPath): Data {
    const name = string(value, path);
    try { return typeReference(name, path); } catch (error) { fail(error instanceof Error ? error.message : String(error), path); }
}
/** Reject duplicate object keys anywhere in a parsed JSONC syntax tree. */
function uniqueKeys(node: Node): void {
    if (node.type === 'object') {
        const keys = new Set<string>();
        for (const prop of node.children || []) {
            const key = prop.children![0];
            if (keys.has(key.value)) { throw new TypeEditError(`Duplicate property "${key.value}".`, [], key.offset, key.length); }
            keys.add(key.value);
        }
    }
    for (const child of node.children || []) { uniqueKeys(child); }
}

/** Parse and validate JSONC document text against `original` type metadata. */
export function parseType(text: string, original: TypeModel): TypeModel {
    const errors: ParseError[] = [];
    const tree = parseTree(text, errors, { allowTrailingComma: true, disallowComments: false });
    if (errors.length) { const error = errors[0]; throw new TypeEditError(printParseErrorCode(error.error), [], error.offset, error.length); }
    if (!tree) { throw new TypeEditError('Enter a data type definition.'); }
    uniqueKeys(tree);
    const key = original.kind === 'enum' ? 'values' : original.kind === 'function' ? 'signature' : 'fields';
    const data = record(getNodeValue(tree), [], ['path', 'kind', key]);
    for (const key of ['path', 'kind'] as const) { if (data[key] !== original[key]) { fail(`${key} identifies this data type and cannot be changed.`, [key]); } }
    if (key === 'signature') {
        const signature = record(data.signature, ['signature'], ['return_type', 'calling_convention', 'has_var_args', 'has_no_return', 'parameters']);
        type(signature.return_type, ['signature', 'return_type']);
        if (string(signature.calling_convention, ['signature', 'calling_convention']).toLowerCase() === 'unknown') { fail('Choose a known calling convention, such as default.', ['signature', 'calling_convention']); }
        for (const flag of ['has_var_args', 'has_no_return']) { if (typeof signature[flag] !== 'boolean') { fail('Expected true or false.', ['signature', flag]); } }
        array(signature.parameters, ['signature', 'parameters']).forEach((param, i) => {
            const p = ['signature', 'parameters', i]; record(param, p, ['name', 'type']);
            string(param.name, [...p, 'name'], true); type(param.type, [...p, 'type']);
        });
    } else {
        const members = array(data[key], [key]);
        const originals = new Map((original[key] || []).map(member => [member.id, member]));
        const ids = new Set<string>(), names = new Set<string>(), offsets = new Set<number>();
        members.forEach((member, i) => {
            const p: JsonPath = [key, i];
            record(member, p, key === 'values' ? ['id', 'name', 'value'] : ['id', 'name', 'type', 'length', ...(original.kind === 'struct' ? ['offset'] : [])]);
            if (member.id !== undefined) {
                const id = string(member.id, [...p, 'id']);
                if (!originals.has(id) || ids.has(id)) { fail('Keep a unique existing id, or omit id for a new member.', [...p, 'id']); }
                ids.add(id);
            }
            const name = string(member.name, [...p, 'name'], key === 'fields' && original.kind === 'struct');
            if (name && names.has(name)) { fail('Member names must be unique.', [...p, 'name']); }
            names.add(name);
            if (key === 'values') { number(member.value, [...p, 'value'], Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER); }
            else {
                type(member.type, [...p, 'type']);
                if (member.length !== undefined) { number(member.length, [...p, 'length'], 1); }
                if (original.kind === 'struct') {
                    const offset = number(member.offset, [...p, 'offset']);
                    if (offsets.has(offset)) { fail('Structure fields must have distinct offsets.', [...p, 'offset']); }
                    offsets.add(offset);
                }
            }
        });
    }
    return data as unknown as TypeModel;
}

/** Move a member without discarding JSONC notes; structure offsets follow the new layout. */
export function reorderTypeMembers(text: string, raw: Data, key: string, from: number, to: number): { text: string; index: number } {
    const original = typeModel(raw), draft = parseType(text, original);
    const path: JsonPath = key === 'parameters' ? ['signature', key] : [key];
    const members = key === 'parameters' ? rows(draft.signature?.parameters) : key === 'fields' ? draft.fields : undefined;
    if (!members || !Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= members.length || to >= members.length) {
        throw new Error('The member list changed. Try moving it again.');
    }
    let order = members.map((_, index) => index);
    if (draft.kind === 'struct' && key === 'fields') {
        const source = rows(raw.fields).filter(field => field.is_undefined !== true);
        const originals = original.fields || [];
        const lengths = members.map((field, index) => {
            const previous = originals.find(item => item.id === field.id);
            const oldField = previous && source[Number(previous.id)];
            if (Number.isSafeInteger(field.length) && Number(field.length) > 0 && (!previous || field.type === previous.type || field.length !== previous.length)) { return Number(field.length); }
            if (previous && field.type === previous.type && Number(oldField?.length) > 0) { return Number(oldField!.length); }
            if (!previous && field.type === 'undefined1') { return 1; }
            throw new TypeEditError('Save changes to field types before moving fields.', ['fields', index, 'type']);
        });
        order.sort((a, b) => Number(members[a].offset) - Number(members[b].offset));
        const start = order.indexOf(from), end = order.indexOf(to);
        const gaps = order.map((index, i) => Number(members[index].offset) - (i ? Number(members[order[i - 1]].offset) + lengths[order[i - 1]] : 0));
        if (gaps.some(gap => !Number.isSafeInteger(gap) || gap < 0)) { throw new TypeEditError('Fix overlapping fields before moving them.', ['fields']); }
        order.splice(end, 0, order.splice(start, 1)[0]);
        let offset = 0;
        for (const [position, index] of order.entries()) {
            offset += gaps[position];
            if (offset !== members[index].offset) {
                text = applyEdits(text, modify(text, [...path, index, 'offset'], offset, { formattingOptions: { insertSpaces: true, tabSize: 2, eol: '\n' } }));
            }
            offset += lengths[index];
        }
    } else {
        order.splice(to, 0, order.splice(from, 1)[0]);
    }
    const tree = parseTree(text), array = tree && findNodeAtLocation(tree, path), nodes = array?.children || [];
    if (nodes.length !== members.length) { throw new Error('The member list changed. Try moving it again.'); }
    for (let i = 1; i < nodes.length; i++) {
        const gap = text.slice(nodes[i - 1].offset + nodes[i - 1].length, nodes[i].offset), scanner = createScanner(gap);
        let token: SyntaxKind;
        while ((token = scanner.scan()) !== SyntaxKind.EOF) {
            if (token === SyntaxKind.LineCommentTrivia || token === SyntaxKind.BlockCommentTrivia) {
                throw new TypeEditError('Move comments between members into a member before reordering.', path);
            }
        }
    }
    const fragments = nodes.map(node => text.slice(node.offset, node.offset + node.length));
    for (let i = nodes.length - 1; i >= 0; i--) { const node = nodes[i]; text = text.slice(0, node.offset) + fragments[order[i]] + text.slice(node.offset + node.length); }
    return { text, index: order.indexOf(from) };
}

/** Convert the edited snapshot into the same transactional operations as the bridge forms. */
export function typeMutations(original: TypeModel, draft: TypeModel, raw: Data): TypeMutation[] {
    const { path, kind } = original;
    const op = (patch: Data): TypeMutation => ({ method: 'data_type.patch', arguments: { selector: { path }, patch: { kind, ...patch } } });
    if (kind === 'function') {
        if (sameTypeData(original.signature, draft.signature)) { return []; }
        const signature = draft.signature!;
        return [{ method: 'data_type.upsert', arguments: { resource: {
            kind, name: raw.name, category_path: raw.category_path,
            signature: { ...signature, return_type: typeReference(signature.return_type),
                parameters: rows(signature.parameters).map(param => ({ name: param.name, data_type: typeReference(param.type) })) },
        } } }];
    }
    const enumType = kind === 'enum', suffix = enumType ? 'values' : 'fields';
    const before = original[suffix] || [], after = draft[suffix] || [];
    const kept = new Set(after.filter(member => member.id !== undefined).map(member => member.id));
    const removals: Data[] = [], additions: Data[] = [], updates: Data[] = [], renames: Data[] = [];
    const selector = (member: Data): Data => kind === 'struct' ? { offset: member.offset } : { name: member.name };
    if (kind === 'union') {
        const survivingOrder = before.filter(member => kept.has(member.id)).map(member => member.id);
        const requestedOrder = after.filter(member => member.id !== undefined).map(member => member.id);
        const firstNew = after.findIndex(member => member.id === undefined);
        const inserted = firstNew >= 0 && after.slice(firstNew + 1).some(member => member.id !== undefined);
        if (!sameTypeData(survivingOrder, requestedOrder) || inserted) {
            if (rows(raw.fields).some(field => field.comment)) { fail('Moving these fields would lose Ghidra comments. Move them in Ghidra instead.', ['fields']); }
            return [op({ remove_fields: before.map(selector), add_fields: after.map(member => {
                const dataType = typeReference(member.type), definition: Data = { name: member.name, data_type: dataType };
                if (member.length !== undefined && dataType.kind !== 'array') { definition.length = member.length; }
                return definition;
            }) })];
        }
    }
    before.forEach(member => { if (!kept.has(member.id)) { removals.push(selector(member)); } });
    for (const [index, member] of after.entries()) {
        let previous = member.id === undefined ? undefined : before.find(item => item.id === member.id);
        if (previous && kind === 'struct' && member.offset !== previous.offset) {
            const source = rows(raw.fields).filter(field => field.is_undefined !== true)[Number(previous.id)];
            if (source?.comment) { fail('Moving this field would lose its Ghidra comment. Move it in Ghidra instead.', ['fields', index, 'offset']); }
            removals.push(selector(previous)); previous = undefined;
        }
        if (enumType) {
            if (!previous) { additions.push({ name: member.name, value: member.value }); }
            else {
                if (member.name !== previous.name) { renames.push({ name: previous.name, new_name: member.name }); }
                if (member.value !== previous.value) { updates.push({ name: member.name, value: member.value }); }
            }
        } else {
            const dataType = typeReference(member.type), definition: Data = { data_type: dataType };
            // Arrays carry their length in the type; a changed type otherwise uses its natural size.
            if (member.length !== undefined && dataType.kind !== 'array'
                && (!previous || member.length !== previous.length || member.type === previous.type)) { definition.length = member.length; }
            if (!previous) { additions.push({ name: member.name, ...definition, ...(kind === 'struct' ? { offset: member.offset } : {}) }); }
            else {
                if (member.name !== previous.name) { renames.push({ ...selector(previous), new_name: member.name }); }
                if (member.type !== previous.type || member.length !== previous.length) {
                    updates.push({ ...(kind === 'struct' ? selector(previous) : { name: member.name }), ...definition });
                }
            }
        }
    }
    if (kind === 'struct') {
        const changes = new Map<number, Data>();
        for (const [prefix, entries] of [['remove', removals], ['rename', renames], ['update', updates]] as const) {
            for (const entry of entries) {
                const offset = Number(entry.offset), change = changes.get(offset) || {};
                change[`${prefix}_fields`] = [entry]; changes.set(offset, change);
            }
        }
        const operations = [...changes].sort(([a], [b]) => b - a).map(([, patch]) => op(patch));
        if (additions.length) { operations.push(op({ add_fields: additions.sort((a, b) => Number(a.offset) - Number(b.offset)) })); }
        return operations;
    }
    const patch: Data = {};
    for (const [prefix, changes] of [['remove', removals], ['rename', renames], ['update', updates], ['add', additions]] as const) {
        if (changes.length) { patch[`${prefix}_${suffix}`] = changes; }
    }
    return Object.keys(patch).length ? [op(patch)] : [];
}
