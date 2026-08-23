import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import RunContractPanel from '../components/analysis/RunContractPanel';
import EvidencePackCard from '../components/analysis/EvidencePackCard';

describe('RunContractPanel', () => {
    it('renders nothing without stages', () => {
        const { container } = render(<RunContractPanel />);
        expect(container.firstChild).toBeNull();
    });

    it('shows the stage ladder with skip notes', () => {
        render(
            <RunContractPanel
                stages={[
                    { id: 'gate', label: 'Gate scan', state: 'done' },
                    { id: 'openings', label: 'Analyst openings', state: 'done' },
                    { id: 'rebuttals', label: 'Rebuttal rounds', state: 'skipped', note: 'USD budget cap reached' },
                    { id: 'verdict', label: 'Moderator verdict', state: 'running' },
                ]}
            />
        );
        expect(screen.getByText(/Run contract · 2\/4/)).toBeInTheDocument();
        expect(screen.getByText('Gate scan')).toBeInTheDocument();
        // The skip note is its own text node next to the struck-through label.
        expect(screen.getByText(/USD budget cap/)).toBeInTheDocument();
        expect(screen.getByText('Moderator verdict')).toBeInTheDocument();
    });
});

describe('EvidencePackCard', () => {
    it('renders nothing without a pack', () => {
        const { container } = render(<EvidencePackCard />);
        expect(container.firstChild).toBeNull();
    });

    it('renders collapsed with a summary and opens to the details', () => {
        render(
            <EvidencePackCard
                pack={{
                    statsLine: "**This desk's record on BTC Short:** 5 trades · 2W/3L (40%)",
                    causePattern: '**Failure pattern:** 3/4 of your admitted BTC Short losses are SETUP_EDGE_FAILURE — the setups themselves, not execution or macro shocks. Tighten entry criteria before trusting this class again.',
                    similar: [
                        { outcome: 'LOSS', coin: 'BTC', direction: 'Short', date: '2026-08-19', lesson: 'Chased the wick', similarity: 88 },
                    ],
                    skills: ['- AVOID [skills/btc-short-avoid.md · confirmed · 1W/4L] IF fake breakout THEN no trade'],
                    doctrineHeader: 'Wait for the reclaim.',
                }}
            />
        );
        // Collapsed summary (single text node) carries every section marker.
        expect(screen.getByText(/Verdict evidence/)).toBeInTheDocument();
        expect(screen.getByText(/journal record/)).toBeInTheDocument();
        expect(screen.getByText(/1 similar trade/)).toBeInTheDocument();
        expect(screen.getByText(/1 skill/)).toBeInTheDocument();
        expect(screen.getByText(/doctrine/)).toBeInTheDocument();
    });

    it('omits sections that have no data', () => {
        render(
            <EvidencePackCard
                pack={{ statsLine: '', causePattern: '', similar: [], skills: [], doctrineHeader: '' }}
            />
        );
        expect(screen.queryByText(/Verdict evidence/)).toBeNull();
    });
});
