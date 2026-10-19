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

const unavailable = (reason: string): ProposalGate => ({
    status: 'unavailable', confidenceCap: 1, reason, stampedAt: new Date().toISOString(),
});

/** Run ONE scan. Never throws: every failure path returns an `unavailable` stamp,
 *  because a plan must be loggable (behind a confirm) with the reason attached. */
export const runGateScan = async (
    proposal: Pick<TradeProposal, 'symbol'>,
    tradeHistory: LoggedTrade[] = [],
    signal?: AbortSignal,
): Promise<ProposalGate> => {
    if (signal?.aborted) return unavailable('stopped before the gate ran');
    try {
        const input = await withTimeout(fetchGateInputData(proposal.symbol, tradeHistory), GATE_FETCH_TIMEOUT_MS);
        // A Stop can land while the fetch is in flight. The fetch itself has no
        // signal (it goes through the shared market service), so the result is
        // discarded here: a cancelled turn must not settle an evaluated stamp.
        if (signal?.aborted) return unavailable('stopped before the gate ran');
        if (!input) return unavailable('market data fetch returned nothing');
        const out = runProgrammaticGate(input);
        return {
            status: 'evaluated',
            confidenceCap: out.confidenceCap,
            reason: out.pass
                ? `${(out.confidenceCap * 100).toFixed(0)}% cap — ${out.warnings.length > 0 ? out.warnings[0] : 'no penalties'}`
                : `insufficient data (${out.reason})`,
            stampedAt: new Date().toISOString(),
        };
    } catch (e) {
        return unavailable(e instanceof Error ? e.message : String(e));
    }
};

/** One in-flight scan per PLAN, so a model that re-presents the same plan (or a
 *  transcript that re-renders it) cannot start a second fetch per paint. */
const inFlight = new Map<string, { promise: Promise<ProposalGate>; controller: AbortController }>();

/** Start the scan for a plan, or join the one already running for that plan id. */
export const beginGateScan = (
    planId: string,
    proposal: Pick<TradeProposal, 'symbol'>,
    tradeHistory: LoggedTrade[] = [],
): Promise<ProposalGate> => {
    const live = inFlight.get(planId);
    if (live) return live.promise;
    const controller = new AbortController();
    const entry = { promise: runGateScan(proposal, tradeHistory, controller.signal), controller };
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
    if (proposal.planId) return await beginGateScan(proposal.planId, proposal, tradeHistory);
    return await runGateScan(proposal, tradeHistory, signal);
};

/** One line for the tool receipt / the card, in the plan's own terms. */
export const gateReceiptLine = (gate: ProposalGate): string => gate.status === 'evaluated'
    ? `Gate: confidence capped at ${(gate.confidenceCap * 100).toFixed(0)}% (${gate.reason}).`
    : `Gate unavailable (${gate.reason}) — logging this plan needs an explicit confirm and it will be recorded UNCAPPED.`;
