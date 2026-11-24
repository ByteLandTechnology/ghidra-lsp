// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

import type { ElkNode } from 'elkjs/lib/elk.bundled.js';
import { callIcon } from './call-graph-icons';
import { layoutEngine, roundedOrthogonalPath } from './graph-layout';
import { GraphOutlineModel, OutlineAction, OutlineEdgeItem, renderGraphStage } from './graph-outline';
import { displayAddress } from './names';
import { escapeHtml } from './workbench-page';

/** Function identifier and display name used in call-graph nodes. */
export interface CallFunction { entry: string; name: string }
/** Single caller or callee edge record returned by the server. */
export interface CallRecord extends CallFunction { callSite?: string }
/** Traversal direction from the root function. */
export type CallDirection = 'callers' | 'callees';
/** Call-graph node with distance and branch expansion metadata. */
export interface CallNode extends CallFunction { id: string; callerDistance?: number; calleeDistance?: number; branches?: Partial<Record<CallDirection, { expanded: boolean; count?: number }>> }
/** Directed call edge between two graph nodes and its known call-site addresses. */
export interface CallEdge { from: string; to: string; sites: string[] }
/** Bounded call-graph model centered on one root function. */
export interface CallGraph { root: string; nodes: CallNode[]; edges: CallEdge[]; limited: boolean; warnings: string[] }
/** Lists of node IDs whose caller or callee branches are expanded. */
export interface CallExpansion { callers: string[]; callees: string[] }

/** Call-graph node positioned by the ELK layout engine. */
interface PlacedNode extends CallNode { x: number; y: number; width: number; height: number; lines: string[] }
/** Call-graph edge with routed polyline bend points. */
interface PlacedEdge extends CallEdge { points: { x: number; y: number }[] }
/** Estimate display column width for ASCII and wide characters. */
const columns = (text: string): number => [...text].reduce((n, ch) => n + (ch.charCodeAt(0) > 255 ? 2 : 1), 0);
/** Wrap a long function name into lines that fit inside a call-graph box. */
function nameLines(name: string): string[] {
    const lines: string[] = []; let line = '';
    for (const character of name) {
        if (columns(line + character) > 36 && line) { lines.push(line); line = ''; }
        line += character;
    }
    if (line) { lines.push(line); }
    return lines.length ? lines : ['(unnamed function)'];
}

/** A top-to-bottom graph with actual shared/recursive edges routed around function nodes. */
async function layoutCalls(graph: CallGraph): Promise<{ width: number; height: number; nodes: PlacedNode[]; edges: PlacedEdge[] }> {
    const measured = graph.nodes.map(node => {
        const root = node.id === graph.root;
        const lines = nameLines(node.name);
        const addressWidth = root ? columns(displayAddress(node.entry)) * 7.5 + 72 : 0;
        return {
            ...node,
            lines,
            width: Math.max(root ? 270 : 230, addressWidth, ...lines.map(line => columns(line) * (root ? 9 : 8) + 72)),
            height: 30 + lines.length * 18 + (root ? 20 : 0),
        };
    });
    const model: ElkNode = { id: 'calls', layoutOptions: {
        'elk.algorithm': 'layered', 'elk.direction': 'DOWN', 'elk.edgeRouting': 'ORTHOGONAL',
        'elk.padding': '[top=36,left=32,bottom=36,right=32]',
        'elk.spacing.nodeNode': '38', 'elk.layered.spacing.nodeNodeBetweenLayers': '110',
        'elk.spacing.edgeNode': '18', 'elk.layered.spacing.edgeNodeBetweenLayers': '18',
        'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
        'elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED',
    }, children: measured.map(node => ({ id: node.id, width: node.width, height: node.height })),
    edges: graph.edges.map((edge, index) => ({ id: String(index), sources: [edge.from], targets: [edge.to] })) };
    const result = await (await layoutEngine()).layout(model);
    const placed = new Map(result.children!.map(node => [node.id, node]));
    return { width: result.width || 1, height: result.height || 1,
        nodes: measured.map(node => ({ ...node, x: placed.get(node.id)!.x!, y: placed.get(node.id)!.y! })),
        edges: graph.edges.map((edge, index) => ({ ...edge, points: result.edges!.find(item => item.id === String(index))!.sections!.flatMap(section => [section.startPoint, ...(section.bendPoints || []), section.endPoint]) })),
    };
}

/** Compute the axis-aligned bounding box of a routed call-edge polyline. */
function boundsOfPoints(points: { x: number; y: number }[]): { x: number; y: number; width: number; height: number } {
    if (!points.length) { return { x: 0, y: 0, width: 1, height: 1 }; }
    const xs = points.map(point => point.x), ys = points.map(point => point.y);
    const minX = Math.min(...xs), minY = Math.min(...ys);
    return { x: minX, y: minY, width: Math.max(1, Math.max(...xs) - minX), height: Math.max(1, Math.max(...ys) - minY) };
}

/** Describe a call-graph node's distance and direction relative to the root function. */
function describeRelation(node: CallNode, rootId: string): string {
    if (node.id === rootId) { return 'Current function'; }
    if (node.callerDistance && node.calleeDistance) { return 'Caller / callee'; }
    if (node.callerDistance) { return `Caller · ${node.callerDistance} ${node.callerDistance === 1 ? 'level' : 'levels'}`; }
    return `Callee · ${node.calleeDistance} ${node.calleeDistance === 1 ? 'level' : 'levels'}`;
}

/** Render the interactive call-graph HTML outline, decorative SVG graph, and overview map. */
export async function callGraph(graph: CallGraph): Promise<string> {
    const layout = await layoutCalls(graph);
    const path = (edge: PlacedEdge): string => roundedOrthogonalPath(edge.points, 8);
    const edgeKeyOf = (edge: CallEdge): string => JSON.stringify([edge.from, edge.to]);
    const functions = new Map(graph.nodes.map(node => [node.id, node.name]));
    const edgeSvg = layout.edges.map(edge => {
        const box = boundsOfPoints(edge.points), d = path(edge);
        return `<g class="call-edge" data-edge-key="${escapeHtml(edgeKeyOf(edge))}" data-from="${escapeHtml(edge.from)}" data-to="${escapeHtml(edge.to)}" data-x="${box.x}" data-y="${box.y}" data-width="${box.width}" data-height="${box.height}"><path class="call-edge-hit" d="${d}"/><path class="edge-focus-halo" d="${d}"/><path class="edge" d="${d}" marker-end="url(#call-arrow)"/><title>${escapeHtml(edge.sites.length ? `Known static call sites: ${edge.sites.join(', ')}` : 'Static call relationship; call-site address not reported')}</title></g>`;
    }).join('');
    const nodeSvg = layout.nodes.map(node => {
        const root = node.id === graph.root;
        const relation = describeRelation(node, graph.root);
        const html = (x: number, y: number, width: number, height: number, body: string, extra = ''): string => `<foreignObject class="call-node-controls ${extra}" x="${x}" y="${y}" width="${width}" height="${height}"><div xmlns="http://www.w3.org/1999/xhtml" class="node-control-content">${body}</div></foreignObject>`;
        const action = `<button type="button" tabindex="-1" class="node-decompile" data-node-action="decompile" title="${escapeHtml(`Decompile ${node.name}`)}">${callIcon('decompile')}</button>`;
        const ports = (['callers', 'callees'] as const).map(direction => {
            const branch = node.branches?.[direction]; if (!branch || branch.count === 0) { return ''; }
            const label = `${branch.expanded ? 'Collapse' : 'Expand'} ${direction} of ${node.name}`;
            const portX = Math.round(node.width / 2 - 26);
            const portY = direction === 'callers' ? -13 : node.height - 13;
            const restPath = branch.expanded ? 'M13 6 Q24 6 35 6' : 'M6 6 Q24 6 42 6';
            const glyph = `<svg class="branch-bar" width="48" height="12" viewBox="0 0 48 12" aria-hidden="true"><path class="branch-bar-path" d="${restPath}" fill="none" stroke="currentColor" stroke-linecap="round"/></svg>`;
            return html(portX, portY, 52, 26, `<button type="button" tabindex="-1" class="node-branch" data-direction="${direction}" data-expanded="${branch.expanded}" title="${escapeHtml(label)}">${glyph}</button>`, `node-${direction}`);
        }).join('');
        const blockHeight = node.lines.length * 18 + (root ? 18 : 0);
        const titleBaseline = Math.round((node.height - blockHeight) / 2 + 14);
        const rootAddress = root ? `<text x="${node.width / 2}" y="${titleBaseline + (node.lines.length - 1) * 18 + 19}" text-anchor="middle" class="node-subtitle call-root-address">${escapeHtml(displayAddress(node.entry))}</text>` : '';
        const controls = html(node.width - 34, Math.round(node.height / 2 - 14), 28, 28, action, 'node-code') + ports;
        return `<g class="graph-node call-node${root ? ' is-root' : ''}" data-node="${escapeHtml(node.id)}" data-entry="${escapeHtml(node.entry)}" data-address="${escapeHtml(node.entry)}" data-kind="function" data-label="${escapeHtml(node.name)}" data-x="${node.x}" data-y="${node.y}" data-width="${node.width}" data-height="${node.height}" transform="translate(${node.x},${node.y})"><title>${escapeHtml(`${node.name}\n${node.entry}\n${relation}\nDouble-click to focus this function's call graph`)}</title><rect class="graph-focus-halo" x="-5" y="-5" width="${node.width + 10}" height="${node.height + 10}" rx="11"/><rect class="call-node-body" width="${node.width}" height="${node.height}" rx="8"/>${node.lines.map((line, index) => `<text x="${node.width / 2}" y="${titleBaseline + index * 18}" text-anchor="middle" class="node-title">${escapeHtml(line)}</text>`).join('')}${rootAddress}${controls}</g>`;
    }).join('');
    const overviewNodes = layout.nodes.map(node => `<rect class="${node.id === graph.root ? 'overview-root' : ''}" x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}"/>`).join('');
    const canvasHtml = `<div class="graph-wrap flow-canvas call-canvas" data-call-graph data-root="${escapeHtml(graph.root)}" tabindex="0" role="region" aria-label="Call graph canvas. Callers above, callees below. Wheel to zoom, drag to pan, or navigate the functions outline."><svg aria-hidden="true" focusable="false" data-width="${layout.width}" data-height="${layout.height}"><defs><marker id="call-arrow" markerUnits="userSpaceOnUse" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z"/></marker></defs><g class="graph-world">${edgeSvg}${nodeSvg}</g></svg><details class="call-overview" hidden><summary title="Hide overview">${callIcon('overview')}<span>Overview</span>${callIcon('close')}</summary><div class="call-overview-stage" tabindex="0" role="region" aria-label="Overview viewport. Click to move the viewport; arrow keys to pan."><svg id="call-overview-map" aria-hidden="true" focusable="false" viewBox="0 0 ${layout.width} ${layout.height}" preserveAspectRatio="xMidYMid meet"><g>${layout.edges.map(edge => `<path d="${path(edge)}"/>`).join('')}${overviewNodes}</g><rect id="call-overview-window"/></svg></div></details></div>`;
    const outlineModel: GraphOutlineModel = {
        kind: 'callGraph',
        heading: `Functions (${layout.nodes.length})`,
        items: layout.nodes.map(node => {
            const root = node.id === graph.root;
            const actions: OutlineAction[] = [{
                ...(root ? { id: 'action-decompile' } : {}),
                text: 'Decompile',
                labelDetail: node.name,
                labelSeparator: ' ',
                title: `Decompile ${node.name}`,
                leadingHtml: callIcon('decompile'),
                dataset: { 'outline-action': 'decompile', entry: node.entry, label: node.name, 'node-id': node.id },
            }];
            if (!root) {
                actions.push({
                    text: 'Focus',
                    labelDetail: node.name,
                    labelSeparator: ' ',
                    title: `Focus call graph on ${node.name}`,
                    leadingHtml: callIcon('focus'),
                    dataset: { 'outline-action': 'focusCallGraph', entry: node.entry, label: node.name, 'node-id': node.id },
                });
            }
            for (const direction of ['callers', 'callees'] as const) {
                const branch = node.branches?.[direction];
                if (!branch || branch.count === 0) { continue; }
                const verb = branch.expanded ? 'Collapse' : 'Expand';
                actions.push({
                    id: `call-branch-${encodeURIComponent(node.id)}-${direction}`,
                    className: 'graph-outline-branch',
                    text: `${verb} ${direction}`,
                    labelDetail: `of ${node.name}`,
                    labelSeparator: ' ',
                    title: `${verb} ${direction} of ${node.name}`,
                    expanded: branch.expanded,
                    dataset: { 'outline-action': 'branch', direction, entry: node.entry, 'node-id': node.id },
                });
            }
            const outgoing: OutlineEdgeItem[] = layout.edges.filter(edge => edge.from === node.id).map(edge => ({
                key: edgeKeyOf(edge),
                from: edge.from,
                to: edge.to,
                jumpNodeId: edge.to,
                kind: 'flow',
                text: `Calls ${functions.get(edge.to)}`,
                title: edge.sites.length ? `Call sites: ${edge.sites.join(', ')}` : 'Static call relationship',
            }));
            const incoming: OutlineEdgeItem[] = layout.edges.filter(edge => edge.to === node.id).map(edge => ({
                key: edgeKeyOf(edge),
                from: edge.from,
                to: edge.to,
                jumpNodeId: edge.from,
                kind: 'incoming',
                text: `Called by ${functions.get(edge.from)}`,
                title: edge.sites.length ? `Call sites: ${edge.sites.join(', ')}` : 'Static call relationship',
            }));
            return {
                id: node.id,
                title: node.name,
                badge: describeRelation(node, graph.root),
                address: node.entry,
                entry: node.entry,
                targetKind: 'function',
                meta: displayAddress(node.entry),
                actions,
                edges: [...outgoing, ...incoming],
            };
        }),
    };
    return renderGraphStage(outlineModel, canvasHtml);
}
