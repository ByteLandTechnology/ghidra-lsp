// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

import { highlightAsm } from './syntax';
import type { ElkNode } from 'elkjs/lib/elk.bundled.js';
import { escapeHtml, GraphEdge, GraphNode } from './workbench-page';
import { layoutEngine, roundedOrthogonalPath } from './graph-layout';
import { callIcon } from './call-graph-icons';
import { GraphOutlineModel, OutlineEdgeItem, renderGraphStage } from './graph-outline';

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
        'elk.spacing.nodeNode': '42', 'elk.layered.spacing.nodeNodeBetweenLayers': '48',
        'elk.layered.spacing.edgeNodeBetweenLayers': '18', 'elk.spacing.edgeNode': '18',
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

/** Compute the axis-aligned bounding box of a routed polyline. */
function boundsOfPoints(points: { x: number; y: number }[]): { x: number; y: number; width: number; height: number } {
    if (!points.length) { return { x: 0, y: 0, width: 1, height: 1 }; }
    const xs = points.map(point => point.x), ys = points.map(point => point.y);
    const minX = Math.min(...xs), minY = Math.min(...ys);
    return { x: minX, y: minY, width: Math.max(1, Math.max(...xs) - minX), height: Math.max(1, Math.max(...ys) - minY) };
}

/** Syntax-highlight one instruction or continuation row as SVG `tspan` markup. */
function code(row: CodeRow): string {
    return highlightAsm(row.text, 'tspan', !row.continuation);
}

/** Render the interactive control-flow HTML outline, decorative SVG graph, and overview map. */
export async function controlFlowGraph(nodes: GraphNode[], edges: GraphEdge[]): Promise<string> {
    const layout = await layoutControlFlow(nodes, edges);
    const titles = new Map(nodes.map(node => [node.id, node.title]));
    const path = (edge: FlowEdge): string => roundedOrthogonalPath(edge.points, 8);
    const edgeKeyOf = (edge: FlowEdge): string => JSON.stringify([edge.from, edge.to, edge.kind]);
    const edgeSvg = layout.edges.map(edge => {
        const box = boundsOfPoints(edge.points), d = path(edge);
        return `<g class="cfg-edge ${edge.kind}${edge.backward ? ' backward' : ''}" data-edge-key="${escapeHtml(edgeKeyOf(edge))}" data-from="${escapeHtml(edge.from)}" data-to="${escapeHtml(edge.to)}" data-kind="${edge.kind}" data-x="${box.x}" data-y="${box.y}" data-width="${box.width}" data-height="${box.height}"><title>${escapeHtml(edge.label || 'Flow')} · ${escapeHtml(titles.get(edge.from))} → ${escapeHtml(titles.get(edge.to))}</title><path class="cfg-edge-hit" d="${d}"/><path class="edge-focus-halo" d="${d}"/><path class="edge" d="${d}" marker-end="url(#cfg-arrow-${edge.kind})"/></g>`;
    }).join('');
    const nodeSvg = layout.nodes.map(node => `<g class="graph-node" data-node="${escapeHtml(node.id)}" data-address="${escapeHtml(node.address)}" data-entry="${escapeHtml(node.entry)}" data-kind="${node.kind || 'address'}" data-label="${escapeHtml(node.title)}" data-x="${node.x}" data-y="${node.y}" data-width="${node.width}" data-height="${node.height}" transform="translate(${node.x},${node.y})"><title>${escapeHtml([node.title, ...(node.lines?.length ? [] : [node.subtitle]), ...(node.lines || [])].filter(Boolean).join('\n'))}</title><rect class="graph-focus-halo" x="-5" y="-5" width="${node.width + 10}" height="${node.height + 10}" rx="11"/><rect class="block-body" width="${node.width}" height="${node.height}" rx="8"/><rect class="block-header" x="1" y="1" width="${node.width - 2}" height="33" rx="7"/><text x="12" y="23" class="node-title">${escapeHtml(node.title)}</text>${node.address && node.address === node.entry ? `<text x="${node.width - 12}" y="23" text-anchor="end" class="node-subtitle cfg-entry-badge">Entry</text>` : ''}${!node.rows.length ? `<text x="14" y="54" class="node-subtitle">${escapeHtml(node.subtitle)}</text>` : ''}${node.rows.map((row, i) => `<text x="14" y="${52 + i * lineHeight}" class="node-line" xml:space="preserve">${code(row)}</text>`).join('')}</g>`).join('');
    const markers = ['taken', 'fallthrough', 'flow'].map(kind => `<marker id="cfg-arrow-${kind}" markerUnits="userSpaceOnUse" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z"/></marker>`).join('');
    const overview = `<details class="cfg-overview"><summary title="Toggle or drag overview" aria-label="Overview, toggle or drag to move">${callIcon('overview')}<span>Overview</span></summary><button type="button" class="cfg-overview-close" aria-label="Hide overview" title="Hide overview">${callIcon('close')}</button><div class="cfg-overview-stage" tabindex="0" role="region" aria-label="Overview viewport. Click or drag to pan; arrow keys move the viewport."><svg id="cfg-overview-map" aria-hidden="true" focusable="false" viewBox="0 0 ${layout.width} ${layout.height}" preserveAspectRatio="xMidYMid meet">${layout.edges.map(edge => `<path d="${path(edge)}"/>`).join('')}${layout.nodes.map(node => `<rect data-map-node="${escapeHtml(node.id)}" x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}"/>`).join('')}<rect id="cfg-overview-window"/></svg></div></details>`;
    const canvasHtml = `<div class="graph-wrap flow-canvas" data-control-flow tabindex="0" role="region" aria-label="Control flow canvas. Drag background to pan, wheel to zoom, or navigate the blocks outline."><svg aria-hidden="true" focusable="false" data-width="${layout.width}" data-height="${layout.height}"><defs>${markers}</defs><g class="graph-world">${edgeSvg}${nodeSvg}</g></svg>${overview}</div>`;
    const outlineModel: GraphOutlineModel = {
        kind: 'controlFlow',
        heading: `Blocks (${layout.nodes.length})`,
        items: layout.nodes.map(node => {
            const isEntry = Boolean(node.address && node.address === node.entry);
            const outgoing: OutlineEdgeItem[] = layout.edges.filter(edge => edge.from === node.id).map(edge => ({
                key: edgeKeyOf(edge),
                from: edge.from,
                to: edge.to,
                jumpNodeId: edge.to,
                kind: edge.kind,
                text: edge.kind === 'taken' ? `Taken → ${titles.get(edge.to)}` : edge.kind === 'fallthrough' ? `Fallthrough → ${titles.get(edge.to)}` : `${edge.label || 'Flow'} → ${titles.get(edge.to)}`,
                title: `${edge.label || 'Flow'} · ${titles.get(edge.from)} → ${titles.get(edge.to)}`,
            }));
            const incoming: OutlineEdgeItem[] = layout.edges.filter(edge => edge.to === node.id).map(edge => ({
                key: edgeKeyOf(edge),
                from: edge.from,
                to: edge.to,
                jumpNodeId: edge.from,
                kind: edge.kind,
                text: `From ${titles.get(edge.from)}${edge.kind === 'taken' ? ' (taken)' : edge.kind === 'fallthrough' ? ' (fallthrough)' : ''}`,
                title: `${edge.label || 'Flow'} · ${titles.get(edge.from)} → ${titles.get(edge.to)}`,
            }));
            return {
                id: node.id,
                title: node.title,
                badge: isEntry ? 'Entry' : undefined,
                address: node.address,
                entry: node.entry,
                targetKind: node.kind || 'block',
                meta: !node.lines?.length && node.subtitle ? node.subtitle : undefined,
                linesHtml: (node.lines || []).map(line => highlightAsm(line.replace(/\t/g, '    '), 'span', true)),
                edges: [...outgoing, ...incoming],
            };
        }),
    };
    return renderGraphStage(outlineModel, canvasHtml);
}
