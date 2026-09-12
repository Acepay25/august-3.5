/**
 * draftGates — the shared quality bar EVERY skill-draft source passes before
 * queueing into the approval inbox. Six sources mint drafts (book seeds,
 * session reviews, model proposals, post-mortem crafts, verdict citations,
 * pass mining, self-improvement distills) and they used to queue raw — only
 * the closed-trade sync ran the gates. That flooded the inbox with
 * prediction-less drafts and near-duplicates of live skills.
 *
 * Two tiers, both enforcing the same two rules: nothing enters without a
 * falsifiable prediction, and nothing duplicates — a covered setup strengthens
 * an existing skill instead of minting a twin.
 *
 *  • Deterministic tier (no scored outcome available): tombstone cooldown,
 *    pending-duplicate skip, live-library coverage skip, IF/THEN sanity, and
 *    a scoped default prediction attached when the source didn't craft one.
 *  • Evidence tier (a real or synthetic closed trade exists): the FULL worth
 *    gate (evaluateSkillWorth — catalog, memory, graveyard, evidence aware).
 *    merge → the outcome is folded into the existing skill's W/L tally via
 *    maybeMergeSkill and NO draft is queued; create → validateCraftedSkill
 *    fail-closed (prediction required) then queue; skip → never queued.
 *    Any gate failure falls back to the deterministic tier — the human inbox
 *    remains the final backstop either way.
 */

import { LoggedTrade, TradeAnalysis } from '../../types';
import { TradeOutcome } from '../../types/enums';
import type { ProviderConfig } from '../../types/provider';
import type { CraftedSkill } from '../../schemas/learning';
import {
    queueSkillDraft, listSkillDrafts, isDraftTombstoned, draftTriggerKey,
} from '../../utils/skillDrafts';
import { defaultPrediction } from '../../utils/skillPrediction';
import { evaluateSkillWorth, validateCraftedSkill } from './skillWorthGate';
import { listSkills, skillMatchesSetup, maybeMergeSkill } from './SkillMemoryService';

// ─── Deterministic tier ─────────────────────────────────────────────────────

const GENERIC_IF_RE = /^(follow trend|use risk management|be careful|manage risk|trade carefully)/i;

/** The same IF/THEN bar validateCraftedSkill applies to worth-gate creates. */
export const validateIfThen = (crafted: Pick<CraftedSkill, 'ifCondition' | 'thenAction'>): string | null => {
    const ic = (crafted.ifCondition || '').trim();
    const ta = (crafted.thenAction || '').trim();
    if (!ic || ic.length < 12) return 'IF condition too short or missing';
    if (!ta || ta.length < 12) return 'THEN action too short or missing';
    if (GENERIC_IF_RE.test(ic)) return 'IF condition is generic';
    return null;
};

/** Words that carry setup identity — generic trading vocabulary and numbers
 *  are stripped so keyword overlap compares pattern nouns, not boilerplate. */
const salientWords = (text: string): string[] => {
    const stop = new Set([
        'with', 'from', 'that', 'this', 'then', 'when', 'near', 'into', 'only', 'must',
        'have', 'been', 'were', 'their', 'they', 'after', 'before', 'while', 'about',
        'above', 'below', 'than', 'over', 'under', 'again', 'also', 'just', 'such',
        'most', 'more', 'some', 'each', 'make', 'made', 'take', 'skip', 'trade',
        'entry', 'enter', 'stop', 'target', 'price', 'level', 'trend', 'setup', 'chart',
    ]);
    const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
        .filter(w => w.length >= 4 && !stop.has(w) && !/^\d+$/.test(w));
    return [...new Set(words)].slice(0, 8);
};

/** Does an enabled live skill already cover this setup? Structural match on
 *  coin/direction/family when the source knows them, keyword overlap on the
 *  IF condition for coinless pattern drafts (the book seeds). */
export const coveredByLiveSkill = (
    crafted: CraftedSkill,
    coin?: string,
    direction?: string,
    family?: string,
): boolean => {
    try {
        const dir = direction && direction !== 'Neutral' ? direction
            : /\b(long|buy)\b/i.test(crafted.ifCondition) ? 'Long'
                : /\b(short|sell|fade)\b/i.test(crafted.ifCondition) ? 'Short'
                    : undefined;
        const words = salientWords(crafted.ifCondition);
        return listSkills().some(({ meta }) => {
            if (meta.status === 'retired' || meta.supersededBy) return false;
            if (skillMatchesSetup(meta, { coin, direction: dir, family })) return true;
            if (coin && meta.coin
                && coin.toUpperCase().replace(/USDT?$/, '') !== meta.coin.toUpperCase().replace(/USDT?$/, '')) {
                return false;
            }
            if (words.length >= 3) {
                const hay = `${meta.ifCondition || ''}`.toLowerCase();
                if (words.filter(w => hay.includes(w)).length >= 2) return true;
            }
            return false;
        });
    } catch {
        return false;
    }
};

export type DraftGateVerdict =
    | { ok: true; crafted: CraftedSkill }
    | { ok: false; reason: string };

export interface DeterministicGateInput {
    crafted: CraftedSkill;
    tradeId: string;
    username?: string;
    coin?: string;
    direction?: string;
    family?: string;
}

/** Deterministic tier — for sources with no scored outcome (book seeds,
 *  model proposals, verdict citations, distills). Returns the craft patched
 *  with a falsifiable prediction, or why the draft must not queue. */
export const deterministicDraftGate = (input: DeterministicGateInput): DraftGateVerdict => {
    const { crafted, tradeId, username, coin, direction, family } = input;
    const key = draftTriggerKey(coin, crafted);
    if (isDraftTombstoned(key, username)) return { ok: false, reason: 'trigger recently rejected (cooldown active)' };
    const dup = listSkillDrafts(username).some(d =>
        d.tradeId !== tradeId && draftTriggerKey(d.coin, d.crafted) === key);
    if (dup) return { ok: false, reason: 'an identical draft is already pending approval' };
    if (coveredByLiveSkill(crafted, coin, direction, family)) return { ok: false, reason: 'an existing skill already covers this setup' };
    const ifThenFail = validateIfThen(crafted);
    if (ifThenFail) return { ok: false, reason: ifThenFail };
    return {
        ok: true,
        crafted: crafted.prediction
            ? crafted
            : { ...crafted, prediction: defaultPrediction({ coin, family }) },
    };
};

// ─── Evidence tier ──────────────────────────────────────────────────────────

/** A scored outcome for a thesis that was never a logged trade (a discussed
 *  Chart AI trade scored against the klines that followed it). */
export interface ScoredEvidence {
    id: string;
    coin?: string;
    direction?: string;
    family?: string;
    outcome: 'win' | 'loss';
    thesis: string;
    atMs: number;
}

/** The minimal LoggedTrade the worth gate's evidence renderer and the merge
 *  fold consume. It is NEVER persisted as a trade — only its id and outcome
 *  land in a skill's evidence tally. */
export const buildSyntheticTrade = (ev: ScoredEvidence): LoggedTrade => {
    const direction: 'Long' | 'Short' = ev.direction === 'Short' ? 'Short' : 'Long';
    const at = new Date(ev.atMs || Date.now()).toISOString();
    const analysis: TradeAnalysis = {
        coinName: ev.coin,
        direction,
        confidence: 'Medium',
        probability: 50,
        strategy: ev.thesis.slice(0, 120),
        activeStrategies: [],
        entryPoints: [],
        stopLoss: '',
        takeProfit: [],
        marketConditions: {
            pattern: ev.family || 'session thesis',
            candleBehavior: '',
            timeframeAlignment: '',
            rsi: '',
            macd: '',
            sentiment: '',
        },
        historicalCorrelation: '',
        createdAt: at,
        detectedPatternFamily: ev.family,
    };
    return {
        id: ev.id,
        analysis,
        outcome: ev.outcome === 'win' ? TradeOutcome.WIN : TradeOutcome.LOSS,
        timestamp: at,
        postMortem: ev.thesis,
    };
};

export type EvidenceGateResult =
    | { action: 'queued'; crafted: CraftedSkill }
    | { action: 'merged'; target: string; reason: string }
    | { action: 'skipped'; reason: string };

export interface EvidenceGateInput {
    crafted: CraftedSkill;
    tradeId: string;
    /** ≥1 real or synthetic closed trade backing this craft. */
    cluster: LoggedTrade[];
    username: string;
    config: ProviderConfig;
    /** The user's full trade list — merge control-stats read from it. */
    allTrades?: LoggedTrade[];
    coin?: string;
    direction?: string;
    family?: string;
    /** The bot-memory context the worth gate reads. Defaults to the
     *  cluster's post-mortem text. */
    botContext?: string;
}

/** Evidence tier — the FULL worth gate. Merge verdicts fold the cluster's
 *  outcome into the existing skill (the "merge before create" rule); create
 *  verdicts must survive validateCraftedSkill, which rejects a create
 *  without a falsifiable prediction. */
export const gateEvidenceBackedDraft = async (input: EvidenceGateInput): Promise<EvidenceGateResult> => {
    const { crafted, tradeId, cluster, username, config, allTrades } = input;
    if (cluster.length === 0) return { action: 'skipped', reason: 'no evidence cluster' };
    const coin = input.coin ?? cluster[0]?.analysis?.coinName;
    const direction = input.direction ?? cluster[0]?.analysis?.direction;
    const family = input.family ?? cluster[0]?.analysis?.detectedPatternFamily;
    const key = draftTriggerKey(coin, crafted);
    if (isDraftTombstoned(key, username)) return { action: 'skipped', reason: 'trigger recently rejected (cooldown active)' };
    const dup = listSkillDrafts(username).some(d =>
        d.tradeId !== tradeId && draftTriggerKey(d.coin, d.crafted) === key);
    if (dup) return { action: 'skipped', reason: 'an identical draft is already pending approval' };
    try {
        const decision = await evaluateSkillWorth(
            {
                coin,
                direction: direction && direction !== 'Neutral' ? direction : undefined,
                family,
                cluster,
            },
            input.botContext ?? cluster[0]?.postMortem ?? '',
            config,
        );
        if (decision) {
            if (decision.verdict === 'merge') {
                if (!decision.mergeTarget) return { action: 'skipped', reason: `merge without a target: ${decision.reason}` };
                await maybeMergeSkill(decision.mergeTarget, cluster[0], allTrades ?? [], username);
                return { action: 'merged', target: decision.mergeTarget, reason: decision.reason };
            }
            if (decision.verdict === 'create') {
                const wins = cluster.filter(t => t.outcome === TradeOutcome.WIN).length;
                const fail = validateCraftedSkill(decision, wins, cluster.length - wins);
                if (fail) return { action: 'skipped', reason: fail };
                const gated: CraftedSkill = {
                    ...crafted,
                    kind: decision.kind ?? crafted.kind,
                    ifCondition: (decision.ifCondition || '').trim() || crafted.ifCondition,
                    thenAction: (decision.thenAction || '').trim() || crafted.thenAction,
                    prediction: decision.prediction ?? defaultPrediction({ coin, family }),
                };
                queueSkillDraft({ tradeId, coin, crafted: gated }, username);
                return { action: 'queued', crafted: gated };
            }
            return { action: 'skipped', reason: decision.reason };
        }
    } catch { /* the gate must never break the calling flow — fall back */ }
    // Gate unavailable (no provider / parse failure): deterministic bar, then
    // the human inbox decides. This keeps drafts flowing when offline.
    const det = deterministicDraftGate({ crafted, tradeId, username, coin, direction, family });
    if (!det.ok) return { action: 'skipped', reason: det.reason };
    queueSkillDraft({ tradeId, coin, crafted: det.crafted }, username);
    return { action: 'queued', crafted: det.crafted };
};
