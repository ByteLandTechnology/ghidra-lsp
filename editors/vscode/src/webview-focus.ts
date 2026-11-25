// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

/**
 * Shared HTML, host messaging, and client runtime helpers for webview focus
 * descriptors, polite busy status regions, assertive error banners, and inline
 * Go To address validation.
 */

/** Escape HTML special characters for safe webview interpolation. */
export const escapeHtml = (value: unknown): string =>
    String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));

/** Build a collision-free deterministic HTML ID from `prefix` and key segments. */
export function controlId(prefix: string, ...parts: unknown[]): string {
    const encoded = parts
        .filter(part => part !== undefined && part !== null && String(part) !== '')
        .map(part => encodeURIComponent(String(part)).replace(/'/g, '%27').replace(/-/g, '%2D'));
    return encoded.length ? `${prefix}-${encoded.join('-')}` : prefix;
}

/** Configuration for mounting shared webview live status and alert regions. */
export interface LiveRegionOptions {
    /** Initial error message rendered inside `#error`. */
    error?: string;
    /** Render initial `"Loading"` text inside `#busy-status`. */
    busy?: boolean;
    /** Render `#goto-error` for inline `#goto` address validation. */
    includeGotoError?: boolean;
}

/** Render assertive `#error`, polite `#busy-status`, and optional `#goto-error` regions. */
export function renderLiveRegions(options: LiveRegionOptions = {}): string {
    const error = `<p id="error" class="error" role="alert">${escapeHtml(options.error ?? '')}</p>`;
    const busy = `<p id="busy-status" class="sr-status" role="status" aria-live="polite" aria-atomic="true">${options.busy ? 'Loading' : ''}</p>`;
    const gotoError = options.includeGotoError
        ? '<p id="goto-error" class="goto-error" role="alert"></p>'
        : '';
    return `${error}${busy}${gotoError}`;
}

/** Minimal structural interface for a VS Code webview panel. */
export interface LiveWebviewPanel {
    readonly visible: boolean;
    readonly webview: {
        postMessage(message: unknown): Thenable<boolean>;
    };
}

/** Post a polite loading announcement to a mounted webview panel. */
export function postBusy(panel: LiveWebviewPanel, label = 'Loading'): void {
    void Promise.resolve(panel.webview.postMessage({ action: 'busy', label })).catch(() => {});
}

/** Route an error to `#error` when the panel is visible, or invoke `fallback` when hidden. */
export async function reportWebviewError(
    panel: LiveWebviewPanel,
    message: string,
    fallback?: (message: string) => void,
): Promise<void> {
    if (panel.visible) {
        try {
            const posted = await panel.webview.postMessage({ action: 'error', error: message });
            if (posted || !fallback) { return; }
        } catch {
            // Fall back when the webview is already disposed.
        }
    }
    fallback?.(message);
}

/** Post an inline `#goto` address validation error to keep the mounted view intact. */
export function postGotoError(panel: LiveWebviewPanel, message: string): void {
    void Promise.resolve(panel.webview.postMessage({ action: 'gotoError', error: message })).catch(() => {});
}

/**
 * Shared client-side runtime for deterministic fallback IDs, live status/alert
 * message updates, inline `#goto` validation, and post-render focus restoration.
 */
export const webviewFocusScript = String.raw`
window.__ghidraRestoringFocus = false;
const assignControlIds = (root = document) => {
  const used = Object.create(null);
  for (const existing of root.querySelectorAll('[id]')) {
    if (existing.id) used[existing.id] = 1;
  }
  for (const control of root.querySelectorAll('button,summary,input,select,textarea,[tabindex]:not([tabindex="-1"])')) {
    if (control.id) continue;
    const base = ('f-' + (control.dataset.action || control.tagName.toLowerCase()) + '-' + (control.dataset.value || control.dataset.address || control.dataset.entry || control.getAttribute('aria-label') || control.textContent.trim() || '')).slice(0, 64).replace(/[^\w-]/g, '_');
    let candidate = base;
    let count = 1;
    while (used[candidate]) {
      count += 1;
      candidate = base + '-' + count;
    }
    used[candidate] = 1;
    control.id = candidate;
  }
};
const setBusyState = (busy, label) => {
  const active = !!busy;
  document.body.classList.toggle('is-busy', active);
  if (active) document.body.setAttribute('aria-busy', 'true');
  else document.body.removeAttribute('aria-busy');
  const statusEl = document.getElementById('busy-status');
  if (statusEl) statusEl.textContent = active ? (label || 'Loading') : '';
  if (active) {
    const errEl = document.getElementById('error');
    if (errEl) errEl.textContent = '';
  }
};
const setErrorState = message => {
  setBusyState(false);
  const errEl = document.getElementById('error');
  if (errEl) errEl.textContent = message || '';
};
const setGotoErrorState = (message, focusInput = false) => {
  setBusyState(false);
  const text = message || '';
  const errEl = document.getElementById('goto-error');
  const addrEl = document.getElementById('address');
  if (errEl) errEl.textContent = text;
  if (addrEl) {
    if (text) {
      addrEl.setAttribute('aria-invalid', 'true');
      if (errEl) addrEl.setAttribute('aria-describedby', 'goto-error');
      if (focusInput) addrEl.focus({ preventScroll: true });
    } else {
      addrEl.removeAttribute('aria-invalid');
      if (addrEl.getAttribute('aria-describedby') === 'goto-error') {
        addrEl.removeAttribute('aria-describedby');
      }
    }
  }
  if (typeof window.__ghidraPersistState === 'function') window.__ghidraPersistState();
};
let lastFocusDescriptor;
let pendingFocusIntent;
const describeFocus = el => {
  if (!(el instanceof Element) || el === document.body || el === document.documentElement) return undefined;
  const tag = el.tagName.toLowerCase();
  const hostNode = el.closest('[data-node]');
  const hostCol = el.closest('[data-column]');
  const hostRow = el.closest('[data-address],[data-entry]');
  const hostDetails = tag === 'summary' ? el.parentElement : el.closest('details');
  const desc = {
    id: el.id || undefined,
    tag,
    action: el.dataset?.action || el.dataset?.nodeAction || undefined,
    address: el.dataset?.address || hostRow?.dataset?.address || undefined,
    entry: el.dataset?.entry || hostRow?.dataset?.entry || hostNode?.dataset?.entry || undefined,
    nodeId: el.dataset?.node || hostNode?.dataset?.node || undefined,
    edgeKey: el.dataset?.edgeKey || undefined,
    direction: el.dataset?.direction || el.dataset?.columnDirection || undefined,
    callView: el.dataset?.callView || undefined,
    targetKind: el.dataset?.kind || hostRow?.dataset?.kind || undefined,
    jump: el.dataset?.jump || undefined,
    columnTrail: el.dataset?.columnTrail !== undefined ? Number(el.dataset.columnTrail) : undefined,
    columnIndex: el.dataset?.columnIndex !== undefined ? Number(el.dataset.columnIndex) : (hostCol ? Number(hostCol.dataset.column) : undefined),
    detailsId: hostDetails?.id || undefined,
    isByteCell: el.classList?.contains('hb') || undefined,
    isSourceCode: el.classList?.contains('call-column-source-code') || undefined,
    isRowCode: el.classList?.contains('call-column-code') || undefined,
  };
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    try {
      if (typeof el.selectionStart === 'number') desc.selectionStart = el.selectionStart;
      if (typeof el.selectionEnd === 'number') desc.selectionEnd = el.selectionEnd;
    } catch {}
  }
  return desc;
};
const currentFocusDescriptor = () => {
  const active = document.activeElement;
  if (active && active !== document.body && active !== document.documentElement) {
    const fresh = describeFocus(active);
    if (fresh) {
      lastFocusDescriptor = fresh;
      return fresh;
    }
  }
  return lastFocusDescriptor;
};
const setFocusIntent = intent => { pendingFocusIntent = intent; };
const getFocusIntent = () => pendingFocusIntent;
const clearFocusIntent = () => { pendingFocusIntent = undefined; };
document.addEventListener('focusin', event => {
  const desc = describeFocus(event.target);
  if (desc) lastFocusDescriptor = desc;
}, true);
document.addEventListener('pointerdown', event => {
  const target = event.target instanceof Element ? event.target.closest('button,summary,input,select,textarea,[tabindex]') : null;
  if (target && !target.disabled) {
    const desc = describeFocus(target);
    if (desc) lastFocusDescriptor = desc;
  }
}, true);
window.addEventListener('message', event => {
  const data = event.data || {};
  if (data.action === 'busy') setBusyState(true, data.label);
  else if (data.action === 'error') setErrorState(data.error || '');
  else if (data.action === 'gotoError') setGotoErrorState(data.error || '', true);
});
const closedDetailsSummary = el => {
  let closed = null;
  let anc = el?.parentElement;
  while (anc) {
    if (anc.tagName === 'DETAILS' && !anc.open) {
      const sum = anc.querySelector(':scope > summary');
      if (sum !== el) closed = anc;
    }
    anc = anc.parentElement;
  }
  return closed ? closed.querySelector(':scope > summary') : null;
};
const isElementFocusable = el => {
  if (!(el instanceof Element) || !el.isConnected) return false;
  if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
  if (el.closest('[hidden]')) return false;
  if (closedDetailsSummary(el)) return false;
  const style = getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  if (el instanceof HTMLElement && el.getClientRects().length === 0) return false;
  return true;
};
const applyFocusElement = (el, desc, prepareFocus) => {
  if (!isElementFocusable(el)) return false;
  if (typeof prepareFocus === 'function') prepareFocus(el);
  window.__ghidraRestoringFocus = true;
  try {
    el.focus({ preventScroll: true });
    if (desc && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && typeof desc.selectionStart === 'number') {
      try {
        const len = el.value.length;
        el.setSelectionRange(Math.min(desc.selectionStart, len), Math.min(desc.selectionEnd ?? desc.selectionStart, len));
      } catch {}
    }
  } finally {
    window.__ghidraRestoringFocus = false;
  }
  const ok = document.activeElement === el;
  if (ok) lastFocusDescriptor = describeFocus(el);
  return ok;
};
const resolveCallColumnTarget = columnIndex => {
  const cols = [...document.querySelectorAll('.call-column')];
  if (!cols.length) return null;
  const col = cols[Math.max(0, Math.min(Number.isFinite(Number(columnIndex)) ? Number(columnIndex) : 0, cols.length - 1))];
  return col.querySelector('.call-column-row:not([hidden]) .call-column-pick[aria-pressed="true"]:not(:disabled)')
    || col.querySelector('.call-column-row:not([hidden]) .call-column-pick:not(:disabled)')
    || col.querySelector('.call-column-source-code:not(:disabled)')
    || document.querySelector('[data-column-trail="' + col.dataset.column + '"]');
};
const resolveCallGraphRootTarget = () =>
  document.querySelector('.call-node.is-root')
  || resolveCallColumnTarget(0)
  || document.getElementById('call-function-picker');
const matchCaseInsensitive = (items, attr, expected) => {
  if (!expected) return null;
  const needle = String(expected).toLowerCase();
  return items.find(item => (item.dataset?.[attr] || '').toLowerCase() === needle && isElementFocusable(item)) || null;
};
const restoreWebviewFocus = (options = {}) => {
  const prev = options.previous || {};
  const same = !!options.samePage;
  const prepare = options.prepareFocus;
  const intent = prev.focusIntent;
  const desc = prev.focus || (prev.focusId ? { id: prev.focusId } : undefined);
  const tryFocus = (el, selDesc) => applyFocusElement(el, selDesc, prepare);

  if (intent) {
    if (intent.kind === 'goto') {
      const addr = document.getElementById('address');
      if (tryFocus(addr)) return true;
    } else if (intent.kind === 'focusCallGraph') {
      if (tryFocus(resolveCallGraphRootTarget())) return true;
    } else if (intent.kind === 'callGraphBack') {
      const back = document.getElementById('call-back') || document.querySelector('[data-action="callGraphBack"]');
      if (tryFocus(back) || tryFocus(resolveCallGraphRootTarget())) return true;
    } else if (intent.kind === 'callColumn') {
      if (tryFocus(resolveCallColumnTarget(intent.columnIndex))) return true;
    } else if (intent.kind === 'control') {
      const exact = intent.id ? document.getElementById(intent.id) : null;
      if (tryFocus(exact)) return true;
      if (exact) {
        const sum = closedDetailsSummary(exact);
        if (tryFocus(sum)) return true;
      }
      if (intent.id === 'page-next' || intent.id === 'page-previous') {
        const alt = document.getElementById(intent.id === 'page-next' ? 'page-previous' : 'page-next');
        if (tryFocus(alt)) return true;
      }
      if (intent.id === 'nav-back' || intent.id === 'nav-forward' || intent.id === 'pager-before' || intent.id === 'pager-after') {
        for (const id of ['nav-back', 'nav-forward', 'pager-before', 'pager-after']) {
          if (tryFocus(document.getElementById(id))) return true;
        }
      }
      if (intent.entry && intent.direction) {
        const node = matchCaseInsensitive([...document.querySelectorAll('.call-node')], 'entry', intent.entry);
        const branch = node?.querySelector('.node-branch[data-direction="' + intent.direction + '"]');
        if (tryFocus(branch) || tryFocus(node)) return true;
      }
    }
  }

  if (!desc) return false;

  if (same || desc.id === 'address' || desc.id === 'search') {
    const byId = desc.id ? document.getElementById(desc.id) : null;
    if (tryFocus(byId, desc)) return true;
    if (byId) {
      const sum = closedDetailsSummary(byId);
      if (tryFocus(sum)) return true;
    }
  }

  if (same) {
    if (desc.isByteCell) {
      const cell = matchCaseInsensitive([...document.querySelectorAll('.hb[data-address]')], 'address', desc.address)
        || document.querySelector('.hb[tabindex="0"]');
      if (tryFocus(cell)) return true;
    }
    if (desc.edgeKey) {
      const edge = [...document.querySelectorAll('[data-edge-key]')].find(item => item.dataset.edgeKey === desc.edgeKey);
      if (tryFocus(edge)) return true;
    }
    if (desc.nodeId) {
      const node = [...document.querySelectorAll('.graph-node')].find(item => item.dataset.node === desc.nodeId);
      if (node) {
        if (desc.direction && tryFocus(node.querySelector('.node-branch[data-direction="' + desc.direction + '"]'))) return true;
        if (desc.action === 'decompile' && tryFocus(node.querySelector('.node-decompile'))) return true;
        if (tryFocus(node)) return true;
      }
    }
    if (desc.columnIndex !== undefined) {
      const col = document.querySelector('.call-column[data-column="' + desc.columnIndex + '"]');
      if (col) {
        if (desc.isRowCode && desc.entry) {
          const row = matchCaseInsensitive([...col.querySelectorAll('.call-column-row')], 'entry', desc.entry);
          if (tryFocus(row?.querySelector('.call-column-code'))) return true;
        }
        if (desc.isSourceCode && tryFocus(col.querySelector('.call-column-source-code'))) return true;
        if (desc.entry) {
          const pick = matchCaseInsensitive([...col.querySelectorAll('.call-column-pick')], 'entry', desc.entry);
          if (tryFocus(pick)) return true;
        }
      }
      if (tryFocus(resolveCallColumnTarget(desc.columnIndex))) return true;
    }
    if (desc.columnTrail !== undefined) {
      const trails = [...document.querySelectorAll('[data-column-trail]')];
      const trail = trails.find(item => Number(item.dataset.columnTrail) === desc.columnTrail) || trails[trails.length - 1];
      if (tryFocus(trail)) return true;
    }
    if (desc.jump) {
      const jumpBtn = [...document.querySelectorAll('[data-jump]')].find(item => item.dataset.jump === desc.jump && isElementFocusable(item));
      if (tryFocus(jumpBtn)) return true;
    }
    if (desc.address || desc.entry) {
      const candidates = [...document.querySelectorAll('tr[data-address],tr[data-entry],.graph-node')];
      const byAddr = matchCaseInsensitive(candidates, 'address', desc.address)
        || matchCaseInsensitive(candidates, 'entry', desc.entry);
      if (tryFocus(byAddr)) return true;
    }
    if (desc.detailsId) {
      const details = document.getElementById(desc.detailsId);
      if (tryFocus(details?.querySelector(':scope > summary'))) return true;
    }
  } else if (desc.id) {
    const crossById = document.getElementById(desc.id);
    if (tryFocus(crossById)) return true;
    if (crossById && tryFocus(closedDetailsSummary(crossById))) return true;
  }

  if (typeof options.fallback === 'function') {
    const fb = options.fallback();
    if (tryFocus(fb)) return true;
  }
  const fallbacks = [
    resolveCallGraphRootTarget(),
    document.querySelector('.hb.is-selected'),
    document.querySelector('tr.selected'),
    document.querySelector('.graph-node.selected'),
    document.querySelector('.graph-node'),
    document.querySelector('tr[tabindex="0"]'),
    document.querySelector('.hb[tabindex="0"]'),
    document.getElementById('address'),
    document.getElementById('search'),
    document.getElementById('cfg-refresh'),
    document.querySelector('button:not(:disabled),summary,input:not(:disabled),select:not(:disabled),[tabindex="0"]'),
    document.querySelector('h1[tabindex="-1"]'),
  ];
  for (const candidate of fallbacks) {
    if (tryFocus(candidate)) return true;
  }
  return false;
};
`;
