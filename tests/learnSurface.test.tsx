/**
 * Learn surface smoke test (WS-5.1) — the four tabs mount, switch, and show
 * the stores they claim to. StrategyStudio/MemoryFilesManager are lazy, so the
 * tab-switch assertions stay on the always-loaded Queue and Health panes.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

let store: Record<string, unknown> = {};
vi.mock('../services/infrastructure/PreferencesService', () => ({
    getPreferenceObject: vi.fn(async (key: string) => store[key] ?? null),
    getPreferenceArray: vi.fn(async (key: string, guard?: (item: unknown) => boolean) => {
        const raw = store[key];
        if (!Array.isArray(raw)) return [];
        return guard ? raw.filter(guard) : raw;
    }),
    setPreferenceObject: vi.fn(async (key: string, value: unknown) => { store[key] = value; }),
    removePreference: vi.fn(async (key: string) => { delete store[key]; }),
}));
vi.mock('../services/learning/MemoryModelService', () => ({
    resolveMemoryConfig: vi.fn(async () => null),
}));

import LearnView, { type LearnTab } from '../components/learn/LearnView';
import { initMemoryFiles } from '../services/learning/MemoryFilesService';
import { queueSkillDraft } from '../utils/skillDrafts';
import * as supervisorStore from '../services/learning/supervisorStore';
import { recordTombstone } from '../services/learning/skillGraveyard';

const USER = 'learn-ui-user';

beforeEach(async () => {
    store = {};
    localStorage.clear();
    supervisorStore.__resetForTests();
    await initMemoryFiles(USER);
});

afterEach(cleanup);

const mount = (): void => {
    render(<LearnView username={USER} trades={[]} memoryConfig={null} />);
};

describe('Learn surface', () => {
    it('offers the loop in its own order: Queue, Skills, Memory, Health', () => {
        mount();
        for (const tab of ['queue', 'skills', 'memory', 'health']) {
            expect(screen.getByTestId(`learn-tab-${tab}`)).toBeTruthy();
        }
        expect(screen.getByTestId('learn-view').textContent).toContain('Skill supervisor');
    });

    it('the Queue tab shows what the model is deciding and what is waiting', async () => {
        queueSkillDraft({
            tradeId: 'q-1', coin: 'BTCUSDT',
            crafted: {
                name: 'Queue row', kind: 'avoid', when: 'BTC sweeps the prior low and reclaims',
                inputs: ['price'], steps: ['wait for the close'], validate: 'closed above',
                output: 'skip', approval: 'size changes',
                ifCondition: 'BTC sweeps the prior low but the 15m candle closes back above it',
                thenAction: 'Do not short — the failed sweep removes the downside edge',
            },
        } as never, USER);
        supervisorStore.setPending(1);
        mount();
        await waitFor(() => {
            expect(screen.getByTestId('supervisor-status').textContent).toContain('1 waiting');
        });
        expect(screen.getByTestId('supervisor-auto-toggle').textContent).toMatch(/Auto/);
    });

    it('switches to Health and renders the memory report', async () => {
        mount();
        fireEvent.click(screen.getByTestId('learn-tab-health'));
        await waitFor(() => {
            expect(screen.getByTestId('memory-health-card')).toBeTruthy();
        });
        const text = screen.getByTestId('memory-health-card').textContent ?? '';
        expect(text).toMatch(/Skills/);
        expect(text).toMatch(/Queues/);
        expect(text).toMatch(/Notebook/);
        expect(text).toMatch(/Hygiene/);
    });

    it('remembers the tab the user last opened', async () => {
        mount();
        fireEvent.click(screen.getByTestId('learn-tab-memory'));
        await waitFor(() => expect(localStorage.getItem('learn_tab_v1')).toBe('memory'));
    });
});

/** Mirrors App's contract for the Settings → "open the notebook" link: the
 *  requested tab lives in caller state and LearnView clears it once applied. */
const DeepLinkHarness: React.FC = () => {
    const [nav, setNav] = React.useState<LearnTab | null>(null);
    const [on, setOn] = React.useState(true);
    return (
        <>
            <button data-testid="link-health" onClick={() => setNav('health')} />
            <button data-testid="toggle-mount" onClick={() => setOn(v => !v)} />
            {on && (
                <LearnView username={USER} trades={[]} memoryConfig={null}
                    initialTab={nav} onInitialTabConsumed={() => setNav(null)} />
            )}
        </>
    );
};

const currentTab = (): string =>
    ['queue', 'skills', 'memory', 'health']
        .find(t => screen.getByTestId(`learn-tab-${t}`).getAttribute('aria-current') === 'true') ?? 'none';

describe('Learn deep link', () => {
    beforeEach(() => { localStorage.setItem('learn_tab_v1', 'queue'); });

    it('applies the link, and applies it again on a second click for the same tab', async () => {
        render(<DeepLinkHarness />);
        fireEvent.click(screen.getByTestId('link-health'));
        await waitFor(() => expect(currentTab()).toBe('health'));

        fireEvent.click(screen.getByTestId('learn-tab-queue'));
        await waitFor(() => expect(currentTab()).toBe('queue'));

        // The tab value never changed between the two clicks, so an effect that
        // value-diffs its prop stays put here.
        fireEvent.click(screen.getByTestId('link-health'));
        await waitFor(() => expect(currentTab()).toBe('health'));
        // Let the lazily-loaded pane settle before the test unmounts it.
        await waitFor(() => expect(screen.getByTestId('memory-health-card')).toBeTruthy());
    });

    it('does not re-apply a consumed link when Learn is opened again', () => {
        render(<DeepLinkHarness />);
        fireEvent.click(screen.getByTestId('link-health'));
        fireEvent.click(screen.getByTestId('learn-tab-queue'));
        fireEvent.click(screen.getByTestId('toggle-mount'));  // leave the surface
        fireEvent.click(screen.getByTestId('toggle-mount'));  // come back
        expect(currentTab()).toBe('queue');
    });
});

describe('Graveyard view (WS-5.1)', () => {
    it('Health lists what was retired and why, instead of only counting it', async () => {
        await recordTombstone(USER, {
            slug: 'btc-old-range-rule', reason: 'eval-hurts', sampleN: 6, liftPts: -12,
            retiredAt: '2026-09-01T00:00:00.000Z',
        });
        mount();
        fireEvent.click(screen.getByTestId('learn-tab-health'));
        await waitFor(() => expect(screen.getByTestId('memory-health-card')).toBeTruthy());
        const text = screen.getByTestId('memory-health-card').textContent ?? '';
        expect(text).toContain('Graveyard (1)');
        expect(text).toContain('btc-old-range-rule');
        expect(text).toContain('eval-hurts');
        expect(text).toContain('standing but contradicted');
    });
});
