// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

import type { ELK } from 'elkjs/lib/elk.bundled.js';

/** Cached lazy-loaded ELK graph layout engine instance. */
let engine: Promise<ELK> | undefined;

/** Two-dimensional coordinate point for SVG path routing. */
export interface LayoutPoint {
    /** Horizontal position in pixels. */
    x: number;
    /** Vertical position in pixels. */
    y: number;
}

/** Format one finite coordinate number for SVG paths without `-0`. */
function formatCoord(value: number): string {
    const rounded = Number(value.toFixed(2));
    return String(Object.is(rounded, -0) ? 0 : rounded);
}

/** Return true when `b` sits directly on the forward line from `a` to `c`. */
function isForwardCollinear(a: LayoutPoint, b: LayoutPoint, c: LayoutPoint): boolean {
    const v1x = b.x - a.x;
    const v1y = b.y - a.y;
    const v2x = c.x - b.x;
    const v2y = c.y - b.y;
    const len1 = Math.hypot(v1x, v1y);
    const len2 = Math.hypot(v2x, v2y);
    if (len1 < 1e-6 || len2 < 1e-6) {
        return false;
    }
    const cross = Math.abs(v1x * v2y - v1y * v2x) / (len1 * len2);
    const dot = (v1x * v2x + v1y * v2y) / (len1 * len2);
    return cross < 1e-6 && dot > 0;
}

/** Convert an orthogonal polyline into an `M`, `L`, and `Q` SVG path with clamped corner radii. */
export function roundedOrthogonalPath(points: { x: number; y: number }[], radius = 8): string {
    const clean: LayoutPoint[] = [];
    for (const point of points) {
        if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
            continue;
        }
        const prev = clean[clean.length - 1];
        if (prev && Math.hypot(point.x - prev.x, point.y - prev.y) < 1e-6) {
            continue;
        }
        if (clean.length >= 2 && isForwardCollinear(clean[clean.length - 2], clean[clean.length - 1], point)) {
            clean[clean.length - 1] = { x: point.x, y: point.y };
            continue;
        }
        clean.push({ x: point.x, y: point.y });
    }
    if (!clean.length) {
        return '';
    }
    if (clean.length === 1) {
        return `M ${formatCoord(clean[0].x)} ${formatCoord(clean[0].y)}`;
    }
    const maxRadius = Number.isFinite(radius) && radius > 0 ? radius : 0;
    const commands = [`M ${formatCoord(clean[0].x)} ${formatCoord(clean[0].y)}`];
    let lastX = clean[0].x;
    let lastY = clean[0].y;
    for (let i = 1; i < clean.length - 1; i++) {
        const prev = clean[i - 1];
        const curr = clean[i];
        const next = clean[i + 1];
        const dx1 = curr.x - prev.x;
        const dy1 = curr.y - prev.y;
        const dx2 = next.x - curr.x;
        const dy2 = next.y - curr.y;
        const len1 = Math.hypot(dx1, dy1);
        const len2 = Math.hypot(dx2, dy2);
        if (len1 < 1e-6 || len2 < 1e-6 || maxRadius === 0) {
            commands.push(`L ${formatCoord(curr.x)} ${formatCoord(curr.y)}`);
            lastX = curr.x;
            lastY = curr.y;
            continue;
        }
        const ux1 = dx1 / len1;
        const uy1 = dy1 / len1;
        const ux2 = dx2 / len2;
        const uy2 = dy2 / len2;
        if (Math.abs(ux1 * uy2 - uy1 * ux2) < 1e-6) {
            commands.push(`L ${formatCoord(curr.x)} ${formatCoord(curr.y)}`);
            lastX = curr.x;
            lastY = curr.y;
            continue;
        }
        const corner = Math.min(maxRadius, len1 / 2, len2 / 2);
        if (corner <= 1e-6) {
            commands.push(`L ${formatCoord(curr.x)} ${formatCoord(curr.y)}`);
            lastX = curr.x;
            lastY = curr.y;
            continue;
        }
        const inX = curr.x - ux1 * corner;
        const inY = curr.y - uy1 * corner;
        const outX = curr.x + ux2 * corner;
        const outY = curr.y + uy2 * corner;
        if (Math.hypot(inX - lastX, inY - lastY) > 1e-6) {
            commands.push(`L ${formatCoord(inX)} ${formatCoord(inY)}`);
        }
        commands.push(`Q ${formatCoord(curr.x)} ${formatCoord(curr.y)} ${formatCoord(outX)} ${formatCoord(outY)}`);
        lastX = outX;
        lastY = outY;
    }
    const end = clean[clean.length - 1];
    if (Math.hypot(end.x - lastX, end.y - lastY) > 1e-6) {
        commands.push(`L ${formatCoord(end.x)} ${formatCoord(end.y)}`);
    }
    return commands.join(' ');
}

/** Load one shared layout engine only when an actual graph is opened. */
export const layoutEngine = (): Promise<ELK> => engine ||= import('elkjs/lib/elk.bundled.js')
    .then(({ default: Engine }) => new Engine({ algorithms: ['layered'] }));
