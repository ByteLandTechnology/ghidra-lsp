// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

import { Call } from './memory';
import { plainAddress } from './listing-format';
import { CommentKind, commentKinds } from './inline-comments';
import { Data, object } from './web';

/** Human-readable label and description for one Ghidra comment kind. */
export interface CommentFieldSpec {
    /** Canonical Ghidra comment kind key. */
    kind: CommentKind;
    /** Accessible form label displayed above the textarea. */
    label: string;
    /** Helper summary linked via `aria-describedby`. */
    description: string;
}

/** Ordered metadata for all five Ghidra comment kinds. */
export const commentFieldSpecs: readonly CommentFieldSpec[] = [
    { kind: 'plate', label: 'Plate comment', description: 'Banner comment displayed above the function or data item.' },
    { kind: 'pre', label: 'Pre comment', description: 'Comment displayed on the line before the instruction or data item.' },
    { kind: 'eol', label: 'End-of-line comment', description: 'Comment displayed beside the instruction or data item.' },
    { kind: 'post', label: 'Post comment', description: 'Comment displayed on the line after the instruction or data item.' },
    { kind: 'repeatable', label: 'Repeatable comment', description: 'Comment echoed at cross-reference sites targeting this address.' },
];

/** Server payload returned by `ghidra.commentsAt`. */
interface CommentsAtPayload {
    /** Session MD5 hash. */
    md5: string;
    /** Canonical CodeUnit address. */
    address: string;
    /** Existing comment strings keyed by kind. */
    comments: Partial<Record<CommentKind, string>>;
}

/** Server payload returned by `ghidra.saveComment`. */
interface SaveCommentPayload {
    /** Session MD5 hash. */
    md5: string;
    /** Canonical CodeUnit address. */
    address: string;
    /** Updated comment kind. */
    kind: CommentKind;
    /** Persisted comment text read back from Ghidra. */
    text?: string;
}

/** Mutable baseline, draft, and uncertainty state for an open 5-kind comment form. */
export interface CommentFormSession {
    /** Session MD5 hash. */
    md5: string;
    /** Canonical CodeUnit address. */
    address: string;
    /** Optional containing function entry address. */
    entry?: string;
    /** Comment kind receiving initial keyboard focus. */
    focusKind: CommentKind;
    /** Last confirmed backend text per comment kind used as `expected`. */
    saved: Record<CommentKind, string>;
    /** Current editor draft text per comment kind. */
    drafts: Record<CommentKind, string>;
    /** True when a post-send write failed or timed out with unknown outcome. */
    uncertain: boolean;
}

/** Return true when `error` indicates a write may have reached Ghidra with unknown persistence. */
export function isUncertainCommentWriteError(error: unknown): boolean {
    return /may have reached|timed out.*write|Modification reached|persistence failed|saving.*failed|saved.*failed|regeneration failed|editor rejected|outcome.*unknown|not persisted/i.test(String(error));
}

/** Choose the default comment kind to focus for `address` and optional function `entry`. */
export function defaultCommentFocusKind(address: string, entry?: string, requested?: string): CommentKind {
    if (requested && commentKinds.includes(requested as CommentKind)) {
        return requested as CommentKind;
    }
    if (entry && plainAddress(address) === plainAddress(entry)) {
        return 'plate';
    }
    return 'pre';
}

/** Load all five comment kinds at `address` via `ghidra.commentsAt` and build an initial session. */
export async function loadCommentFormSession(
    call: Call,
    md5: string,
    address: string,
    entry?: string,
    requestedKind?: string,
): Promise<CommentFormSession> {
    const response = await call<CommentsAtPayload>('ghidra.commentsAt', { md5, address });
    const raw = object(response.comments);
    const resolvedAddress = typeof response.address === 'string' && response.address ? response.address : address;
    const saved = {} as Record<CommentKind, string>;
    const drafts = {} as Record<CommentKind, string>;
    for (const kind of commentKinds) {
        const text = typeof raw[kind] === 'string' ? (raw[kind] as string) : '';
        saved[kind] = text;
        drafts[kind] = text;
    }
    return {
        md5,
        address: resolvedAddress,
        entry,
        focusKind: defaultCommentFocusKind(resolvedAddress, entry, requestedKind),
        saved,
        drafts,
        uncertain: false,
    };
}

/** Update `session.drafts` from webview values and return true when any kind differs from `session.saved`. */
export function isCommentSessionDirty(session: CommentFormSession, values?: Data): boolean {
    if (values) {
        for (const kind of commentKinds) {
            if (kind in values) {
                session.drafts[kind] = String(values[kind] ?? '');
            }
        }
    }
    return commentKinds.some(kind => session.drafts[kind] !== session.saved[kind]);
}

/** Persist modified comment kinds via `ghidra.saveComment` with per-kind `expected` and `uncertain` guards. */
export async function saveCommentFormSession(
    call: Call,
    session: CommentFormSession,
    values: Data,
    refreshBrowser: (md5: string) => Promise<void>,
): Promise<{ savedValues: Data; message: string }> {
    if (session.uncertain) {
        throw new Error('The previous save has an uncertain outcome. Close and reopen the comments before saving again.');
    }
    for (const kind of commentKinds) {
        session.drafts[kind] = String(values[kind] ?? '');
    }
    const changed = commentKinds.filter(kind => session.drafts[kind] !== session.saved[kind]);
    if (!changed.length) {
        return { savedValues: { ...session.saved }, message: 'No comment changes to save.' };
    }
    for (const kind of changed) {
        try {
            const saved = await call<SaveCommentPayload>('ghidra.saveComment', {
                md5: session.md5,
                address: session.address,
                kind,
                text: session.drafts[kind],
                expected: session.saved[kind],
            });
            const persisted = typeof saved.text === 'string'
                ? saved.text
                : (session.drafts[kind].trim() ? session.drafts[kind] : '');
            session.saved[kind] = persisted;
            session.drafts[kind] = persisted;
        } catch (error) {
            if (isUncertainCommentWriteError(error)) {
                session.uncertain = true;
            }
            throw error;
        }
    }
    await refreshBrowser(session.md5);
    return { savedValues: { ...session.saved }, message: 'Saved comments to the Ghidra project.' };
}
