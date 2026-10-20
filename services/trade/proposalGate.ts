/**
 * proposalGate — the gate scan that bounds a presented plan.
 *
 * Why this exists at a tool call at all: the gate used to be a PIPELINE stage, so
 * the confidence cap only bound a verdict the multi-seat run produced. Once a
 * model can put a trade on the table by calling `present_trade`, the cap has to
 * bind THAT path too — otherwise a tool-proposed plan reaches the journal with a
 * probability no scan ever approved.
 *
 * Why it is CONCURRENT rather than blocking: the scan is market data plus an OHLCV
 * pull per timeframe. Awaiting it inside the tool call delays the plan's own
 * drawing and its "Log this trade" card by seconds, on a path that never touched
 * the network before. So `present_trade` starts the scan and shows the levels
 * immediately (no probability, no confidence, no grade until the stamp lands),
 * and the LOG path — a human deciding, seconds or minutes later — awaits the same
 * in-flight scan. Nothing uncapped is ever recorded, and nothing waits on a fetch.
 *
 * Deliberately NOT `quickGateCheck`: that helper folds a FAILED FETCH into
 * `pass: false, confidenceCap: 0`. Here that would report a live idea as a 0%
 * one for the length of a network blip, and 0 is a measurement, not an absence.
 * Splitting fetch from scoring keeps "measured low" and "could not measure" two
 * different facts.
 */

import { fetchGateInputData, runProgrammaticGate } from '../validation/GateKeeperService';
import type { LoggedTrade, ProposalGate } from '../../types';
import type { TradeProposal } from './proposedTrade';
import { buildTradePlan } from './proposedTrade';
import { getHarnessSettings } from '../../utils/harnessSettings';

/** The plan fields the gate needs. `runGateScan` needs the levels for the
 *  minEdge arithmetic too — not just the symbol. */
type PlanForGate = Pick<TradeProposal, 'symbol' | 'direction' | 'entry' | 'stopLoss' | 'takeProfits' | 'confidence'>;

/** How long a scan may run before the plan is called unmeasurable. */
export const GATE_FETCH_TIMEOUT_MS = 10_000;

/** How old a stamp may be before logging re-scans.
 *
 *  Shorter than the 30s desk-tool cache is pointless (the same data), longer than
 *  a trader is likely to sit on a card is theatre; two minutes is the window in
 *  which "fresh" still means the same market. A stamp from yesterday's session,
 *  re-opened today, is re-run. */
export const GATE_STAMP_STALE_MS = 120_000;

const withTimeout = async <T>(p: Promise<T>, ms: number): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            p,
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error(`gate fetch timed out after ${ms}ms`)), ms);
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
};

/** What the code-checked skill predicates contribute to a plan's stamp. The
 *  ceiling is the deterministic half of E-35: a fired AVOID trigger caps the
 *  recorded probability, and the note names the skill so the row says why. */
export interface SkillGateSignal {
    ceiling?: number;
    note?: string;
}

const unavailable = (reason: string, skill?: SkillGateSignal | null, minEdge?: MinEdgeVerdict): ProposalGate => ({
    status: 'unavailable', confidenceCap: 1, reason, stampedAt: new Date().toISOString(),
    ...(skill?.ceiling !== undefined ? { skillCeiling: skill.ceiling } : {}),
    ...(skill?.note ? { skillNote: skill.note } : {}),
    ...(minEdge?.refusal ? { refusal: minEdge.refusal } : {}),
    ...(minEdge?.netEdgeR !== undefined ? { netEdgeR: minEdge.netEdgeR } : {}),
    ...(minEdge?.thresholdR !== undefined ? { minEdgeThresholdR: minEdge.thresholdR } : {}),
});

interface MinEdgeVerdict {
    refusal?: string;
    netEdgeR?: number;
    thresholdR?: number;
}

/** The plan-local expectancy check (E-43). It needs no market data, so a
 *  refused plan is refused even while the market gate is down. Unknown
 *  arithmetic (an unmeasurable stop) does NOT refuse — an unmeasured plan is
 *  not evidence of a bad one. */
const assessMinEdge = (proposal: PlanForGate, cap: number): MinEdgeVerdict => {
    const thresholdR = getHarnessSettings().minEdgeR;
    // Ask the SAME plan object the card and the journal use, with the cap
    // folded in as a synthetic evaluated stamp. Two arithmetic paths for one
    // plan is how the card and the gate start disagreeing.
    const plan = buildTradePlan({
        ...proposal,
        gate: { status: 'evaluated', confidenceCap: cap, reason: 'min-edge', stampedAt: new Date().toISOString() },
    } as TradeProposal);
    if (typeof plan.netEdgeR !== 'number' || !Number.isFinite(plan.netEdgeR)) {
        return { thresholdR, netEdgeR: undefined };
    }
    const refused = plan.netEdgeR <= thresholdR;
    return {
        thresholdR,
        netEdgeR: plan.netEdgeR,
        ...(refused
            ? { refusal: `net expectancy ${plan.netEdgeR.toFixed(2)}R at ${plan.probability.toFixed(0)}% is at or below your ${thresholdR.toFixed(2)}R floor — ${plan.netEdgeLabel ?? 'after fees'}` }
            : {}),
    };
};

/** Run ONE scan. Never throws: every failure path returns an `unavailable` stamp,
 *  because a plan must be loggable (behind a confirm) with the reason attached.
 *
 *  `skillGate` runs CONCURRENTLY with the market fetch. Its ceiling is folded
 *  into the returned stamp, so the plan the trader logs can never outrank a
 *  trigger deterministic code already confirmed. */
export const runGateScan = async (
    proposal: PlanForGate,
    tradeHistory: LoggedTrade[] = [],
    signal?: AbortSignal,
    skillGate?: Promise<SkillGateSignal | null>,
): Promise<ProposalGate> => {
    if (signal?.aborted) return unavailable('stopped before the gate ran', null, assessMinEdge(proposal, 1));
    const skillTask = skillGate
        ? withTimeout(skillGate, GATE_FETCH_TIMEOUT_MS).catch(() => null)
        : Promise.resolve<SkillGateSignal | null>(null);
    try {
        const [input, skill] = await Promise.all([
            withTimeout(fetchGateInputData(proposal.symbol, tradeHistory), GATE_FETCH_TIMEOUT_MS),
            skillTask,
        ]);
        // A Stop can land while the fetch is in flight. The fetch itself has no
        // signal (it goes through the shared market service), so the result is
        // discarded here: a cancelled turn must not settle an evaluated stamp.
        if (signal?.aborted) return unavailable('stopped before the gate ran', skill, assessMinEdge(proposal, Math.min(1, skill?.ceiling ?? 1)));
        if (!input) return unavailable('market data fetch returned nothing', skill, assessMinEdge(proposal, Math.min(1, skill?.ceiling ?? 1)));
        const out = runProgrammaticGate(input);
        const cap = skill?.ceiling !== undefined
            ? Math.min(out.confidenceCap, skill.ceiling)
            : out.confidenceCap;
        const minEdge = assessMinEdge(proposal, cap);
        const reason = out.pass
            ? `${(out.confidenceCap * 100).toFixed(0)}% cap — ${out.warnings.length > 0 ? out.warnings[0] : 'no penalties'}`
            : `insufficient data (${out.reason})`;
        return {
            status: 'evaluated',
            confidenceCap: cap,
            reason: skill?.ceiling !== undefined && skill.ceiling < out.confidenceCap
                ? `${reason}; code-checked skill ceiling ${(skill.ceiling * 100).toFixed(0)}%`
                : reason,
            stampedAt: new Date().toISOString(),
            ...(skill?.ceiling !== undefined ? { skillCeiling: skill.ceiling } : {}),
            ...(skill?.note ? { skillNote: skill.note } : {}),
            ...(minEdge.refusal ? { refusal: minEdge.refusal } : {}),
            ...(minEdge.netEdgeR !== undefined ? { netEdgeR: minEdge.netEdgeR } : {}),
            ...(minEdge.thresholdR !== undefined ? { minEdgeThresholdR: minEdge.thresholdR } : {}),
        };
    } catch (e) {
        // The market fetch failed, but the deterministic skill gate may still
        // have answered. Keep its ceiling rather than throwing the measurement
        // away with the fetch.
        const skill = await skillTask.catch(() => null);
        return unavailable(
            e instanceof Error ? e.message : String(e),
            skill,
            assessMinEdge(proposal, Math.min(1, skill?.ceiling ?? 1)),
        );
    }
};

/** Start the deterministic predicate evaluation for a plan. One place builds
 *  this signal, so the presentation scan and a stale-stamp re-scan cannot
 *  disagree about whether a fired trigger binds. Best-effort by design: a
 *  failed fetch means NO skill signal, never a fabricated one. */
export const buildSkillGate = (
    proposal: Pick<TradeProposal, 'symbol' | 'direction'>,
    runId?: string,
): Promise<SkillGateSignal | null> => (async () => {
    try {
        const { evaluateSkillPredicates } = await import('../learning/skillPredicateGate');
        const out = await evaluateSkillPredicates({
            coin: proposal.symbol,
            direction: proposal.direction,
            runId,
        });
        if (out.ceiling === undefined) return null;
        const names = out.fired.filter(f => f.kind === 'avoid').map(f => f.name);
        return { ceiling: out.ceiling, note: `avoid trigger: ${names.join(', ') || 'skill fired'}` };
    } catch {
        return null;
    }
})();

/** One in-flight scan per PLAN, so a model that re-presents the same plan (or a
 *  transcript that re-renders it) cannot start a second fetch per paint. */
const inFlight = new Map<string, { promise: Promise<ProposalGate>; controller: AbortController }>();

/** Start the scan for a plan, or join the one already running for that plan id. */
export const beginGateScan = (
    planId: string,
    proposal: PlanForGate,
    tradeHistory: LoggedTrade[] = [],
    skillGate?: Promise<SkillGateSignal | null>,
): Promise<ProposalGate> => {
    const live = inFlight.get(planId);
    if (live) return live.promise;
    const controller = new AbortController();
    const entry = { promise: runGateScan(proposal, tradeHistory, controller.signal, skillGate), controller };
    inFlight.set(planId, entry);
    // Drop the record once answered: `ensureStamp` then reads the stamp off the
    // proposal, and a genuinely stale one must be allowed to start a NEW scan.
    void entry.promise.finally(() => { if (inFlight.get(planId) === entry) inFlight.delete(planId); });
    return entry.promise;
};

/** Stop/unmount cancels the scan. The settled value is then an `unavailable`
 *  stamp, so the card falls to the confirm path instead of hanging. */
export const cancelGateScan = (planId: string): void => {
    const live = inFlight.get(planId);
    if (!live) return;
    inFlight.delete(planId);
    live.controller.abort();
};

export const isStampFresh = (gate?: ProposalGate): boolean => {
    if (!gate) return false;
    const at = Date.parse(gate.stampedAt);
    return Number.isFinite(at) && Date.now() - at <= GATE_STAMP_STALE_MS;
};

/** The ONE call every log path makes — the card's button and the automation sink
 *  both await this, so a row is never written beside a scan that could have been
 *  consulted. Fresh stamp → reuse. Scan running → join it. Neither → scan now. */
export const ensureStamp = async (
    proposal: TradeProposal,
    tradeHistory: LoggedTrade[] = [],
    signal?: AbortSignal,
): Promise<ProposalGate> => {
    if (isStampFresh(proposal.gate)) return proposal.gate as ProposalGate;
    if (proposal.planId) return await beginGateScan(proposal.planId, proposal, tradeHistory, buildSkillGate(proposal, proposal.planId));
    return await runGateScan(proposal, tradeHistory, signal, buildSkillGate(proposal));
};

/** One line for the tool receipt / the card, in the plan's own terms. */
export const gateReceiptLine = (gate: ProposalGate): string => {
    if (gate.refusal) return `Gate: REFUSED — ${gate.refusal}. The card will not offer "Log this trade"; do not ask the user to log it.`;
    const cap = Math.min(gate.confidenceCap, gate.skillCeiling ?? 1);
    return gate.status === 'evaluated' || gate.skillCeiling !== undefined
        ? `Gate: confidence capped at ${(cap * 100).toFixed(0)}% (${gate.reason}${gate.skillNote ? `; ${gate.skillNote}` : ''}).`
        : `Gate unavailable (${gate.reason}) — logging this plan needs an explicit confirm and it will be recorded UNCAPPED.`;
};
