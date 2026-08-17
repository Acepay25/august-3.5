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
    createMemoryFile,
    deleteMemoryFile,
    ensureHarnessFolders,
    extractLessonFromPostMortem,
    getMemoryFiles,
    slugifyName,
    syncRecurringMistakes,
    updateMemoryFile,
} from './MemoryFilesService';
import { formatSkillProcedure, parseIfThenClauses, skillHitRate } from '../../utils/ifThenSkill';
import { maybePinWinningPromptLane } from '../../utils/promptVersionStats';
import { CraftedSkill } from '../../schemas/learning';
import { formatCraftedSkillBody, refineSkillFromLosses } from './SkillCraftService';
import { listSkillDrafts } from '../../utils/skillDrafts';
import { tradeAdmitsTechnicalStrategyRule } from '../../utils/rootCause';
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
}

export const MIN_CLUSTER_FOR_SKILL = 3;
export const MIN_SAMPLE_CONFIRMED = 5;
export const MIN_SAMPLE_RETIRE = 6;
/** Consecutive losses on a CONFIRMED skill before the LLM refinement pass. */
export const REFINE_AFTER_CONSECUTIVE_LOSSES = 2;

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
        const n = parseInt(pick(key) || '0', 10);
        return Number.isFinite(n) ? n : 0;
    };
    const statusRaw = (pick('status') || 'candidate').toLowerCase();
    const status: SkillStatus = statusRaw === 'confirmed' || statusRaw === 'retired' ? statusRaw : 'candidate';
    const kind: SkillKind = (pick('kind') || '').toLowerCase() === 'repeat' ? 'repeat' : 'avoid';
    const tradeIds = (pick('tradeIds') || '').split(',').map(s => s.trim()).filter(Boolean);
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
    };
};

export const setSkillStatus = async (fileId: string, status: SkillStatus, username?: string): Promise<void> => {
    const file = getMemoryFiles().files.find(f => f.id === fileId);
    if (!file) return;
    const meta = parseSkillMarkdown(file.content);
    if (!meta) return;
    meta.status = status;
    await updateMemoryFile(fileId, {
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
    const fam = (setup.family || setup.pattern || '').toLowerCase();
    if (fam && meta.family && fam.includes(meta.family.toLowerCase())) hits += 2;
    if (setup.regime && meta.regime && setup.regime === meta.regime) hits += 1;
    return hits >= 2;
};

const enabledSkillMeta = (file: MemoryFile): SkillMeta | null => {
    if (!file.enabled || !isSkillFile(file)) return null;
    return parseSkillMarkdown(file.content);
};

const deriveStatus = (meta: SkillMeta): SkillStatus => {
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
export const applySkillEvidence = async (trade: LoggedTrade, username: string, allTrades?: LoggedTrade[]): Promise<void> => {
    if (trade.outcome !== TradeOutcome.WIN && trade.outcome !== TradeOutcome.LOSS) return;
    if (!tradeAdmitsTechnicalStrategyRule(trade)) return;
    await ensureHarnessFolders(username);
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
        if (trade.outcome === TradeOutcome.WIN) {
            meta.wins += 1;
            meta.consecutiveLosses = 0;
        } else {
            meta.losses += 1;
            meta.consecutiveLosses += 1;
        }
        meta.tradeIds = [...meta.tradeIds, trade.id];
        meta.status = deriveStatus(meta);
        await updateMemoryFile(file.id, {
            content: serializeSkill(meta, titleFromMeta(meta)),
            enabled: meta.status !== 'retired',
        }, username);
        if (trade.outcome === TradeOutcome.LOSS
            && meta.status === 'confirmed'
            && meta.consecutiveLosses >= REFINE_AFTER_CONSECUTIVE_LOSSES) {
            await maybeRefineSkill(file.id, allTrades ?? [trade], username);
        }
    }
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
        latest.kind = refined.kind;
        latest.ifCondition = refined.ifCondition;
        latest.thenAction = refined.thenAction;
        latest.body = formatCraftedSkillBody(refined);
        latest.consecutiveLosses = 0;
        await updateMemoryFile(fileId, {
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
export const maybeUpsertSkill = async (
    trade: LoggedTrade,
    allTrades: LoggedTrade[],
    username: string
): Promise<MemoryFile | null> => {
    if (trade.outcome !== TradeOutcome.WIN && trade.outcome !== TradeOutcome.LOSS) return null;
    if (!tradeAdmitsTechnicalStrategyRule(trade)) return null;
    await ensureHarnessFolders(username);
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
    return createMemoryFile(folder.id, fileNameFromMeta(meta), content, username, true);
};

export const ingestCraftedSkill = async (
    trade: LoggedTrade,
    crafted: CraftedSkill,
    username: string,
): Promise<void> => {
    if (trade.outcome !== TradeOutcome.WIN && trade.outcome !== TradeOutcome.LOSS) return;
    if (!tradeAdmitsTechnicalStrategyRule(trade)) return;
    await ensureHarnessFolders(username);
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
        await updateMemoryFile(existing.id, {
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
    await createMemoryFile(folder.id, `${slug}.md`, serializeSkill(meta, crafted.name || titleFromMeta(meta)), username, true);
};

/**
 * Ingest a user-approved skill draft that has NO closed trade behind it
 * (verdict-sourced drafts). Starts as a zero-evidence candidate — it must
 * earn wins/losses through applySkillEvidence before it can confirm.
 */
export const ingestCraftedSkillFromDraft = async (
    crafted: CraftedSkill,
    coin: string | undefined,
    username: string,
): Promise<void> => {
    await ensureHarnessFolders(username);
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
    await createMemoryFile(folder.id, `${slug}.md`, serializeSkill(meta, crafted.name || titleFromMeta(meta)), username, true);
};

export const ingestIfThenFromTrade = async (trade: LoggedTrade, username: string): Promise<void> => {
    if (trade.outcome !== TradeOutcome.WIN && trade.outcome !== TradeOutcome.LOSS) return;
    if (!tradeAdmitsTechnicalStrategyRule(trade)) return;
    if (listSkillDrafts(username).some(d => d.tradeId === trade.id)) return;
    const clauses = parseIfThenClauses(trade.postMortem ?? '');
    if (clauses.length === 0) return;
    await ensureHarnessFolders(username);
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
            meta.body = formatSkillProcedure(clause);
            meta.status = deriveStatus(meta);
            await updateMemoryFile(existing.id, {
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
        await createMemoryFile(folder.id, `${slug}.md`, serializeSkill(meta, titleFromMeta(meta)), username, true);
    }
};

/**
 * Disable retired skills and merge exact-duplicate triggers (same file stem).
 */
export const consolidateSkills = async (username: string): Promise<void> => {
    await ensureHarnessFolders(username);
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
                await updateMemoryFile(group[0].id, { enabled: false }, username);
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
        await updateMemoryFile(keep.id, {
            content: serializeSkill(merged, titleFromMeta(merged)),
            enabled: merged.status !== 'retired',
        }, username);
        for (const extra of group.slice(1)) {
            await deleteMemoryFile(extra.id, username);
        }
    }
};

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
    await maybeUpsertSkill(trade, allTrades, username);
    await consolidateSkills(username);
    maybePinWinningPromptLane(allTrades);
};

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
