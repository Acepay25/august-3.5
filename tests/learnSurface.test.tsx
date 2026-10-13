/**
 * Learn surface smoke test (WS-5.1) — the tabs mount, switch, and show
 * the stores they claim to. Six of this surface's panes are `React.lazy`, so
 * the module graph is paid for here, once, before any assertion runs — see
 * `beforeAll` below.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

/**
 * A lazy boundary's first mount pays for transforming its whole module graph,
 * and vitest does that lazily, inside whichever test happens to open the tab.
 * On an idle machine that is a second; alongside the other 510 files it has
 * measured 19s, so the run fails two ways and neither names the cause: the
 * `waitFor` gives up at 1s and reports a missing heading ("renders the
 * global-memory switch", "falls back to Approvals"), or the test blows its
 * budget outright. Both were seen on 2026-10-13 in two consecutive full runs,
 * on different tests, while the file passed 3/3 solo.
 *
 * Importing the same specifiers here instantiates them once, so `lazy()`
 * resolves from the module registry on mount; the assertions then measure the
 * pane, not the compiler. A larger `testTimeout` would instead have decided how
 * slow a first mount is acceptable, and taxed every genuinely-fast test in the
 * file to hide it.
 *
 * The hook gets its own budget because moving the cost out of the tests
 * revealed it lands in the hook instead: in one full 511-file run this
 * `beforeAll` hit the 10s default and failed, which skipped all sixteen tests
 * in the file — a worse outcome than the flake it replaced.
 *
 * MEASURED 2026-10-13: 444ms solo on an idle machine (1,180ms with a cold
 * transform cache) and 555ms from inside a full run. The budget below is ~50×
 * the in-run measurement, because the failure mode of a tight one is the whole
 * file skipping and the cost being bounded is machine-dependent setup that does
 * no assertions. Per-test budgets stay at the default, so a genuinely slow test
 * still fails — this number cannot hide one.
 */
beforeAll(async () => {
    await Promise.all([
        import('../components/learn/MemoryFilesManager'),
        import('../components/settings/HarnessLessonsBrowser'),
        import('../components/dashboards/LearningDashboard'),
        import('../components/dashboards/VersionHistoryDashboard'),
        import('../components/settings/SessionUsagePanel'),
        import('../components/settings/DiagnosticsPanel'),
    ]);
}, 30_000);

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
import { ToastProvider } from '../components/shared/Toast';
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

/**
 * App hands every surface a ToastProvider; this harness now does too.
 *
 * It used not to, and nothing failed, because the panes that call `useToast`
 * sit behind `lazy()`: the boundary was still pending when the assertions ran,
 * so `LearningDashboard` never mounted inside a test and its missing provider
 * stayed invisible. Pre-warming the lazy chunks (beforeAll) made that honest —
 * and the pane then threw, exactly as it would in any tree without the
 * provider. The tests that "passed" against those Health panes were asserting
 * on a subtree that had never rendered.
 */
const mount = (): void => {
    render(
        <ToastProvider>
            <LearnView username={USER} trades={[]} memoryConfig={null} />
        </ToastProvider>,
    );
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
        <ToastProvider>
            <button data-testid="link-health" onClick={() => setNav('health')} />
            <button data-testid="toggle-mount" onClick={() => setOn(v => !v)} />
            {on && (
                <LearnView username={USER} trades={[]} memoryConfig={null}
                    initialTab={nav} onInitialTabConsumed={() => setNav(null)} />
            )}
        </ToastProvider>
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
        mount();
        fireEvent.click(screen.getByTestId('learn-tab-health'));
        // `learn-signals` is the div AROUND the Suspense boundary, so it exists
        // as soon as the tab renders — asserting on it proved nothing about the
        // pane inside. This asserts the lazy pane itself mounted.
        await waitFor(() => expect(screen.getByTestId('learn-analytics')).toBeTruthy());
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
 * The Health tab is one always-on surface: the memory report, the learning
 * analytics, the lesson browser and the runtime telemetry all render with no
 * preset to rest them — a panel that only appears when a setting says so is
 * a panel a first run never meets.
 */
describe('Health shows the loop telemetry with no preset behind it', () => {
    it('renders the panels without writing any setting first', async () => {
        mount();
        fireEvent.click(screen.getByTestId('learn-tab-health'));
        await waitFor(() => expect(screen.getByTestId('memory-health-card')).toBeTruthy());
        // The panels are lazy (Suspense), so the assertions wait for the
        // mounts — the PRESET they used to wait on is gone, the timing is not.
        await waitFor(() => expect(screen.getByTestId('learn-signals')).toBeTruthy());
        await waitFor(() => expect(screen.getByTestId('learn-system')).toBeTruthy());
    });

    it('the notebook health is there too — it is the one panel with a press on it', async () => {
        mount();
        fireEvent.click(screen.getByTestId('learn-tab-health'));
        await waitFor(() => expect(screen.getByTestId('memory-health-card')).toBeTruthy());
    });
});

/**
 * The global-memory switch lives on the Learn surface (MemoryFilesManager) —
 * Settings → Memory kept only a link here, so if App stopped handing the flag
 * and its setter through LearnView the ONE writer of that flag would silently
 * vanish from the UI (the switch renders only when the setter is supplied).
 * A real state holder mounts it so the pressed switch must flip aria-checked —
 * an inert control would leave it frozen.
 */
const GlobalMemoryHarness: React.FC = () => {
    const [enabled, setEnabled] = React.useState(false);
    return (
        <ToastProvider>
            <LearnView username={USER} trades={[]} memoryConfig={null}
                isGlobalMemoryEnabled={enabled}
                setIsGlobalMemoryEnabled={setEnabled} />
        </ToastProvider>
    );
};

const openMemoryTab = async (): Promise<void> => {
    fireEvent.click(screen.getByTestId('learn-tab-memory'));
    // MemoryFilesManager is lazy — wait for its header before asserting on it.
    await screen.findByText(/Notebook files the model reads/);
};

describe('The Memory tab', () => {
    it('renders the global-memory switch and writes through the setter', async () => {
        render(<GlobalMemoryHarness />);
        await openMemoryTab();
        const sw = screen.getByRole('switch', { name: 'Toggle Global Memory' });
        expect(sw.getAttribute('aria-checked')).toBe('false');
        fireEvent.click(sw);
        await waitFor(() => expect(sw.getAttribute('aria-checked')).toBe('true'));
    });

    it('shows no global-memory switch when the setter is not handed in', async () => {
        // `mount()` provides Toast now (see the note on it); this case still
        // spells its own wrapper because it pins the ABSENCE of the switch,
        // which is a property of the props handed in, not of the provider.
        render(
            <ToastProvider>
                <LearnView username={USER} trades={[]} memoryConfig={null} />
            </ToastProvider>,
        );
        await openMemoryTab();
        expect(screen.queryByRole('switch', { name: 'Toggle Global Memory' })).toBeNull();
    });
});
