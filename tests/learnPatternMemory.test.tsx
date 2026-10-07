/**
 * The pattern memory's move (2026-10-07): the Journal is the trade ledger —
 * its Models and Reasoning tabs were deleted and the pattern-memory document
 * moved out of the trade log into the Learn surface's Memory tab, next to the
 * notebook it is a file of. One suite pins both sides of the move:
 *
 *  1. BEHAVIOR — PatternMemoryCard reads profile/pattern-memory.md live,
 *     composes the pipeline's own fallback markdown when no file exists yet,
 *     and regenerates through the same handler the Journal review used.
 *  2. WIRING SCAN — the Journal's log no longer hosts pattern memory (a
 *     second home is how the numbers drift apart), and the Learn surface
 *     mounts the card. Scans, because the Journal's tab strip lives inside
 *     App's Journal props and LearnView's tab branches — the same jsdom-free
 *     wiring the journalSurfaceNavigation scans cover.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { initMemoryFiles, getMemoryFiles, createMemoryFile } from '../services/learning/MemoryFilesService';
import PatternMemoryCard from '../components/learn/PatternMemoryCard';
import type { LoggedTrade } from '../types';

const tradeLogSrc = readFileSync('components/journal/TradeLog.tsx', 'utf8');
const learnViewSrc = readFileSync('components/learn/LearnView.tsx', 'utf8');
const journalSrc = readFileSync('components/journal/Journal.tsx', 'utf8');

afterEach(() => {
    cleanup();
    window.localStorage.clear();
});

const emptyTrade: LoggedTrade[] = [];

describe('PatternMemoryCard (Learn → Memory)', () => {
    it('reads the notebook file live and offers regeneration', async () => {
        await initMemoryFiles('learn-pm-1');
        const profile = getMemoryFiles().folders.find(f => f.name === 'profile');
        expect(profile).toBeTruthy();
        await createMemoryFile(profile!.id, 'pattern-memory.md', '---\nkind: pattern-memory\n---\n\n## Recurring pattern\n\nFailed breakouts on BTC bleed for three bars.', 'learn-pm-1');

        const onRegenerate = vi.fn();
        render(
            <PatternMemoryCard
                trades={emptyTrade}
                finalSummary={null}
                isLoading={false}
                onRegenerate={onRegenerate}
            />,
        );
        expect(await screen.findByText(/Failed breakouts on BTC bleed/i)).toBeInTheDocument();
        const btn = screen.getByRole('button', { name: /regenerate pattern memory synthesis/i });
        fireEvent.click(btn);
        expect(onRegenerate).toHaveBeenCalledTimes(1);
    });

    it('composes the pipeline fallback when the file does not exist yet', async () => {
        await initMemoryFiles('learn-pm-2');
        render(
            <PatternMemoryCard
                trades={emptyTrade}
                finalSummary='The trader repeats the same late-entry mistake on Fridays.'
                isLoading={false}
            />,
        );
        expect(await screen.findByText(/late-entry mistake/i)).toBeInTheDocument();
    });
});

describe('the move itself (source contract)', () => {
    it('the Journal trade log no longer hosts pattern memory', () => {
        // The prose survives (the clear-all dialog still says the memory is
        // preserved — it is, on Learn); the affordances must not.
        expect(tradeLogSrc).not.toMatch(/pattern-memory\.md/);
        expect(tradeLogSrc).not.toMatch(/PatternMemoryDetailView|setShowPatternMemory|toPatternMemoryMarkdown/);
    });

    it('the Learn surface mounts the card on the Memory tab', () => {
        expect(learnViewSrc).toMatch(/PatternMemoryCard/);
    });

    it('the Journal tabs are the ledger, the stats, and saved — nothing else', () => {
        // The old models/reasoning tabs (and the legacy learning/memory ones)
        // must not come back: resolveTab folds every unknown to the ledger.
        expect(journalSrc).toMatch(/type TabId = 'log' \| 'analytics' \| 'saved';/);
        // Match the TABS entries, not prose — the comments naming the dead
        // tabs are the documentation of why they fold to the ledger.
        expect(journalSrc).not.toMatch(/id: '(models|reasoning|learning|memory)'/);
        expect(journalSrc).not.toMatch(/ModelPerformanceDashboard|ReasoningDashboard/);
    });
});
