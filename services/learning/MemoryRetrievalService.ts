/**
 * Setup-aware retrieval for the trader notebook.
 *
 * Design (post-simplification pass, ROUND-24m):
 *  - ONE narrative voice: doctrine rides every stage; everything else is
 *    ranked data under a hard per-stage budget.
 *  - Diary is RAW STORAGE — never injected. It feeds doctrine rewrites and
 *    skill gates; the model sees its conclusions, not its journal.
 *  - Recurring-mistakes lines escalate into skills: once a skill owns a
 *    coin+direction cluster, the raw warning line goes quiet.
 *  - IF/THEN rules live INSIDE skills (candidate → confirmed by evidence);
 *    there is no separate rules injection path.
 *  - Similar-trade history is verdict-stage material (and `recall` tool).
 *
 * Pull-over-push: analysts/debaters who want more history call the `recall`
 * desk tool instead of receiving bigger prompts.
 */

import { LoggedTrade } from '../../types';
import { getMemoryFiles } from './MemoryFilesService';
import { readDoctrineForInjection } from './DoctrineConsolidationService';
import { findRelevantTrades } from './PatternMemorySynthesisService';
import {
    isSkillFile,
    parseSkillMarkdown,
    skillMatchesSetup,
    type SkillMeta,
} from './SkillMemoryService';
import {
    buildMemoryGraph,
    walkMemoryNeighbors,
    type MemoryRetrievalQuery,
    type WalkedMemoryHit,
} from './MemoryGraph';

export type { MemoryRetrievalQuery };

/** Hard per-stage budget for EVERYTHING except the doctrine slot. */
const STAGE_BUDGET_CHARS: Record<MemoryStage, number> = {
    opening: 900,
    rebuttal: 400,
    verdict: 600,
};
const DOCTRINE_SLOT_CHARS = 800;
const SKILL_BLOCK_MAX = 400;
const RISK_RULES_MAX = 300;
const MISTAKE_LINE_MAX = 200;

export interface RetrievedMemorySource {
    path: string;
    kind: 'identity' | 'skill' | 'playbook' | 'diary' | 'rules' | 'similar';
}

/**
 * Debate stage selector for retrieval budgeting.
 *   opening  — doctrine + best matched skill only (independent read)
 *   rebuttal — best matched skill only (tight counter-evidence)
 *   verdict  — doctrine + skills + similar trades (binding constraints)
 */
export type MemoryStage = 'opening' | 'rebuttal' | 'verdict';

const kindForHit = (hit: WalkedMemoryHit): RetrievedMemorySource['kind'] => {
    if (hit.node.kind === 'identity') return 'identity';
    if (hit.node.kind === 'skill') return 'skill';
    if (hit.node.path?.startsWith('trader-diary/')) return 'diary';
    if (hit.node.kind === 'rule' || hit.node.path?.startsWith('rules/')) return 'rules';
    return 'playbook';
};

/** Best matching enabled skill for this setup, ranked: confirmed first, then sample size. */
const bestMatchedSkill = (query?: MemoryRetrievalQuery): { file: ReturnType<typeof getMemoryFiles>['files'][number]; meta: SkillMeta } | null => {
    if (!query) return null;
    const setup = {
        coin: query.coin,
        direction: query.direction === 'Long' || query.direction === 'Short' ? query.direction : undefined,
        family: query.family,
        pattern: query.pattern,
        regime: typeof query.regime === 'string' ? query.regime : undefined,
    };
    const audience = (query as MemoryRetrievalQuery & { _audience?: 'analyst' | 'moderator' })._audience;
    void audience; // audience filtering happens in matchedSkillBlock
    const candidates: Array<{ file: ReturnType<typeof getMemoryFiles>['files'][number]; meta: SkillMeta }> = [];
    for (const file of getMemoryFiles().files) {
        if (!file.enabled || !isSkillFile(file)) continue;
        const meta = parseSkillMarkdown(file.content);
        if (!meta || meta.status === 'retired') continue;
        if (!skillMatchesSetup(meta, setup)) continue;
        candidates.push({ file, meta });
    }
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => {
        const statusRank = (s: SkillMeta['status']): number => (s === 'confirmed' ? 2 : s === 'candidate' ? 1 : 0);
        const sample = (m: SkillMeta): number => m.wins + m.losses;
        return statusRank(b.meta.status) - statusRank(a.meta.status) || sample(b.meta) - sample(a.meta);
    });
    return candidates[0];
};

/**
 * Doctrine block — the ONE narrative voice, fixed slot on every stage.
 */
const doctrineBlock = (): string => {
    try {
        const doctrine = readDoctrineForInjection();
        if (!doctrine) return '';
        const capped = doctrine.length > DOCTRINE_SLOT_CHARS
            ? `${doctrine.slice(0, DOCTRINE_SLOT_CHARS).trimEnd()}\n…`
            : doctrine;
        return `**My trading doctrine (settled beliefs):**\n${capped}`;
    } catch {
        return '';
    }
};

/** The single best-matched skill body, capped. */
/** Human-readable evidence freshness for a skill (Claude Code 'modified' pattern). */
const evidenceFreshness = (meta: SkillMeta): string => {
    if (!meta.lastEvidenceAt) return 'no counted evidence yet';
    const t = Date.parse(meta.lastEvidenceAt);
    if (!Number.isFinite(t)) return 'no counted evidence yet';
    const days = Math.floor((Date.now() - t) / 86_400_000);
    if (days <= 0) return 'evidence from today';
    if (days === 1) return 'evidence from yesterday';
    if (days <= 30) return `evidence ${days}d old`;
    if (days <= 90) return `evidence ${Math.floor(days / 7)}w old — treat as stale`;
    return 'evidence 3+ months old — stale, verify before relying on it';
};

/**
 * #4 invocation control (Agent Skills frontmatter port): `audience: analyst`
 * hides a skill from moderator-facing assembly, `audience: moderator` the
 * reverse. Default `all`.
 */
const skillAudience = (meta: SkillMeta): 'all' | 'analyst' | 'moderator' =>
    meta.audience ?? 'all';

const skillAllowedFor = (meta: SkillMeta, audience: 'analyst' | 'moderator'): boolean =>
    skillAudience(meta) === 'all' || skillAudience(meta) === audience;

/**
 * #5 dynamic context injection: skill bodies may reference ${SYMBOL} /
 * ${REGIME} / ${DIRECTION}; substituted with the live setup at assembly
 * time so the model reads facts, not placeholders.
 */
const substituteSkillContext = (text: string, query?: MemoryRetrievalQuery): string =>
    text
        .replace(/\$\{SYMBOL\}/g, (query?.coin ?? 'this coin').toUpperCase())
        .replace(/\$\{REGIME\}/g, (typeof query?.regime === 'string' && query.regime) || 'the current regime')
        .replace(/\$\{DIRECTION\}/g, (query?.direction === 'Long' || query?.direction === 'Short') ? query.direction : 'either direction');

/** One-line index entry (progressive disclosure tier 1 — near-zero tokens). */
const skillIndexLine = (name: string, meta: SkillMeta): string => {
    const rule = meta.ifCondition
        ? `IF ${meta.ifCondition} THEN ${meta.thenAction}`
        : meta.body.split('\n').find(l => l.trim())?.replace(/^#+\s*/, '').slice(0, 100) || name;
    return `${meta.kind === 'avoid' ? 'AVOID' : 'REPEAT'} [${meta.status} · ${meta.wins}W/${meta.losses}L · ${evidenceFreshness(meta)}] ${rule}`;
};

/**
 * Matched-skill block. Openings/rebuttals get the INDEX LINE only (tier 1);
 * verdicts get the full body (tier 2); recall serves the full body anytime.
 */
const matchedSkillBlock = (
    query?: MemoryRetrievalQuery,
    audience: 'analyst' | 'moderator' = 'analyst',
    stage: MemoryStage = 'opening',
): { text: string; meta: SkillMeta | null; name: string } => {
    const match = bestMatchedSkill(query);
    if (!match) return { text: '', meta: null, name: '' };
    if (!skillAllowedFor(match.meta, audience)) return { text: '', meta: null, name: '' };
    const header = `[skills/${match.file.name} · ${match.meta.status} · ${match.meta.wins}W/${match.meta.losses}L]`;
    if (stage !== 'verdict') {
        return { text: `${header}\n${skillIndexLine(match.file.name, match.meta)}`, meta: match.meta, name: match.file.name };
    }
    const titleBits = [match.meta.kind === 'avoid' ? 'Avoid' : 'Repeat', match.meta.coin, match.meta.direction]
        .filter(Boolean).join(' ');
    const body = substituteSkillContext(match.file.content.trim(), query);
    const capped = body.length > SKILL_BLOCK_MAX ? `${body.slice(0, SKILL_BLOCK_MAX).trimEnd()}\n…` : body;
    return {
        text: `${header}\n${evidenceFreshness(match.meta)}\n${titleBits}\n${capped}`,
        meta: match.meta,
        name: match.file.name,
    };
};

/**
 * Risk-rules excerpt — hard rules only (always-on identity file), capped tight.
 */
const riskRulesBlock = (): string => {
    const { files, folders } = getMemoryFiles();
    const folder = folders.find(f => f.name === 'rules');
    const file = files.find(f => f.folderId === folder?.id && f.name === 'risk-rules.md');
    if (!file?.enabled) return '';
    // Strip the instructional preamble — keep bullet lines only.
    const bullets = file.content.split('\n').filter(l => l.trim().startsWith('-')).slice(0, 6).join('\n');
    if (!bullets) return '';
    return cap(`[rules/risk-rules.md]\n${bullets}`, RISK_RULES_MAX);
};

/**
 * Identity slice — profile/memory.md ("About the Trader"), compact and
 * always-on. Who the model is: stats, preferences, style. Capped tight.
 */
const identityBlock = (): string => {
    const { files, folders } = getMemoryFiles();
    const folder = folders.find(f => f.name === 'profile');
    const file = files.find(f => f.folderId === folder?.id && f.name === 'memory.md');
    if (!file?.enabled) return '';
    const bullets = file.content.split('\n').filter(l => l.trim().startsWith('-')).slice(0, 7).join('\n');
    if (!bullets) return '';
    return cap(`[profile/memory.md]\n${bullets}`, 300);
};

/**
 * Recurring-mistakes line for a cluster ONLY when no enabled skill owns that
 * coin+direction. Escalation contract: mistake → skill created → line silent.
 */
const uncoveredMistakeLine = (query?: MemoryRetrievalQuery): string => {
    if (!query?.coin) return '';
    const { files, folders } = getMemoryFiles();
    const rulesFolder = folders.find(f => f.name === 'rules');
    const file = files.find(f => f.folderId === rulesFolder?.id && f.name === 'recurring-mistakes.md');
    if (!file?.enabled) return '';

    // Does an enabled skill already own this coin (+direction when set)?
    const setup = {
        coin: query.coin,
        direction: query.direction === 'Long' || query.direction === 'Short' ? query.direction : undefined,
    };
    const owned = getMemoryFiles().files.some(f => {
        if (!f.enabled || !isSkillFile(f)) return false;
        const meta = parseSkillMarkdown(f.content);
        if (!meta || meta.status === 'retired') return false;
        if ((meta.coin ?? '').toLowerCase() !== setup.coin.toLowerCase()) return false;
        if (setup.direction && meta.direction && meta.direction !== setup.direction) return false;
        return true;
    });
    if (owned) return ''; // skill owns it — raw warning would be a stale duplicate

    const line = file.content
        .split('\n')
        .find(l => l.includes(` ${setup.coin.toUpperCase()} `) || l.includes(`${setup.coin.toUpperCase()} `));
    if (!line) return '';
    return cap(`[rules/recurring-mistakes.md]\n${line.trim()}`, MISTAKE_LINE_MAX);
};

/** Similar closed trades — verdict-stage history (and the recall tool). */
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

const cap = (text: string, n: number): string =>
    text.length <= n ? text : `${text.slice(0, n).trimEnd()}\n…`;

export const listRetrievedMemorySources = (
    query?: MemoryRetrievalQuery,
    trades?: LoggedTrade[],
    audience: 'analyst' | 'moderator' = 'analyst',
): RetrievedMemorySource[] => {
    const out: RetrievedMemorySource[] = [];
    if (doctrineBlock()) out.push({ path: 'profile/doctrine', kind: 'identity' });
    if (identityBlock()) out.push({ path: 'profile/memory', kind: 'identity' });
    const skillMatch = matchedSkillBlock(query, audience);
    if (skillMatch.meta) out.push({ path: `skills/${skillMatch.name}`, kind: 'skill' });
    if (riskRulesBlock()) out.push({ path: 'rules/risk-rules', kind: 'rules' });
    if (uncoveredMistakeLine(query)) out.push({ path: 'rules/recurring-mistakes', kind: 'rules' });
    if (similarTradesBlock(query, trades)) out.push({ path: 'journal/similar-trades', kind: 'similar' });
    return out;
};

/**
 * Capped, setup-ranked harness context.
 *
 * Fill order per stage (budget enforced across all non-doctrine blocks):
 *   1. best matched skill   2. risk-rules excerpt   3. uncovered mistake line
 *   4. similar trades (verdict only)
 * Doctrine has its own always-on slot and does not count against the budget.
 */
export const getMemoryFilesContext = (
    query?: MemoryRetrievalQuery,
    trades?: LoggedTrade[],
    audience: 'analyst' | 'moderator' = 'analyst',
    stage: MemoryStage = 'opening',
): string => {
    void audience;
    const budget = STAGE_BUDGET_CHARS[stage];
    const blocks: string[] = [];
    let used = 0;

    const push = (block: string): void => {
        if (!block || used >= budget) return;
        const room = budget - used;
        blocks.push(cap(block, room));
        used += Math.min(block.length, room);
    };

    push(identityBlock());
    push(matchedSkillBlock(query, audience, stage).text);
    push(riskRulesBlock());
    push(uncoveredMistakeLine(query));
    if (stage === 'verdict') push(similarTradesBlock(query, trades));

    const doctrine = doctrineBlock();
    if (blocks.length === 0 && !doctrine) return '';

    const parts: string[] = [];
    if (doctrine) parts.push(doctrine);
    if (blocks.length > 0) parts.push(blocks.join('\n\n'));

    return `═══════════════════════════════════════════════════════════════
📓 MY MEMORY (doctrine + what matches THIS setup — not a blank slate)
═══════════════════════════════════════════════════════════════
Do not contradict a confirmed rule without strong new evidence. Need more
history? Call the recall tool with this setup's coin/topic.
═══════════════════════════════════════════════════════════════
${parts.join('\n\n---\n\n')}`;
};

// ─── recall tool (pull-over-push) ───────────────────────────────────────────

export interface RecallRequest {
    /** Free-text topic: usually the coin ("BTC"), optionally + direction/pattern. */
    topic: string;
}

/**
 * Handle a model-initiated `recall` desk-tool call: search the notebook the
 * way the retrieval layer does and hand back a compact digest — matched
 * skills (top 3, one-line each), similar closed trades, uncovered mistakes,
 * and the current doctrine header. Budget-capped like every other slice.
 */
export const handleRecallTool = (
    args: RecallRequest,
    trades?: LoggedTrade[],
): string => {
    const raw = (args.topic || '').trim();
    if (!raw) return JSON.stringify({ error: 'recall requires a topic, e.g. {"topic": "BTC long"}' });

    // Parse "BTC long" / "ETH short sweep" style topics into a query.
    const words = raw.toLowerCase().split(/\s+/);
    const direction = words.includes('long') ? 'Long' : words.includes('short') ? 'Short' : undefined;
    const coin = words.find(w => w !== 'long' && w !== 'short' && w.length >= 2)?.toUpperCase();
    const query: MemoryRetrievalQuery = {
        coin,
        direction: direction as MemoryRetrievalQuery['direction'],
        family: undefined,
        pattern: undefined,
    };

    const sections: string[] = [];

    const skillMatch = bestMatchedSkill(query);
    if (skillMatch) {
        // recall = pull tier: full procedure body with live substitutions.
        const body = substituteSkillContext(skillMatch.file.content.trim(), query);
        const capped = body.length > 700 ? `${body.slice(0, 700).trimEnd()}\n…` : body;
        sections.push(
            `SKILL ${skillMatch.meta.status.toUpperCase()} (${skillMatch.meta.wins}W/${skillMatch.meta.losses}L · ${evidenceFreshness(skillMatch.meta)}):\n${capped}`
        );
    }

    const mistakes = uncoveredMistakeLine(query);
    if (mistakes) sections.push(mistakes.replace(/^\[[^\]]+\]\n/, ''));

    const similar = similarTradesBlock(query, trades);
    if (similar) sections.push(similar);

    const doctrine = readDoctrineForInjection();
    if (doctrine) {
        const head = doctrine.split('\n').filter(l => l.trim()).slice(0, 3).join('\n');
        sections.push(`DOCTRINE (my settled beliefs):\n${head}`);
    }

    if (sections.length === 0) {
        return JSON.stringify({ result: `No notebook memory found for "${raw}".` });
    }
    const digest = sections.join('\n\n');
    return JSON.stringify({
        result: digest.length > MAX_TOOL_CONTENT_RECALL ? `${digest.slice(0, MAX_TOOL_CONTENT_RECALL)}\n…` : digest,
    });
};
const MAX_TOOL_CONTENT_RECALL = 1600;
