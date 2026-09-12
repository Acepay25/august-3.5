/**
 * bookSkillDrafts — the strategy PDFs in `Pdf's Strategies`, turned into
 * candidate skills the human approves.
 *
 * Each entry is the machine-checkable core of one book's playbook, written as
 * an IF/THEN skill. They are queued as PENDING DRAFTS (the same inbox the
 * post-mortem crafts use) — nothing enters the live library until the trader
 * approves it in the Coach inbox / Settings → Skills. One-time and idempotent:
 * a localStorage flag guards the seeding, so approving or dismissing a draft
 * is never undone by a later boot, and user edits are never clobbered.
 *
 * This is deliberately separate from seedStrategies.ts (which lands book
 * priors directly as `candidate` skills). These came from the trader's OWN
 * PDF library, so they go through the human gate rather than the auto-prior
 * path.
 */

import { queueSkillDraft, listSkillDrafts } from '../../utils/skillDrafts';
import type { CraftedSkill } from '../../schemas/learning';
import { deterministicDraftGate } from './draftGates';

const SEED_FLAG = 'book_drafts_seeded_v1';

interface BookDraft {
    slug: string;
    source: string;
    crafted: CraftedSkill;
}

const D = (
    slug: string,
    source: string,
    name: string,
    kind: 'repeat' | 'avoid',
    when: string,
    steps: string[],
    validate: string,
    output: string,
    approval: string,
    ifCondition: string,
    thenAction: string,
): BookDraft => ({
    slug,
    source,
    crafted: {
        name, kind, when,
        inputs: ['candles', 'range/levels', 'indicators as noted'],
        steps, validate, output, approval, ifCondition, thenAction,
    },
});

export const BOOK_SKILL_DRAFTS: BookDraft[] = [
    D('book-breakout-retest', 'Breakout-Trading-Strategies-Quick-Guide',
        'Repeat: breakout then retest continuation', 'repeat',
        'Price closes beyond a well-tested range high/low, then pulls back to retest the broken level without closing back through it.',
        ['Mark the range extreme the break cleared', 'Wait for a retest that holds beyond the level', 'Enter on the resumption candle in the break direction', 'Stop beyond the retest low/high'],
        'The retest must hold — a close back inside the range voids it',
        'Directional entry with a defined stop at the failed-retest level',
        'Only when the break bar had a full body and above-average range',
        'IF price closes beyond the range extreme and the retest holds on the far side THEN enter with the break, stop beyond the retest',
        'Do not chase the first breakout candle before the retest confirms'),
    D('book-failed-breakout-fade', 'Reversal-Trading-Strategies-for-All-Markets',
        'Avoid: chasing a breakout that fails inside two bars', 'avoid',
        'A breakout candle is immediately followed by a close back inside the prior range.',
        ['Detect the break close beyond the prior extreme', 'Watch the next one or two bars', 'A close back inside marks the trap'],
        'The reversal close must be decisive (beyond the break bar midpoint)',
        'Fade entry against the trapped breakout, stop beyond the fake extreme',
        'Strongest when the break bar itself was weak (small body, long wick)',
        'IF a breakout closes back inside the range within two bars THEN fade it and stop beyond the false extreme',
        'Never add to a position after the breakout has failed'),
    D('book-gap-exhaustion-fade', 'Gap-Trading-Strategies-Quick-Guide',
        'Repeat: exhaustion gap reversion', 'repeat',
        'A gap opens in the direction of an already-stretched run (3+ same-color bars) on an outsized range bar.',
        ['Confirm the run into the gap was stretched', 'Classify the gap as exhaustion', 'Wait for the first sign of a retrace', 'Target the gap fill / prior bar close'],
        'The gap must still be unfilled when the fade triggers',
        'Reversion entry toward the gap origin, stop beyond the gap extreme',
        'Only against a parabolic-looking run, not a fresh breakaway',
        'IF an unfilled gap follows 3+ same-direction bars on a >=1.8x range bar THEN play the fill back toward the gap origin',
        'Do not fade breakaway gaps out of tight bases — those continue'),
    D('book-breakaway-gap-join', 'Gap-Trading-Strategies-Quick-Guide',
        'Repeat: breakaway gap continuation', 'repeat',
        'A gap opens out of a compressed, tight base with expanding range and no immediate fill.',
        ['Identify the tight range before the gap', 'Confirm the gap cleared it decisively', 'Enter on the first shallow pullback toward the gap edge', 'Stop below the gap origin'],
        'The gap must stay unfilled through the entry',
        'Continuation entry in the gap direction',
        'Only with volume/range expansion on the gap bar',
        'IF a gap breaks out of a compressed base and stays unfilled THEN join the direction on the first pullback',
        'Never short a breakaway gap on the first red bar'),
    D('book-pin-bar-range-fade', 'Pin-Bar-Trading-Strategies',
        'Repeat: pin bar rejection at a range edge', 'repeat',
        'A pin bar (wick >= 2.5x body, body < 1/3 range) prints at the top or bottom of the recent range.',
        ['Confirm the wick rejects the range extreme', 'Enter on the close or next-bar open', 'Stop beyond the wick tip', 'Target the range midpoint'],
        'The rejection must be AT the tested level, not mid-range',
        'Reversal entry with the wick as the invalidation',
        'Stronger when the prior bar was a failed breakout',
        'IF a pin bar with a >=2.5x wick rejects the range extreme THEN fade back toward mid-range, stop beyond the wick',
        'Ignore pin bars in the middle of nowhere'),
    D('book-inside-bar-break', 'Inside-Bar-Trading-Strategies',
        'Repeat: inside-bar mother resolution', 'repeat',
        'An inside bar forms after a directional move and the next candle closes outside the mother bar.',
        ['Mark the mother bar high/low', 'Wait for a close beyond the mother in the trend direction', 'Enter on the break close', 'Stop at the mother bar midpoint'],
        'The inside bar must follow a clear impulse, not chop',
        'Breakout entry with a tight, defined stop',
        'Best aligned with the higher-timeframe trend',
        'IF an inside bar after an impulse resolves with a close outside the mother THEN trade the break, stop at the mother midpoint',
        'Do not pre-empt the resolution — no entry inside the mother range'),
    D('book-rsi-divergence-reversal', 'Relative-Strength-Index-Strategies-Quick-Guide',
        'Repeat: RSI divergence at a swing extreme', 'repeat',
        'Price prints a lower low while RSI prints a higher low (or the inverse at highs) near a tested level.',
        ['Confirm the price swing extreme', 'Confirm the RSI swing disagrees (divergence)', 'Wait for a trigger candle against the old trend', 'Stop beyond the price extreme'],
        'Divergence alone is not a signal — the trigger candle is required',
        'Reversal entry with divergence as the thesis',
        'Strongest at range extremes and after stretched runs',
        'IF price makes a lower low while RSI makes a higher low and a trigger candle closes up THEN go long against the prior leg',
        'Never trade divergence without the confirming trigger'),
    D('book-band-mean-reversion', 'Bands Explained + Mean-reversion-trading-strategies',
        'Repeat: band tag with reversal candle', 'repeat',
        'A close pierces the lower (upper) Bollinger band and the next candle closes back inside as a green (red) bar.',
        ['Confirm the band pierce', 'Wait for the close-back-inside reversal bar', 'Enter toward the mid-band', 'Stop beyond the pierce extreme'],
        'Only in ranging markets — check ADX/regime first',
        'Mean-reversion entry targeting the mid-band',
        'Void if a band walk (3+ closes outside) is in progress',
        'IF price closes outside a band then back inside on a reversal bar THEN target the mid-band',
        'Do not fade a band walk — that is momentum, not reversion'),
    D('book-band-walk-momentum', 'Bands Explained + Momentum-Trading-Strategies-Free-PDF',
        'Repeat: band walk continuation', 'repeat',
        'Three or more consecutive closes outside the same Bollinger band with expanding range.',
        ['Count the consecutive outside closes', 'Enter with the walk on any shallow retrace', 'Trail the stop at the mid-band'],
        'The walk must be unbroken — an inside close ends it',
        'Momentum continuation entry, mid-band as the trail',
        'Only while the band walk holds',
        'IF 3+ closes ride outside the same band THEN stay with the move and trail at the mid-band',
        'Never fade a band walk because it "looks overextended"'),
    D('book-trend-pullback-second-entry', "Al Brooks - Trading Price Action (Trends)",
        'Repeat: pullback to rising EMA, second entry', 'repeat',
        'In a trend (EMA20 rising/falling), price pulls back to the EMA and resumes with a signal bar.',
        ['Establish the EMA slope', 'Wait for the pullback to tag the EMA zone', 'Enter on the resumption bar past the pullback extreme', 'Stop at the pullback origin'],
        'The resumption bar must close beyond the prior bar',
        'Second-entry trend continuation with a structured stop',
        'Skip when the market is ranging (flat EMA, low ADX)',
        'IF an uptrend pulls back to the rising EMA and closes back above it THEN take the second entry long',
        'Do not take first entries after a long stretch — wait for the pullback'),
    D('book-range-edge-fade', 'Range-Trading-Strategies-Quick-Guide + Positional-Trading-Strategies-Guide',
        'Repeat: range-edge fade with ATR-sized stop', 'repeat',
        'Price reaches a well-tested range edge with a rejection bar and no breakout follow-through.',
        ['Confirm at least two prior tests of the edge', 'Enter on the rejection bar', 'Size the stop at >=1x ATR beyond the edge', 'Target the opposite side or mid-range'],
        'The edge must be tested, not fresh',
        'Fade entry with ATR-based sizing',
        'Void on a breakout close with body beyond the edge',
        'IF price rejects a twice-tested range edge THEN fade toward mid-range with a >=1x ATR stop',
        'Never fade a fresh, untested high or low'),
    D('book-momentum-thrust-continuation', 'Momentum-Trading-Strategies-Free-PDF + Profitable-Chart-Patterns-Trading-Guide',
        'Repeat: impulse thrust continuation', 'repeat',
        'An impulse bar (>=1.8x average range) closes at its extreme in the trend direction.',
        ['Confirm the impulse close near its extreme', 'Enter on a shallow retrace (not the full bar)', 'Stop below the impulse origin', 'Add only on the next base'],
        'The retrace must stay shallow — a deep retrace kills momentum',
        'Continuation entry riding the thrust',
        'Aligned with higher-timeframe direction only',
        'IF an impulse bar closes at its extreme THEN buy the first shallow retrace, stop below the impulse start',
        'Do not enter after the second extension of the same thrust'),
];

/**
 * Queue the book drafts once. Returns how many were newly queued (0 when the
 * flag is already set, or the store is unavailable). Safe to call on every
 * profile load.
 *
 * Each draft passes the deterministic gate before queueing: a rejected
 * trigger's tombstone cooldown, pending-duplicate skip, live-library
 * coverage skip, IF/THEN sanity, and a falsifiable default prediction
 * attached when the entry has none. Deliberately NO LLM worth gate here —
 * seeding runs on every profile load and must not fire a dozen provider
 * calls; these are pre-curated and stay human-gated in the inbox.
 */
export const ensureBookSkillDrafts = (username?: string): number => {
    try {
        if (localStorage.getItem(SEED_FLAG)) return 0;
        localStorage.setItem(SEED_FLAG, '1');
    } catch {
        return 0;
    }
    const existing = new Set(listSkillDrafts(username).map(d => d.tradeId));
    let queued = 0;
    for (const d of BOOK_SKILL_DRAFTS) {
        const tradeId = `book:${d.slug}`;
        if (existing.has(tradeId)) continue;
        const gate = deterministicDraftGate({ crafted: d.crafted, tradeId, username });
        if (!gate.ok) continue;
        queueSkillDraft({ tradeId, coin: undefined, crafted: gate.crafted }, username);
        queued += 1;
    }
    return queued;
};
