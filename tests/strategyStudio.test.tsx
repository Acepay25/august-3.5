import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import StrategyStudio from '../components/dashboards/StrategyStudio';
import { initMemoryFiles, createMemoryFile, getMemoryFiles } from '../services/learning/MemoryFilesService';
import type { LoggedTrade, TradeAnalysis } from '../types';

// hydrateStrategyRegimeMatrix touches Preferences; stub it so the effect is a
// no-op in jsdom (the matrix cells are absent → "—" edges, which we assert).
vi.mock('../services/learning/strategyRegimeMatrix', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../services/learning/strategyRegimeMatrix')>();
    return { ...actual, hydrateStrategyRegimeMatrix: vi.fn(async () => {}) };
});

const trade: LoggedTrade = {
    id: 't1',
    analysis: { coinName: 'BTCUSDT', direction: 'Short', detectedPatternFamily: 'Family A' } as TradeAnalysis,
    outcome: 'LOSS' as LoggedTrade['outcome'],
    timestamp: new Date().toISOString(),
};

const seedSkill = async (name: string, status: 'confirmed' | 'candidate', user: string): Promise<void> => {
    const skills = getMemoryFiles().folders.find(f => f.name === 'skills')!;
    await createMemoryFile(skills.id, name, `---
status: ${status}
kind: avoid
coin: BTCUSDT
direction: Short
family: Family A
strategyFamily: mean_reversion
wins: 4
losses: 1
ifCondition: BTC short after a failed breakout
thenAction: skip the short
description: Failed-breakout BTC shorts keep bleeding.
tradeIds: a,b,c,d,e
---

# ${name}

**When:** \${SYMBOL} short
**What I do:** skip.
`, user, true);
};

describe('StrategyStudio (browse + annotate the playbook library)', () => {
    // Unique username per test: initMemoryFiles re-seeds only when the cache
    // user changes, so one shared user would collide on repeated seeds
    // (same isolation pattern as skillEval.test.ts).
    it('renders a card per playbook with its family chip and status badge', async () => {
        await initMemoryFiles('studio-1');
        await seedSkill('btc-failed-breakout.md', 'confirmed', 'studio-1');
        render(<StrategyStudio trades={[trade]} username="studio-1" />);
        expect(await screen.findByText('Failed-breakout BTC shorts keep bleeding.')).toBeInTheDocument();
        // Family chip (from strategyFamily), evidence, and the confirmed badge.
        expect(screen.getAllByText(/mean reversion/i).length).toBeGreaterThan(0);
        expect(screen.getAllByText(/confirmed/i).length).toBeGreaterThan(0);
        expect(screen.getByTestId('studio-wl-btc-failed-breakout').textContent).toContain('4W 1L');
    });

    it('search filters the library and reports the empty state', async () => {
        await initMemoryFiles('studio-2');
        await seedSkill('btc-failed-breakout.md', 'confirmed', 'studio-2');
        render(<StrategyStudio trades={[trade]} username="studio-2" />);
        const box = await screen.findByPlaceholderText(/search playbooks/i);
        fireEvent.change(box, { target: { value: 'zzzzz-no-match' } });
        expect(screen.getByText(/no playbooks match/i)).toBeInTheDocument();
        fireEvent.change(box, { target: { value: 'breakout' } });
        expect(screen.getByTestId('studio-wl-btc-failed-breakout')).toBeInTheDocument();
    });

    it('"Try in chat" dispatches august:try-skill with the slug and closes', async () => {
        await initMemoryFiles('studio-3');
        await seedSkill('btc-failed-breakout.md', 'confirmed', 'studio-3');
        const onSpy = vi.fn();
        window.addEventListener('august:try-skill', onSpy);
        let closed = false;
        render(<StrategyStudio trades={[trade]} username="studio-3" onClose={() => { closed = true; }} />);
        const btn = await screen.findByRole('button', { name: /try in chat/i });
        fireEvent.click(btn);
        window.removeEventListener('august:try-skill', onSpy);
        expect(onSpy).toHaveBeenCalledTimes(1);
        const detail = (onSpy.mock.calls[0][0] as CustomEvent).detail as { slug?: string };
        expect(detail.slug).toBe('btc-failed-breakout');
        expect(closed).toBe(true);
    });
});
