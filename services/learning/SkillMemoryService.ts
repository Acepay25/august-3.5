/**
 * Evidence-gated skills in the trader notebook (skills/*.md).
 *
 * A skill is a procedure with a trigger and a win/loss score. The harness
 * creates one only after a cluster of similar closed trades; each new
 * WIN/LOSS updates the score; weak skills are retired. Analysts retrieve
 * matching skills — they do not get every skill dumped into the prompt.
 */

import { LoggedTrade, MemoryFile, TradeOutcome } from '../../types';
import { ProviderConfig } from '../../types/provider';
import {
    appendDiaryEntry,
    createMemoryFileUnlocked,
    deleteMemoryFileUnlocked,
    ensureHarnessFoldersUnlocked,
    ensureSkillsArchiveFolderUnlocked,
    extractLessonFromPostMortem,
    getMemoryFiles,
    slugifyName,
    syncRecurringMistakes,
    updateMemoryFileUnlocked,
    withNotebookWriteLock,
} from './MemoryFilesService';
import { formatSkillProcedure, parseIfThenClauses, skillHitRate } from '../../utils/ifThenSkill';
import { maybePinWinningPromptLane } from '../../utils/promptVersionStats';
import { CraftedSkill } from '../../schemas/learning';
import { formatCraftedSkillBody, refineSkillFromLosses } from './SkillCraftService';
import { listSkillDrafts } from '../../utils/skillDrafts';
import { tradeAdmitsTechnicalStrategyRule } from '../../utils/rootCause';
import { familiesRelate } from '../../utils/patternMatch';
import { skillInjectedSince } from './MemoryInjectionService';
import { loadProviderConfigs, getReadyProviders } from '../infrastructure/ProviderConfigService';
import { getFirstReadyProvider } from '../../utils/providerUtils';

export type SkillStatus = 'candidate' | 'confirmed' | 'retired';
export type SkillKind = 'repeat' | 'avoid';

export interface SkillMeta {
    status: SkillStatus;
    kind: SkillKind;
    coin?: string;
    direction?: string;
    family?: string;
    regime?: string;
    wins: number;
    losses: number;
    /** Running count of consecutive LOSS outcomes (reset by any WIN). A
     *  confirmed skill that reaches REFINE_AFTER_CONSECUTIVE_LOSSES gets an
     *  LLM refinement pass instead of silently bleeding. */
    consecutiveLosses: number;
    tradeIds: string[];
    ifCondition?: string;
    thenAction?: string;
    body: string;
    /** ISO timestamp of the last LLM refinement pass, if any. */
    refinedAt?: string;
    /** ISO timestamp of the most recent counted trade (evidence decay input). */
    lastEvidenceAt?: string;
    /** ISO timestamp of the last content write — freshness signal for readers. */
    modifiedAt?: string;
    /** Invocation control (Agent Skills frontmatter port): which debate
     *  audience may load this skill. Default 'all'. */
    audience?: 'analyst' | 'moderator' | 'all';
    /** Latest automated A/B verdict (SkillEvalService). 'hurts' demotes a
     *  confirmed skill back to candidate on the next evidence pass. */
    evalVerdict?: 'helps' | 'mixed' | 'hurts' | 'inconclusive';
    /** Aligned/total flips from the latest eval, e.g. "2/3". */
    evalDetail?: string;
    /** ISO timestamp of the last automated eval run. */
    lastEvalAt?: string;
    /** Trigger/action snapshot taken BEFORE the last refinement — the
     *  evidence diff shown in the notebook so a rewrite is auditable. */
    previousVersion?: { kind: SkillKind; ifCondition?: string; thenAction?: string };
}

export const MIN_CLUSTER_FOR_SKILL = 3;
export const MIN_SAMPLE_CONFIRMED = 5;
export const MIN_SAMPLE_RETIRE = 6;
/** Consecutive losses on a CONFIRMED skill before the LLM refinement pass. */
export const REFINE_AFTER_CONSECUTIVE_LOSSES = 3;
/**
 * Refinement also requires the losses to span at least this many hours —
 * three whipsaw losses inside one session is regime noise, not a broken rule
 * (ROUND-24m: rewrite loops must lag the evidence that triggers them).
 */
export const REFINE_MIN_SPAN_HOURS = 48;

const folderName = (folderId: string): string =>
    getMemoryFiles().folders.find(f => f.id === folderId)?.name ?? '';

export const isSkillFile = (file: MemoryFile): boolean =>
    folderName(file.folderId) === 'skills' && file.name.endsWith('.md');

export const listSkillSlugs = (): string[] =>
    getMemoryFiles().files.filter(isSkillFile).map(f => f.name.replace(/\.md$/i, ''));

export const parseSkillMarkdown = (content: string): SkillMeta | null => {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!match) return null;
    const fm = match[1];
    const body = (match[2] || '').trim();
    const pick = (key: string): string | undefined => {
        const line = fm.match(new RegExp(`^${key}:\\s*(.+)$`, 'mi'));
        const v = line?.[1]?.trim();
        return v && v !== 'undefined' && v !== '' ? v : undefined;
    };
    const num = (key: string): number => {
        // parseFloat, not parseInt: weighted attribution (ROUND-27) stores
        // half-credit counts like `wins: 0.5` — truncating them back to
        // integers silently erased matched-but-not-injected evidence.
        const n = parseFloat(pick(key) || '0');
        return Number.isFinite(n) ? n : 0;
    };
    const statusRaw = (pick('status') || 'candidate').toLowerCase();
    const status: SkillStatus = statusRaw === 'confirmed' || statusRaw === 'retired' ? statusRaw : 'candidate';
    const kind: SkillKind = (pick('kind') || '').toLowerCase() === 'repeat' ? 'repeat' : 'avoid';
    const tradeIds = (pick('tradeIds') || '').split(',').map(s => s.trim()).filter(Boolean);
    let previousVersion: SkillMeta['previousVersion'];
    const prevRaw = pick('previousVersion');
    if (prevRaw) {
        try {
            const parsed = JSON.parse(prevRaw) as { kind?: string; ifCondition?: string; thenAction?: string };
            previousVersion = {
                kind: parsed.kind === 'repeat' ? 'repeat' : 'avoid',
                ifCondition: typeof parsed.ifCondition === 'string' ? parsed.ifCondition : undefined,
                thenAction: typeof parsed.thenAction === 'string' ? parsed.thenAction : undefined,
            };
        } catch {
            previousVersion = undefined;
        }
    }
    return {
        status,
        kind,
        coin: pick('coin'),
        direction: pick('direction'),
        family: pick('family'),
        regime: pick('regime'),
        wins: num('wins'),
        losses: num('losses'),
        consecutiveLosses: num('consecutiveLosses'),
        tradeIds,
        ifCondition: pick('ifCondition'),
        thenAction: pick('thenAction'),
        body,
        refinedAt: pick('refinedAt'),
        modifiedAt: pick('modified'),
        audience: (() => {
            const a = pick('audience');
            return a === 'analyst' || a === 'moderator' ? a : 'all';
        })(),
        evalVerdict: (() => {
            const v = (pick('evalVerdict') || '').toLowerCase();
            return v.startsWith('helps') ? 'helps'
                : v.startsWith('mixed') ? 'mixed'
                    : v.startsWith('hurts') ? 'hurts'
                        : v.startsWith('inconclusive') ? 'inconclusive'
                            : undefined;
        })(),
        evalDetail: pick('evalVerdict')?.replace(/^(helps|mixed|hurts|inconclusive)\s*/i, '').replace(/^\(|\)$/g, '') || undefined,
        lastEvalAt: pick('lastEvalAt'),
        lastEvidenceAt: pick('lastEvidenceAt'),
        previousVersion,
    };
};

export const setSkillStatus = async (fileId: string, status: SkillStatus, username?: string): Promise<void> => {
    const file = getMemoryFiles().files.find(f => f.id === fileId);
    if (!file) return;
    const meta = parseSkillMarkdown(file.content);
    if (!meta) return;
    meta.status = status;
    await updateMemoryFileUnlocked(fileId, {
        content: serializeSkill(meta, titleFromMeta(meta)),
        enabled: status !== 'retired',
    }, username || 'local');
};

export const listSkills = (): Array<{ file: MemoryFile; meta: SkillMeta }> =>
    getMemoryFiles().files.filter(isSkillFile).map(file => {
        const meta = parseSkillMarkdown(file.content);
        return meta ? { file, meta } : null;
    }).filter((row): row is { file: MemoryFile; meta: SkillMeta } => Boolean(row));

export const serializeSkill = (meta: SkillMeta, title: string): string => {
    const lines = [
        '---',
        `status: ${meta.status}`,
        `kind: ${meta.kind}`,
        ...(meta.coin ? [`coin: ${meta.coin}`] : []),
        ...(meta.direction ? [`direction: ${meta.direction}`] : []),
        ...(meta.family ? [`family: ${meta.family}`] : []),
        ...(meta.regime ? [`regime: ${meta.regime}`] : []),
        `wins: ${meta.wins}`,
        `losses: ${meta.losses}`,
        `sample: ${meta.wins + meta.losses}`,
        ...(meta.consecutiveLosses > 0 ? [`consecutiveLosses: ${meta.consecutiveLosses}`] : []),
        ...(meta.ifCondition ? [`ifCondition: ${meta.ifCondition.replace(/\n/g, ' ')}`] : []),
        ...(meta.thenAction ? [`thenAction: ${meta.thenAction.replace(/\n/g, ' ')}`] : []),
        ...(meta.refinedAt ? [`refinedAt: ${meta.refinedAt}`] : []),
        ...(meta.lastEvidenceAt ? [`lastEvidenceAt: ${meta.lastEvidenceAt}`] : []),
        `modified: ${meta.modifiedAt ?? new Date().toISOString()}`,
        ...(meta.audience && meta.audience !== 'all' ? [`audience: ${meta.audience}`] : []),
        ...(meta.evalVerdict ? [`evalVerdict: ${meta.evalVerdict}${meta.evalDetail ? ` (${meta.evalDetail})` : ''}`] : []),
        ...(meta.lastEvalAt ? [`lastEvalAt: ${meta.lastEvalAt}`] : []),
        ...(meta.previousVersion ? [`previousVersion: ${JSON.stringify(meta.previousVersion)}`] : []),
        `tradeIds: ${meta.tradeIds.slice(-20).join(',')}`,
        '---',
        '',
        `# ${title}`,
        '',
        meta.body.trim(),
        '',
    ];
    return lines.join('\n');
};

export const skillMatchesSetup = (
    meta: SkillMeta,
    setup: { coin?: string; direction?: string; family?: string; pattern?: string; regime?: string }
): boolean => {
    if (meta.status === 'retired') return false;
    let hits = 0;
    const coin = setup.coin?.toUpperCase().replace(/USDT?$/, '');
    const skillCoin = meta.coin?.toUpperCase().replace(/USDT?$/, '');
    if (coin && skillCoin && coin === skillCoin) hits += 2;
    if (setup.direction && meta.direction && setup.direction === meta.direction) hits += 2;
    // Negation-aware: "fake-breakout" must NOT match a "breakout" skill.
    const fam = (setup.family || setup.pattern || '').toLowerCase();
    if (fam && meta.family && familiesRelate(fam, meta.family)) hits += 2;
    if (setup.regime && meta.regime && setup.regime === meta.regime) hits += 1;
    return hits >= 2;
};

const enabledSkillMeta = (file: MemoryFile): SkillMeta | null => {
    if (!file.enabled || !isSkillFile(file)) return null;
    return parseSkillMarkdown(file.content);
};

/**
 * How long a recorded automated-eval verdict stays authoritative. After this
 * window a 'hurts' demotion expires: the next evidence pass re-derives status
 * from outcomes alone, and the scheduler may re-audit the skill for a fresh
 * verdict.
 */
export const EVAL_VERDICT_STALE_MS = 30 * 86_400_000;

/**
 * TRUE while an automated-eval 'hurts' verdict still outranks outcome
 * correlation. Undated or unparseable verdicts stay active — conservative,
 * since there is no timestamp from which they could expire.
 */
export const evalDemotionActive = (meta: SkillMeta): boolean => {
    if (meta.evalVerdict !== 'hurts') return false;
    if (!meta.lastEvalAt) return true;
    const t = Date.parse(meta.lastEvalAt);
    if (!Number.isFinite(t)) return true;
    return Date.now() - t < EVAL_VERDICT_STALE_MS;
};

const deriveStatus = (meta: SkillMeta): SkillStatus => {
    // ── Causal override (ROUND-25c) ──
    // An automated A/B eval that shows the skill HURTS decisions demotes it
    // regardless of outcome correlation — injection-causation outranks
    // co-occurrence. The override expires after EVAL_VERDICT_STALE_MS so a
    // single noisy eval cannot bench a skill forever.
    if (meta.evalVerdict === 'hurts' && meta.status === 'confirmed' && evalDemotionActive(meta)) return 'candidate';

    const sample = meta.wins + meta.losses;
    const winRate = sample > 0 ? meta.wins / sample : 0;
    if (sample >= MIN_SAMPLE_RETIRE) {
        if (meta.kind === 'repeat' && winRate < 0.4) return 'retired';
        if (meta.kind === 'avoid' && winRate > 0.6) return 'retired';
    }
    if (sample >= MIN_SAMPLE_CONFIRMED) {
        if (meta.kind === 'repeat' && winRate >= 0.6) return 'confirmed';
        if (meta.kind === 'avoid' && winRate <= 0.4) return 'confirmed';
        return 'candidate';
    }
    return 'candidate';
};

export const titleFromMeta = (meta: SkillMeta): string => {
    const bits = [meta.kind === 'avoid' ? 'Avoid' : 'Repeat', meta.coin, meta.direction, meta.family]
        .filter(Boolean);
    return bits.join(' ') || 'Skill';
};

const fileNameFromMeta = (meta: SkillMeta): string => {
    const slug = slugifyName([meta.coin, meta.direction, meta.family, meta.kind].filter(Boolean).join(' '))
        || 'skill';
    return `${slug}.md`;
};

const clusterKey = (trade: LoggedTrade): string => {
    const coin = (trade.analysis?.coinName || 'GEN').toUpperCase().replace(/USDT?$/, '');
    const dir = trade.analysis?.direction === 'Long' || trade.analysis?.direction === 'Short'
        ? trade.analysis.direction
        : 'Neutral';
    const fam = trade.analysis?.detectedPatternFamily || trade.analysis?.marketConditions?.pattern || 'any';
    return `${coin}|${dir}|${fam}`;
};

/**
 * After a closed trade, bump wins/losses on every matching skill. A WIN
 * resets the consecutive-loss streak; a confirmed skill that reaches
 * REFINE_AFTER_CONSECUTIVE_LOSSES gets an LLM refinement pass (tightened
 * trigger) instead of silently bleeding.
 */
const applySkillEvidenceUnlocked = async (trade: LoggedTrade, username: string, allTrades?: LoggedTrade[]): Promise<void> => {
    if (trade.outcome !== TradeOutcome.WIN && trade.outcome !== TradeOutcome.LOSS) return;
    if (!tradeAdmitsTechnicalStrategyRule(trade)) return;
    await ensureHarnessFoldersUnlocked(username);
    const setup = {
        coin: trade.analysis?.coinName,
        direction: trade.analysis?.direction,
        family: trade.analysis?.detectedPatternFamily,
        pattern: trade.analysis?.marketConditions?.pattern,
        regime: trade.marketRegime,
    };
    for (const file of getMemoryFiles().files.filter(isSkillFile)) {
        const meta = parseSkillMarkdown(file.content);
        if (!meta || !file.enabled || !skillMatchesSetup(meta, setup)) continue;
        if (meta.tradeIds.includes(trade.id)) continue;

        // ── Evidence decay (ROUND-24m) ──
        // Authority expires with its evidence. Before counting this trade:
        //   • counts >30 days stale are halved
        //   • evidence earned in a DIFFERENT market regime halves again
        // deriveStatus then naturally demotes stale skills to candidate —
        // no new status machinery needed.
        applyEvidenceDecay(meta, trade.marketRegime);

        // ── Weighted attribution (ROUND-27) ──
        // Full credit when retrieval actually injected this skill; half when
        // it merely matched the setup (budgets/audience filters mean it may
        // never have reached the prompt). Unknown telemetry (empty log) keeps
        // full credit so tiering cannot starve on missing data.
        let injected: boolean | null = null;
        try {
            injected = await skillInjectedSince(username, file.name);
        } catch { injected = null; }
        const credit = injected === false ? 0.5 : 1;

        if (trade.outcome === TradeOutcome.WIN) {
            meta.wins += credit;
            meta.consecutiveLosses = 0;
        } else {
            meta.losses += credit;
            meta.consecutiveLosses += 1;
        }
        meta.tradeIds = [...meta.tradeIds, trade.id];
        // Track the freshest evidence and the regime it came from.
        meta.lastEvidenceAt = trade.timestamp ?? new Date().toISOString();
        meta.modifiedAt = new Date().toISOString();
        if (trade.marketRegime) meta.regime = trade.marketRegime;
        meta.status = deriveStatus(meta);
        await updateMemoryFileUnlocked(file.id, {
            content: serializeSkill(meta, titleFromMeta(meta)),
            enabled: meta.status !== 'retired',
        }, username);

        // Refinement gate: 3 consecutive losses AND spread over >=48h.
        if (trade.outcome === TradeOutcome.LOSS
            && meta.status === 'confirmed'
            && meta.consecutiveLosses >= REFINE_AFTER_CONSECUTIVE_LOSSES
            && lossesSpanEnoughHours(allTrades ?? [trade], meta.tradeIds, REFINE_MIN_SPAN_HOURS)) {
            await maybeRefineSkill(file.id, allTrades ?? [trade], username);
        }
    }
};

/** Serialized public API — see withNotebookWriteLock in MemoryFilesService. */
export const applySkillEvidence = (
    trade: LoggedTrade,
    username: string,
    allTrades?: LoggedTrade[],
): Promise<void> =>
    withNotebookWriteLock(() => applySkillEvidenceUnlocked(trade, username, allTrades));

/** Age of the freshest recorded evidence in days (Infinity when unknown). */
const evidenceAgeDays = (meta: SkillMeta): number => {
    if (!meta.lastEvidenceAt) return Infinity;
    const t = Date.parse(meta.lastEvidenceAt);
    return Number.isFinite(t) ? (Date.now() - t) / 86_400_000 : Infinity;
};

/**
 * Halve wins/losses when the skill's evidence is stale (>30 days since the
 * last counted trade) or was earned in a different regime than the incoming
 * trade's. Mutates `meta` before the new outcome is counted.
 */
export const applyEvidenceDecay = (meta: SkillMeta, incomingRegime?: string): void => {
    let halvings = 0;
    if (evidenceAgeDays(meta) > EVIDENCE_STALE_DAYS) halvings += 1;
    if (incomingRegime && meta.regime && incomingRegime !== meta.regime) halvings += 1;
    if (halvings > 0) halveCounts(meta, halvings);
};

export const EVIDENCE_STALE_DAYS = 30;

/** Halve wins/losses n times (floor at 0). Keeps sample math consistent. */
export const halveCounts = (meta: SkillMeta, times: number): void => {
    for (let i = 0; i < times; i++) {
        meta.wins = Math.floor(meta.wins / 2);
        meta.losses = Math.floor(meta.losses / 2);
    }
};

/**
 * True when the last N losing trades for this skill span at least `minHours`
 * between first and last. Whipsaw losses inside one session don't trigger
 * LLM rewrites.
 */
export const lossesSpanEnoughHours = (
    allTrades: LoggedTrade[],
    tradeIds: string[],
    minHours: number,
): boolean => {
    const idSet = new Set(tradeIds);
    const stamps = allTrades
        .filter(t => idSet.has(t.id) && t.outcome === TradeOutcome.LOSS)
        .map(t => Date.parse(t.timestamp || ''))
        .filter(Number.isFinite)
        .sort((a, b) => a - b);
    if (stamps.length < REFINE_AFTER_CONSECUTIVE_LOSSES) return false;
    const window = stamps.slice(-REFINE_AFTER_CONSECUTIVE_LOSSES);
    return (window[window.length - 1] - window[0]) >= minHours * 3_600_000;
};

/**
 * Self-improving skills: hand a confirmed skill that keeps losing back to
 * the model with the losing post-mortems so the trigger/procedure is
 * tightened. Best-effort — any failure keeps the existing skill untouched.
 * The refined skill starts a fresh consecutive-loss streak.
 */
const maybeRefineSkill = async (fileId: string, allTrades: LoggedTrade[], username: string): Promise<void> => {
    try {
        const configs = await loadProviderConfigs();
        const config = getFirstReadyProvider(getReadyProviders(configs));
        if (!config) return;
        const file = getMemoryFiles().files.find(f => f.id === fileId);
        const meta = file ? parseSkillMarkdown(file.content) : null;
        if (!meta) return;
        const losingTrades = allTrades
            .filter(t => t.outcome === TradeOutcome.LOSS && meta.tradeIds.includes(t.id))
            .slice(-4);
        const refined = await refineSkillFromLosses({
            title: titleFromMeta(meta),
            kind: meta.kind,
            ifCondition: meta.ifCondition,
            thenAction: meta.thenAction,
            body: meta.body,
            wins: meta.wins,
            losses: meta.losses,
        }, losingTrades, config);
        if (!refined) return;
        // Re-read after the LLM round-trip — evidence may have landed meanwhile.
        const latestFile = getMemoryFiles().files.find(f => f.id === fileId);
        const latest = latestFile ? parseSkillMarkdown(latestFile.content) : null;
        if (!latest) return;
        latest.previousVersion = {
            kind: latest.kind,
            ifCondition: latest.ifCondition,
            thenAction: latest.thenAction,
        };
        latest.kind = refined.kind;
        latest.ifCondition = refined.ifCondition;
        latest.thenAction = refined.thenAction;
        latest.body = formatCraftedSkillBody(refined);
        latest.consecutiveLosses = 0;
        latest.refinedAt = new Date().toISOString();
        latest.modifiedAt = latest.refinedAt;
        await updateMemoryFileUnlocked(fileId, {
            content: serializeSkill(latest, refined.name || titleFromMeta(latest)),
            enabled: latest.status !== 'retired',
        }, username);
    } catch (e) {
        console.warn('[SkillMemory] Refinement pass failed (skill kept):', e);
    }
};

/**
 * Create a skill when a similar cluster reaches MIN_CLUSTER_FOR_SKILL and
 * no matching skill exists yet. Evidence-gated — not a free-form LLM spawn.
 */
const maybeUpsertSkillUnlocked = async (
    trade: LoggedTrade,
    allTrades: LoggedTrade[],
    username: string
): Promise<MemoryFile | null> => {
    if (trade.outcome !== TradeOutcome.WIN && trade.outcome !== TradeOutcome.LOSS) return null;
    if (!tradeAdmitsTechnicalStrategyRule(trade)) return null;
    await ensureHarnessFoldersUnlocked(username);
    const key = clusterKey(trade);
    const cluster = allTrades.filter(t =>
        (t.outcome === TradeOutcome.WIN || t.outcome === TradeOutcome.LOSS) && clusterKey(t) === key
    );
    if (cluster.length < MIN_CLUSTER_FOR_SKILL) return null;

    const setup = {
        coin: trade.analysis?.coinName,
        direction: trade.analysis?.direction === 'Neutral' ? undefined : trade.analysis?.direction,
        family: trade.analysis?.detectedPatternFamily,
        pattern: trade.analysis?.marketConditions?.pattern,
        regime: trade.marketRegime,
    };
    const existing = getMemoryFiles().files.filter(isSkillFile).some(f => {
        const meta = parseSkillMarkdown(f.content);
        return meta ? skillMatchesSetup(meta, setup) : false;
    });
    if (existing) return null;

    const wins = cluster.filter(t => t.outcome === TradeOutcome.WIN).length;
    const losses = cluster.filter(t => t.outcome === TradeOutcome.LOSS).length;
    // Trailing-loss streak (cluster sorted oldest → newest).
    const ordered = [...cluster].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    let streak = 0;
    for (let i = ordered.length - 1; i >= 0 && ordered[i].outcome === TradeOutcome.LOSS; i--) streak++;
    const kind: SkillKind = losses >= wins ? 'avoid' : 'repeat';
    const clause = parseIfThenClauses(trade.postMortem ?? '')[0];
    const lesson = clause
        ? formatSkillProcedure(clause)
        : extractLessonFromPostMortem(trade.postMortem ?? '')
            || (kind === 'avoid'
                ? 'Do not repeat this setup until structure and invalidation are clearer.'
                : 'Repeat this setup only when the same confluence is present.');
    const meta: SkillMeta = {
        status: 'candidate',
        kind,
        coin: trade.analysis?.coinName,
        direction: setup.direction,
        family: trade.analysis?.detectedPatternFamily,
        regime: trade.marketRegime,
        wins,
        losses,
        consecutiveLosses: streak,
        tradeIds: cluster.map(t => t.id),
        ifCondition: clause?.ifCondition,
        thenAction: clause?.thenAction,
        body: clause
            ? lesson
            : [
                `**Trigger:** ${[setup.coin, setup.direction, setup.family].filter(Boolean).join(' · ') || 'matching setup'}`,
                `**Procedure:** ${lesson}`,
                `**Invalidates:** thesis break or a different regime than ${setup.regime || 'the one that produced this cluster'}.`,
            ].join('\n'),
    };
    meta.status = deriveStatus(meta);

    const folder = getMemoryFiles().folders.find(f => f.name === 'skills');
    if (!folder) return null;
    const content = serializeSkill(meta, titleFromMeta(meta));
    return createMemoryFileUnlocked(folder.id, fileNameFromMeta(meta), content, username, true);
};

/** Serialized public API — see withNotebookWriteLock in MemoryFilesService. */
export const maybeUpsertSkill = (
    trade: LoggedTrade,
    allTrades: LoggedTrade[],
    username: string
): Promise<MemoryFile | null> =>
    withNotebookWriteLock(() => maybeUpsertSkillUnlocked(trade, allTrades, username));

const ingestCraftedSkillUnlocked = async (
    trade: LoggedTrade,
    crafted: CraftedSkill,
    username: string,
): Promise<void> => {
    if (trade.outcome !== TradeOutcome.WIN && trade.outcome !== TradeOutcome.LOSS) return;
    if (!tradeAdmitsTechnicalStrategyRule(trade)) return;
    await ensureHarnessFoldersUnlocked(username);
    const folder = getMemoryFiles().folders.find(f => f.name === 'skills');
    if (!folder) return;
    const setupDir = trade.analysis?.direction === 'Long' || trade.analysis?.direction === 'Short'
        ? trade.analysis.direction
        : undefined;
    const existing = getMemoryFiles().files.filter(isSkillFile).find(f => {
        const meta = parseSkillMarkdown(f.content);
        return meta?.ifCondition?.toLowerCase() === crafted.ifCondition.toLowerCase();
    });
    const kind = crafted.kind;
    if (existing) {
        const meta = parseSkillMarkdown(existing.content);
        if (!meta) return;
        if (!meta.tradeIds.includes(trade.id)) {
            if (trade.outcome === TradeOutcome.WIN) meta.wins += 1;
            else meta.losses += 1;
            meta.tradeIds = [...meta.tradeIds, trade.id];
        }
        meta.kind = kind;
        meta.ifCondition = crafted.ifCondition;
        meta.thenAction = crafted.thenAction;
        meta.body = formatCraftedSkillBody(crafted);
        meta.status = deriveStatus(meta);
        await updateMemoryFileUnlocked(existing.id, {
            content: serializeSkill(meta, crafted.name || titleFromMeta(meta)),
            enabled: meta.status !== 'retired',
        }, username);
        return;
    }
    const meta: SkillMeta = {
        status: 'candidate',
        kind,
        coin: trade.analysis?.coinName,
        direction: setupDir,
        family: trade.analysis?.detectedPatternFamily,
        regime: trade.marketRegime,
        wins: trade.outcome === TradeOutcome.WIN ? 1 : 0,
        losses: trade.outcome === TradeOutcome.LOSS ? 1 : 0,
        consecutiveLosses: trade.outcome === TradeOutcome.LOSS ? 1 : 0,
        tradeIds: [trade.id],
        ifCondition: crafted.ifCondition,
        thenAction: crafted.thenAction,
        body: formatCraftedSkillBody(crafted),
    };
    meta.status = deriveStatus(meta);
    const slug = slugifyName(crafted.name) || slugifyName([trade.analysis?.coinName, kind].filter(Boolean).join(' ')) || 'skill';
    await createMemoryFileUnlocked(folder.id, `${slug}.md`, serializeSkill(meta, crafted.name || titleFromMeta(meta)), username, true);
};

/** Serialized public API — see withNotebookWriteLock in MemoryFilesService. */
export const ingestCraftedSkill = (
    trade: LoggedTrade,
    crafted: CraftedSkill,
    username: string,
): Promise<void> =>
    withNotebookWriteLock(() => ingestCraftedSkillUnlocked(trade, crafted, username));

/**
 * Ingest a user-approved skill draft that has NO closed trade behind it
 * (verdict-sourced drafts). Starts as a zero-evidence candidate — it must
 * earn wins/losses through applySkillEvidence before it can confirm.
 */
const ingestCraftedSkillFromDraftUnlocked = async (
    crafted: CraftedSkill,
    coin: string | undefined,
    username: string,
): Promise<void> => {
    await ensureHarnessFoldersUnlocked(username);
    const folder = getMemoryFiles().folders.find(f => f.name === 'skills');
    if (!folder) return;
    const existing = getMemoryFiles().files.filter(isSkillFile).find(f => {
        const meta = parseSkillMarkdown(f.content);
        return meta?.ifCondition?.toLowerCase() === crafted.ifCondition.toLowerCase();
    });
    if (existing) return; // already learned — never duplicate a trigger
    const meta: SkillMeta = {
        status: 'candidate',
        kind: crafted.kind,
        coin,
        wins: 0,
        losses: 0,
        consecutiveLosses: 0,
        tradeIds: [],
        ifCondition: crafted.ifCondition,
        thenAction: crafted.thenAction,
        body: formatCraftedSkillBody(crafted),
    };
    const slug = slugifyName(crafted.name) || slugifyName([coin, crafted.kind].filter(Boolean).join(' ')) || 'skill';
    await createMemoryFileUnlocked(folder.id, `${slug}.md`, serializeSkill(meta, crafted.name || titleFromMeta(meta)), username, true);
};

/** Serialized public API — see withNotebookWriteLock in MemoryFilesService. */
export const ingestCraftedSkillFromDraft = (
    crafted: CraftedSkill,
    coin: string | undefined,
    username: string,
): Promise<void> =>
    withNotebookWriteLock(() => ingestCraftedSkillFromDraftUnlocked(crafted, coin, username));

const ingestIfThenFromTradeUnlocked = async (trade: LoggedTrade, username: string): Promise<void> => {
    if (trade.outcome !== TradeOutcome.WIN && trade.outcome !== TradeOutcome.LOSS) return;
    if (!tradeAdmitsTechnicalStrategyRule(trade)) return;
    if (listSkillDrafts(username).some(d => d.tradeId === trade.id)) return;
    const clauses = parseIfThenClauses(trade.postMortem ?? '');
    if (clauses.length === 0) return;
    await ensureHarnessFoldersUnlocked(username);
    const folder = getMemoryFiles().folders.find(f => f.name === 'skills');
    if (!folder) return;
    const kind: SkillKind = trade.outcome === TradeOutcome.LOSS ? 'avoid' : 'repeat';
    const setupDir = trade.analysis?.direction === 'Long' || trade.analysis?.direction === 'Short'
        ? trade.analysis.direction
        : undefined;
    for (const clause of clauses) {
        const existing = getMemoryFiles().files.filter(isSkillFile).find(f => {
            const meta = parseSkillMarkdown(f.content);
            return meta?.ifCondition?.toLowerCase() === clause.ifCondition.toLowerCase();
        });
        if (existing) {
            const meta = parseSkillMarkdown(existing.content);
            if (!meta) continue;
            if (!meta.tradeIds.includes(trade.id)) {
                if (trade.outcome === TradeOutcome.WIN) meta.wins += 1;
                else meta.losses += 1;
                meta.tradeIds = [...meta.tradeIds, trade.id];
            }
            meta.thenAction = clause.thenAction;
            meta.modifiedAt = new Date().toISOString();
            meta.body = formatSkillProcedure(clause);
            meta.status = deriveStatus(meta);
            await updateMemoryFileUnlocked(existing.id, {
                content: serializeSkill(meta, titleFromMeta(meta)),
                enabled: meta.status !== 'retired',
            }, username);
            continue;
        }
        const meta: SkillMeta = {
            status: 'candidate',
            kind,
            coin: trade.analysis?.coinName,
            direction: setupDir,
            family: trade.analysis?.detectedPatternFamily,
            regime: trade.marketRegime,
            wins: trade.outcome === TradeOutcome.WIN ? 1 : 0,
            losses: trade.outcome === TradeOutcome.LOSS ? 1 : 0,
            consecutiveLosses: trade.outcome === TradeOutcome.LOSS ? 1 : 0,
            tradeIds: [trade.id],
            ifCondition: clause.ifCondition,
            thenAction: clause.thenAction,
            body: formatSkillProcedure(clause),
        };
        meta.status = deriveStatus(meta);
        const slug = slugifyName([trade.analysis?.coinName, kind, clause.ifCondition.slice(0, 40)].filter(Boolean).join(' '))
            || 'if-then';
        await createMemoryFileUnlocked(folder.id, `${slug}.md`, serializeSkill(meta, titleFromMeta(meta)), username, true);
    }
};

/** Serialized public API — see withNotebookWriteLock in MemoryFilesService. */
export const ingestIfThenFromTrade = (trade: LoggedTrade, username: string): Promise<void> =>
    withNotebookWriteLock(() => ingestIfThenFromTradeUnlocked(trade, username));

/**
 * Disable retired skills and merge exact-duplicate triggers (same file stem).
 */
const consolidateSkillsUnlocked = async (username: string): Promise<void> => {
    await ensureHarnessFoldersUnlocked(username);
    const skills = getMemoryFiles().files.filter(isSkillFile);
    const byKey = new Map<string, MemoryFile[]>();
    for (const file of skills) {
        const meta = parseSkillMarkdown(file.content);
        const key = meta
            ? [meta.coin, meta.direction, meta.family, meta.kind].join('|').toLowerCase()
            : file.name;
        const list = byKey.get(key) ?? [];
        list.push(file);
        byKey.set(key, list);
    }
    for (const group of byKey.values()) {
        if (group.length < 2) {
            const meta = parseSkillMarkdown(group[0].content);
            if (meta?.status === 'retired' && group[0].enabled) {
                await updateMemoryFileUnlocked(group[0].id, { enabled: false }, username);
            }
            continue;
        }
        const metas = group.map(f => parseSkillMarkdown(f.content)).filter(Boolean) as SkillMeta[];
        const keep = group[0];
        const merged: SkillMeta = {
            ...metas[0],
            wins: metas.reduce((s, m) => s + m.wins, 0),
            losses: metas.reduce((s, m) => s + m.losses, 0),
            tradeIds: [...new Set(metas.flatMap(m => m.tradeIds))],
            body: metas[0].body,
        };
        merged.status = deriveStatus(merged);
        await updateMemoryFileUnlocked(keep.id, {
            content: serializeSkill(merged, titleFromMeta(merged)),
            enabled: merged.status !== 'retired',
        }, username);
        for (const extra of group.slice(1)) {
            await deleteMemoryFileUnlocked(extra.id, username);
        }
    }

    // ── Archive sweep (bounds pass) ──
    // Retired skills leave the active skills folder: isSkillFile is
    // folder-based, so archived skills drop out of retrieval, evidence and
    // dashboards while staying in the notebook for the record. Keeps the
    // active skill set bounded instead of growing forever.
    const retired = getMemoryFiles().files.filter(f => {
        if (!isSkillFile(f)) return false;
        const m = parseSkillMarkdown(f.content);
        return m?.status === 'retired';
    });
    if (retired.length > 0) {
        const archive = await ensureSkillsArchiveFolderUnlocked(username);
        if (archive) {
            for (const f of retired) {
                if (f.folderId !== archive.id) {
                    await updateMemoryFileUnlocked(f.id, { folderId: archive.id, enabled: false }, username);
                }
            }
        }
    }
};

/** Serialized public API — see withNotebookWriteLock in MemoryFilesService. */
export const consolidateSkills = (username: string): Promise<void> =>
    withNotebookWriteLock(() => consolidateSkillsUnlocked(username));

/**
 * Closed-loop write: diary + mistakes + skill scores. Safe to call from
 * both trade-log and post-mortem (diary entries are de-duplicated by id).
 */
export const syncClosedTradeToNotebook = async (
    trade: LoggedTrade,
    allTrades: LoggedTrade[],
    username: string
): Promise<void> => {
    await appendDiaryEntry(trade, username);
    await syncRecurringMistakes(allTrades, username);
    await applySkillEvidence(trade, username, allTrades);
    await ingestIfThenFromTrade(trade, username);
    try {
        const { evaluateSkillWorth, validateCraftedSkill } = await import('./skillWorthGate');
        await ensureHarnessFoldersUnlocked(username);
        const key = clusterKey(trade);
        const cluster = allTrades.filter(t => (t.outcome === TradeOutcome.WIN || t.outcome === TradeOutcome.LOSS) && clusterKey(t) === key);
        if (cluster.length >= MIN_CLUSTER_FOR_SKILL) {
            const setup = { coin: trade.analysis?.coinName, direction: trade.analysis?.direction, family: trade.analysis?.detectedPatternFamily };
            const hasMatch = getMemoryFiles().files.filter(isSkillFile).some(f => {
                const m = parseSkillMarkdown(f.content);
                return m ? skillMatchesSetup(m, setup) : false;
            });
            if (!hasMatch) {
                const { getFirstReadyProvider } = await import('../../utils/providerUtils');
                const { getReadyProviders, loadProviderConfigs } = await import('../infrastructure/ProviderConfigService');
                const configs = await loadProviderConfigs();
                const config = getFirstReadyProvider(getReadyProviders(configs));
                if (config) {
                    const { getBotMemoryContext } = await import('../bots/BotMemoryService');
                    const firstBotId = (() => {
                        try {
                            const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(`bots_v1_${username}`) : null;
                            const data = raw ? JSON.parse(raw) as { bots?: Array<{ id: string }> } : null;
                            return data?.bots?.[0]?.id || trade.id;
                        } catch { return trade.id; }
                    })();
                    const botCtx = getBotMemoryContext(firstBotId, setup, 'global');
                    const decision = await evaluateSkillWorth({ coin: setup.coin, direction: setup.direction, family: setup.family, cluster }, botCtx, config);
                    if (decision && decision.verdict === 'create') {
                        const err = validateCraftedSkill(decision, cluster.filter(t => t.outcome === TradeOutcome.WIN).length, cluster.filter(t => t.outcome === TradeOutcome.LOSS).length);
                        if (!err) await maybeUpsertSkill(trade, allTrades, username);
                        else console.warn('[SkillMemory] Skill worth-gate rejected crafted skill:', err);
                    }
                } else {
                    // No ready provider = the gate cannot run. Fail CLOSED:
                    // an unjudged skill is exactly what the gate exists to
                    // prevent. The cluster stays eligible — the next closed
                    // trade in it retries the gate once a provider is up.
                    console.warn('[SkillMemory] Skill worth-gate skipped (no ready provider) — skill creation deferred.');
                }
            }
        }
        // Below MIN_CLUSTER_FOR_SKILL there is no evidence to judge — that is
        // not a bypass, just too little data. maybeUpsertSkill would return
        // null anyway, so calling it here only risks a duplicate write path.
    } catch (e) {
        // Gate infrastructure failure (import, provider call, bad JSON).
        // Fail CLOSED for the same reason: never create a skill the gate
        // did not approve. Logged so silent degradation is visible.
        console.warn('[SkillMemory] Skill worth-gate errored — skill creation deferred:', e);
    }
    await consolidateSkills(username);
    maybePinWinningPromptLane(allTrades);
    // Doctrine consolidation: every N newly-closed trades an LLM pass
    // rewrites profile/doctrine.md into settled first-person beliefs.
    // Best-effort + gated on evidence count; never blocks the sync.
    try {
        const { consolidateDoctrine } = await import('./DoctrineConsolidationService');
        const { getFirstReadyProvider } = await import('../../utils/providerUtils');
        const configs = await (await import('../infrastructure/ProviderConfigService')).loadProviderConfigs();
        const config = getFirstReadyProvider(getReadyProviders(configs));
        if (config) {
            const res = await consolidateDoctrine(allTrades, username, config);
            if (res.updated) console.log('[Doctrine] Doctrine rewritten from', countClosedTrades(allTrades), 'closed trades.');

            // ── Automated skill evals (ROUND-25c) ──
            // The harness audits its own knowledge: one due skill gets a
            // cost-capped A/B run; a 'hurts' verdict demotes it via
            // deriveStatus. Deliberately NOT awaited — up to a dozen provider
            // calls must never stall the post-mortem chain. The scheduler's
            // own try/catch + session budget make it safe detached.
            try {
                const { runDueSkillEvalWithDefaultRunner } = await import('./SkillEvalScheduler');
                void runDueSkillEvalWithDefaultRunner(allTrades, username, config).catch(e => {
                    console.warn('[SkillEvalScheduler] deferred:', e instanceof Error ? e.message : e);
                });
            } catch (e) {
                console.warn('[SkillEvalScheduler] import failed:', e instanceof Error ? e.message : e);
            }
        }
    } catch { /* doctrine + eval are optional — sync must not fail because of them */ }
};

const countClosedTrades = (trades: LoggedTrade[]): number =>
    trades.filter(t => t.outcome === TradeOutcome.WIN || t.outcome === TradeOutcome.LOSS).length;

/**
 * Code-side skill enforcement so markdown skills actually move the signal,
 * not only the prompt. Confirmed avoid skills veto Long/Short; candidate
 * avoid skills cap High/Medium down to Low.
 */
export const applyNotebookSkillsToAnalysis = <T extends {
    coinName?: string;
    direction?: string;
    confidence?: string;
    probability?: number;
    detectedPatternFamily?: string;
    marketConditions?: { pattern?: string };
    originalConfidence?: string;
    riskVeto?: string;
    validationWarnings?: string[];
}>(analysis: T): T => {
    const setup = {
        coin: analysis.coinName,
        direction: analysis.direction,
        family: analysis.detectedPatternFamily,
        pattern: analysis.marketConditions?.pattern,
    };
    const matches = getMemoryFiles().files
        .map(enabledSkillMeta)
        .filter((m): m is SkillMeta => Boolean(m && skillMatchesSetup(m, setup)));
    if (matches.length === 0) return analysis;

    const next = { ...analysis };
    const warn = (note: string): void => {
        next.validationWarnings = [...(next.validationWarnings ?? []), note];
        next.riskVeto = [next.riskVeto, note].filter(Boolean).join(' ');
    };

    const avoidConfirmed = matches.find(m => m.kind === 'avoid' && m.status === 'confirmed');
    if (avoidConfirmed && (next.direction === 'Long' || next.direction === 'Short')) {
        next.originalConfidence = next.originalConfidence ?? next.confidence;
        next.confidence = 'Avoid';
        next.direction = 'Neutral';
        if (typeof next.probability === 'number') next.probability = Math.min(next.probability, 15);
        warn(`NOTEBOOK SKILL VETO: ${titleFromMeta(avoidConfirmed)} — IF ${avoidConfirmed.ifCondition || avoidConfirmed.body.replace(/\s+/g, ' ').slice(0, 120)}`);
        return next;
    }

    const avoidCandidate = matches.find(m => m.kind === 'avoid' && m.status === 'candidate');
    if (avoidCandidate && (next.direction === 'Long' || next.direction === 'Short')) {
        next.originalConfidence = next.originalConfidence ?? next.confidence;
        if (next.confidence === 'High' || next.confidence === 'Medium') next.confidence = 'Low';
        warn(`NOTEBOOK SKILL: candidate avoid ${titleFromMeta(avoidCandidate)} — size down until the cluster confirms or retires.`);
        return next;
    }

    const repeat = matches.find(m => m.kind === 'repeat' && m.status === 'confirmed');
    if (repeat) {
        next.validationWarnings = [
            ...(next.validationWarnings ?? []),
            `NOTEBOOK SKILL: confirmed repeat ${titleFromMeta(repeat)} — follow the procedure in skills, do not invent a new tape.`,
        ];
    }
    return next;
};

export const listAppliedSkills = (
    analysis: { coinName?: string; direction?: string; detectedPatternFamily?: string; marketConditions?: { pattern?: string } },
): Array<{ title: string; kind: SkillKind; status: SkillStatus; wins: number; losses: number; hitRate: number | null; procedure?: string }> => {
    const setup = {
        coin: analysis.coinName,
        direction: analysis.direction,
        family: analysis.detectedPatternFamily,
        pattern: analysis.marketConditions?.pattern,
    };
    return getMemoryFiles().files
        .map(enabledSkillMeta)
        .filter((m): m is SkillMeta => Boolean(m && skillMatchesSetup(m, setup)))
        .map(m => ({
            title: titleFromMeta(m),
            kind: m.kind,
            status: m.status,
            wins: m.wins,
            losses: m.losses,
            hitRate: skillHitRate(m.wins, m.losses),
            procedure: m.thenAction || m.ifCondition,
        }));
};

export const confirmedAvoidForSetup = (
    setup: { coin?: string; direction?: string; family?: string; pattern?: string },
): SkillMeta | null => {
    const matches = getMemoryFiles().files
        .map(enabledSkillMeta)
        .filter((m): m is SkillMeta => Boolean(m && skillMatchesSetup(m, setup)));
    return matches.find(m => m.kind === 'avoid' && m.status === 'confirmed') ?? null;
};

// ─── Skill effectiveness review ─────────────────────────────────────────────
// Grades every skill on its realized W/L record and recommends an action.
// This closes the loop: skills are enforced in code (applyNotebookSkillsTo-
// Analysis), so their enforcement history must feed back into their status.

// ─── Applying review recommendations ────────────────────────────────────────

const applyReviewRecommendationUnlocked = async (
    fileId: string,
    recommendation: 'promote' | 'demote' | 'retire',
    username: string,
): Promise<boolean> => {
    const file = getMemoryFiles().files.find(f => f.id === fileId);
    const meta = file ? parseSkillMarkdown(file.content) : null;
    if (!file || !meta || meta.status === 'retired') return false;
    meta.status = recommendation === 'promote'
        ? 'confirmed'
        : recommendation === 'demote' ? 'candidate' : 'retired';
    meta.modifiedAt = new Date().toISOString();
    await updateMemoryFileUnlocked(fileId, {
        content: serializeSkill(meta, titleFromMeta(meta)),
        enabled: meta.status !== 'retired',
    }, username);
    return true;
};

/**
 * User-applied review action from the dashboard. Evidence keeps the final
 * say — the next applySkillEvidence pass re-derives status from counts, so a
 * manual promote of a stats-weak skill reverts unless outcomes back it up.
 */
export const applyReviewRecommendation = (
    fileId: string,
    recommendation: 'promote' | 'demote' | 'retire',
    username: string,
): Promise<boolean> =>
    withNotebookWriteLock(() => applyReviewRecommendationUnlocked(fileId, recommendation, username));

export interface SkillEffectiveness {
    fileId: string;
    title: string;
    kind: SkillKind;
    status: SkillStatus;
    wins: number;
    losses: number;
    hitRate: number | null;
    consecutiveLosses: number;
    /** What the loop should do next with this skill. */
    recommendation: 'keep' | 'watch' | 'refine' | 'demote' | 'retire' | 'promote';
    rationale: string;
    /** Causal A/B verdict from the automated eval (when one exists). */
    evalVerdict?: SkillMeta['evalVerdict'];
    /** Causal before/after win-rate verdict (when computable). */
    liftVerdict?: 'positive' | 'neutral' | 'negative' | 'insufficient-data';
}

export interface SkillEffectivenessReviewOptions {
    /** Per-skill lift results (MemoryProvenanceService.computeAllSkillLifts), keyed by fileId. */
    liftByFileId?: Record<string, { lift: number | null; verdict: 'positive' | 'neutral' | 'negative' | 'insufficient-data' }>;
    /** Notebook file names ACTUALLY injected since tracking began (MemoryInjectionService). When provided, never-injected skills get an attribution caveat. */
    injectedFileNames?: Set<string>;
}

/**
 * Correlation (W/L counts) decides the base recommendation; causal signals —
 * the automated A/B eval and post-vs-pre lift — override it, because a skill
 * that correlates with wins but causes losses is worse than no skill at all.
 */
export const reviewSkillEffectiveness = (opts: SkillEffectivenessReviewOptions = {}): SkillEffectiveness[] => {
    return getMemoryFiles().files
        .map(file => {
            const meta = enabledSkillMeta(file);
            if (!meta) return null;
            const sample = meta.wins + meta.losses;
            const hitRate = skillHitRate(meta.wins, meta.losses);
            const title = titleFromMeta(meta);
            const lift = opts.liftByFileId?.[file.id];

            let recommendation: SkillEffectiveness['recommendation'] = 'keep';
            let rationale: string;

            if (sample === 0) {
                rationale = 'No closed-trade evidence yet — candidate stays unenforced until it earns a record.';
                recommendation = 'watch';
            } else if (meta.status === 'retired') {
                rationale = `Retired at ${meta.wins}W/${meta.losses}L — kept for the record, not enforced.`;
                recommendation = 'retire';
            } else if (meta.consecutiveLosses >= REFINE_AFTER_CONSECUTIVE_LOSSES && meta.status === 'confirmed') {
                rationale = `${meta.consecutiveLosses} straight losses — trigger/procedure needs an LLM refinement pass.`;
                recommendation = 'refine';
            } else if (sample >= MIN_SAMPLE_RETIRE && meta.kind === 'repeat' && (hitRate ?? 100) < 40) {
                rationale = `Repeat skill winning only ${hitRate}% over ${sample} trades — below the 40% retire bar.`;
                recommendation = 'retire';
            } else if (sample >= MIN_SAMPLE_RETIRE && meta.kind === 'avoid' && (hitRate ?? 0) > 60) {
                rationale = `Avoid skill losing ${hitRate}% of matched trades — the setup is actually tradeable; retire the veto.`;
                recommendation = 'retire';
            } else if (meta.status === 'candidate' && sample >= MIN_SAMPLE_CONFIRMED && (hitRate ?? 0) >= 60) {
                rationale = `Candidate holding ${hitRate}% over ${sample} trades — evidence supports confirming.`;
                recommendation = 'promote';
            } else if (meta.status === 'confirmed' && (hitRate ?? 100) < 50 && sample >= MIN_SAMPLE_CONFIRMED) {
                rationale = `Confirmed but under 50% (${meta.wins}W/${meta.losses}L) — consider demoting to candidate until it recovers.`;
                recommendation = 'demote';
            } else if ((hitRate ?? 0) < 55) {
                rationale = `Hit rate ${hitRate}% over ${sample} trades — keep, monitor next outcomes.`;
                recommendation = 'watch';
            } else {
                rationale = `Healthy at ${hitRate}% (${meta.wins}W/${meta.losses}L).`;
            }

            // ── Causal overrides (injection-causation outranks co-occurrence) ──
            const freshHurts = meta.evalVerdict === 'hurts' && evalDemotionActive(meta);
            if (freshHurts && (recommendation === 'keep' || recommendation === 'promote')) {
                recommendation = meta.status === 'confirmed' ? 'demote' : 'watch';
                rationale = `Automated A/B eval says the skill HURTS decisions${meta.evalDetail ? ` (${meta.evalDetail} flips misaligned)` : ''} — the causal signal outranks the ${hitRate ?? '?'}% outcome correlation.`;
            }
            if (lift?.verdict === 'negative' && (recommendation === 'keep' || recommendation === 'promote')) {
                recommendation = sample >= MIN_SAMPLE_CONFIRMED ? 'demote' : 'watch';
                rationale = `Post-influence win rate is ${lift.lift != null ? Math.round(Math.abs(lift.lift) * 100) : '?'}pp BELOW the pre-skill baseline — setups got worse once this skill started injecting.`;
            }
            if (!freshHurts && lift?.verdict === 'positive' && recommendation === 'watch' && sample > 0) {
                recommendation = 'keep';
                rationale = `${rationale} Lift +${lift.lift != null ? Math.round(lift.lift * 100) : '?'}pp over baseline supports it.`;
            }
            // Attribution caveat: evidence earned purely by setup match, when
            // we know the skill was never actually injected into a prompt.
            if (opts.injectedFileNames && !opts.injectedFileNames.has(file.name)
                && sample > 0 && recommendation === 'promote') {
                recommendation = 'watch';
                rationale = `${rationale} Caveat: never actually injected into a prompt since tracking began — its record is co-occurrence, not influence.`;
            }

            return {
                fileId: file.id,
                title,
                kind: meta.kind,
                status: meta.status,
                wins: Math.round(meta.wins),
                losses: Math.round(meta.losses),
                hitRate,
                consecutiveLosses: meta.consecutiveLosses,
                recommendation,
                rationale,
                ...(meta.evalVerdict ? { evalVerdict: meta.evalVerdict } : {}),
                ...(lift ? { liftVerdict: lift.verdict } : {}),
            };
        })
        .filter((s): s is SkillEffectiveness => s !== null)
        .sort((a, b) => (a.hitRate ?? 2) - (b.hitRate ?? 2)); // weakest first
};
