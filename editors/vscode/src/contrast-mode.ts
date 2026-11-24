// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

/**
 * Host contrast controller that bridges VS Code color theme kinds and
 * `ghidraLsp.accessibility.highVisibilityControls` into open webviews.
 */
import * as vscode from 'vscode';
import {
    ContrastKind,
    ContrastState,
    HighVisibilitySetting,
    computeHighVisibility,
} from './page-styles';

/** Frame-length debounce window in milliseconds for theme and configuration broadcasts. */
const BROADCAST_DEBOUNCE_MS = 16;

/** Map a VS Code {@link vscode.ColorThemeKind} value to a {@link ContrastKind} identifier. */
function readContrastKind(kind: vscode.ColorThemeKind): ContrastKind {
    if (kind === vscode.ColorThemeKind.HighContrast) {
        return 'hc-dark';
    }
    if (kind === vscode.ColorThemeKind.HighContrastLight) {
        return 'hc-light';
    }
    if (kind === vscode.ColorThemeKind.Light) {
        return 'light';
    }
    return 'dark';
}

/** Read and normalize `ghidraLsp.accessibility.highVisibilityControls` from workspace settings. */
function readHighVisibilitySetting(): HighVisibilitySetting {
    const raw = vscode.workspace
        .getConfiguration('ghidraLsp')
        .get<string>('accessibility.highVisibilityControls', 'auto');
    if (raw === 'on' || raw === 'off') {
        return raw;
    }
    return 'auto';
}

/** Tracks open webview panels and broadcasts debounced contrast-mode updates. */
export class ContrastModeController implements vscode.Disposable {
    /** Registered open webview panels that receive live contrast updates. */
    private readonly panels = new Set<vscode.WebviewPanel>();
    /** Pending one-frame debounce timer for theme and configuration changes. */
    private broadcastTimer: ReturnType<typeof setTimeout> | undefined;

    /** Read the current host {@link ContrastState}. */
    get state(): ContrastState {
        const contrastMode = readContrastKind(vscode.window.activeColorTheme.kind);
        const highVisibilityControls = readHighVisibilitySetting();
        return {
            contrastMode,
            highVisibilityControls,
            highVisibility: computeHighVisibility(contrastMode, highVisibilityControls),
        };
    }

    /** Register `panel` to receive live `contrastMode` messages until disposal. */
    track(panel: vscode.WebviewPanel): vscode.WebviewPanel {
        this.panels.add(panel);
        panel.onDidDispose(() => {
            this.panels.delete(panel);
        });
        return panel;
    }

    /** Schedule a one-frame debounced `contrastMode` broadcast to all tracked webview panels. */
    scheduleBroadcast(): void {
        if (this.broadcastTimer !== undefined) {
            clearTimeout(this.broadcastTimer);
        }
        this.broadcastTimer = setTimeout(() => {
            this.broadcastTimer = undefined;
            this.broadcastNow();
        }, BROADCAST_DEBOUNCE_MS);
    }

    /** Post the current {@link ContrastState} immediately to every tracked webview panel. */
    private broadcastNow(): void {
        const current = this.state;
        const message = { action: 'contrastMode', ...current };
        for (const panel of this.panels) {
            void Promise.resolve(panel.webview.postMessage(message)).catch(() => {});
        }
    }

    /** Clear pending broadcast timers and release tracked panel references. */
    dispose(): void {
        if (this.broadcastTimer !== undefined) {
            clearTimeout(this.broadcastTimer);
            this.broadcastTimer = undefined;
        }
        this.panels.clear();
    }
}
