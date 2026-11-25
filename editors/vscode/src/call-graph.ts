// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

import { callIcon } from './call-graph-icons';
import { layoutLayeredGraph, LayoutPoint, MeasuredSize } from './graph-layout';
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
export interface PlacedCallNode extends CallNode {
    /** Horizontal position in graph pixels. */
    x: number;
    /** Vertical position in graph pixels. */
    y: number;
    /** Card width in CSS pixels. */
    width: number;
    /** Card height in CSS pixels. */
    height: number;
}

/** Call-graph edge with routed polyline bend points and SVG path. */
export interface PlacedCallEdge extends CallEdge {
    /** Stable edge index in the rendered edge list. */
    index: number;
    /** Orthogonal polyline points returned by ELK. */
    points: LayoutPoint[];
    /** Rounded orthogonal SVG path string. */
    path: string;
}

/** Positioned call-graph layout model returned by `layoutCalls`. */
export interface CallGraphLayout {
    /** Total graph width in pixels. */
    width: number;
    /** Total graph height in pixels. */
    height: number;
    /** Positioned function cards. */
    nodes: PlacedCallNode[];
    /** Routed orthogonal call edges. */
    edges: PlacedCallEdge[];
}

/** Maximum card width in CSS pixels before long function names wrap. */
const maxCallWidth = 340;
/** Estimate display column width for ASCII and wide characters. */
const columns = (text: string): number => [...text].reduce((n, ch) => n + (ch.charCodeAt(0) > 255 ? 2 : 1), 0);
/** Escape text and insert soft word-break hints after scope, template, and parameter delimiters. */
const breakableTitle = (text: string): string => escapeHtml(text).replace(/(::|&lt;|,|\()/g, '$1<wbr>');

/** Estimate fallback dimensions for one call-graph HTML card before DOM measurement. */
function estimateCallNodeSize(node: CallNode, root: boolean): MeasuredSize {
    const label = node.name || '(unnamed function)';
    const charWidth = root ? 8.8 : 8.1;
    const minWidth = root ? 240 : 210;
    const addressWidth = root ? columns(displayAddress(node.entry)) * 7.6 + 68 : 0;
    const rawWidth = Math.max(minWidth, addressWidth, columns(label) * charWidth + 68);
    const width = Math.min(maxCallWidth, Math.ceil(rawWidth));
    const usableCols = Math.max(14, Math.floor((width - 68) / charWidth));
    const lines = Math.max(1, Math.ceil(Math.max(1, columns(label)) / usableCols));
    const portCount = Number(Boolean(node.branches?.callers && node.branches.callers.count !== 0))
        + Number(Boolean(node.branches?.callees && node.branches.callees.count !== 0));
    const height = Math.max(48, 22 + lines * 20 + (root ? 36 : 0) + portCount * 24);
    return { width, height };
}

/** Compute a top-to-bottom orthogonal layout for function cards using estimated or measured sizes. */
export async function layoutCalls(
    graph: CallGraph,
    measured?: ReadonlyMap<string, MeasuredSize>,
): Promise<CallGraphLayout> {
    const ids = new Set(graph.nodes.map(node => node.id));
    const validEdges = graph.edges.filter(edge => ids.has(edge.from) && ids.has(edge.to));
    const result = await layoutLayeredGraph({
        id: 'calls',
        nodes: graph.nodes.map(node => ({ id: node.id, ...estimateCallNodeSize(node, node.id === graph.root) })),
        edges: validEdges.map((edge, index) => ({ id: String(index), from: edge.from, to: edge.to })),
        layoutOptions: {
            'elk.padding': '[top=36,left=32,bottom=36,right=32]',
            'elk.spacing.nodeNode': '38',
            'elk.layered.spacing.nodeNodeBetweenLayers': '88',
            'elk.spacing.edgeNode': '18',
            'elk.layered.spacing.edgeNodeBetweenLayers': '18',
            'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
            'elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED',
        },
        measured,
    });
    const placed = new Map(result.nodes.map(node => [node.id, node]));
    return {
        width: result.width,
        height: result.height,
        nodes: graph.nodes.map(node => {
            const box = placed.get(node.id)!;
            return { ...node, x: box.x, y: box.y, width: box.width, height: box.height };
        }),
        edges: result.edges.map(edge => {
            const index = Number(edge.id);
            const original = validEdges[index];
            return { ...original, index, points: edge.points, path: edge.path };
        }),
    };
}

/** Render the decorative non-color badge identifying the root function card. */
export const callRootBadge = (): string => '<span class="call-root-badge" aria-hidden="true">ROOT</span>';

/** Render one caller or callee branch toggle bar when the node has expandable peers. */
function renderBranchPort(node: CallNode, direction: CallDirection): string {
    const branch = node.branches?.[direction];
    if (!branch || branch.count === 0) {
        return '';
    }
    const label = `${branch.expanded ? 'Collapse' : 'Expand'} ${direction} of ${node.name}`;
    const restPath = branch.expanded ? 'M13 6 Q24 6 35 6' : 'M6 6 Q24 6 42 6';
    const glyph = `<svg class="branch-bar" width="48" height="12" viewBox="0 0 48 12" aria-hidden="true"><path class="branch-bar-path" d="${restPath}" fill="none" stroke="currentColor" stroke-linecap="round"/></svg>`;
    return `<div class="call-node-port call-node-controls node-${direction}"><button id="call-branch-${encodeURIComponent(node.id)}-${direction}" type="button" class="node-branch" data-direction="${direction}" aria-expanded="${branch.expanded}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">${glyph}</button></div>`;
}

/** Render the interactive HTML-card + SVG-edge call graph and overview map. */
export async function callGraph(
    graph: CallGraph,
    measured?: ReadonlyMap<string, MeasuredSize>,
): Promise<string> {
    const layout = await layoutCalls(graph, measured);
    const functions = new Map(graph.nodes.map(node => [node.id, node.name]));
    const edgeSvg = layout.edges.map(edge => `<g class="call-edge" tabindex="0" role="button" aria-pressed="false" aria-label="${escapeHtml(`${functions.get(edge.from)} calls ${functions.get(edge.to)}`)}" data-edge-index="${edge.index}" data-from="${escapeHtml(edge.from)}" data-to="${escapeHtml(edge.to)}"><path class="call-edge-hit" d="${edge.path}"/><path class="edge" d="${edge.path}" marker-end="url(#call-arrow)"/><title>${escapeHtml(edge.sites.length ? `Known static call sites: ${edge.sites.join(', ')}` : 'Static call relationship; call-site address not reported')}</title></g>`).join('');
    const nodeCards = layout.nodes.map(node => {
        const root = node.id === graph.root;
        const labelText = node.name || '(unnamed function)';
        const relation = root
            ? 'Current function'
            : node.callerDistance && node.calleeDistance
                ? 'Caller / callee'
                : node.callerDistance
                    ? `Caller · ${node.callerDistance} ${node.callerDistance === 1 ? 'level' : 'levels'}`
                    : `Callee · ${node.calleeDistance} ${node.calleeDistance === 1 ? 'level' : 'levels'}`;
        const rootBadge = root ? callRootBadge() : '';
        const rootAddress = root ? `<span class="node-subtitle call-root-address">${escapeHtml(displayAddress(node.entry))}</span>` : '';
        const action = `<div class="call-node-actions call-node-controls node-code"><button ${root ? 'id="action-decompile" ' : ''}type="button" class="node-decompile" data-node-action="decompile" aria-label="${escapeHtml(`Decompile ${labelText}`)}" title="${escapeHtml(`Decompile ${labelText}`)}">${callIcon('decompile')}</button></div>`;
        return `<div class="graph-node call-node${root ? ' is-root' : ''}" data-node="${escapeHtml(node.id)}" data-entry="${escapeHtml(node.entry)}" data-address="${escapeHtml(node.entry)}" data-kind="function" data-label="${escapeHtml(labelText)}" data-x="${node.x}" data-y="${node.y}" data-width="${node.width}" data-height="${node.height}" style="left:${node.x}px;top:${node.y}px" tabindex="0" role="group" aria-label="${escapeHtml(labelText)}" aria-description="${escapeHtml(`${relation}, ${node.entry}`)}" title="${escapeHtml(`${labelText}\n${node.entry}\n${relation}\nDouble-click or Enter to focus this function's call graph`)}">${renderBranchPort(node, 'callers')}<div class="call-node-main"><div class="call-node-copy">${rootBadge}<span class="node-title">${breakableTitle(labelText)}</span>${rootAddress}</div>${action}</div>${renderBranchPort(node, 'callees')}</div>`;
    }).join('');
    const overviewNodes = layout.nodes.map(node => `<rect data-map-node="${escapeHtml(node.id)}" class="${node.id === graph.root ? 'overview-root' : ''}" x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}"/>`).join('');
    return `<div class="graph-wrap flow-canvas call-canvas" data-call-graph data-root="${escapeHtml(graph.root)}" tabindex="0" role="region" aria-label="Call graph canvas. Callers above, callees below. Wheel to zoom, drag to pan, double-click a function to focus."><svg role="group" aria-label="Static call graph" data-width="${layout.width}" data-height="${layout.height}"><defs><marker id="call-arrow" markerUnits="userSpaceOnUse" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z"/></marker></defs><g class="graph-world">${edgeSvg}</g></svg><div class="graph-cards"><div class="graph-card-world">${nodeCards}</div></div><details class="call-overview" hidden><summary title="Hide overview">${callIcon('overview')}<span>Overview</span>${callIcon('close')}</summary><svg id="call-overview-map" viewBox="0 0 ${layout.width} ${layout.height}" preserveAspectRatio="xMidYMid meet" tabindex="0" role="button" aria-label="Graph overview. Click to move the viewport; arrow keys to pan."><g>${layout.edges.map(edge => `<path data-map-edge="${edge.index}" d="${edge.path}"/>`).join('')}${overviewNodes}</g><rect id="call-overview-window"/></svg></details></div>`;
}
