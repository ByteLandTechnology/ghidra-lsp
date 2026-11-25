// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

import { highlightAsm } from './syntax';
import { escapeHtml, GraphEdge, GraphNode } from './workbench-page';
import { layoutLayeredGraph, LayoutPoint, MeasuredSize } from './graph-layout';
import { callIcon } from './call-graph-icons';

/** Default line height estimate in CSS pixels for initial basic-block layout. */
const estimatedLineHeight = 20;
/** Maximum card width in CSS pixels before assembly operands wrap to the next line. */
const maxBlockWidth = 540;
/** Minimum card width in CSS pixels for basic-block HTML cards. */
const minBlockWidth = 220;

/** Basic-block node positioned by the ELK layout engine. */
export interface FlowNode extends GraphNode {
    /** Horizontal position in graph pixels. */
    x: number;
    /** Vertical position in graph pixels. */
    y: number;
    /** Card width in CSS pixels. */
    width: number;
    /** Card height in CSS pixels. */
    height: number;
}

/** Directed control-flow edge with routed points, SVG path, branch kind, and optional badge anchor. */
export interface FlowEdge extends GraphEdge {
    /** Stable edge index in the rendered edge list. */
    index: number;
    /** Orthogonal polyline points returned by ELK. */
    points: LayoutPoint[];
    /** Rounded orthogonal SVG path string. */
    path: string;
    /** Branch classification used for stroke, dash pattern, and `T`/`F` badge. */
    kind: 'taken' | 'fallthrough' | 'flow';
    /** True when the edge points upward to an earlier or equal layer. */
    backward: boolean;
    /** Collision-free SVG coordinate for conditional `T`/`F` edge badges. */
    badge?: LayoutPoint;
}

/** Positioned control-flow graph model returned by `layoutControlFlow`. */
export interface ControlFlowLayout {
    /** Total graph width in pixels. */
    width: number;
    /** Total graph height in pixels. */
    height: number;
    /** Positioned basic-block cards. */
    nodes: FlowNode[];
    /** Routed orthogonal control-flow edges. */
    edges: FlowEdge[];
}

/** Estimate display column width for ASCII and wide characters. */
const columns = (text: string): number => [...text].reduce((width, ch) => width + (ch.charCodeAt(0) > 255 ? 2 : 1), 0);

/** Select a badge position on `points` that does not overlap basic blocks or previous badges. */
export function placeEdgeBadge(
    points: { x: number; y: number }[],
    nodes: { x: number; y: number; width: number; height: number }[],
    placed: { x: number; y: number }[],
): LayoutPoint | undefined {
    if (points.length < 2) { return undefined; }
    const half = 10;
    const clear = (cx: number, cy: number): boolean => (
        nodes.every(n => cx + half <= n.x || cx - half >= n.x + n.width || cy + half <= n.y || cy - half >= n.y + n.height)
        && placed.every(b => Math.abs(cx - b.x) >= half * 2 || Math.abs(cy - b.y) >= half * 2)
    );
    const candidates: LayoutPoint[] = [];
    for (let i = 0; i + 1 < points.length; i++) {
        const a = points[i], b = points[i + 1];
        const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
        if (len < 1) { continue; }
        const nx = -dy / len, ny = dx / len;
        const start = i === 0 ? Math.min(16, len / 2) : 4;
        const end = i + 2 === points.length ? Math.max(start, len - 16) : len - 4;
        for (let d = start; d <= end; d += 6) {
            const px = a.x + (dx * d) / len, py = a.y + (dy * d) / len;
            for (const off of [0, 12, -12]) {
                candidates.push({ x: Math.round(px + nx * off), y: Math.round(py + ny * off) });
            }
        }
        candidates.push({ x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2) });
    }
    for (const c of candidates) {
        if (clear(c.x, c.y)) { placed.push(c); return c; }
    }
    const seed = candidates[0] || { x: Math.round(points[0].x), y: Math.round(points[0].y + 20) };
    for (let radius = 12; radius <= 160; radius += 8) {
        for (const [ox, oy] of [[0, radius], [radius, 0], [-radius, 0], [0, -radius], [radius, radius], [-radius, radius]]) {
            const cx = seed.x + ox, cy = seed.y + oy;
            if (clear(cx, cy)) { const hit = { x: cx, y: cy }; placed.push(hit); return hit; }
        }
    }
    return undefined;
}

/** Estimate fallback dimensions for one basic-block HTML card before DOM measurement. */
function estimateBlockSize(node: GraphNode): MeasuredSize {
    const rawLines = (node.lines || []).map(line => line.replace(/\t/g, '    '));
    const titleWidth = columns(node.title) * 8.4 + (node.address && node.address === node.entry ? 96 : 32);
    const widestLine = rawLines.reduce((max, line) => Math.max(max, columns(line) * 8.2 + 28), 0);
    const subtitleWidth = !rawLines.length && node.subtitle ? columns(node.subtitle) * 7.4 + 28 : 0;
    const width = Math.min(maxBlockWidth, Math.max(minBlockWidth, Math.ceil(Math.max(titleWidth, widestLine, subtitleWidth))));
    const usableCols = Math.max(18, Math.floor((width - 28) / 8.2));
    const wrappedRows = rawLines.length
        ? rawLines.reduce((sum, line) => sum + Math.max(1, Math.ceil(Math.max(1, columns(line)) / usableCols)), 0)
        : 1;
    const height = Math.max(72, 46 + wrappedRows * estimatedLineHeight);
    return { width, height };
}

/** Layer control flow and route orthogonal edges around estimated or measured HTML cards. */
export async function layoutControlFlow(
    nodes: GraphNode[],
    edges: GraphEdge[],
    measured?: ReadonlyMap<string, MeasuredSize>,
): Promise<ControlFlowLayout> {
    const ids = new Set(nodes.map(node => node.id));
    const validEdges = edges.filter(edge => ids.has(edge.from) && ids.has(edge.to));
    const result = await layoutLayeredGraph({
        id: 'cfg',
        nodes: nodes.map(node => ({ id: node.id, ...estimateBlockSize(node) })),
        edges: validEdges.map((edge, index) => ({ id: String(index), from: edge.from, to: edge.to })),
        layoutOptions: {
            'elk.padding': '[top=24,left=24,bottom=24,right=24]',
            'elk.spacing.nodeNode': '42',
            'elk.layered.spacing.nodeNodeBetweenLayers': '56',
            'elk.layered.spacing.edgeNodeBetweenLayers': '22',
            'elk.spacing.edgeNode': '22',
            'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
        },
        measured,
    });
    const placed = new Map(result.nodes.map(node => [node.id, node]));
    const placedNodes: FlowNode[] = nodes.map(node => {
        const box = placed.get(node.id)!;
        return { ...node, x: box.x, y: box.y, width: box.width, height: box.height };
    });
    const conditional = (edge: GraphEdge): boolean => /CONDITIONAL/.test(edge.label || '') && !/UNCONDITIONAL/.test(edge.label || '');
    const branches = new Set(validEdges.filter(conditional).map(edge => edge.from));
    const placedBadges: LayoutPoint[] = [];
    return {
        width: result.width,
        height: result.height,
        nodes: placedNodes,
        edges: result.edges.map(edge => {
            const index = Number(edge.id);
            const original = validEdges[index];
            const fromBox = placed.get(original.from)!;
            const toBox = placed.get(original.to)!;
            const kind = conditional(original)
                ? 'taken'
                : /^fall[ -]through$/i.test(original.label || '') && branches.has(original.from)
                    ? 'fallthrough'
                    : 'flow';
            const badge = kind === 'taken' || kind === 'fallthrough'
                ? placeEdgeBadge(edge.points, placedNodes, placedBadges)
                : undefined;
            return {
                ...original,
                index,
                points: edge.points,
                path: edge.path,
                kind,
                backward: toBox.y <= fromBox.y,
                badge,
            };
        }),
    };
}

/** Render one syntax-highlighted assembly instruction line as flow-wrapped HTML. */
function instructionLine(line: string): string {
    return `<div class="node-line">${highlightAsm(line.replace(/\t/g, '    '), 'span', true)}</div>`;
}

/** Render a decorative `T` or `F` SVG badge for conditional control-flow edges. */
export function renderCfgEdgeBadge(
    edgeOrKind: { kind: 'taken' | 'fallthrough' | 'flow'; badge?: { x: number; y: number } } | 'taken' | 'fallthrough' | 'flow',
    badge?: { x: number; y: number },
): string {
    const kind = typeof edgeOrKind === 'string' ? edgeOrKind : edgeOrKind.kind;
    const anchor = typeof edgeOrKind === 'string' ? badge : (badge ?? edgeOrKind.badge);
    const label = kind === 'taken' ? 'T' : kind === 'fallthrough' ? 'F' : '';
    if (!label) { return ''; }
    const attr = anchor ? ` transform="translate(${anchor.x},${anchor.y})"` : ' hidden';
    return `<g class="cfg-edge-badge" aria-hidden="true"${attr}><rect x="-9" y="-9" width="18" height="18" rx="4"/><text y="3.5" text-anchor="middle">${label}</text></g>`;
}

/** Render the interactive HTML-card + SVG-edge control-flow graph and overview map. */
export async function controlFlowGraph(
    nodes: GraphNode[],
    edges: GraphEdge[],
    measured?: ReadonlyMap<string, MeasuredSize>,
): Promise<string> {
    const layout = await layoutControlFlow(nodes, edges, measured);
    const titles = new Map(nodes.map(node => [node.id, node.title]));
    const edgeSvg = layout.edges.map(edge => `<g class="cfg-edge ${edge.kind}${edge.backward ? ' backward' : ''}" tabindex="0" role="button" aria-pressed="false" aria-label="${escapeHtml(`${edge.label || 'Flow'} from ${titles.get(edge.from)} to ${titles.get(edge.to)}`)}" data-edge-index="${edge.index}" data-edge-key="${escapeHtml(JSON.stringify([edge.from, edge.to, edge.kind]))}" data-from="${escapeHtml(edge.from)}" data-to="${escapeHtml(edge.to)}" data-kind="${edge.kind}"><title>${escapeHtml(edge.label || 'Flow')} · ${escapeHtml(titles.get(edge.from))} → ${escapeHtml(titles.get(edge.to))}</title><path class="cfg-edge-hit" d="${edge.path}"/><path class="edge" d="${edge.path}" marker-end="url(#cfg-arrow-${edge.kind})"/>${renderCfgEdgeBadge(edge)}</g>`).join('');
    const nodeCards = layout.nodes.map(node => {
        const tooltip = [node.title, ...(node.lines?.length ? [] : [node.subtitle]), ...(node.lines || [])].filter(Boolean).join('\n');
        const entryBadge = node.address && node.address === node.entry ? '<span class="node-subtitle cfg-entry-badge">Entry</span>' : '';
        const body = node.lines?.length
            ? node.lines.map(instructionLine).join('')
            : `<div class="node-subtitle">${escapeHtml(node.subtitle || '')}</div>`;
        return `<div class="graph-node cfg-node" tabindex="0" role="button" aria-label="${escapeHtml(node.title)}" title="${escapeHtml(tooltip)}" data-node="${escapeHtml(node.id)}" data-address="${escapeHtml(node.address)}" data-entry="${escapeHtml(node.entry)}" data-kind="${node.kind || 'address'}" data-label="${escapeHtml(node.title)}" data-x="${node.x}" data-y="${node.y}" data-width="${node.width}" data-height="${node.height}" style="left:${node.x}px;top:${node.y}px"><div class="block-header"><span class="node-title">${escapeHtml(node.title)}</span>${entryBadge}</div><div class="block-body">${body}</div></div>`;
    }).join('');
    const markers = ['taken', 'fallthrough', 'flow'].map(kind => `<marker id="cfg-arrow-${kind}" markerUnits="userSpaceOnUse" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z"/></marker>`).join('');
    const overview = `<details class="cfg-overview" hidden><summary title="Drag to move overview" aria-label="Overview. Drag or use arrow keys to move">${callIcon('overview')}<span>Overview</span><span role="button" tabindex="0" class="cfg-overview-close" aria-label="Hide overview" title="Hide overview">${callIcon('close')}</span></summary><svg id="cfg-overview-map" viewBox="0 0 ${layout.width} ${layout.height}" preserveAspectRatio="xMidYMid meet" tabindex="0" role="button" aria-label="Graph overview. Click or drag to pan; arrow keys move the viewport.">${layout.edges.map(edge => `<path data-map-edge="${edge.index}" d="${edge.path}"/>`).join('')}${layout.nodes.map(node => `<rect data-map-node="${escapeHtml(node.id)}" x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}"/>`).join('')}<rect id="cfg-overview-window"/></svg></details>`;
    return `<div class="graph-wrap flow-canvas" data-control-flow tabindex="0" role="region" aria-label="Control flow canvas. Drag the background or middle-drag a block to pan; wheel to zoom. Enter on a block reveals source."><svg role="group" aria-label="Control flow graph" data-width="${layout.width}" data-height="${layout.height}"><defs>${markers}</defs><g class="graph-world">${edgeSvg}</g></svg><div class="graph-cards"><div class="graph-card-world">${nodeCards}</div></div>${overview}</div>`;
}
