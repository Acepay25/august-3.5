/**
 * Typed memory graph for retrieval.
 *
 * Nodes: setup, trade, rootCause, skill, rule, note, identity.
 * Edges: hasDim / appliesWhen (setup attributes), outcome (trade → cause),
 * admits (cause → skill, technical only), evidence (skill ↔ trade).
 *
 * Retrieval walks neighbors of the current setup instead of dumping every
 * notebook file that shares a keyword.
 */

import { LoggedTrade, MemoryFile, RootCauseClass } from '../../types';
import { getMemoryFiles } from './MemoryFilesService';
import { isSkillFile, parseSkillMarkdown, skillMatchesSetup, SkillMeta } from './SkillMemoryService';
import { shouldAdmitTechnicalStrategyRule, rootCauseForTrade } from '../../utils/rootCause';
import { findRelevantTrades } from './PatternMemorySynthesisService';

export interface MemoryRetrievalQuery {
    coin?: string;
    direction?: string;
    family?: string;
    pattern?: string;
    regime?: string;
}

export type MemoryNodeKind = 'setup' | 'trade' | 'rootCause' | 'skill' | 'rule' | 'note' | 'identity';
export type MemoryEdgeKind = 'hasDim' | 'appliesWhen' | 'outcome' | 'admits' | 'evidence' | 'similarTo';

export interface MemoryNode {
    id: string;
    kind: MemoryNodeKind;
    label: string;
    path?: string;
    fileId?: string;
    tradeId?: string;
}

export interface MemoryEdge {
    from: string;
    to: string;
    kind: MemoryEdgeKind;
    weight: number;
}

export interface MemoryGraph {
    nodes: Map<string, MemoryNode>;
    edges: MemoryEdge[];
}

export interface WalkedMemoryHit {
    node: MemoryNode;
    score: number;
    via: MemoryEdgeKind[];
}

const ALWAYS_ON = new Set(['memory.md', 'risk-rules.md', 'recurring-mistakes.md']);
const SKIP_FULL = new Set(['pattern-memory.md', 'suggestions.md', 'index.md']);

const folderOf = (file: MemoryFile): string =>
    getMemoryFiles().folders.find(f => f.id === file.folderId)?.name ?? 'misc';

export const normalizeCoin = (coin?: string): string =>
    (coin || '').toUpperCase().replace(/USDT?$/, '');

const dimId = (kind: string, value: string): string =>
    `dim:${kind}:${value.trim().toLowerCase()}`;

const addNode = (graph: MemoryGraph, node: MemoryNode): void => {
    if (!graph.nodes.has(node.id)) graph.nodes.set(node.id, node);
};

const addEdge = (graph: MemoryGraph, edge: MemoryEdge): void => {
    graph.edges.push(edge);
};

const pickFrontmatter = (content: string, key: string): string | undefined => {
    const match = content.match(new RegExp(`^${key}:\\s*(.+)$`, 'mi'));
    const value = match?.[1]?.trim();
    return value && value !== 'undefined' ? value : undefined;
};

const dimsFromQuery = (query?: MemoryRetrievalQuery): string[] => {
    if (!query) return [];
    const dims: string[] = [];
    const coin = normalizeCoin(query.coin);
    if (coin) dims.push(dimId('coin', coin));
    if (query.direction) dims.push(dimId('direction', query.direction));
    const family = (query.family || query.pattern || '').trim();
    if (family) dims.push(dimId('family', family));
    if (query.regime) dims.push(dimId('regime', query.regime));
    return dims;
};

const dimsFromSkill = (meta: SkillMeta): string[] => {
    const dims: string[] = [];
    const coin = normalizeCoin(meta.coin);
    if (coin) dims.push(dimId('coin', coin));
    if (meta.direction) dims.push(dimId('direction', meta.direction));
    if (meta.family) dims.push(dimId('family', meta.family));
    if (meta.regime) dims.push(dimId('regime', meta.regime));
    return dims;
};

const dimsFromNote = (file: MemoryFile, folder: string): string[] => {
    const dims: string[] = [];
    const coin = normalizeCoin(pickFrontmatter(file.content, 'coin') || (folder === 'trader-diary' ? file.name.replace(/\.md$/i, '') : ''));
    if (coin) dims.push(dimId('coin', coin));
    const direction = pickFrontmatter(file.content, 'direction');
    if (direction) dims.push(dimId('direction', direction));
    const family = pickFrontmatter(file.content, 'family');
    if (family) dims.push(dimId('family', family));
    const regime = pickFrontmatter(file.content, 'regime');
    if (regime) dims.push(dimId('regime', regime));
    if (/ranging/i.test(file.name)) dims.push(dimId('regime', 'ranging'));
    if (/sweep|liquidity/i.test(file.name)) dims.push(dimId('regime', 'sweep'));
    return [...new Set(dims)];
};

const causeId = (cause: RootCauseClass): string => `cause:${cause}`;

/**
 * Build the in-memory graph for this setup from notebook files, skills,
 * closed trades, and IF/THEN rules.
 */
export const buildMemoryGraph = (
    query?: MemoryRetrievalQuery,
    trades: LoggedTrade[] = [],
): MemoryGraph => {
    const graph: MemoryGraph = { nodes: new Map(), edges: [] };
    const { files } = getMemoryFiles();
    const setupId = 'setup:current';
    addNode(graph, { id: setupId, kind: 'setup', label: 'current setup' });
    for (const dim of dimsFromQuery(query)) {
        addNode(graph, { id: dim, kind: 'setup', label: dim });
        addEdge(graph, { from: setupId, to: dim, kind: 'hasDim', weight: 1 });
    }

    for (const cause of ['SETUP_EDGE_FAILURE', 'EXECUTION_ERROR', 'MACRO_SHOCK', 'UNCLEAR'] as RootCauseClass[]) {
        addNode(graph, { id: causeId(cause), kind: 'rootCause', label: cause });
    }

    for (const file of files) {
        if (!file.enabled || !file.content.trim()) continue;
        const name = file.name.toLowerCase();
        if (SKIP_FULL.has(name)) continue;
        const folder = folderOf(file);
        const path = `${folder}/${file.name}`;

        if (ALWAYS_ON.has(file.name) || file.name === 'memory.md') {
            addNode(graph, { id: `file:${file.id}`, kind: 'identity', label: file.name, path, fileId: file.id });
            continue;
        }

        if (folder === 'skills' && isSkillFile(file)) {
            const meta = parseSkillMarkdown(file.content);
            if (!meta || meta.status === 'retired') continue;
            const id = `skill:${file.id}`;
            addNode(graph, { id, kind: 'skill', label: file.name, path, fileId: file.id });
            for (const dim of dimsFromSkill(meta)) {
                addNode(graph, { id: dim, kind: 'setup', label: dim });
                addEdge(graph, { from: id, to: dim, kind: 'appliesWhen', weight: meta.status === 'confirmed' ? 2 : 1 });
            }
            const cause = meta.kind === 'avoid' || meta.kind === 'repeat' ? 'SETUP_EDGE_FAILURE' : 'UNCLEAR';
            addEdge(graph, { from: causeId(cause), to: id, kind: 'admits', weight: 1 });
            for (const tradeId of meta.tradeIds) {
                addEdge(graph, { from: id, to: `trade:${tradeId}`, kind: 'evidence', weight: 1 });
            }
            continue;
        }

        const kind: MemoryNodeKind = folder === 'trader-diary' ? 'note' : folder === 'rules' ? 'rule' : 'note';
        const id = `file:${file.id}`;
        addNode(graph, { id, kind, label: file.name, path, fileId: file.id });
        for (const dim of dimsFromNote(file, folder)) {
            addNode(graph, { id: dim, kind: 'setup', label: dim });
            addEdge(graph, { from: id, to: dim, kind: 'appliesWhen', weight: 1 });
        }
    }

    for (const trade of trades) {
        const id = `trade:${trade.id}`;
        addNode(graph, {
            id,
            kind: 'trade',
            label: `${trade.analysis?.coinName || ''} ${trade.outcome}`,
            tradeId: trade.id,
        });
        const cause = rootCauseForTrade(trade);
        addEdge(graph, { from: id, to: causeId(cause), kind: 'outcome', weight: 1 });
        const coin = normalizeCoin(trade.analysis?.coinName);
        if (coin) {
            const dim = dimId('coin', coin);
            addNode(graph, { id: dim, kind: 'setup', label: dim });
            addEdge(graph, { from: id, to: dim, kind: 'appliesWhen', weight: 1 });
        }
        if (shouldAdmitTechnicalStrategyRule(cause)) {
            addEdge(graph, { from: causeId(cause), to: id, kind: 'admits', weight: 1 });
        }
    }

    if (query && trades.length > 0) {
        const similar = findRelevantTrades({
            coin: query.coin,
            direction: query.direction === 'Long' || query.direction === 'Short' ? query.direction : undefined,
            pattern: query.pattern,
            family: query.family,
            regime: query.regime as 'trending' | 'ranging' | 'volatile' | 'compression' | undefined,
        }, trades).slice(0, 5);
        for (const row of similar) {
            // Edge decay (ROUND-26): older associations weigh less — a 90-day-old
            // trade keeps at most ~50% of its similarity influence, a year old
            // nearly none. Stale associations stop surfacing without deletion.
            const t = trades.find(x => x.id === row.tradeId);
            const ageDays = t?.timestamp ? Math.max(0, (Date.now() - Date.parse(t.timestamp)) / 86_400_000) : 0;
            const decay = Math.exp(-ageDays / 120); // 120-day half-life-ish
            addEdge(graph, { from: setupId, to: `trade:${row.tradeId}`, kind: 'similarTo', weight: (row.similarity / 100) * decay });
        }
    }

    // Legacy IF/THEN rules are no longer graph nodes (ROUND-25): lessons
    // live in skills. The rules store remains read-only history for outcome
    // attribution only.
    return graph;
};

const sharedDims = (graph: MemoryGraph, nodeId: string, setupDims: Set<string>): string[] =>
    graph.edges
        .filter(e => e.from === nodeId && e.kind === 'appliesWhen' && setupDims.has(e.to))
        .map(e => e.to);

/**
 * Walk from the current setup along hasDim → appliesWhen (and similar trades).
 * Identity nodes are always included. Skills still need a real setup match.
 */
export const walkMemoryNeighbors = (
    graph: MemoryGraph,
    query?: MemoryRetrievalQuery,
    audience: 'analyst' | 'moderator' = 'analyst',
): WalkedMemoryHit[] => {
    const setupDims = new Set(dimsFromQuery(query));
    const hits = new Map<string, WalkedMemoryHit>();

    const keep = (node: MemoryNode, score: number, via: MemoryEdgeKind[]): void => {
        const prev = hits.get(node.id);
        if (!prev || score > prev.score) hits.set(node.id, { node, score, via });
    };

    for (const node of graph.nodes.values()) {
        if (node.kind === 'identity') {
            const name = node.label.toLowerCase();
            keep(node, name === 'memory.md' ? 1100 : 1000, []);
        }
    }

    if (setupDims.size === 0) {
        for (const node of graph.nodes.values()) {
            if (node.kind === 'rule' && node.path?.startsWith('rules/') && node.fileId) keep(node, 120, []);
            if (node.kind === 'note' && node.path?.startsWith('market-conditions/')) keep(node, 80, []);
        }
        return [...hits.values()].sort((a, b) => b.score - a.score);
    }

    const { files } = getMemoryFiles();
    const fileById = (id?: string): MemoryFile | undefined => files.find(f => f.id === id);

    for (const node of graph.nodes.values()) {
        if (node.kind === 'skill') {
            if (audience === 'moderator') continue;
            const file = fileById(node.fileId);
            const meta = file ? parseSkillMarkdown(file.content) : null;
            if (!meta) continue;
            const overlap = sharedDims(graph, node.id, setupDims);
            if (overlap.length === 0) continue;
            if (!skillMatchesSetup(meta, query || {})) continue;
            keep(node, meta.status === 'confirmed' ? 900 : 800, ['appliesWhen']);
            continue;
        }
        if (node.kind === 'note' || (node.kind === 'rule' && node.fileId)) {
            const overlap = sharedDims(graph, node.id, setupDims);
            if (overlap.length === 0) continue;
            const diary = node.path?.startsWith('trader-diary/') ? 700 : 500;
            keep(node, diary + overlap.length * 20, ['appliesWhen']);
        }
    }

    for (const edge of graph.edges) {
        if (edge.kind !== 'similarTo') continue;
        const trade = graph.nodes.get(edge.to);
        if (trade) keep(trade, 400 + Math.round(edge.weight * 100), ['similarTo']);
    }

    return [...hits.values()].sort((a, b) => b.score - a.score);
};


