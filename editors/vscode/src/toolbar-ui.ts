// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

import { escape } from './web';

/** Options for rendering a shared accessible toolbar or inspector button. */
export interface ToolbarButtonOptions {
    /** Optional unique DOM element ID. */
    id?: string;
    /** Optional CSS class names applied to the button element. */
    className?: string;
    /** Visible button text; when set, the accessible name always starts with this text. */
    text?: string;
    /** Optional CSS class name for the visible text span wrapper. */
    textClass?: string;
    /** Wrap the visible text in a `<span>` element when true. */
    wrapText?: boolean;
    /** Additional accessible description placed after `text` in `aria-label`. */
    labelDetail?: string;
    /** Separator inserted between `text` and `labelDetail` in `aria-label`. */
    labelSeparator?: ', ' | ' ';
    /** Accessible name for icon-only buttons that have no visible `text`. */
    ariaLabel?: string;
    /** Optional tooltip text written to the `title` attribute. */
    title?: string;
    /** Toggle state written to `aria-pressed`; keep `text` and `labelDetail` invariant across states. */
    pressed?: boolean;
    /** Disclosure state written to `aria-expanded`. */
    expanded?: boolean;
    /** Controlled element ID written to `aria-controls`. */
    controls?: string;
    /** Disable the button when true. */
    disabled?: boolean;
    /** Decorative HTML markup placed before the visible label. */
    leadingHtml?: string;
    /** Decorative HTML markup placed after the visible label. */
    trailingHtml?: string;
    /** Custom `data-*` attributes keyed by kebab-case suffix. */
    dataset?: Record<string, string | undefined>;
}

/** Format the accessible label for the live zoom reset button so it begins with the percentage. */
export function formatZoomAriaLabel(percentText: string): string {
    return `${percentText}, reset zoom`;
}

/** Render a native `<button type="button">` whose accessible name aligns with its visible text. */
export function toolbarButton(options: ToolbarButtonOptions): string {
    const visibleText = options.text ?? '';
    const computedAriaLabel = visibleText
        ? (options.labelDetail ? `${visibleText}${options.labelSeparator ?? ', '}${options.labelDetail}` : undefined)
        : options.ariaLabel;
    const dataAttrs = Object.entries(options.dataset ?? {})
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => value === '' ? ` data-${key}` : ` data-${key}="${escape(value)}"`)
        .join('');
    const textHtml = visibleText
        ? (options.wrapText || options.textClass
            ? `<span${options.textClass ? ` class="${escape(options.textClass)}"` : ''}>${escape(visibleText)}</span>`
            : escape(visibleText))
        : '';
    return `<button type="button"`
        + `${options.id ? ` id="${escape(options.id)}"` : ''}`
        + `${options.className ? ` class="${escape(options.className)}"` : ''}`
        + `${dataAttrs}`
        + `${computedAriaLabel ? ` aria-label="${escape(computedAriaLabel)}"` : ''}`
        + `${options.pressed !== undefined ? ` aria-pressed="${options.pressed}"` : ''}`
        + `${options.expanded !== undefined ? ` aria-expanded="${options.expanded}"` : ''}`
        + `${options.controls ? ` aria-controls="${escape(options.controls)}"` : ''}`
        + `${options.title ? ` title="${escape(options.title)}"` : ''}`
        + `${options.disabled ? ' disabled' : ''}>`
        + `${options.leadingHtml ?? ''}${textHtml}${options.trailingHtml ?? ''}`
        + `</button>`;
}

/** Render the shared zoom toolbar (`#graph-zoom-out`, `#graph-zoom`, `#graph-zoom-in`). */
export function zoomToolbar(className: string, outIconHtml: string, inIconHtml: string, disabled = false): string {
    const initialPercent = '100%';
    return `<div class="${escape(className)}" role="group" aria-label="Zoom">`
        + toolbarButton({
            id: 'graph-zoom-out',
            ariaLabel: 'Zoom out',
            title: 'Zoom out (-)',
            leadingHtml: outIconHtml,
            disabled,
        })
        + toolbarButton({
            id: 'graph-zoom',
            text: initialPercent,
            labelDetail: 'reset zoom',
            title: `${initialPercent} · Actual size (100%)`,
            disabled,
        })
        + toolbarButton({
            id: 'graph-zoom-in',
            ariaLabel: 'Zoom in',
            title: 'Zoom in (+)',
            leadingHtml: inIconHtml,
            disabled,
        })
        + `</div>`;
}
