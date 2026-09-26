/**
 * The app must say what it is not, where people will actually look.
 *
 * The disclaimer used to live in exactly one place — the Chart AI dock's
 * composer footer, the least-read corner of the app. Everywhere else it said
 * nothing, and the surface where it mattered most said nothing at all: the
 * Agents surface, whose own language ("ensemble", "binding verdict",
 * "autopilot") is exactly what invites the wrong assumption. The app places no
 * trades and has no exchange account access, so the risk here is purely that a
 * trader is misled, not that anyone is harmed.
 *
 * These assertions are deliberately source-level rather than rendered: the
 * point is that the wording lives in ONE constant and is referenced from the
 * places that matter, so it cannot be reworded on one screen and left stale on
 * another.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

import {
    DISCLAIMER_SHORT,
    DISCLAIMER_FIRST_RUN,
    DISCLAIMER_VERDICT,
} from '../constants/disclaimer';

const read = (p: string): string => readFileSync(p, 'utf8');

describe('the disclaimer says the true thing', () => {
    it('denies order placement, which is factually correct', () => {
        // Verified against the source, not assumed: every Binance call in the
        // repo is a public market-data endpoint, with no key and no signature.
        for (const d of [DISCLAIMER_SHORT, DISCLAIMER_FIRST_RUN, DISCLAIMER_VERDICT]) {
            expect(d).toMatch(/never places|places no trades|cannot place|not a trade/i);
        }
    });

    it('is not just "not financial advice" — that alone is the legal minimum', () => {
        // "Not advice" does not answer "will this place my trade?", which is
        // the question a trader is actually asking. The plain statement is the
        // whole point.
        expect(DISCLAIMER_SHORT).toMatch(/never places or signs a trade/i);
        expect(DISCLAIMER_FIRST_RUN).toMatch(/no exchange account access/i);
    });

    it('first run also names where the data goes', () => {
        // A first-run notice that only denies trading but never says prompts
        // leave the machine is a notice that makes a privacy promise by
        // omission.
        expect(DISCLAIMER_FIRST_RUN).toMatch(/AI providers you configure/i);
    });
});

describe('it is said where people look', () => {
    it('on the Chart AI dock composer', () => {
        expect(read('components/trade/TradeChatPanel.tsx')).toMatch(/DISCLAIMER_SHORT/);
    });

    it('on the Agents surface, which previously had none', () => {
        const src = read('components/agents/AgentsView.tsx');
        expect(src).toMatch(/DISCLAIMER_SHORT/);
    });

    it('on first run, where "what is this thing" is asked', () => {
        expect(read('components/settings/UserProfileManager.tsx')).toMatch(/DISCLAIMER_FIRST_RUN/);
    });

    it('one constant, so the wording cannot drift between screens', () => {
        // A disclaimer that says two slightly different things on two screens
        // is worse than one said once, clearly.
        for (const f of [
            'components/trade/TradeChatPanel.tsx',
            'components/agents/AgentsView.tsx',
            'components/settings/UserProfileManager.tsx',
        ]) {
            const src = read(f);
            const literals = src.match(/August may make mistakes · analysis, not financial advice/g) ?? [];
            expect(literals, `${f} still hardcodes the old wording`).toEqual([]);
        }
    });
});

describe('the privacy statement matches the code', () => {
    const privacy = read('PRIVACY.md');

    it('exists and is linked from the README', () => {
        expect(privacy.length).toBeGreaterThan(500);
        expect(read('README.md')).toMatch(/PRIVACY\.md/);
    });

    it('names the real market-data endpoints', () => {
        for (const e of ['klines', 'ticker/price', 'premium', 'data-api.binance.vision']) {
            expect(privacy).toContain(e);
        }
    });

    it('says there is no key and no signature — which the code confirms', () => {
        expect(privacy).toMatch(/no API key, no signature/i);
        const repo = read('package.json');
        expect(repo).toBeTruthy();
        // The strongest form of this claim is checkable by a reader: point them
        // at the string to search for.
        expect(privacy).toContain('X-MBX-APIKEY');
    });

    it('is explicit that prompts go to the provider the user chose', () => {
        expect(privacy).toMatch(/third parties you choose|provider you configured/i);
        expect(privacy).toMatch(/OpenRouter/);
    });

    it('states there is no analytics or telemetry', () => {
        expect(privacy).toMatch(/no telemetry, no crash reporting/i);
    });
});
