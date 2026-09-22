import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import VerdictAudit from '../components/analysis/VerdictAudit';
import type { TradeAnalysis } from '../types';

/**
 * `VerdictAudit` is the single home for "why did this run say that", mounted on
 * both settled-verdict surfaces. These tests hold the RULE, not the panels'
 * internals (those have their own suites): a declined run gets the blocker
 * breakdown, a live-but-not-yet run gets the wait line, and never both — the
 * two panels say nearly the same sentence in different moods, and rendering
 * both is how a watch starts reading as a no-trade.
 */

const analysis = (over: Partial<TradeAnalysis> = {}): TradeAnalysis => ({
    direction: 'Long', confidence: 'High', entryPoints: [], takeProfit: [],
    reasoning: '', ...over,
} as TradeAnalysis);

const pack = {
    statsLine: '6 similar setups · 4 wins · median 1.8R',
    causePattern: 'Chasing a break before the retest holds.',
    similar: [],
    skills: ['fade-the-first-break'],
    doctrineHeader: 'Doctrine: only trade the reclaim.',
};

const stages = [
    { id: 'gate', label: 'Gate scan', state: 'done' as const },
    { id: 'clarification', label: 'Clarification', state: 'skipped' as const, note: 'budget cap' },
];

describe('the declined / watch rule', () => {
    it('explains a verdict with no direction', () => {
        render(<VerdictAudit analysis={analysis({ direction: undefined, confidence: 'Avoid' })} />);
        expect(screen.getByText(/why no trade/i)).toBeTruthy();
        expect(screen.queryByText(/wait for confirmation/i)).toBeNull();
    });

    it('explains a Neutral verdict', () => {
        render(<VerdictAudit analysis={analysis({ direction: 'Neutral' })} />);
        expect(screen.getByText(/why no trade/i)).toBeTruthy();
    });

    /** A directional call at Low confidence is a watch, not a refusal — the
     *  banner names the trigger that would make it tradeable. */
    it('does not treat a directional watch as a no-trade', () => {
        render(<VerdictAudit analysis={analysis({ direction: 'Long', confidence: 'Low' })} />);
        expect(screen.queryByText(/why no trade/i)).toBeNull();
    });

    it('does not treat an explicit Avoid as a watch even at Low confidence', () => {
        render(<VerdictAudit analysis={analysis({ direction: 'Long', confidence: 'Avoid' })} />);
        expect(screen.getByText(/why no trade/i)).toBeTruthy();
    });

    it('renders nothing at all for an actionable verdict with no audit to show', () => {
        const { container } = render(<VerdictAudit analysis={analysis()} />);
        expect(container.firstChild).toBeNull();
    });
});

describe('the run audit', () => {
    /** There is deliberately no outer disclosure: `EvidencePackCard` already
     *  owns its own collapse, and the run contract exists so a stage that did
     *  not run is VISIBLE — behind a second click it would be silent again. */
    it('shows the stage ladder without any interaction', () => {
        render(<VerdictAudit analysis={analysis()} runContract={stages} />);

        expect(screen.getByText(/Run contract · 1\/2/)).toBeTruthy();
        expect(screen.getByText('Gate scan')).toBeTruthy();
        // The skip reason is the point of the ladder.
        expect(screen.getByText(/budget cap/)).toBeTruthy();
    });

    it('renders the evidence card, which owns its own disclosure', () => {
        render(<VerdictAudit analysis={analysis()} evidencePack={pack} />);
        // Its trigger is a div carrying data-state (not a button role), so the
        // header text is the honest handle here.
        const header = screen.getByText(/evidence/i);
        expect(header).toBeTruthy();
        // Collapsed until opened — its own stated default, not ours.
        expect(screen.queryByText(/median 1\.8R/)).toBeNull();
    });

    it('renders both halves together without nesting collapsibles', () => {
        render(<VerdictAudit analysis={analysis()} evidencePack={pack} runContract={stages} />);
        expect(screen.getByText(/Run contract · 1\/2/)).toBeTruthy();
        expect(screen.getByText(/evidence/i)).toBeTruthy();
    });

    it('renders nothing when there is no verdict backing to disclose', () => {
        const { container } = render(<VerdictAudit analysis={analysis()} />);
        expect(screen.queryByText(/Run contract/)).toBeNull();
        expect(container.firstChild).toBeNull();
    });
});

/**
 * The audit renders INSIDE a transcript's `messages.map()`, so a throw here
 * does not lose the panel — it loses that message and every one after it, which
 * looks to the user exactly like "the second message stopped rendering".
 * `Message.evidencePack` and `Message.runContract` are persisted rows written by
 * whichever build was running at the time, so the shapes below are not
 * hypothetical.
 */
describe('a malformed verdict never blanks the transcript', () => {
    const Transcript = ({ packs, contracts }: {
        packs: unknown[]; contracts: unknown[];
    }) => (
        <div>
            {['FIRST answer', 'SECOND answer'].map((text, i) => (
                <div key={text}>
                    <p>{text}</p>
                    <VerdictAudit
                        analysis={analysis()}
                        evidencePack={packs[i] as never}
                        runContract={contracts[i] as never}
                    />
                </div>
            ))}
        </div>
    );

    it('tolerates a pack missing the arrays its type promises', () => {
        render(<Transcript
            packs={[
                undefined,
                { statsLine: 'journal record', causePattern: '', doctrineHeader: '' },
            ]}
            contracts={[undefined, undefined]}
        />);
        expect(screen.getByText('FIRST answer')).toBeTruthy();
        expect(screen.getByText('SECOND answer')).toBeTruthy();
        // The pack that DID arrive still shows, minus the sections it lacks.
        expect(screen.getByText(/Verdict evidence/)).toBeTruthy();
    });

    it('tolerates a stage state an older build wrote', () => {
        render(<Transcript
            packs={[undefined, undefined]}
            contracts={[
                undefined,
                [{ id: 'gate', label: 'Gate scan', state: 'complete' }, { id: 'verdict', label: 'Moderator verdict', state: 'done' }],
            ]}
        />);
        expect(screen.getByText('SECOND answer')).toBeTruthy();
        // Rendered as an unknown rather than throwing on a missing mark.
        expect(screen.getByText('Gate scan')).toBeTruthy();
        expect(screen.getByText(/Run contract · 1\/2/)).toBeTruthy();
    });

    it('tolerates null rows and a non-array ladder', () => {
        render(<Transcript
            packs={[undefined, undefined]}
            contracts={[
                [null, undefined, { id: 'x', label: 'Rebuttal rounds', state: 'skipped', note: 'budget' }],
                'not-an-array' as never,
            ]}
        />);
        expect(screen.getByText('Rebuttal rounds')).toBeTruthy();
        expect(screen.getByText('SECOND answer')).toBeTruthy();
    });

    it('keeps the transcript alive even when the audit throws outright', () => {
        // A pack whose field throws on access — the worst case the boundary
        // exists for.
        const hostile = {
            statsLine: 'x', causePattern: '', doctrineHeader: '',
            get similar(): never { throw new Error('unreadable persisted row'); },
            get skills(): never { throw new Error('unreadable persisted row'); },
        };
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        render(<Transcript packs={[undefined, hostile]} contracts={[undefined, undefined]} />);

        expect(screen.getByText('FIRST answer')).toBeTruthy();
        expect(screen.getByText('SECOND answer')).toBeTruthy();
        // It says so on the console rather than failing silently.
        expect(warn.mock.calls.flat().join(' ')).toMatch(/audit render failure/i);
        warn.mockRestore();
    });

    it('does not let one bad message suppress a good one', () => {
        render(<Transcript
            packs={[undefined, undefined]}
            contracts={[
                [{ id: 'a', label: 'Openings', state: 'nonsense-state' }],
                [{ id: 'b', label: 'Clarification', state: 'skipped', note: 'floor aligned' }],
            ]}
        />);
        expect(screen.getByText('Openings')).toBeTruthy();
        expect(screen.getByText('Clarification')).toBeTruthy();
        expect(screen.getByText(/floor aligned/)).toBeTruthy();
    });
});
