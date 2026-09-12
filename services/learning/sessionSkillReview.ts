/**
 * sessionSkillReview — learn skills from the CONVERSATION, not only from
 * logged trades.
 *
 * Today a skill is born when a trade is LOGGED and closes (syncClosedTradeTo-
 * Notebook) or when the model explicitly proposes one. But the trader and the
 * model talk about many trades that never get logged — "I'd short here, stop
 * above 78k" — and those are lessons too. This pass, run every few Chart AI
 * sessions, reads the recent conversations, extracts each concrete trade
 * thesis discussed, SCORES it against the real price history that followed
 * (did TP or SL hit first?), and turns the resolved ones into skill DRAFTS:
 * a thesis that won → a `repeat` skill, one that lost → an `avoid` skill.
 *
 * It is deliberately conservative and human-gated, matching the app's existing
 * governance and the Hermes write-approval pattern:
 *   • it only ever QUEUES DRAFTS (utils/skillDrafts) into the approval inbox —
 *     nothing enters the live library without the trader approving it;
 *   • it skips theses still unresolved (no win/loss yet) and ones already
 *     drafted (fingerprint dedupe), so it never nags twice about the same idea;
 *   • every failure is swallowed — a background learning pass must never
 *     break the chat it is reviewing.
 *
 * The outcome scorer is pure and unit-tested; the extraction is one LLM call
 * following the same GenericProviderService path as the post-mortem.
 */

import type { ProviderConfig } from '../../types/provider';
import type { LoggedTrade } from '../../types';
import { sendChatRequest, type ChatMessage } from '../providers/GenericProviderService';
import { TASK_BUDGETS } from '../providers/taskBudgets';
import { effortForTask } from '../providers/reasoningControls';
import { extractAndParseJson } from '../../utils/jsonUtils';
import { listSkillDrafts } from '../../utils/skillDrafts';
import { fetchKlines } from '../analysis/KlineService';
import type { CraftedSkill } from '../../schemas/learning';
import { buildSyntheticTrade, gateEvidenceBackedDraft } from './draftGates';

/** A concrete trade the user and model discussed, as extracted from a chat. */
export interface DiscussedThesis {
    symbol: string;
    direction: 'Long' | 'Short';
    entry: number;
    stopLoss: number;
    takeProfit: number;
    /** The reasoning given at the time — becomes the skill's thesis. */
    thesis: string;
    /** Epoch ms of the message that proposed it (scoring starts here). */
    atMs: number;
    interval: string;
}

export type ThesisOutcome = 'win' | 'loss' | 'open';

/**
 * Pure: walk candles that printed AFTER the thesis and decide win/loss/open
 * by which level touched first. Conservative on an ambiguous bar (both SL and
 * TP inside one candle) → LOSS, because we cannot claim the favourable fill.
 * Direction-aware. `candles` must be oldest→newest and start at/after atMs.
 */
export const scoreHypotheticalTrade = (
    thesis: Pick<DiscussedThesis, 'direction' | 'stopLoss' | 'takeProfit'>,
    candles: { high: number; low: number }[],
): ThesisOutcome => {
    const { direction, stopLoss, takeProfit } = thesis;
    for (const c of candles) {
        if (direction === 'Long') {
            const hitSl = c.low <= stopLoss;
            const hitTp = c.high >= takeProfit;
            if (hitSl && hitTp) return 'loss';   // ambiguous bar — assume the stop
            if (hitSl) return 'loss';
            if (hitTp) return 'win';
        } else {
            const hitSl = c.high >= stopLoss;
            const hitTp = c.low <= takeProfit;
            if (hitSl && hitTp) return 'loss';
            if (hitSl) return 'loss';
            if (hitTp) return 'win';
        }
    }
    return 'open';
};

/** Stable dedupe key for a thesis (symbol+direction+rounded levels). */
export const thesisFingerprint = (t: DiscussedThesis): string =>
    `session:${t.symbol}:${t.direction}:${Math.round(t.entry)}:${Math.round(t.stopLoss)}:${Math.round(t.takeProfit)}`;

const COUNTER_KEY = 'session_review_counter_v1';
const DEDUPE_KEY = 'session_review_drafted_v1';

/**
 * Bump the per-user session counter; return true when a review is due (every
 * `every` sessions) and reset the counter. Cheap, synchronous, localStorage.
 */
export const recordSessionForReview = (username: string, every = 3): boolean => {
    try {
        const n = Number(localStorage.getItem(`${COUNTER_KEY}:${username}`) || '0') + 1;
        if (n >= every) {
            localStorage.setItem(`${COUNTER_KEY}:${username}`, '0');
            return true;
        }
        localStorage.setItem(`${COUNTER_KEY}:${username}`, String(n));
        return false;
    } catch {
        return false;
    }
};

const draftedKeys = (username: string): Set<string> => {
    try { return new Set(JSON.parse(localStorage.getItem(`${DEDUPE_KEY}:${username}`) || '[]') as string[]); } catch { return new Set(); }
};
const markDrafted = (username: string, keys: string[]): void => {
    try {
        const set = draftedKeys(username);
        for (const k of keys) set.add(k);
        localStorage.setItem(`${DEDUPE_KEY}:${username}`, JSON.stringify([...set].slice(-200)));
    } catch { /* best-effort */ }
};

/** One LLM call: pull concrete trade theses out of a conversation transcript.
 *  Returns [] on any failure (no provider, no JSON, malformed rows). */
export const extractDiscussedTrades = async (
    transcript: string,
    config: ProviderConfig,
    defaultSymbol: string,
    signal?: AbortSignal,
): Promise<DiscussedThesis[]> => {
    if (!transcript.trim() || transcript.trim().length < 40) return [];
    const prompt = [
        'From this trading chat transcript, list every CONCRETE trade idea the user or the assistant proposed — one with a direction AND at least an entry and a stop or target. Ignore vague talk.',
        'Return ONLY a JSON array (no prose) of objects: {"symbol","direction":"Long|Short","entry","stopLoss","takeProfit","thesis","interval"}.',
        '"thesis" is one sentence: the reason given. Use the chart symbol if none is named. Numbers as plain values.',
        'If there is no concrete trade, return [].',
        '',
        'TRANSCRIPT:',
        transcript.slice(-8000),
    ].join('\n');
    try {
        const raw = await sendChatRequest(
            config,
            [{ role: 'user', content: prompt } as ChatMessage],
            { maxTokens: TASK_BUDGETS.chat, temperature: 0.2, reasoningEffort: effortForTask('chat'), signal },
        );
        const parsed = extractAndParseJson(raw);
        const arr = Array.isArray(parsed) ? parsed : (parsed?.trades ?? []);
        if (!Array.isArray(arr)) return [];
        return arr.map((r: any): DiscussedThesis | null => {
            const direction = String(r?.direction ?? '').toLowerCase().startsWith('short') ? 'Short' : 'Long';
            const entry = Number(r?.entry); const stopLoss = Number(r?.stopLoss ?? r?.stop); const takeProfit = Number(r?.takeProfit ?? r?.target ?? r?.tp);
            if (!Number.isFinite(entry) || !Number.isFinite(stopLoss) || !Number.isFinite(takeProfit)) return null;
            // A sane plan: stop on the correct side of entry for the direction.
            if (direction === 'Long' && (stopLoss >= entry || takeProfit <= entry)) return null;
            if (direction === 'Short' && (stopLoss <= entry || takeProfit >= entry)) return null;
            return {
                symbol: String(r?.symbol ?? defaultSymbol ?? '').toUpperCase() || defaultSymbol,
                direction, entry, stopLoss, takeProfit,
                thesis: String(r?.thesis ?? '').slice(0, 240) || 'discussed trade',
                atMs: 0, // filled by the caller from the message timestamp
                interval: String(r?.interval ?? '15m'),
            };
        }).filter((x): x is DiscussedThesis => x !== null);
    } catch {
        return [];
    }
};

/** A recent Chart AI conversation to review. */
export interface ReviewableSession {
    id: string;
    /** Flattened user+assistant text. */
    transcript: string;
    /** Epoch ms of the conversation (scoring window start). */
    atMs: number;
    symbol: string;
}

/** The draft craft for a scored thesis — shared by the every-3 review pass
 *  and the event-driven resolver so both mint identical drafts. */
export const craftedSkillFromThesis = (thesis: DiscussedThesis, outcome: ThesisOutcome): CraftedSkill => ({
    name: `${thesis.symbol} ${thesis.direction} — ${outcome === 'win' ? 'worked' : 'failed'} (session review)`,
    kind: outcome === 'win' ? 'repeat' : 'avoid',
    when: `${thesis.direction} on ${thesis.symbol} near ${thesis.entry} with stop ${thesis.stopLoss}: ${thesis.thesis}`,
    inputs: ['price', 'levels'],
    steps: [
        `Entry ${thesis.entry}, stop ${thesis.stopLoss}, target ${thesis.takeProfit}.`,
        `Thesis from the chat: ${thesis.thesis}`,
        outcome === 'win' ? 'This played out — repeat when the same conditions line up.' : 'This lost — require extra confirmation or skip it.',
    ],
    validate: 'Levels and direction match the discussed setup before acting.',
    output: `${thesis.direction} plan with a defined stop and target.`,
    approval: 'Human-approved draft from a session review — not yet in the live library.',
    ifCondition: `IF ${thesis.symbol} ${thesis.direction.toLowerCase()} setup near ${thesis.entry} with stop ${thesis.stopLoss} THEN ${outcome === 'win' ? 'take it as a repeat' : 'skip or demand more confirmation'}`,
    thenAction: outcome === 'win'
        ? `Enter the ${thesis.direction.toLowerCase()} (this exact plan won in a past session).`
        : `Avoid the ${thesis.direction.toLowerCase()} (this exact plan lost in a past session).`,
});

/**
 * The review pass: for each recent session, extract theses, score each against
 * the klines that followed, and route the resolved ones through the evidence
 * gate (merge folds the outcome into a covered skill; create queues a draft
 * carrying a falsifiable prediction). Unresolved theses are CACHED so the
 * event-driven resolver (runThesisResolver) can land them the moment new
 * bars resolve them — no waiting for the next counter boundary. Returns how
 * many drafts were queued. Never throws.
 */
export const runSessionSkillReview = async (
    username: string,
    sessions: ReviewableSession[],
    config: ProviderConfig,
    allTrades: LoggedTrade[] = [],
): Promise<number> => {
    let queued = 0;
    const already = draftedKeys(username);
    const existingDraftIds = new Set(listSkillDrafts(username).map(d => d.tradeId));
    for (const session of sessions.slice(-6)) {
        const theses = await extractDiscussedTrades(session.transcript, config, session.symbol);
        for (const thesis of theses) {
            const fp = thesisFingerprint(thesis);
            if (already.has(fp) || existingDraftIds.has(fp)) continue;
            let candles;
            try {
                const kl = await fetchKlines(thesis.symbol, thesis.interval || '15m', 120);
                candles = kl.filter(k => k.time * 1000 >= (session.atMs || 0));
            } catch { continue; }
            const outcome = scoreHypotheticalTrade(thesis, candles);
            if (outcome === 'open') {
                cacheOpenThesis(username, session.id, thesis);
                continue; // not resolved yet — the resolver revisits as bars print
            }
            const result = await gateEvidenceBackedDraft({
                crafted: craftedSkillFromThesis(thesis, outcome),
                tradeId: fp,
                username,
                config,
                allTrades,
                coin: thesis.symbol.replace(/USDT?$/, ''),
                direction: thesis.direction,
                cluster: [buildSyntheticTrade({
                    id: fp,
                    coin: thesis.symbol,
                    direction: thesis.direction,
                    outcome: outcome === 'win' ? 'win' : 'loss',
                    thesis: thesis.thesis,
                    atMs: session.atMs || Date.now(),
                })],
                botContext: thesis.thesis,
            });
            if (result.action === 'queued') queued += 1;
            // Judged once — merged/skipped/queued theses never re-nag.
            markDrafted(username, [fp]);
            dropOpenThesis(username, fp);
        }
        markDrafted(username, [`${session.id}`]);
    }
    return queued;
};

// ─── Event-driven resolution (runs on EVERY send, throttled) ────────────────
// The every-3 counter only decides when EXTRACTION runs. Resolution is
// evidence-weighted: a cached unresolved thesis is re-scored against fresh
// klines and lands in the Inbox the moment price actually resolves it.

const THESIS_CACHE_KEY = 'session_review_open_theses_v1';
const RESOLVER_THROTTLE_KEY = 'session_review_resolver_v1';
const RESOLVER_THROTTLE_MS = 10 * 60_000;
/** Unresolved theses age out — a 2-week-old "entry" was never going to hit. */
const OPEN_THESIS_TTL_MS = 14 * 86_400_000;

interface OpenThesis extends DiscussedThesis {
    sessionId: string;
    cachedAtMs: number;
}

const readOpenTheses = (username: string): OpenThesis[] => {
    try {
        const parsed = JSON.parse(localStorage.getItem(`${THESIS_CACHE_KEY}:${username}`) || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

const writeOpenTheses = (username: string, rows: OpenThesis[]): void => {
    try {
        localStorage.setItem(`${THESIS_CACHE_KEY}:${username}`, JSON.stringify(rows.slice(-60)));
    } catch { /* best-effort */ }
};

/** Remember a discussed thesis that price hasn't resolved yet. */
export const cacheOpenThesis = (username: string, sessionId: string, thesis: DiscussedThesis): void => {
    const rows = readOpenTheses(username).filter(t => thesisFingerprint(t) !== thesisFingerprint(thesis));
    rows.push({ ...thesis, sessionId, cachedAtMs: Date.now() });
    writeOpenTheses(username, rows);
};

export const dropOpenThesis = (username: string, fp: string): void => {
    writeOpenTheses(username, readOpenTheses(username).filter(t => thesisFingerprint(t) !== fp));
};

/**
 * Event-driven pass: re-score every cached unresolved thesis; a newly
 * resolved one goes through the evidence gate immediately. Throttled to one
 * run per 10 minutes so a chatty session doesn't hammer the klines endpoint.
 * Returns how many drafts were queued. Never throws.
 */
export const runThesisResolver = async (
    username: string,
    config: ProviderConfig,
    allTrades: LoggedTrade[] = [],
): Promise<number> => {
    try {
        const last = Number(localStorage.getItem(`${RESOLVER_THROTTLE_KEY}:${username}`) || '0');
        if (Date.now() - last < RESOLVER_THROTTLE_MS) return 0;
        localStorage.setItem(`${RESOLVER_THROTTLE_KEY}:${username}`, String(Date.now()));
    } catch { /* no throttle storage — proceed unthrottled */ }
    const open = readOpenTheses(username);
    if (open.length === 0) return 0;
    const already = draftedKeys(username);
    const existingDraftIds = new Set(listSkillDrafts(username).map(d => d.tradeId));
    const keep: OpenThesis[] = [];
    let queued = 0;
    for (const thesis of open) {
        const fp = thesisFingerprint(thesis);
        if (already.has(fp) || existingDraftIds.has(fp)) continue; // handled by the review pass meanwhile
        try {
            const kl = await fetchKlines(thesis.symbol, thesis.interval || '15m', 120);
            const candles = kl.filter(k => k.time * 1000 >= (thesis.atMs || 0));
            const outcome = scoreHypotheticalTrade(thesis, candles);
            if (outcome === 'open') {
                if (Date.now() - thesis.cachedAtMs < OPEN_THESIS_TTL_MS) keep.push(thesis);
                continue;
            }
            const result = await gateEvidenceBackedDraft({
                crafted: craftedSkillFromThesis(thesis, outcome),
                tradeId: fp,
                username,
                config,
                allTrades,
                coin: thesis.symbol.replace(/USDT?$/, ''),
                direction: thesis.direction,
                cluster: [buildSyntheticTrade({
                    id: fp,
                    coin: thesis.symbol,
                    direction: thesis.direction,
                    outcome: outcome === 'win' ? 'win' : 'loss',
                    thesis: thesis.thesis,
                    atMs: thesis.atMs || Date.now(),
                })],
                botContext: thesis.thesis,
            });
            if (result.action === 'queued') queued += 1;
            markDrafted(username, [fp]);
        } catch {
            keep.push(thesis); // a failed klines fetch must not lose the thesis
        }
    }
    writeOpenTheses(username, keep);
    return queued;
};
