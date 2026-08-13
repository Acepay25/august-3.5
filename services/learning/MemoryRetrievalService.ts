/**
 * Setup-aware retrieval for the trader notebook.
 *
 * Analysts and the moderator get a capped pack: always-on identity/rules,
 * matching skills, matching notes, similar closed trades, and scored IF/THEN
 * rules. The full notebook and pattern-memory essay are not dumped.
 */

import { LoggedTrade, MemoryFile } from '../../types';
import { getMemoryFiles, buildNotebookMapMarkdown } from './MemoryFilesService';
import { findRelevantTrades } from './PatternMemorySynthesisService';
import { getRelevantRules, loadLearningRules } from './LearningRulesService';
import { isSkillFile, parseSkillMarkdown, skillMatchesSetup } from './SkillMemoryService';

export interface MemoryRetrievalQuery {
    coin?: string;
    direction?: string;
    family?: string;
    pattern?: string;
    regime?: string;
}

const MAX_CONTEXT_CHARS = 4500;
const MAX_FILE_CHARS = 900;
const MAX_DIARY_CHARS = 600;
const MAX_MAP_CHARS = 1400;
const ALWAYS_ON = new Set(['memory.md', 'risk-rules.md', 'recurring-mistakes.md']);
const SKIP_FULL = new Set(['pattern-memory.md', 'suggestions.md', 'index.md']);

const cap = (text: string, n: number): string =>
    text.length <= n ? text : `${text.slice(0, n).trimEnd()}\n…`;

const folderOf = (file: MemoryFile): string =>
    getMemoryFiles().folders.find(f => f.id === file.folderId)?.name ?? 'misc';

const tokens = (query?: MemoryRetrievalQuery): string[] => {
    if (!query) return [];
    return [query.coin, query.direction, query.family, query.pattern, query.regime]
        .filter(Boolean)
        .map(s => String(s).toLowerCase());
};

const fileScore = (file: MemoryFile, query?: MemoryRetrievalQuery): number => {
    if (!file.enabled || !file.content.trim()) return -1;
    const name = file.name.toLowerCase();
    if (SKIP_FULL.has(name)) return -1;

    const folder = folderOf(file);
    if (file.name === 'memory.md') return 110;
    if (ALWAYS_ON.has(file.name)) return 100;

    if (folder === 'skills') {
        const meta = parseSkillMarkdown(file.content);
        if (!meta || meta.status === 'retired') return -1;
        if (!query) return meta.status === 'confirmed' ? 40 : -1;
        if (!skillMatchesSetup(meta, query)) return -1;
        return meta.status === 'confirmed' ? 90 : 70;
    }

    if (folder === 'trader-diary') {
        const coin = query?.coin?.toUpperCase().replace(/USDT?$/, '') || '';
        const fileCoin = file.name.replace(/\.md$/i, '').toUpperCase().replace(/USDT?$/, '');
        if (coin && fileCoin === coin) return 60;
        return -1;
    }

    if (file.name === 'recurring-mistakes.md') return 80;

    const hay = `${file.name}\n${file.content}`.toLowerCase();
    const t = tokens(query);
    if (t.length === 0) {
        if (folder === 'market-conditions') return 20;
        if (folder === 'rules') return 25;
        return folder === 'skills' ? -1 : 8;
    }
    let score = 0;
    for (const tok of t) {
        if (tok.length < 3) continue;
        if (hay.includes(tok)) score += 15;
    }
    return score > 0 ? score : -1;
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
    const setup: {
        coin?: string;
        direction?: 'Long' | 'Short';
        pattern?: string;
        family?: string;
        regime?: 'trending' | 'ranging' | 'volatile' | 'compression';
    } = {
        coin: query.coin,
        direction: query.direction === 'Long' || query.direction === 'Short' ? query.direction : undefined,
        pattern: query.pattern,
        family: query.family,
        regime: query.regime as 'trending' | 'ranging' | 'volatile' | 'compression' | undefined,
    };
    const relevant = findRelevantTrades(setup, trades).slice(0, 5);
    if (relevant.length === 0) return '';
    const lines = relevant.map(t =>
        `- ${t.coin} ${t.direction} ${t.outcome} (${t.similarity}% similar)${t.keyLesson ? ` — ${t.keyLesson}` : ''}`
    );
    return `**Similar closed trades**\n${lines.join('\n')}`;
};

const rulesBlock = (query?: MemoryRetrievalQuery): string => {
    const rules = getRelevantRules(loadLearningRules(), {
        coin: query?.coin,
        pattern: query?.family || query?.pattern,
        direction: query?.direction === 'Long' || query?.direction === 'Short' ? query.direction : undefined,
    }, 4);
    if (rules.length === 0) return '';
    const lines = rules.map(r => {
        const retired = (r as { status?: string }).status === 'retired';
        if (retired) return '';
        const ev = typeof r.wins === 'number' || typeof r.losses === 'number'
            ? ` [${r.wins ?? 0}W/${r.losses ?? 0}L]`
            : '';
        return `- IF ${r.ifCondition} THEN ${r.thenAction}${ev}`;
    }).filter(Boolean);
    return lines.length ? `**Matching rules**\n${lines.join('\n')}` : '';
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
    const ranked = files
        .map(f => ({ f, score: fileScore(f, query) }))
        .filter(x => x.score >= 0)
        .sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            const fa = getMemoryFiles().folders.find(x => x.id === a.f.folderId)?.order ?? 99;
            const fb = getMemoryFiles().folders.find(x => x.id === b.f.folderId)?.order ?? 99;
            return fa - fb;
        });

    if (ranked.length === 0 && !trades?.length) {
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
    let skillsKept = 0;
    for (const { f } of ranked) {
        if (used >= MAX_CONTEXT_CHARS) break;
        const folder = folderOf(f);
        if (folder === 'skills') {
            if (audience === 'moderator') continue;
            if (skillsKept >= 2) continue;
            skillsKept += 1;
        }
        let body = f.content.trim();
        if (folder === 'trader-diary') body = diaryExcerpt(body);
        else body = cap(body, ALWAYS_ON.has(f.name) ? 1600 : MAX_FILE_CHARS);
        const block = `[${folder}/${f.name}]\n${body}`;
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
📓 HARNESS MEMORY (notebook map + retrieved files — not a blank slate)
═══════════════════════════════════════════════════════════════
Identity files always apply. ${audience === 'moderator' ? 'Skills are listed as a catalog only — do not paste full skill bodies here.' : 'Matching skill bodies apply when they match this coin, direction, or regime; otherwise ignore them.'} Do not contradict a matching confirmed skill without strong new evidence.

${[mapBlock, ...blocks].filter(Boolean).join('\n\n---\n\n')}
═══════════════════════════════════════════════════════════════`;
};
