import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import InlineVerdict from '../components/analysis/InlineVerdict';
import type { TradeAnalysis } from '../types';

/**
 * A quarantined verdict is a MEASUREMENT FAILURE, never an opinion.
 *
 * When an integrity gate overrides the direction — no aligned analyst cited,
 * ungrounded levels, an unparseable or truncated plan — `direction` is left at
 * 'Neutral' so every downstream consumer stays safe. Safe is not the same as
 * INFORMED: the card then draws a confident no-trade badge over a plan nobody
 * could read, and the trader has no way to tell that from a deliberate pass.
 *
 * The Journal's row had said so all along; the conversation's verdict card did
 * not, so ONE plan read two ways on two surfaces of the same app. These tests
 * hold the two halves of the fix: the card says it, and the sentence has ONE
 * home — a hand-copied second badge is how the two drifted apart to begin with.
 */

const analysis = (over: Partial<TradeAnalysis> = {}): TradeAnalysis => ({
    direction: 'Neutral', confidence: 'Low', entryPoints: [], takeProfit: [],
    reasoning: '', ...over,
} as TradeAnalysis);

/** Every component source under components/. */
const componentFiles = (): string[] => {
    const out: string[] = [];
    const walk = (dir: string): void => {
        for (const name of readdirSync(dir)) {
            const p = join(dir, name);
            if (statSync(p).isDirectory()) walk(p);
            else if (name.endsWith('.tsx')) out.push(p);
        }
    };
    walk('components');
    return out;
};

describe('the quarantined-verdict badge', () => {
    it('tells the trader a quarantined plan was not a verdict at all', () => {
        render(<InlineVerdict analysis={analysis({ verdictReview: { reason: 'truncated-plan', from: 'Long' } })} />);

        const badge = screen.getByTestId('verdict-review');
        expect(badge.textContent).toBe('Review');
        // The REASON reaches the tooltip, not just the word "Review": which gate
        // fired is the difference between "the model hedged" and "we could not
        // read the plan", and only the second one is a bug report.
        expect(badge.getAttribute('title')).toContain('truncated-plan');
        expect(badge.getAttribute('title')).toMatch(/not a neutral opinion/i);
    });

    it('stays off a verdict no gate overrode', () => {
        render(<InlineVerdict analysis={analysis({ direction: 'Long', confidence: 'High' })} />);

        expect(screen.queryByTestId('verdict-review')).toBeNull();
    });

    it('writes the words once — the two homes cannot drift again', () => {
        const owners = componentFiles()
            .filter(f => readFileSync(f, 'utf8').includes('Quarantined verdict ('))
            .map(f => f.replace(/\\/g, '/').split('/').pop());

        expect(owners).toEqual(['StatusPill.tsx']);
    });

    it('has both surfaces drawing that one component', () => {
        for (const file of ['components/journal/TradeLog.tsx', 'components/analysis/InlineVerdict.tsx']) {
            const src = readFileSync(file, 'utf8');
            expect(src, `${file} draws the shared pill`).toContain('VerdictReviewPill');
        }
    });
});
