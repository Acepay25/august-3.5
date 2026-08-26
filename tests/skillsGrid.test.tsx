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
import SkillsGrid from '../components/settings/SkillsGrid';

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

describe('SkillsGrid', () => {
    beforeEach(async () => {
        store = {};
        await initMemoryFiles('tester');
        // The harness pre-seeds a `skills` folder — find it and drop two
        // skill files in.
        const folder = getMemoryFiles().folders.find(f => f.name === 'skills');
        if (!folder) throw new Error('skills folder missing after init');
        await createMemoryFile(folder.id, 'avoid-btc-short-fakeouts.md', `${SKILL_A}\n`, 'tester');
        await createMemoryFile(folder.id, 'repeat-eth-continuation.md', `${SKILL_B}\n`, 'tester');
    });

    it('renders every skill as a card with status/kind badges', async () => {
        render(<SkillsGrid />);
        expect(await screen.findByText('avoid-btc-short-fakeouts')).toBeInTheDocument();
        expect(screen.getByText('repeat-eth-continuation')).toBeInTheDocument();
        expect(screen.getByText('CONFIRMED')).toBeInTheDocument();
        expect(screen.getByText('AVOID')).toBeInTheDocument();
        expect(screen.getByText('REPEAT')).toBeInTheDocument();
        // Evidence line from wins/losses.
        expect(screen.getByText('3W·4L')).toBeInTheDocument();
    });

    it('search filters the grid', async () => {
        render(<SkillsGrid />);
        await screen.findByText('avoid-btc-short-fakeouts');
        await userEvent.type(screen.getByPlaceholderText('Search skills…'), 'eth');
        expect(screen.queryByText('avoid-btc-short-fakeouts')).toBeNull();
        expect(screen.getByText('repeat-eth-continuation')).toBeInTheDocument();
    });

    it('clicking a card opens the detail with meta + instructions, back returns', async () => {
        render(<SkillsGrid />);
        await userEvent.click(await screen.findByText('avoid-btc-short-fakeouts'));

        // Detail header + meta panel.
        expect(screen.getByText('Instructions')).toBeInTheDocument();
        expect(screen.getByText('Trigger')).toBeInTheDocument();
        expect(screen.getByText('BTC Short')).toBeInTheDocument();
        expect(screen.getByText('3W / 4L')).toBeInTheDocument();
        // The grid is gone while the detail is open.
        expect(screen.queryByPlaceholderText('Search skills…')).toBeNull();

        // Back to the grid.
        await userEvent.click(screen.getByRole('button', { name: 'Skills' }));
        expect(screen.getByPlaceholderText('Search skills…')).toBeInTheDocument();
        expect(screen.getByText('repeat-eth-continuation')).toBeInTheDocument();
    });
});
