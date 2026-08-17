import { describe, it, expect } from 'vitest';
import { parseProvisionalVerdict } from '../utils/provisionalVerdict';

const PLAN = `**FINAL TRADE PLAN**
- **Coin:** BTCUSDT
- **Direction:** Long
- **Entry:** 95000 — Support retest
- **Stop Loss:** 94500
- **Take Profit 1:** 96000 (2%)
- **Take Profit 2:** 97000 (4%)
- **Confidence:** Medium
- **Probability:** 60%
- **Strategy:** Trend continuation`;

describe('parseProvisionalVerdict (progressive verdict)', () => {
  it('returns null while the stream is empty', () => {
    expect(parseProvisionalVerdict('', '')).toBeNull();
  });

  it('returns null for a partial plan (no stop loss yet)', () => {
    const partial = `**FINAL TRADE PLAN**
- **Coin:** BTCUSDT
- **Direction:** Long
- **Entry:** 95000`;
    expect(parseProvisionalVerdict(partial, partial)).toBeNull();
  });

  it('parses a binding plan from the moderator turn before DEBATE_END', () => {
    const verdict = `The floor agrees on momentum.\n\n${PLAN}`;
    const provisional = parseProvisionalVerdict(verdict, verdict);
    expect(provisional).not.toBeNull();
    expect(provisional!.direction).toBe('Long');
    expect(provisional!.coinName).toBe('BTCUSDT');
    expect(provisional!.stopLoss).toBeDefined();
  });

  it('prefers the text after </DEBATE_END> over the full stream', () => {
    // Clarification-style noise before the marker must not leak into the card.
    const stream = `**Moderator:** What is your invalidation?\n</DEBATE_END>\n${PLAN}`;
    const provisional = parseProvisionalVerdict(stream, stream);
    expect(provisional).not.toBeNull();
    expect(provisional!.direction).toBe('Long');
    expect(provisional!.strategy).not.toContain('invalidation');
  });

  it('accepts an Avoid verdict without entry/stop fields', () => {
    const avoid = `**FINAL TRADE PLAN**
- **Coin:** BTCUSDT
- **Direction:** Neutral
- **Confidence:** Avoid
- **Strategy:** No edge — stand aside`;
    const provisional = parseProvisionalVerdict(avoid, avoid);
    expect(provisional).not.toBeNull();
    expect(provisional!.confidence).toBe('Avoid');
  });
});
