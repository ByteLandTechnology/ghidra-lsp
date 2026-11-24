// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

import { highlightAsm } from './syntax';
import type { ElkNode } from 'elkjs/lib/elk.bundled.js';
import { escapeHtml, GraphEdge, GraphNode } from './workbench-page';
import { layoutEngine, roundedOrthogonalPath } from './graph-layout';
import { callIcon } from './call-graph-icons';

/** Vertical line height in pixels for assembly lines inside basic-block nodes. */
const lineHeight = 20;
/** Single wrapped instruction line inside a basic-block node. */
type CodeRow = { text: string; continuation: boolean };
/** Basic-block node positioned by the ELK layout engine. */
type FlowNode = GraphNode & { x: number; y: number; width: number; height: number; rows: CodeRow[] };
/** Directed control-flow edge with routed points and branch classification. */
type FlowEdge = GraphEdge & { points: { x: number; y: number }[]; kind: 'taken' | 'fallthrough' | 'flow'; backward: boolean };

/** Wrap long operands rather than replacing their ends with ellipses. */
function codeRows(lines: string[]): CodeRow[] {
    return lines.flatMap(line => {
        const rows: CodeRow[] = [];
        let rest = line.replace(/\t/g, '    '), continuation = false;
        while (rest.length > 64) {
            const space = rest.lastIndexOf(' ', 64), cut = space > 24 ? space : 64;
            rows.push({ text: (continuation ? '  ' : '') + rest.slice(0, cut), continuation });
            rest = rest.slice(cut).trimStart(); continuation = true;
        }
        rows.push({ text: (continuation ? '  ' : '') + rest, continuation });
        return rows;
    });
}
/** Estimate display column width for ASCII and wide characters. */
const columns = (text: string): number => [...text].reduce((width, ch) => width + (ch.charCodeAt(0) > 255 ? 2 : 1), 0);

/** Layer actual control flow and route its edges around variable-sized blocks, including loops. */
export async function layoutControlFlow(nodes: GraphNode[], edges: GraphEdge[]): Promise<{ width: number; height: number; nodes: FlowNode[]; edges: FlowEdge[] }> {
    const measured = nodes.map(node => {
        const rows = codeRows(node.lines || []);
        const width = Math.max(280, ...rows.map(row => columns(row.text) * 8.6 + 28), columns(node.title) * 8.6 + 156);
        return { ...node, rows, width, height: Math.max(76, 46 + rows.length * lineHeight) };
    });
    const ids = new Set(nodes.map(node => node.id));
    const validEdges = edges.filter(edge => ids.has(edge.from) && ids.has(edge.to));
    const model: ElkNode = { id: 'cfg', layoutOptions: {
        'elk.algorithm': 'layered', 'elk.direction': 'DOWN', 'elk.edgeRouting': 'ORTHOGONAL',
        'elk.padding': '[top=24,left=24,bottom=24,right=24]',
        'elk.spacing.nodeNode': '42', 'elk.layered.spacing.nodeNodeBetweenLayers': '62',
        'elk.layered.spacing.edgeNodeBetweenLayers': '24', 'elk.spacing.edgeNode': '24',
        'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    }, children: measured.map(node => ({ id: node.id, width: node.width, height: node.height })),
    edges: validEdges.map((edge, index) => ({ id: String(index), sources: [edge.from], targets: [edge.to] })) };
    const result = await (await layoutEngine()).layout(model);
    const placed = new Map(result.children!.map(node => [node.id, node]));
    const conditional = (edge: GraphEdge): boolean => /CONDITIONAL/.test(edge.label || '') && !/UNCONDITIONAL/.test(edge.label || '');
    const branches = new Set(validEdges.filter(conditional).map(edge => edge.from));
    return { width: result.width || 1, height: result.height || 1,
        nodes: measured.map(node => ({ ...node, x: placed.get(node.id)!.x!, y: placed.get(node.id)!.y! })),
        edges: (result.edges || []).map(edge => {
            const original = validEdges[Number(edge.id)];
            return { ...original, points: (edge.sections || []).flatMap(section => [section.startPoint, ...(section.bendPoints || []), section.endPoint]),
                kind: conditional(original) ? 'taken' : /^fall[ -]through$/i.test(original.label || '') && branches.has(original.from) ? 'fallthrough' : 'flow',
                backward: placed.get(original.to)!.y! <= placed.get(original.from)!.y! };
        }),
    };
}

/** Syntax-highlight one instruction or continuation row as SVG `tspan` markup. */
function code(row: CodeRow): string {
    return highlightAsm(row.text, 'tspan', !row.continuation);
}

/** Select a badge position on `points` that does not overlap basic blocks or previous badges. */
function placeEdgeBadge(
    points: { x: number; y: number }[],
    nodes: FlowNode[],
    placed: { x: number; y: number }[],
): { x: number; y: number } | undefined {
    if (points.length < 2) { return undefined; }
    const half = 10;
    const clear = (cx: number, cy: number): boolean => (
        nodes.every(n => cx + half <= n.x || cx - half >= n.x + n.width || cy + half <= n.y || cy - half >= n.y + n.height)
        && placed.every(b => Math.abs(cx - b.x) >= half * 2 || Math.abs(cy - b.y) >= half * 2)
    );
    const candidates: { x: number; y: number }[] = [];
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

/** Render the interactive SVG control-flow graph and overview map. */
export async function controlFlowGraph(nodes: GraphNode[], edges: GraphEdge[]): Promise<string> {
    const layout = await layoutControlFlow(nodes, edges);
    const titles = new Map(nodes.map(node => [node.id, node.title]));
    const path = (edge: FlowEdge): string => roundedOrthogonalPath(edge.points, 8);
    const placedBadges: { x: number; y: number }[] = [];
    const edgeSvg = layout.edges.map(edge => {
        const badgeLabel = edge.kind === 'taken' ? 'T' : edge.kind === 'fallthrough' ? 'F' : '';
        const anchor = badgeLabel ? placeEdgeBadge(edge.points, layout.nodes, placedBadges) : undefined;
        const badgeSvg = anchor ? `<g class="cfg-edge-badge" aria-hidden="true" transform="translate(${anchor.x},${anchor.y})"><rect x="-9" y="-9" width="18" height="18" rx="4"/><text y="3.5" text-anchor="middle">${badgeLabel}</text></g>` : '';
        return `<g class="cfg-edge ${edge.kind}${edge.backward ? ' backward' : ''}" tabindex="0" role="button" aria-pressed="false" aria-label="${escapeHtml(`${edge.label || 'Flow'} from ${titles.get(edge.from)} to ${titles.get(edge.to)}`)}" data-edge-key="${escapeHtml(JSON.stringify([edge.from, edge.to, edge.kind]))}" data-from="${escapeHtml(edge.from)}" data-to="${escapeHtml(edge.to)}" data-kind="${edge.kind}"><title>${escapeHtml(edge.label || 'Flow')} · ${escapeHtml(titles.get(edge.from))} → ${escapeHtml(titles.get(edge.to))}</title><path class="cfg-edge-hit" d="${path(edge)}"/><path class="edge" d="${path(edge)}" marker-end="url(#cfg-arrow-${edge.kind})"/>${badgeSvg}</g>`;
    }).join('');
    const nodeSvg = layout.nodes.map(node => `<g class="graph-node" tabindex="0" role="button" aria-label="${escapeHtml(node.title)}" data-node="${escapeHtml(node.id)}" data-address="${escapeHtml(node.address)}" data-entry="${escapeHtml(node.entry)}" data-kind="${node.kind || 'address'}" data-label="${escapeHtml(node.title)}" data-x="${node.x}" data-y="${node.y}" data-width="${node.width}" data-height="${node.height}" transform="translate(${node.x},${node.y})"><title>${escapeHtml([node.title, ...(node.lines?.length ? [] : [node.subtitle]), ...(node.lines || [])].filter(Boolean).join('\n'))}</title><rect class="block-body" width="${node.width}" height="${node.height}" rx="8"/><rect class="block-header" x="1" y="1" width="${node.width - 2}" height="33" rx="7"/><text x="12" y="23" class="node-title">${escapeHtml(node.title)}</text>${node.address && node.address === node.entry ? `<text x="${node.width - 12}" y="23" text-anchor="end" class="node-subtitle cfg-entry-badge">Entry</text>` : ''}${!node.rows.length ? `<text x="14" y="54" class="node-subtitle">${escapeHtml(node.subtitle)}</text>` : ''}${node.rows.map((row, i) => `<text x="14" y="${52 + i * lineHeight}" class="node-line" xml:space="preserve">${code(row)}</text>`).join('')}</g>`).join('');
    const markers = ['taken', 'fallthrough', 'flow'].map(kind => `<marker id="cfg-arrow-${kind}" markerUnits="userSpaceOnUse" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z"/></marker>`).join('');
    const overview = `<details class="cfg-overview" hidden><summary title="Drag to move overview" aria-label="Overview. Drag or use arrow keys to move">${callIcon('overview')}<span>Overview</span><span role="button" tabindex="0" class="cfg-overview-close" aria-label="Hide overview" title="Hide overview">${callIcon('close')}</span></summary><svg id="cfg-overview-map" viewBox="0 0 ${layout.width} ${layout.height}" preserveAspectRatio="xMidYMid meet" tabindex="0" role="button" aria-label="Graph overview. Click or drag to pan; arrow keys move the viewport.">${layout.edges.map(edge => `<path d="${path(edge)}"/>`).join('')}${layout.nodes.map(node => `<rect data-map-node="${escapeHtml(node.id)}" x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}"/>`).join('')}<rect id="cfg-overview-window"/></svg></details>`;
    return `<div class="graph-wrap flow-canvas" data-control-flow tabindex="0" role="region" aria-label="Control flow canvas. Drag the background or middle-drag a block to pan; wheel to zoom. Enter on a block reveals source."><svg role="group" aria-label="Control flow graph" data-width="${layout.width}" data-height="${layout.height}"><defs>${markers}</defs><g class="graph-world">${edgeSvg}${nodeSvg}</g></svg>${overview}</div>`;
}
