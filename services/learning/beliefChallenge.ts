/**
 * §8.4d — settled beliefs need a challenge path (plan §8.4d).
 *
 * Only the doctrine rewriter can INVALIDATE a belief — a `settled` belief is
 * effectively unchallengeable by data. This module gives one: a deterministic
 * rolling-window counter per belief slug, incremented on closed WIN trades
 * whose DIRECTION contradicts the belief's observable claim (e.g. "never
 * short into premium" is contradicted by a WON short in premium). At ≥3
 * contradictions in the window the belief is auto-FLAGGED for review through
 * the learning queue (a review card) — NEVER auto-invalidated. "Settled" must
 * mean hard to change, not unchallengeable.
 */

import { getPreferenceObject, setPreferenceObject } from '../infrastructure/PreferencesService';
import { listActiveBeliefs } from './settledBeliefs';
import { queueLearningProposal } from '../../utils/learningQueue';
import { LoggedTrade } from '../../types/trade';
import { TradeOutcome } from '../../types/enums';

const KEY_PREFIX = 'belief_challenge_v1_';
const WINDOW_DAYS = 30;
const FLAG_THRESHOLD = 3;

export interface BeliefContradictionEvent {
    slug: string;
    ts: string;
    tradeId: string;
}

const keyFor = (username: string): string =>
    `${KEY_PREFIX}${(username || 'default').trim() || 'default'}`;

const read = async (username: string): Promise<BeliefContradictionEvent[]> => {
    try {
        const raw = await getPreferenceObject<BeliefContradictionEvent[]>(keyFor(username));
        return Array.isArray(raw) ? raw.filter(e => e && typeof e.slug === 'string') : [];
    } catch {
        return [];
    }
};

const write = async (username: string, events: BeliefContradictionEvent[]): Promise<void> => {
    try {
        await setPreferenceObject(keyFor(username), events.slice(-200));
    } catch { /* challenge path is best-effort */ }
};

/** The direction the belief's observable claim WARNS AGAINST (e.g.
 *  "never short into premium" → 'short' — a WIN short contradicts it). */
export const contestedDirection = (body: string): 'long' | 'short' | null => {
    const m = (body || '').toLowerCase().match(/(?:never|avoid|don't|dont|skip|no|against)[^.;\n]{0,60}?\b(long|short|buy|sell)\b/i);
    if (!m) return null;
    const w = m[1].toLowerCase();
    if (w === 'buy') return 'long';
    if (w === 'sell') return 'short';
    return w as 'long' | 'short';
};

/** Context tokens in the belief's body (coin symbols + regime/family words) —
 *  a contradiction must be about the SAME context, not a different one. */
export const contextTokens = (body: string): string[] => {
    const s = body || '';
    const symbols = s.toUpperCase().match(/\b[A-Z]{2,10}(?:USDT?)?\b/g) ?? [];
    const words = ['premium','discount','sweep','reclaim','london','asia','ny','nyc','trend','chop','ranging','volatile','compression','news','high','low']
        .filter(w => s.toLowerCase().includes(w));
    return [...new Set([...symbols.map(x => x.toLowerCase()), ...words])];
};

const tradeContext = (t: LoggedTrade): string => [
    t.analysis?.coinName,
    t.analysis?.detectedPatternFamily,
    t.marketRegime,
].filter(Boolean).join(' ');

const directionOfTrade = (t: LoggedTrade): 'long' | 'short' | null => {
    const d = (t.analysis?.direction || '').toLowerCase();
    return d === 'long' ? 'long' : d === 'short' ? 'short' : null;
};

/** Deterministic pass (read-side, no runtime hook): fold recent closed WIN
 *  trades into the contradiction counters, flag at the threshold, and queue a
 *  review card (never invalidate). Returns the number of NEW flags. */
export const runBeliefChallengePass = async (username: string, trades: LoggedTrade[]): Promise<number> => {
    const beliefs = listActiveBeliefs();
    const bySlug = new Map(beliefs.map(b => [b.slug, b] as const));
    if (beliefs.length === 0) return 0;
    const cutoff = Date.now() - WINDOW_DAYS * 86_400_000;
    let events = (await read(username)).filter(e => Date.parse(e.ts) > cutoff);
    const existing = new Set(events.map(e => `${e.slug}|${e.tradeId}`));
    let newFlags = 0;

    for (const t of trades) {
        if (t.outcome !== TradeOutcome.WIN || !t.id || !t.timestamp) continue;
        if (Date.parse(t.timestamp) < cutoff) continue;
        const td = directionOfTrade(t);
        if (!td) continue;
        const ctx = contextTokens(tradeContext(t));
        for (const belief of beliefs) {
            const warned = contestedDirection(belief.body);
            if (!warned || warned !== td) continue;
            const bctx = contextTokens(belief.body);
            // Same context required (symbol/family/regime intersection) unless
            // the belief is global (no context tokens).
            if (bctx.length > 0 && !bctx.some(w => ctx.includes(w))) continue;
            const key = `${belief.slug}|${t.id}`;
            if (existing.has(key)) continue;
            events.push({ slug: belief.slug, ts: t.timestamp, tradeId: t.id });
            existing.add(key);
            const count = events.filter(e => e.slug === belief.slug).length;
            if (count >= FLAG_THRESHOLD) {
                const proposal = queueLearningProposal({
                    kind: 'contradiction',
                    skillSlug: belief.slug,
                    text: `Settled belief "${belief.slug}" has been contradicted by ${count} winning ${warned} trades in ${WINDOW_DAYS} days (latest: ${t.id}) — challenge it in review. NEVER auto-invalidated; a human decides.`,
                    fingerprint: `belief|${belief.slug}`,
                    payload: { slug: belief.slug, contradictions: count },
                }, username);
                if (proposal) newFlags += 1;
            }
        }
    }

    events = events.sort((a, b) => b.ts.localeCompare(a.ts)).slice(-200);
    await write(username, events);
    return newFlags;
};
