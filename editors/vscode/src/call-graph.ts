// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

import type { ElkNode } from 'elkjs/lib/elk.bundled.js';
import { callIcon } from './call-graph-icons';
import { layoutEngine, roundedOrthogonalPath } from './graph-layout';
import { displayAddress } from './names';
import { controlId } from './webview-focus';
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

/** Render the interactive SVG call graph and overview map. */
export async function callGraph(graph: CallGraph): Promise<string> {
    const layout = await layoutCalls(graph);
    const path = (edge: PlacedEdge): string => roundedOrthogonalPath(edge.points, 8);
    const functions = new Map(graph.nodes.map(node => [node.id, node.name]));
    const seenEdges = new Map<string, number>();
    const edgeSvg = layout.edges.map(edge => {
        const baseId = controlId('call-edge', edge.from, edge.to);
        const count = (seenEdges.get(baseId) || 0) + 1;
        seenEdges.set(baseId, count);
        const edgeId = count === 1 ? baseId : `${baseId}-${count}`;
        return `<g id="${edgeId}" class="call-edge" tabindex="0" role="button" aria-pressed="false" aria-label="${escapeHtml(`${functions.get(edge.from)} calls ${functions.get(edge.to)}`)}" data-edge-key="${escapeHtml(JSON.stringify([edge.from, edge.to]))}" data-from="${escapeHtml(edge.from)}" data-to="${escapeHtml(edge.to)}"><path class="call-edge-hit" d="${path(edge)}"/><path class="edge" d="${path(edge)}" marker-end="url(#call-arrow)"/><title>${escapeHtml(edge.sites.length ? `Known static call sites: ${edge.sites.join(', ')}` : 'Static call relationship; call-site address not reported')}</title></g>`;
    }).join('');
    const nodeSvg = layout.nodes.map(node => {
        const root = node.id === graph.root;
        const relation = root ? 'Current function' : node.callerDistance && node.calleeDistance ? 'Caller / callee' : node.callerDistance ? `Caller · ${node.callerDistance} ${node.callerDistance === 1 ? 'level' : 'levels'}` : `Callee · ${node.calleeDistance} ${node.calleeDistance === 1 ? 'level' : 'levels'}`;
        const html = (x: number, y: number, width: number, height: number, body: string, extra = ''): string => `<foreignObject class="call-node-controls ${extra}" x="${x}" y="${y}" width="${width}" height="${height}"><div xmlns="http://www.w3.org/1999/xhtml" class="node-control-content">${body}</div></foreignObject>`;
        const action = `<button id="${root ? 'action-decompile' : controlId('call-decompile', node.id)}" class="node-decompile" data-node-action="decompile" aria-label="${escapeHtml(`Decompile ${node.name}`)}" title="${escapeHtml(`Decompile ${node.name}`)}">${callIcon('decompile')}</button>`;
        const ports = (['callers', 'callees'] as const).map(direction => {
            const branch = node.branches?.[direction]; if (!branch || branch.count === 0) { return ''; }
            const label = `${branch.expanded ? 'Collapse' : 'Expand'} ${direction} of ${node.name}`;
            const portX = Math.round(node.width / 2 - 26);
            const portY = direction === 'callers' ? 0 : node.height - 12;
            const restPath = branch.expanded ? 'M13 6 Q24 6 35 6' : 'M6 6 Q24 6 42 6';
            const glyph = `<svg class="branch-bar" width="48" height="12" viewBox="0 0 48 12" aria-hidden="true"><path class="branch-bar-path" d="${restPath}" fill="none" stroke="currentColor" stroke-linecap="round"/></svg>`;
            return html(portX, portY, 52, 12, `<button id="call-branch-${encodeURIComponent(node.id)}-${direction}" class="node-branch" data-direction="${direction}" aria-expanded="${branch.expanded}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">${glyph}</button>`, `node-${direction}`);
        }).join('');
        const blockHeight = node.lines.length * 18 + (root ? 18 : 0);
        const titleBaseline = Math.round((node.height - blockHeight) / 2 + 14);
        const rootAddress = root ? `<text x="${node.width / 2}" y="${titleBaseline + (node.lines.length - 1) * 18 + 19}" text-anchor="middle" class="node-subtitle call-root-address">${escapeHtml(displayAddress(node.entry))}</text>` : '';
        const controls = html(node.width - 34, Math.round(node.height / 2 - 14), 28, 28, action, 'node-code') + ports;
        return `<g id="${controlId('call-node', node.id)}" class="graph-node call-node${root ? ' is-root' : ''}" data-node="${escapeHtml(node.id)}" data-entry="${escapeHtml(node.entry)}" data-address="${escapeHtml(node.entry)}" data-kind="function" data-label="${escapeHtml(node.name)}" data-x="${node.x}" data-y="${node.y}" data-width="${node.width}" data-height="${node.height}" transform="translate(${node.x},${node.y})" tabindex="0" role="group" aria-label="${escapeHtml(node.name)}" aria-description="${escapeHtml(`${relation}, ${node.entry}`)}"><title>${escapeHtml(`${node.name}\n${node.entry}\n${relation}\nDouble-click or Enter to focus this function's call graph`)}</title><rect class="call-node-body" width="${node.width}" height="${node.height}" rx="8"/>${node.lines.map((line, index) => `<text x="${node.width / 2}" y="${titleBaseline + index * 18}" text-anchor="middle" class="node-title">${escapeHtml(line)}</text>`).join('')}${rootAddress}${controls}</g>`;
    }).join('');
    const overviewNodes = layout.nodes.map(node => `<rect class="${node.id === graph.root ? 'overview-root' : ''}" x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}"/>`).join('');
    return `<div id="call-canvas" class="graph-wrap flow-canvas call-canvas" data-call-graph data-root="${escapeHtml(graph.root)}" tabindex="0" role="region" aria-label="Call graph canvas. Callers above, callees below. Wheel to zoom, drag to pan, double-click a function to focus."><svg role="group" aria-label="Static call graph" data-width="${layout.width}" data-height="${layout.height}"><defs><marker id="call-arrow" markerUnits="userSpaceOnUse" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z"/></marker></defs><g class="graph-world">${edgeSvg}${nodeSvg}</g></svg><details id="call-overview" class="call-overview" hidden><summary id="call-overview-summary" title="Hide overview">${callIcon('overview')}<span>Overview</span>${callIcon('close')}</summary><svg id="call-overview-map" viewBox="0 0 ${layout.width} ${layout.height}" preserveAspectRatio="xMidYMid meet" tabindex="0" role="button" aria-label="Graph overview. Click to move the viewport; arrow keys to pan."><g>${layout.edges.map(edge => `<path d="${path(edge)}"/>`).join('')}${overviewNodes}</g><rect id="call-overview-window"/></svg></details></div>`;
}
