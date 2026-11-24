// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

import * as vscode from 'vscode';
import { Data, stringOf } from './web';

/** Webview action names sent by VS Code keybinding commands. */
export type WebviewShortcutAction = 'focusFilter' | 'focusAddress' | 'zoomIn' | 'zoomOut' | 'fitGraph';

/** Focus flags recorded for one webview panel. */
interface WebviewFocusState {
    /** Panel kind (`listing`, `memory`, `callGraph`, `controlFlow`, or another workbench kind). */
    kind: string;
    /** True when focus is in an editable control, button, summary, link, or graph node or edge. */
    editableOrButton: boolean;
    /** True when focus is directly on a `.flow-canvas` viewport element. */
    canvas: boolean;
}

/** Context key set to true when an editable control, button, or graph item has focus. */
const editableContextKey = 'ghidra.webviewEditableOrButtonFocus';
/** Context key set to true when a `.flow-canvas` viewport element has focus. */
const canvasContextKey = 'ghidra.webviewCanvasFocus';

/** Panel kinds that accept `ghidraLsp.webviewFocusFilter`. */
const filterKinds = new Set(['listing', 'memory', 'callGraph', 'controlFlow']);
/** Panel kinds that accept `ghidraLsp.webviewGoToAddress`. */
const addressKinds = new Set(['listing', 'memory']);
/** Panel kinds that accept graph zoom commands. */
const zoomKinds = new Set(['callGraph', 'controlFlow']);

/**
 * Client-side script that monitors DOM focus changes and sends `{ action: 'webviewFocus' }`
 * messages so VS Code `when` clauses can guard character shortcuts.
 */
export const webviewFocusScript = String.raw`
const syncWebviewFocus = (() => {
  const interactiveSelector = 'input,select,textarea,button,summary,a[href],[contenteditable="true"],[role="button"],.graph-node,.call-node,.cfg-edge,.call-edge';
  let lastKey = '';
  const post = (focused, editableOrButton, canvas) => {
    const key = focused + ':' + editableOrButton + ':' + canvas;
    if (key === lastKey) return;
    lastKey = key;
    vscode.postMessage({ action: 'webviewFocus', focused, editableOrButton, canvas });
  };
  const read = () => {
    const el = document.activeElement;
    if (!el || el === document.body || el === document.documentElement || typeof el.closest !== 'function') {
      return { editableOrButton: false, canvas: false };
    }
    const editableOrButton = !!el.closest(interactiveSelector);
    const canvas = !editableOrButton && typeof el.matches === 'function' && el.matches('.flow-canvas');
    return { editableOrButton, canvas };
  };
  const report = () => {
    const current = read();
    post(true, current.editableOrButton, current.canvas);
  };
  document.addEventListener('focusin', report);
  document.addEventListener('focusout', () => queueMicrotask(() => {
    if (!document.hasFocus()) { post(false, false, false); return; }
    report();
  }));
  window.addEventListener('focus', report);
  window.addEventListener('blur', () => post(false, false, false));
  if (document.hasFocus()) report();
  return report;
})();
`;

/**
 * Routes VS Code webview shortcut commands and keeps focus context keys synchronized.
 */
export class WebviewShortcuts implements vscode.Disposable {
    /** Recorded focus state for each attached webview panel. */
    private readonly panels = new Map<vscode.WebviewPanel, WebviewFocusState>();
    /** Most recent panel that reported DOM focus inside its iframe. */
    private lastFocusedPanel?: vscode.WebviewPanel;
    /** Last `ghidra.webviewEditableOrButtonFocus` value sent to VS Code. */
    private lastEditable = false;
    /** Last `ghidra.webviewCanvasFocus` value sent to VS Code. */
    private lastCanvas = false;
    /** Registered commands and window listeners. */
    private readonly disposables: vscode.Disposable[] = [];

    /** Register the five webview shortcut commands and global focus-reset listeners. */
    constructor() {
        const commands: [string, WebviewShortcutAction, ReadonlySet<string>][] = [
            ['ghidraLsp.webviewFocusFilter', 'focusFilter', filterKinds],
            ['ghidraLsp.webviewGoToAddress', 'focusAddress', addressKinds],
            ['ghidraLsp.webviewZoomIn', 'zoomIn', zoomKinds],
            ['ghidraLsp.webviewZoomOut', 'zoomOut', zoomKinds],
            ['ghidraLsp.webviewResetZoom', 'fitGraph', zoomKinds],
        ];
        for (const [id, action, allowed] of commands) {
            this.disposables.push(vscode.commands.registerCommand(id, async () => {
                await this.dispatch(action, allowed);
            }));
        }
        this.disposables.push(
            vscode.window.onDidChangeActiveTextEditor(editor => {
                if (editor) { this.resetAll(); }
            }),
            vscode.window.onDidChangeWindowState(state => {
                if (!state.focused) { this.resetAll(); }
            }),
        );
        this.pushContext(false, false);
    }

    /** Attach view-state and disposal listeners to `panel`. */
    attach(panel: vscode.WebviewPanel, kind: string): void {
        this.panels.set(panel, { kind, editableOrButton: false, canvas: false });
        panel.onDidChangeViewState(event => {
            const target = event.webviewPanel;
            const current = this.panels.get(target);
            if (!current) { return; }
            if (!target.active || !target.visible) {
                current.editableOrButton = false;
                current.canvas = false;
                if (this.lastFocusedPanel === target) { this.lastFocusedPanel = undefined; }
            } else if (this.lastFocusedPanel && this.lastFocusedPanel !== target) {
                const previous = this.panels.get(this.lastFocusedPanel);
                if (previous) {
                    previous.editableOrButton = false;
                    previous.canvas = false;
                }
                this.lastFocusedPanel = undefined;
            }
            this.syncContext();
        });
        panel.onDidDispose(() => {
            this.panels.delete(panel);
            if (this.lastFocusedPanel === panel) { this.lastFocusedPanel = undefined; }
            this.syncContext();
        });
        this.syncContext();
    }

    /** Clear focus flags for `panel` before replacing its HTML document. */
    resetPanel(panel: vscode.WebviewPanel): void {
        const current = this.panels.get(panel);
        if (!current) { return; }
        current.editableOrButton = false;
        current.canvas = false;
        if (this.lastFocusedPanel === panel) { this.lastFocusedPanel = undefined; }
        this.syncContext();
    }

    /** Record `{ action: 'webviewFocus' }` messages from `panel` and return true when handled. */
    handleMessage(panel: vscode.WebviewPanel, message: Data): boolean {
        if (stringOf(message.action) !== 'webviewFocus') { return false; }
        const current = this.panels.get(panel);
        if (!current) { return true; }
        const focused = message.focused !== false && (Boolean(message.focused) || Boolean(message.editableOrButton) || Boolean(message.canvas));
        if (!focused || !panel.visible) {
            current.editableOrButton = false;
            current.canvas = false;
            if (this.lastFocusedPanel === panel) { this.lastFocusedPanel = undefined; }
        } else {
            for (const [other, state] of this.panels) {
                if (other !== panel) {
                    state.editableOrButton = false;
                    state.canvas = false;
                }
            }
            current.editableOrButton = Boolean(message.editableOrButton);
            current.canvas = !current.editableOrButton && Boolean(message.canvas);
            this.lastFocusedPanel = panel;
        }
        this.syncContext();
        return true;
    }

    /** Send `action` to the active webview panel when its kind is in `allowed`. */
    private async dispatch(action: WebviewShortcutAction, allowed: ReadonlySet<string>): Promise<void> {
        const panel = this.activePanel();
        if (!panel) { return; }
        const state = this.panels.get(panel);
        if (!state || !allowed.has(state.kind)) { return; }
        await panel.webview.postMessage({ action });
    }

    /** Find the focused or active visible webview panel, if any. */
    private activePanel(): vscode.WebviewPanel | undefined {
        if (this.lastFocusedPanel && this.panels.has(this.lastFocusedPanel) && this.lastFocusedPanel.visible) {
            return this.lastFocusedPanel;
        }
        for (const panel of this.panels.keys()) {
            if (panel.active && panel.visible) { return panel; }
        }
        return undefined;
    }

    /** Clear focus flags on all tracked panels and reset VS Code context keys to false. */
    private resetAll(): void {
        for (const state of this.panels.values()) {
            state.editableOrButton = false;
            state.canvas = false;
        }
        this.lastFocusedPanel = undefined;
        this.pushContext(false, false);
    }

    /** Compute context keys from the active panel and update VS Code when a value changes. */
    private syncContext(): void {
        const panel = this.activePanel();
        const state = panel ? this.panels.get(panel) : undefined;
        const editable = Boolean(state?.editableOrButton);
        const canvas = !editable && Boolean(state?.canvas);
        if (editable === this.lastEditable && canvas === this.lastCanvas) { return; }
        this.pushContext(editable, canvas);
    }

    /** Send both context key values to VS Code with `setContext`. */
    private pushContext(editable: boolean, canvas: boolean): void {
        this.lastEditable = editable;
        this.lastCanvas = canvas;
        void vscode.commands.executeCommand('setContext', editableContextKey, editable);
        void vscode.commands.executeCommand('setContext', canvasContextKey, canvas);
    }

    /** Dispose command registrations and listeners, and reset context keys. */
    dispose(): void {
        this.panels.clear();
        this.lastFocusedPanel = undefined;
        this.pushContext(false, false);
        for (const item of this.disposables) { item.dispose(); }
    }
}
