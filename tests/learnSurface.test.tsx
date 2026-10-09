/**
 * Learn surface smoke test (WS-5.1) — the tabs mount, switch, and show
 * the stores they claim to. MemoryFilesManager is lazy, so the tab-switch
 * assertions stay on the always-loaded Queue and Health panes.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

let store: Record<string, unknown> = {};
vi.mock('../services/infrastructure/PreferencesService', () => ({
    getPreferenceObject: vi.fn(async (key: string) => store[key] ?? null),
    getPreference: vi.fn(async (key: string) => store[key] ?? null),
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
import { getHarnessSettings, saveHarnessSettings } from '../utils/harnessSettings';

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
    it('offers one inbox, then where it lives, then whether it is sound', () => {
        mount();
        for (const tab of ['coach', 'memory', 'health']) {
            expect(screen.getByTestId(`learn-tab-${tab}`)).toBeTruthy();
        }
        // StrategyStudio is the one owner of the playbook table and has its own
        // surface (Alt+3). Mounting it here too gave it a second, half-wired
        // copy: no onClose, so "Try in chat" was dead on this tab.
        expect(screen.queryByTestId('learn-tab-skills')).toBeNull();
        // The inbox leads and is the default, so what a trader sees on arrival is
        // the decisions — the supervisor's log is telemetry and lives on Health.
        expect(screen.getByTestId('learn-view').textContent).toContain('amendment');
        fireEvent.click(screen.getByTestId('learn-tab-health'));
        expect(screen.getByTestId('learn-view').textContent).toContain('Skill supervisor');
    });

    // The supervisor's running log sits on Health, NOT beside the drafts: it is
    // what the loop is doing, not a decision waiting on you, and next to the
    // inbox it made the queue read like a dashboard.
    it('Health shows what the model is deciding and how many are waiting', async () => {
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
        fireEvent.click(screen.getByTestId('learn-tab-health'));
        await waitFor(() => {
            expect(screen.getByTestId('supervisor-status').textContent).toContain('1 waiting');
        });
        expect(screen.getByTestId('supervisor-auto-toggle').textContent).toMatch(/Auto/);
    });

    it('switches to Health and renders the memory report', async () => {
        // The report itself is always on; only the dashboards rest under Focus.
        saveHarnessSettings({ viewDensity: 'detail' });
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
    ['coach', 'memory', 'health']
        .find(t => screen.getByTestId(`learn-tab-${t}`).getAttribute('aria-current') === 'true') ?? 'none';

describe('Learn deep link', () => {
    beforeEach(() => { localStorage.setItem('learn_tab_v1', 'coach'); });

    it('applies the link, and applies it again on a second click for the same tab', async () => {
        render(<DeepLinkHarness />);
        fireEvent.click(screen.getByTestId('link-health'));
        await waitFor(() => expect(currentTab()).toBe('health'));

        fireEvent.click(screen.getByTestId('learn-tab-coach'));
        await waitFor(() => expect(currentTab()).toBe('coach'));

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
        fireEvent.click(screen.getByTestId('learn-tab-coach'));
        fireEvent.click(screen.getByTestId('toggle-mount'));  // leave the surface
        fireEvent.click(screen.getByTestId('toggle-mount'));  // come back
        expect(currentTab()).toBe('coach');
    });
});

describe('One learning surface (WS-5.1)', () => {
    it('Health carries the learning analytics that used to live in the Journal', async () => {
        saveHarnessSettings({ viewDensity: 'detail' });
        mount();
        fireEvent.click(screen.getByTestId('learn-tab-health'));
        await waitFor(() => expect(screen.getByTestId('learn-signals')).toBeTruthy());
    });
});

describe('Graveyard view (WS-5.1)', () => {    it('Health lists what was retired and why, instead of only counting it', async () => {
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

/**
 * The Coach inbox moved here from the Chart AI dock's Chat | Coach switch when
 * the surfaces went into the hamburger menu. App owns the allow/deny handlers
 * and hands the panel in, so these mount a stand-in and pin the tab contract:
 * it exists only with the panel, it carries the pending count, and a stale
 * stored choice cannot strand the surface on a tab it cannot render.
 */
const mountCoach = (coachCount = 0): void => {
    render(
        <LearnView
            username={USER} trades={[]} memoryConfig={null} coachCount={coachCount}
            renderCoach={() => <div data-testid="fake-coach-pane">coach</div>}
        />,
    );
};

describe('The Approvals tab', () => {
    // It is no longer conditional on a panel being handed in: the tab holds the
    // autopilot's permission requests and the memory amendments too, so a
    // surface that hides its own inbox when App renders nothing is worse than
    // one that shows an empty list.
    it('exists with or without the coach panel handed in', () => {
        mount();
        expect(screen.getByTestId('learn-tab-coach')).toBeTruthy();
        expect(screen.getByTestId('learn-tab-coach').getAttribute('aria-current')).toBe('true');
    });

    it('is the default tab and renders the panel App hands in', async () => {
        mountCoach();
        await waitFor(() => expect(screen.getByTestId('fake-coach-pane')).toBeTruthy());
    });

    it('counts the decisions waiting on the tab', () => {
        mountCoach(0);
        expect(screen.getByTestId('learn-tab-coach').textContent).not.toMatch(/\d/);
        cleanup();
        mountCoach(7);
        expect(screen.getByTestId('learn-tab-coach').textContent).toContain('7');
        expect(screen.getByTestId('learn-tab-coach').getAttribute('title')).toBe('7 awaiting your decision');
    });

    // A stored id from before the tabs were merged must not strand the surface
    // on a tab it no longer has.
    it('a stored tab id that no longer exists falls back to Approvals', async () => {
        for (const stale of ['queue', 'system', 'nonsense']) {
            localStorage.setItem('learn_tab_v1', stale);
            mount();
            await waitFor(() => {
                expect(screen.getByTestId('learn-tab-coach').getAttribute('aria-current')).toBe('true');
            });
            cleanup();
        }
        expect(screen.queryByTestId('learn-coach')).toBeNull();
    });
});

/**
 * Density is a whole-view preset, not six toggles: one setting decides whether
 * the loop's dashboards are on screen, and the shorter screen must SAY what is
 * resting. A panel that silently disappears is indistinguishable from a feature
 * that broke, which is the difference between minimalism and loss.
 */
describe('Focus rests the telemetry without deleting it', () => {
    it('hides the dashboards and names what is resting', async () => {
        saveHarnessSettings({ viewDensity: 'focus' });
        mount();
        fireEvent.click(screen.getByTestId('learn-tab-health'));
        await waitFor(() => expect(screen.getByTestId('memory-health-card')).toBeTruthy());
        expect(screen.queryByTestId('learn-signals')).toBeNull();
        expect(screen.queryByTestId('learn-system')).toBeNull();
        expect(screen.getByTestId('learn-resting').textContent).toMatch(/resting/i);
    });

    it('the Show Detail press writes the shared setting and reveals them', async () => {
        saveHarnessSettings({ viewDensity: 'focus' });
        mount();
        fireEvent.click(screen.getByTestId('learn-tab-health'));
        fireEvent.click(await screen.findByTestId('learn-show-detail'));
        await waitFor(() => expect(screen.getByTestId('learn-signals')).toBeTruthy());
        expect(screen.getByTestId('learn-system')).toBeTruthy();
        expect(getHarnessSettings().viewDensity).toBe('detail');
    });

    it('and the surface owns the way back — Rest these writes focus again', async () => {
        // The bottom bar used to be the only control that could close these
        // again. Deleting the bar must not leave Detail a one-way door: the
        // surface that opens the panels has to be able to rest them.
        saveHarnessSettings({ viewDensity: 'focus' });
        mount();
        fireEvent.click(screen.getByTestId('learn-tab-health'));
        fireEvent.click(await screen.findByTestId('learn-show-detail'));
        await waitFor(() => expect(screen.getByTestId('learn-system')).toBeTruthy());
        fireEvent.click(screen.getByTestId('learn-rest-telemetry'));
        await waitFor(() => expect(screen.getByTestId('learn-resting')).toBeTruthy());
        expect(screen.queryByTestId('learn-system')).toBeNull();
        expect(getHarnessSettings().viewDensity).toBe('focus');
    });

    it('the notebook health never rests — it is the one panel with a press on it', async () => {
        saveHarnessSettings({ viewDensity: 'focus' });
        mount();
        fireEvent.click(screen.getByTestId('learn-tab-health'));
        await waitFor(() => expect(screen.getByTestId('memory-health-card')).toBeTruthy());
    });
});
