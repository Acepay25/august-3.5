/**
 * Setup-aware retrieval for the trader notebook.
 *
 * Walks the typed memory graph (setup → dimensions → skills/notes/trades)
 * instead of dumping every file that shares a keyword. Identity files are
 * always on. The full notebook and pattern-memory essay are not dumped.
 */

import { LoggedTrade } from '../../types';
import { getMemoryFiles, buildNotebookMapMarkdown } from './MemoryFilesService';
import { findRelevantTrades } from './PatternMemorySynthesisService';
import { isSkillFile, parseSkillMarkdown, skillMatchesSetup } from './SkillMemoryService';
import {
    buildMemoryGraph,
    matchingLearningRules,
    walkMemoryNeighbors,
    type MemoryRetrievalQuery,
    type WalkedMemoryHit,
} from './MemoryGraph';

export type { MemoryRetrievalQuery };

const MAX_CONTEXT_CHARS = 4500;
const MAX_FILE_CHARS = 900;
const MAX_DIARY_CHARS = 600;
const MAX_MAP_CHARS = 1400;
const ALWAYS_ON = new Set(['memory.md', 'risk-rules.md', 'recurring-mistakes.md']);

const cap = (text: string, n: number): string =>
    text.length <= n ? text : `${text.slice(0, n).trimEnd()}\n…`;

const folderOf = (fileId: string): string => {
    const { files, folders } = getMemoryFiles();
    const file = files.find(f => f.id === fileId);
    if (!file) return 'misc';
    return folders.find(f => f.id === file.folderId)?.name ?? 'misc';
};

const diaryExcerpt = (content: string): string => {
    const chunks = content.split('\n## ');
    if (chunks.length <= 1) return cap(content, MAX_DIARY_CHARS);
    const header = chunks[0];
    const last = chunks.slice(1).slice(-3);
    return cap(`${header}\n## ${last.join('\n## ')}`, MAX_DIARY_CHARS);
};

const skillCatalogBlock = (query?: MemoryRetrievalQuery): string => {
    const { files } = getMemoryFiles();
    const lines: string[] = [];
    for (const file of files) {
        if (!file.enabled || !isSkillFile(file)) continue;
        const meta = parseSkillMarkdown(file.content);
        if (!meta || meta.status === 'retired') continue;
        if (query && !skillMatchesSetup(meta, query) && meta.status !== 'confirmed') continue;
        const trigger = meta.body.split('\n').find(l => l.trim())?.replace(/^#+\s*/, '').trim().slice(0, 80) || file.name;
        lines.push(`- ${file.name.replace(/\.md$/i, '')} · ${meta.kind} · ${meta.status} · ${meta.wins}W/${meta.losses}L — ${trigger}`);
        if (lines.length >= 8) break;
    }
    return lines.length ? `**Skill catalog (preload matching skills into workers, not this prompt):**\n${lines.join('\n')}` : '';
};

const similarTradesBlock = (query: MemoryRetrievalQuery | undefined, trades?: LoggedTrade[]): string => {
    if (!trades || trades.length === 0 || !query) return '';
    const relevant = findRelevantTrades({
        coin: query.coin,
        direction: query.direction === 'Long' || query.direction === 'Short' ? query.direction : undefined,
        pattern: query.pattern,
        family: query.family,
        regime: query.regime as 'trending' | 'ranging' | 'volatile' | 'compression' | undefined,
    }, trades).slice(0, 5);
    if (relevant.length === 0) return '';
    const lines = relevant.map(t =>
        `- ${t.coin} ${t.direction} ${t.outcome} (${t.similarity}% similar)${t.keyLesson ? ` — ${t.keyLesson}` : ''}`
    );
    return `**Similar closed trades**\n${lines.join('\n')}`;
};

const rulesBlock = (query?: MemoryRetrievalQuery): string => {
    const rules = matchingLearningRules(query, 4);
    if (rules.length === 0) return '';
    const lines = rules.map(r => {
        const ev = typeof r.wins === 'number' || typeof r.losses === 'number'
            ? ` [${r.wins ?? 0}W/${r.losses ?? 0}L]`
            : '';
        return `- IF ${r.ifCondition} THEN ${r.thenAction}${ev}`;
    });
    return `**Matching rules**\n${lines.join('\n')}`;
};

export interface RetrievedMemorySource {
    path: string;
    kind: 'identity' | 'skill' | 'playbook' | 'diary' | 'rules' | 'similar';
}

const kindForHit = (hit: WalkedMemoryHit): RetrievedMemorySource['kind'] => {
    if (hit.node.kind === 'identity') return 'identity';
    if (hit.node.kind === 'skill') return 'skill';
    if (hit.node.path?.startsWith('trader-diary/')) return 'diary';
    if (hit.node.kind === 'rule' || hit.node.path?.startsWith('rules/')) return 'rules';
    return 'playbook';
};

const fileHits = (query?: MemoryRetrievalQuery, audience: 'analyst' | 'moderator' = 'analyst'): WalkedMemoryHit[] => {
    const graph = buildMemoryGraph(query, []);
    const walked = walkMemoryNeighbors(graph, query, audience);
    let skillsKept = 0;
    const out: WalkedMemoryHit[] = [];
    for (const hit of walked) {
        if (!hit.node.fileId) continue;
        if (hit.node.kind === 'skill') {
            if (audience === 'moderator') continue;
            if (skillsKept >= 2) continue;
            skillsKept += 1;
        }
        out.push(hit);
    }
    return out;
};

export const listRetrievedMemorySources = (
    query?: MemoryRetrievalQuery,
    trades?: LoggedTrade[],
    audience: 'analyst' | 'moderator' = 'analyst',
): RetrievedMemorySource[] => {
    const out: RetrievedMemorySource[] = fileHits(query, audience).map(hit => ({
        path: hit.node.path || hit.node.label,
        kind: kindForHit(hit),
    }));
    if (audience === 'moderator' && skillCatalogBlock(query)) {
        out.push({ path: 'skills/catalog', kind: 'skill' });
    }
    if (similarTradesBlock(query, trades)) {
        out.push({ path: 'journal/similar-trades', kind: 'similar' });
    }
    if (rulesBlock(query)) {
        out.push({ path: 'rules/if-then', kind: 'rules' });
    }
    return out;
};

/**
 * Capped, setup-aware harness context. Replaces dumping every notebook file.
 * `audience: 'moderator'` weaves a skill catalog (name, W/L, trigger) instead
 * of full skill bodies — analysts still get matching skill text.
 */
export const getMemoryFilesContext = (
    query?: MemoryRetrievalQuery,
    trades?: LoggedTrade[],
    audience: 'analyst' | 'moderator' = 'analyst',
): string => {
    const { files } = getMemoryFiles();
    const hits = fileHits(query, audience);

    if (hits.length === 0 && !trades?.length) {
        const mapOnly = cap(buildNotebookMapMarkdown(), MAX_MAP_CHARS);
        return mapOnly
            ? `═══════════════════════════════════════════════════════════════
📓 HARNESS MEMORY
═══════════════════════════════════════════════════════════════
${mapOnly}
═══════════════════════════════════════════════════════════════`
            : '';
    }

    const mapBlock = cap(buildNotebookMapMarkdown(), MAX_MAP_CHARS);
    const blocks: string[] = [];
    let used = mapBlock.length;
    for (const hit of hits) {
        if (used >= MAX_CONTEXT_CHARS) break;
        const file = files.find(f => f.id === hit.node.fileId);
        if (!file) continue;
        const folder = folderOf(file.id);
        let body = file.content.trim();
        if (folder === 'trader-diary') body = diaryExcerpt(body);
        else body = cap(body, ALWAYS_ON.has(file.name) ? 1600 : MAX_FILE_CHARS);
        const block = `[${folder}/${file.name}]\n${body}`;
        if (used + block.length > MAX_CONTEXT_CHARS) {
            blocks.push(cap(block, MAX_CONTEXT_CHARS - used));
            used = MAX_CONTEXT_CHARS;
            break;
        }
        blocks.push(block);
        used += block.length;
    }

    const extras = [
        audience === 'moderator' ? skillCatalogBlock(query) : '',
        similarTradesBlock(query, trades),
        rulesBlock(query),
    ].filter(Boolean);
    for (const extra of extras) {
        if (used >= MAX_CONTEXT_CHARS) break;
        const room = MAX_CONTEXT_CHARS - used;
        blocks.push(cap(extra, room));
        used += Math.min(extra.length, room);
    }

    if (blocks.length === 0 && !mapBlock) return '';

    return `═══════════════════════════════════════════════════════════════
📓 HARNESS MEMORY (notebook map + graph neighbors — not a blank slate)
═══════════════════════════════════════════════════════════════
Identity files always apply. ${audience === 'moderator' ? 'Skills are listed as a catalog only — do not paste full skill bodies here.' : 'Matching skill bodies apply when they match this coin, direction, or regime; otherwise ignore them.'} Do not contradict a matching confirmed skill without strong new evidence.

${[mapBlock, ...blocks].filter(Boolean).join('\n\n---\n\n')}
═══════════════════════════════════════════════════════════════`;
};
