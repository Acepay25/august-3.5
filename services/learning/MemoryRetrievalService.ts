/**
 * Setup-aware retrieval for the trader notebook.
 *
 * Design:
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
/** Extra matched skills surfaced as index lines at verdict depth (on top of #1). */
const VERDICT_EXTRA_SKILLS = 2;

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

/** Enabled, non-retired skills matching this setup, ranked by graph score:
 *  status weight × setup-dimension overlap × evidence freshness decay
 *  (the memory graph's semantics now drive production retrieval,
 *  not just the dashboard — with the M3 reconciliation that moderators see
 *  matched skills at index tier rather than being excluded entirely). */
const rankedMatchedSkills = (
    query?: MemoryRetrievalQuery,
    audience?: 'analyst' | 'moderator',
): Array<{ file: ReturnType<typeof getMemoryFiles>['files'][number]; meta: SkillMeta; score: number }> => {
    if (!query) return [];
    const setup = {
        coin: query.coin,
        direction: query.direction === 'Long' || query.direction === 'Short' ? query.direction : undefined,
        family: query.family,
        pattern: query.pattern,
        regime: typeof query.regime === 'string' ? query.regime : undefined,
    };
    const candidates: Array<{ file: ReturnType<typeof getMemoryFiles>['files'][number]; meta: SkillMeta; score: number }> = [];
    for (const file of getMemoryFiles().files) {
        if (!file.enabled || !isSkillFile(file)) continue;
        const meta = parseSkillMarkdown(file.content);
        if (!meta || meta.status === 'retired') continue;
        if (!skillMatchesSetup(meta, setup)) continue;
        // Audience filtering happens BEFORE ranking (#4 invocation control): a
        // blocked best-match must surface the second-best skill, not an empty slot.
        if (audience && !skillAllowedFor(meta, audience)) continue;
        // Zero-evidence skills stay OUT of prompt injection.
        // A 0W/0L draft is an unproven hunch; injecting it gave the model no
        // basis to weigh it against — and contradicted the dashboard's own
        // "stays unenforced until it earns a record" message. The recall tool
        // still serves the full body when a model asks explicitly.
        if ((meta.wins + meta.losses) === 0) continue;
        // Graph score: status weight (confirmed 2 / candidate 1)
        // × dimension overlap count × evidence-freshness decay. Mirrors the
        // appliesWhen weights the dashboard graph assigns, so the two views
        // can never disagree about what matters.
        const statusWeight = meta.status === 'confirmed' ? 2 : 1;
        const overlap = dimsOverlap(meta, query);
        const score = statusWeight * overlap * evidenceDecay(meta);
        candidates.push({ file, meta, score });
    }
    candidates.sort((a, b) => b.score - a.score || (b.meta.wins + b.meta.losses) - (a.meta.wins + a.meta.losses));
    return candidates;
};

/** Count shared setup dimensions between a skill and the current query. */
const dimsOverlap = (meta: SkillMeta, query: MemoryRetrievalQuery): number => {
    let n = 0;
    const coin = (query.coin || '').toUpperCase().replace(/USDT?$/, '');
    const skillCoin = (meta.coin || '').toUpperCase().replace(/USDT?$/, '');
    if (coin && skillCoin && coin === skillCoin) n += 1;
    if (query.direction && meta.direction && query.direction === meta.direction) n += 1;
    if ((query.family || query.pattern) && meta.family && (query.family === meta.family)) n += 1;
    if (query.regime && meta.regime && String(query.regime) === meta.regime) n += 1;
    return Math.max(n, 0.5); // a bare trigger match still scores, just low
};

/** Evidence-age decay for scoring — same 120-day constant as MemoryGraph. */
const evidenceDecay = (meta: SkillMeta): number => {
    if (!meta.lastEvidenceAt) return 0.75;
    const t = Date.parse(meta.lastEvidenceAt);
    if (!Number.isFinite(t)) return 0.75;
    const ageDays = Math.max(0, (Date.now() - t) / 86_400_000);
    return Math.exp(-ageDays / 120);
};

const bestMatchedSkill = (
    query?: MemoryRetrievalQuery,
    audience?: 'analyst' | 'moderator',
): { file: ReturnType<typeof getMemoryFiles>['files'][number]; meta: SkillMeta } | null =>
    rankedMatchedSkills(query, audience)[0] ?? null;

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
/** Human-readable evidence freshness for a skill (relative-time label). */
export const evidenceFreshness = (meta: SkillMeta): string => {
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
export const substituteSkillContext = (text: string, query?: MemoryRetrievalQuery): string =>
    text
        .replace(/\$\{SYMBOL\}/g, (query?.coin ?? 'this coin').toUpperCase())
        .replace(/\$\{REGIME\}/g, (typeof query?.regime === 'string' && query.regime) || 'the current regime')
        .replace(/\$\{DIRECTION\}/g, (query?.direction === 'Long' || query?.direction === 'Short') ? query.direction : 'either direction');

/** One-line index entry (progressive disclosure tier 1 — near-zero tokens). */
const skillIndexLine = (name: string, meta: SkillMeta): string => {
    const rule = meta.ifCondition
        ? `IF ${meta.ifCondition} THEN ${meta.thenAction}`
        : meta.body.split('\n').find(l => l.trim())?.replace(/^#+\s*/, '').slice(0, 100) || name;
    return `${meta.kind === 'avoid' ? 'AVOID' : 'REPEAT'} [${meta.status} · ${Math.round(meta.wins)}W/${Math.round(meta.losses)}L · ${evidenceFreshness(meta)}] ${rule}`;
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
    const match = bestMatchedSkill(query, audience);
    if (!match) return { text: '', meta: null, name: '' };
    const header = `[skills/${match.file.name} · ${match.meta.status} · ${Math.round(match.meta.wins)}W/${Math.round(match.meta.losses)}L]`;
    if (stage !== 'verdict') {
        return { text: `${header}\n${skillIndexLine(match.file.name, match.meta)}`, meta: match.meta, name: match.file.name };
    }
    const titleBits = [match.meta.kind === 'avoid' ? 'Avoid' : 'Repeat', match.meta.coin, match.meta.direction]
        .filter(Boolean).join(' ');
    const body = substituteSkillContext(match.file.content.trim(), query);
    const capped = body.length > SKILL_BLOCK_MAX ? `${body.slice(0, SKILL_BLOCK_MAX).trimEnd()}\n…` : body;
    // Provenance: how many logged trades
    // shaped this rule — from the monotonic evidence counter, not the
    // tail-20 tradeIds list.
    const provenance = (match.meta.evidenceCount ?? match.meta.tradeIds.length) > 0
        ? `learned from ${match.meta.evidenceCount ?? match.meta.tradeIds.length} logged trade(s)`
        : '';
    return {
        text: `${header}\n${[evidenceFreshness(match.meta), provenance].filter(Boolean).join(' · ')}\n${titleBits}\n${capped}`,
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

/**
 * Avoid-vs-repeat conflict flag: when BOTH kinds of enabled skill match this
 * exact setup, say so instead of silently letting sample size pick a winner.
 * One line, verdict-stage only — where the full bodies are actually shown.
 */
const conflictNote = (query?: MemoryRetrievalQuery): string => {
    if (!query) return '';
    const setup = {
        coin: query.coin,
        direction: query.direction === 'Long' || query.direction === 'Short' ? query.direction : undefined,
        family: query.family,
        pattern: query.pattern,
        regime: typeof query.regime === 'string' ? query.regime : undefined,
    };
    let avoid = false;
    let repeat = false;
    for (const file of getMemoryFiles().files) {
        if (!file.enabled || !isSkillFile(file)) continue;
        const meta = parseSkillMarkdown(file.content);
        if (!meta || meta.status === 'retired') continue;
        if (!skillMatchesSetup(meta, setup)) continue;
        if (meta.kind === 'avoid') avoid = true; else repeat = true;
        if (avoid && repeat) break;
    }
    if (!(avoid && repeat)) return '';
    return '[notebook conflict] Both an AVOID and a REPEAT skill match this setup and they disagree — resolve against doctrine and evidence freshness rather than habit.';
};

/** Similar closed trades — verdict-stage history (and the recall tool). */
const similarTradesBlock = (query: MemoryRetrievalQuery | undefined, trades?: LoggedTrade[]): string => {
    if (!trades || trades.length === 0 || !query) return '';
    // Age-decayed similarity — old associations weigh less in
    // prompts, honoring the edge-decay contract end to end.
    const relevant = findRelevantTrades({
        coin: query.coin,
        direction: query.direction === 'Long' || query.direction === 'Short' ? query.direction : undefined,
        pattern: query.pattern,
        family: query.family,
        regime: query.regime as 'trending' | 'ranging' | 'volatile' | 'compression' | undefined,
    }, trades, { decayByAge: true }).slice(0, 5);
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
export interface MemoryContextOptions {
    /** Exclude one skill (file stem) from matching —
     *  used by the A/B eval so the "baseline minus skill" arm genuinely
     *  omits the skill under test. */
    excludeSkillName?: string;
    /** Skip recordMemoryInjection — synthetic contexts
     *  (A/B evals) must not pollute the attribution telemetry that
     *  applySkillEvidence trusts for credit-granting windows. */
    recordInjections?: boolean;
}

export const getMemoryFilesContext = (
    query?: MemoryRetrievalQuery,
    trades?: LoggedTrade[],
    audience: 'analyst' | 'moderator' = 'analyst',
    stage: MemoryStage = 'opening',
    options?: MemoryContextOptions,
): string => {
    const budget = STAGE_BUDGET_CHARS[stage];
    const blocks: string[] = [];
    /** What ACTUALLY made it into the prompt — recorded for attribution. */
    const injected: Array<{ path: string; kind: string }> = [];
    let used = 0;

    const push = (block: string): boolean => {
        if (!block || used >= budget) return false;
        const room = budget - used;
        blocks.push(cap(block, room));
        used += Math.min(block.length, room);
        return true;
    };

    const exclude = options?.excludeSkillName?.toLowerCase().replace(/\.md$/i, '');
    if (push(identityBlock())) injected.push({ path: 'profile/memory', kind: 'identity' });
    if (stage === 'verdict') push(conflictNote(query)); // a flag, not a notebook source
    const primary = (() => {
        if (!exclude) return matchedSkillBlock(query, audience, stage);
        const firstNonExcluded = rankedMatchedSkills(query, audience)
            .find(m => m.file.name.toLowerCase().replace(/\.md$/i, '') !== exclude);
        return firstNonExcluded
            ? { text: `[skills/${firstNonExcluded.file.name}] ${skillIndexLine(firstNonExcluded.file.name, firstNonExcluded.meta)}`, meta: firstNonExcluded.meta, name: firstNonExcluded.file.name }
            : { text: '', meta: null as SkillMeta | null, name: '' };
    })();
    if (push(primary.text) && primary.meta) injected.push({ path: `skills/${primary.name}`, kind: 'skill' });
    if (stage === 'verdict') {
        // Top-K: verdict depth surfaces the runners-up as index
        // lines — one matching skill is a coincidence, two a pattern.
        // The primary skill is already pushed above — skip it
        // here so it never renders twice when no exclusion is set.
        const ranked = rankedMatchedSkills(query).filter(
            m => (!exclude || m.file.name.toLowerCase().replace(/\.md$/i, '') !== exclude)
                && m.file.name !== primary.name,
        );
        for (const extra of ranked.slice(0, VERDICT_EXTRA_SKILLS)) {
            if (push(`[skills/${extra.file.name}] ${skillIndexLine(extra.file.name, extra.meta)}`)) {
                injected.push({ path: `skills/${extra.file.name}`, kind: 'skill' });
            }
        }
    }
    if (push(riskRulesBlock())) injected.push({ path: 'rules/risk-rules', kind: 'rules' });
    if (push(uncoveredMistakeLine(query))) injected.push({ path: 'rules/recurring-mistakes', kind: 'rules' });
    if (stage === 'verdict' && push(similarTradesBlock(query, trades))) {
        injected.push({ path: 'journal/similar-trades', kind: 'similar' });
    }

    const doctrine = doctrineBlock();
    if (blocks.length === 0 && !doctrine) return '';
    if (doctrine) injected.unshift({ path: 'profile/doctrine', kind: 'identity' });

    // Telemetry (fire-and-forget): record what was REALLY injected so skill
    // evidence, lift and the dashboard reflect injections, not setup matches.
    // Synthetic contexts (A/B eval arms) pass
    // recordInjections:false — their fresh timestamps must never fall inside
    // a future trade's attribution window and grant phantom credit.
    if (injected.length > 0 && options?.recordInjections !== false) {
        void (async () => {
            try {
                const { recordMemoryInjection } = await import('./MemoryInjectionService');
                const { getActiveUsername } = await import('../../utils/activeUser');
                await recordMemoryInjection(getActiveUsername(), {
                    stage,
                    audience,
                    coin: query?.coin,
                    sources: injected,
                });
            } catch { /* telemetry must never break prompt assembly */ }
        })();
    }

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

    // Pull tier: #1 gets the full body; runners-up appear as one-line index
    // entries so the model knows they exist and can ask again specifically.
    const matches = rankedMatchedSkills(query).slice(0, 1 + VERDICT_EXTRA_SKILLS);
    matches.forEach((m, i) => {
        if (i === 0) {
            const body = substituteSkillContext(m.file.content.trim(), query);
            const capped = body.length > 700 ? `${body.slice(0, 700).trimEnd()}\n…` : body;
            sections.push(
                `SKILL ${m.meta.status.toUpperCase()} (${Math.round(m.meta.wins)}W/${Math.round(m.meta.losses)}L · ${evidenceFreshness(m.meta)}):\n${capped}`
            );
        } else {
            sections.push(`SKILL (also matches) ${skillIndexLine(m.file.name, m.meta)}`);
        }
    });

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
