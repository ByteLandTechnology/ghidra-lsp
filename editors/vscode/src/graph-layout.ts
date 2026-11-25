// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

import type { ELK, ElkNode } from 'elkjs/lib/elk.bundled.js';

/** Cached lazy-loaded ELK graph layout engine instance. */
let engine: Promise<ELK> | undefined;

/** Two-dimensional coordinate point for SVG path routing. */
export interface LayoutPoint {
    /** Horizontal position in pixels. */
    x: number;
    /** Vertical position in pixels. */
    y: number;
}

/** Measured border-box dimensions of one rendered HTML graph card. */
export interface MeasuredSize {
    /** Card width in unscaled CSS pixels. */
    width: number;
    /** Card height in unscaled CSS pixels. */
    height: number;
}

/** Input node box passed to the layered ELK layout helper. */
export interface LayoutNodeInput {
    /** Stable graph node identifier. */
    id: string;
    /** Estimated fallback card width in CSS pixels. */
    width: number;
    /** Estimated fallback card height in CSS pixels. */
    height: number;
}

/** Input directed edge passed to the layered ELK layout helper. */
export interface LayoutEdgeInput {
    /** Stable edge identifier within the current graph. */
    id: string;
    /** Source node identifier. */
    from: string;
    /** Target node identifier. */
    to: string;
}

/** Positioned graph card box returned by the ELK layout engine. */
export interface PlacedLayoutNode {
    /** Stable graph node identifier. */
    id: string;
    /** Horizontal card coordinate in graph pixels. */
    x: number;
    /** Vertical card coordinate in graph pixels. */
    y: number;
    /** Final card width used during layout. */
    width: number;
    /** Final card height used during layout. */
    height: number;
}

/** Routed orthogonal graph edge returned by the ELK layout engine. */
export interface PlacedLayoutEdge {
    /** Stable edge identifier within the current graph. */
    id: string;
    /** Source node identifier. */
    from: string;
    /** Target node identifier. */
    to: string;
    /** Orthogonal polyline points from source port to target port. */
    points: LayoutPoint[];
    /** Rounded SVG path string built from `points`. */
    path: string;
}

/** Complete layered graph layout output for webview updates. */
export interface GraphLayoutResult {
    /** Total graph width in pixels. */
    width: number;
    /** Total graph height in pixels. */
    height: number;
    /** Positioned node card coordinates and dimensions. */
    nodes: PlacedLayoutNode[];
    /** Routed orthogonal edges and SVG path strings. */
    edges: PlacedLayoutEdge[];
}

/** Clamp one raw dimension value to a safe positive integer pixel size. */
function clampDimension(value: unknown, fallback: number): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return Math.max(24, Math.ceil(fallback));
    }
    return Math.max(24, Math.min(4096, Math.ceil(numeric)));
}

/** Parse a webview `measureGraph` payload into a validated map of node dimensions. */
export function parseMeasuredSizes(raw: unknown): Map<string, MeasuredSize> {
    const sizes = new Map<string, MeasuredSize>();
    if (!raw || typeof raw !== 'object') {
        return sizes;
    }
    if (Array.isArray(raw)) {
        for (const item of raw) {
            if (!item || typeof item !== 'object') {
                continue;
            }
            const record = item as Record<string, unknown>;
            const id = typeof record.id === 'string' ? record.id : '';
            const width = Number(record.width);
            const height = Number(record.height);
            if (id && Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
                sizes.set(id, { width: clampDimension(width, 24), height: clampDimension(height, 24) });
            }
        }
        return sizes;
    }
    for (const [id, entry] of Object.entries(raw as Record<string, unknown>)) {
        if (!id || !entry || typeof entry !== 'object') {
            continue;
        }
        const box = entry as Record<string, unknown>;
        const width = Number(box.width);
        const height = Number(box.height);
        if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
            sizes.set(id, { width: clampDimension(width, 24), height: clampDimension(height, 24) });
        }
    }
    return sizes;
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

/** Input specification for running a layered orthogonal ELK graph layout. */
export interface LayeredGraphInput {
    /** Root ELK graph identifier. */
    id: string;
    /** Input nodes with fallback width and height estimates. */
    nodes: LayoutNodeInput[];
    /** Input directed edges between node identifiers. */
    edges: LayoutEdgeInput[];
    /** Additional ELK layout options merged into the orthogonal layered defaults. */
    layoutOptions?: Record<string, string>;
    /** Optional measured card dimensions reported by the webview. */
    measured?: ReadonlyMap<string, MeasuredSize>;
}

/** Run ELK layered orthogonal layout from estimated or measured HTML card dimensions. */
export async function layoutLayeredGraph(input: LayeredGraphInput): Promise<GraphLayoutResult> {
    const sized = input.nodes.map(node => {
        const box = input.measured?.get(node.id);
        return {
            id: node.id,
            width: clampDimension(box?.width, node.width),
            height: clampDimension(box?.height, node.height),
        };
    });
    const ids = new Set(sized.map(node => node.id));
    const validEdges = input.edges.filter(edge => ids.has(edge.from) && ids.has(edge.to));
    const model: ElkNode = {
        id: input.id,
        layoutOptions: {
            'elk.algorithm': 'layered',
            'elk.direction': 'DOWN',
            'elk.edgeRouting': 'ORTHOGONAL',
            ...input.layoutOptions,
        },
        children: sized.map(node => ({ id: node.id, width: node.width, height: node.height })),
        edges: validEdges.map(edge => ({ id: edge.id, sources: [edge.from], targets: [edge.to] })),
    };
    const result = await (await layoutEngine()).layout(model);
    const placed = new Map((result.children || []).map(node => [node.id, node]));
    const routed = new Map((result.edges || []).map(edge => [edge.id, edge]));
    const nodes: PlacedLayoutNode[] = sized.map(node => {
        const box = placed.get(node.id);
        return {
            id: node.id,
            x: Math.round(box?.x ?? 0),
            y: Math.round(box?.y ?? 0),
            width: node.width,
            height: node.height,
        };
    });
    const edges: PlacedLayoutEdge[] = validEdges.map(edge => {
        const elkEdge = routed.get(edge.id);
        const points = (elkEdge?.sections || []).flatMap(section => [
            section.startPoint,
            ...(section.bendPoints || []),
            section.endPoint,
        ]);
        return {
            id: edge.id,
            from: edge.from,
            to: edge.to,
            points,
            path: roundedOrthogonalPath(points, 8),
        };
    });
    return {
        width: Math.max(1, Math.ceil(result.width || 1)),
        height: Math.max(1, Math.ceil(result.height || 1)),
        nodes,
        edges,
    };
}
