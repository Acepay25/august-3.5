/**
 * The skill viewer — gap 1 of docs/plan/open-items.md.
 *
 * The reference reads a skill as a rendered `SKILL.md`: `Description` as its
 * own labelled field, the body below it, `Save skill` / `Copy` in the header.
 * August's catalog used to be a list of file names with the record reachable
 * only by editing the raw notebook file, so the surface that lists skills
 * could not READ one. Three claims are pinned here:
 *
 *   1. the panel renders the record: description (its own labelled field —
 *      the field `skillMatchesSetup` retrieves on), body, outcome ledger;
 *   2. a catalog row opens it and the close round trip returns the surface,
 *      so the probe can drive open → read → close;
 *   3. every control on the panel does something real (Copy writes the exact
 *      file markdown; Save downloads it) — the render-probe's inert-control
 *      gate applies to this panel the moment it opens.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

/**
 * `listSkills` is faked at MODULE level with a mutable roster, for the reason
 * tests/skillsCatalog.test.ts documents: the real service pulls in the
 * notebook store, Capacitor and the Electron bridge, and times out in jsdom.
 * Everything else the viewer reads (`skillEnabledFlag`, `skillExpectancyR`)
 * stays actual, so the derivations under test are the real ones. The roster
 * is a plain array because the viewer must RE-READ it on every open — the
 * "not a cache" case mutates it between presses.
 */
const roster: Array<{ file: { id: string; name: string; content: string }; meta: Record<string, unknown> }> = [];

vi.mock('../services/learning/SkillMemoryService', async () => {
    const actual = await vi.importActual<typeof import('../services/learning/SkillMemoryService')>(
        '../services/learning/SkillMemoryService',
    );
    return { ...actual, listSkills: () => roster };
});

vi.mock('../services/infrastructure/PreferencesService', () => ({
    getPreferenceObject: vi.fn(async (_key: string) => store[_key] ?? null),
    getPreference: vi.fn(async (_key: string) => store[_key] ?? null),
    getPreferenceArray: vi.fn(async (_key: string) => []),
    setPreferenceObject: vi.fn(async (_key: string, value: unknown) => { store[_key] = value; }),
    removePreference: vi.fn(async (_key: string) => { delete store[_key]; }),
}));

let store: Record<string, unknown> = {};

import LearnView from '../components/learn/LearnView';
import SkillViewerPanel, { type SkillViewerRecord } from '../components/learn/SkillViewerPanel';
import { ToastProvider } from '../components/shared/Toast';
import type { SkillMeta } from '../services/learning/SkillMemoryService';

/**
 * The Memory tab's `Suspense` boundary wraps the catalog AND the lazy
 * `MemoryFilesManager`, so a first mount of the tab shows the fallback until
 * the chunk resolves — which would make every round-trip assertion below race
 * a dynamic import. Importing the specifier here instantiates it once, so
 * `lazy()` resolves from the module registry on mount (same reason as
 * tests/learnSurface.test.tsx's `beforeAll`).
 */
beforeAll(async () => {
    await import('../components/learn/MemoryFilesManager');
});

const meta = {
    status: 'confirmed',
    kind: 'repeat',
    description: 'Repeat: IF price reclaims the prior session high on expanding volume THEN take the long continuation.',
    coin: 'BTCUSDT',
    direction: 'Long',
    family: 'reclaim',
    regime: 'trending',
    timeframe: '15m',
    wins: 3,
    losses: 1,
    netR: 4.0,
    rSampled: 10,
    consecutiveLosses: 0,
    tradeIds: ['a', 'b', 'c', 'd'],
    evidenceCount: 4,
    approvedBy: 'grandfathered',
    body: '**When:** reclaim of the prior session high\n**What I do:** enter on the reclaim close.',
} as unknown as SkillMeta;

beforeEach(() => {
    store = {};
    localStorage.clear();
    roster.length = 0;
    roster.push({
        file: { id: 'f1', name: 'btc-reclaim-repeat.md', content: 'name: btc-reclaim\n---\nbody text\n' },
        meta: { ...meta },
    });
});

afterEach(cleanup);

describe('SkillViewerPanel — the rendered record', () => {
    const record = (over: Partial<SkillMeta> = {}): SkillViewerRecord => ({
        file: {
            id: 'f1', name: 'btc-reclaim-repeat.md', content: 'name: x\n',
            folderId: 'skills', enabled: true,
            createdAt: Date.now(), updatedAt: Date.now(),
        } as unknown as SkillViewerRecord['file'],
        meta: { ...meta, ...over } as SkillMeta,
    });

    it('shows Description as its own labelled field, above the body', () => {
        // The field the matcher retrieves on (R1) must be the most visible
        // thing on the record — burying it under the body is decoration.
        render(<SkillViewerPanel skill={record()} />);
        expect(screen.getByRole('heading', { name: 'Description' })).toBeTruthy();
        expect(screen.getByTestId('skill-viewer-description').textContent)
            .toContain('reclaims the prior session high');
        // Body renders BELOW the description, as prose — the raw file text is
        // not what a reader wants.
        const viewer = screen.getByTestId('skill-viewer');
        expect(viewer.textContent).toContain('enter on the reclaim close');
        expect(viewer.textContent!.indexOf('reclaims the prior session high'))
            .toBeLessThan(viewer.textContent!.indexOf('enter on the reclaim close'));
    });

    it('reports the outcome ledger honestly', () => {
        render(<SkillViewerPanel skill={record()} />);
        const line = screen.getByTestId('skill-viewer-outcome').textContent ?? '';
        expect(line).toContain('3W – 1L');
        expect(line).toContain('expectancy +0.40R');
        expect(line).toContain('4 counted');
    });

    it('calls expectancy UNMEASURED below the sample floor, not break-even', () => {
        // A zero here would read as "this skill breaks even"; the ledger says
        // it has not been measured yet, which is a different fact.
        render(<SkillViewerPanel skill={record({ netR: 0, rSampled: 2 })} />);
        expect(screen.getByTestId('skill-viewer-outcome').textContent)
            .toContain('expectancy unmeasured');
        expect(screen.getByTestId('skill-viewer-outcome').textContent).not.toContain('+0.00R');
    });

    it('says so when the retrieval trigger is empty instead of showing nothing', () => {
        render(<SkillViewerPanel skill={record({ description: '' })} />);
        expect(screen.getByTestId('skill-viewer-description-missing').textContent)
            .toContain('retrieval trigger is empty');
    });

    it('renders only the scope keys that are set', () => {
        render(<SkillViewerPanel skill={record({ regime: undefined })} />);
        const scope = screen.getByTestId('skill-viewer-scope').textContent ?? '';
        expect(scope).toContain('BTCUSDT');
        expect(scope).not.toContain('regime');
    });

    it('Copy writes the exact file markdown and confirms it', async () => {
        const writeText = vi.fn(async () => undefined);
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
        render(<SkillViewerPanel skill={record()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Copy this skill' }));
        await waitFor(() => expect(writeText).toHaveBeenCalledWith('name: x\n'));
        expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy();
    });

    it('Save skill downloads the file, not a re-serialized copy', () => {
        // The bytes a reader saves must be the bytes on disk; re-serializing
        // here would be a second writer with its own opinion about the format.
        const clicks: Array<{ download: string; href: string }> = [];
        const realClick = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function patioClick(this: HTMLAnchorElement) {
            clicks.push({ download: this.download, href: this.href });
        } as typeof realClick;
        try {
            render(<SkillViewerPanel skill={record()} />);
            fireEvent.click(screen.getByRole('button', { name: 'Save this skill as a file' }));
        } finally {
            HTMLAnchorElement.prototype.click = realClick;
        }
        expect(clicks).toHaveLength(1);
        expect(clicks[0].download).toBe('btc-reclaim-repeat.md');
    });
});

describe('the catalog → viewer round trip (the probe gate)', () => {
    const mount = (): void => {
        render(
            <ToastProvider>
                <LearnView username="skill-viewer-user" trades={[]} memoryConfig={null} />
            </ToastProvider>,
        );
    };

    const openMemoryTab = async (): Promise<void> => {
        fireEvent.click(screen.getByTestId('learn-tab-memory'));
        // Two async hops before the rows exist: the tab's Suspense boundary
        // waits on the lazy MemoryFilesManager chunk, and the catalog's own
        // store read runs in a mount effect. Waiting for the GRID (not the
        // section, which also exists in the loading and error states) keeps
        // the round trip from racing either.
        await screen.findByTestId('skills-catalog-grid');
    };

    it('a catalog row opens that skill\'s record, and closing returns the surface', async () => {
        mount();
        await openMemoryTab();

        // Open: press the ROW, not a separate "details" control — the catalog
        // row is the route to the record it names.
        fireEvent.click(screen.getByRole('button', { name: 'Read btc-reclaim-repeat.md' }));
        const viewer = await screen.findByTestId('skill-viewer');
        expect(viewer.textContent).toContain('reclaims the prior session high');
        expect(screen.getByTestId('skill-viewer-outcome').textContent).toContain('3W – 1L');

        // Close: the panel's own header control. (The shell's capsule strip is
        // drawn only when more than one panel is open, so a lone panel must
        // carry its own dismiss.)
        fireEvent.click(screen.getByRole('button', { name: 'Close the skill viewer' }));
        // Hide ≠ close: the shell drops the panel out of flow and keeps it
        // mounted, so the assertion is the hidden state — not unmounting.
        await waitFor(() =>
            expect(screen.getByTestId('learn-right-panel').getAttribute('data-hidden')).toBe('true'));
        // And the catalog is still there underneath.
        expect(screen.getByTestId('skills-catalog-grid')).toBeTruthy();
    });

    it('re-reads the record from the store on each open — a viewer is not a cache', async () => {
        mount();
        await openMemoryTab();
        fireEvent.click(screen.getByRole('button', { name: 'Read btc-reclaim-repeat.md' }));
        await screen.findByTestId('skill-viewer');
        fireEvent.click(screen.getByRole('button', { name: 'Close the skill viewer' }));

        // The Studio (or any other writer) changes the record while the panel
        // is closed; the next open must show the current bytes, not the copy
        // the first open loaded.
        (roster[0].meta as { description: string }).description = 'UPDATED description.';
        fireEvent.click(screen.getByRole('button', { name: 'Read btc-reclaim-repeat.md' }));
        const viewer = await screen.findByTestId('skill-viewer');
        expect(viewer.textContent).toContain('UPDATED description.');
    });
});
