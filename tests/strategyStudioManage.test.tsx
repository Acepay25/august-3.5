import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

let store: Record<string, unknown> = {};
vi.mock('../services/infrastructure/PreferencesService', () => ({
    getPreferenceObject: vi.fn(async (key: string) => store[key] ?? null),
    setPreferenceObject: vi.fn(async (key: string, value: unknown) => {
        store[key] = value;
    }),
    removePreference: vi.fn(async (key: string) => {
        delete store[key];
    }),
}));

import {
    initMemoryFiles,
    getMemoryFiles,
    createMemoryFile,
} from '../services/learning/MemoryFilesService';
import { ToastProvider } from '../components/shared/Toast';
import StrategyStudio from '../components/dashboards/StrategyStudio';

// The merged surface hydrates the regime matrix on mount; stub the network/
// prefs-touching effect (the cells stay absent → "—" edges, which is fine).
vi.mock('../services/learning/strategyRegimeMatrix', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../services/learning/strategyRegimeMatrix')>();
    return { ...actual, hydrateStrategyRegimeMatrix: vi.fn(async () => {}) };
});

const SKILL_A = [
    '---',
    'status: confirmed',
    'kind: avoid',
    'coin: BTC',
    'direction: Short',
    'wins: 3',
    'losses: 4',
    'tradeIds: t1,t2',
    'evidenceCount: 7',
    '---',
    '',
    '# Avoid BTC Short Fakeouts',
    '',
    'Skip BTC shorts when funding is positive and price sits above the range high.',
].join('\n');

const SKILL_B = [
    '---',
    'status: candidate',
    'kind: repeat',
    'coin: ETH',
    'wins: 1',
    'losses: 0',
    'tradeIds: t9',
    '---',
    '',
    '# Repeat ETH Trend Continuation',
    '',
    'Add when HTF trend aligns with the 4h reclaim.',
].join('\n');

const renderStudio = async (): Promise<void> => {
    render(<ToastProvider><StrategyStudio trades={[]} username="tester" /></ToastProvider>);
    await screen.findByTestId('studio-wl-avoid-btc-short-fakeouts');
};

describe('Strategy Studio — merged management (was Settings → Skills)', () => {
    beforeEach(async () => {
        store = {};
        await initMemoryFiles('tester');
        const folder = getMemoryFiles().folders.find(f => f.name === 'skills');
        if (!folder) throw new Error('skills folder missing after init');
        await createMemoryFile(folder.id, 'avoid-btc-short-fakeouts.md', `${SKILL_A}\n`, 'tester');
        await createMemoryFile(folder.id, 'repeat-eth-continuation.md', `${SKILL_B}\n`, 'tester');
    });

    it('renders a card per skill with its status/kind badges and evidence', async () => {
        await renderStudio();
        expect(screen.getByTestId('studio-wl-avoid-btc-short-fakeouts')).toBeInTheDocument();
        expect(screen.getByTestId('studio-wl-repeat-eth-continuation')).toBeInTheDocument();
        expect(screen.getByText('Skip BTC shorts when funding is positive and price sits above the range high.')).toBeInTheDocument();
        // Status badge (confirmed) and kind badges (AVOID / REPEAT) are present.
        expect(screen.getAllByText(/confirmed/i).length).toBeGreaterThan(0);
        expect(screen.getByText('AVOID')).toBeInTheDocument();
        expect(screen.getByText('REPEAT')).toBeInTheDocument();
    });

    it('search filters the library', async () => {
        await renderStudio();
        const box = screen.getByPlaceholderText(/search playbooks/i);
        await userEvent.clear(box);
        await userEvent.type(box, 'eth');
        expect(screen.queryByTestId('studio-wl-avoid-btc-short-fakeouts')).toBeNull();
        expect(screen.getByTestId('studio-wl-repeat-eth-continuation')).toBeInTheDocument();
    });

    it('opening a card shows the detail (meta + instructions); back returns to the grid', { timeout: 30_000 }, async () => {
        await renderStudio();
        await userEvent.click(screen.getByTestId('studio-wl-avoid-btc-short-fakeouts'));
        expect(screen.getByText('Instructions')).toBeInTheDocument();
        expect(screen.getByText('Trigger')).toBeInTheDocument();
        expect(screen.getByText('BTC Short')).toBeInTheDocument();   // Setup field
        expect(screen.getByText('3W / 4L')).toBeInTheDocument();       // Evidence field
        // The toolbar is gone while the detail is open.
        expect(screen.queryByPlaceholderText(/search playbooks/i)).toBeNull();
        // Back to the library.
        await userEvent.click(screen.getByRole('button', { name: /library/i }));
        expect(screen.getByPlaceholderText(/search playbooks/i)).toBeInTheDocument();
        expect(screen.getByTestId('studio-wl-repeat-eth-continuation')).toBeInTheDocument();
    });
});
