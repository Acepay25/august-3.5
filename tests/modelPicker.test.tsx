/**
 * ModelPicker — the form-side picker, since E-51 Phase 3 mounted `ModelMenu`.
 *
 * The oldest guard here is the 2026-09-15 one: the readiness filter must be the
 * SHARED `providerUtils.isProviderReady` predicate, never a local copy of its
 * rule (a local copy silently diverged from the roster/pipeline semantics).
 * Everything else is the contract the rewrite had to inherit rather than
 * re-invent: the flat cross-provider search, the greyed seat duplicates, the
 * discovery feedback word, and the two value shapes `mode` speaks.
 *
 * The panel's own behaviour (arrow keys, Escape containment, the effort slider,
 * the star sort) is pinned in `tests/modelMenu.test.tsx`; nothing here repeats it.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, screen, within, waitFor, cleanup } from '@testing-library/react';
import fs from 'node:fs';
import ModelPicker from '../components/shared/ModelPicker';
import { isProviderReady } from '../utils/providerUtils';
import type { ProviderConfig } from '../types/provider';

// This repo has no global auto-cleanup, and every test below renders; without
// this the second `getByTestId` in a file finds the FIRST test's panel.
afterEach(cleanup);

const mk = (id: string, name: string, over: Partial<ProviderConfig> = {}): ProviderConfig => ({
    id,
    name,
    apiKey: 'key',
    baseUrl: 'https://x.example/v1',
    apiFormat: 'chat_completions',
    isEnabled: true,
    isBuiltIn: false,
    models: [`${id}-m1`],
    selectedModel: `${id}-m1`,
    ...over,
});

/** jsdom lays nothing out; the panel anchors off the trigger's rect. */
const stubRect = (): void => {
    HTMLElement.prototype.getBoundingClientRect = () => ({
        top: 300, bottom: 332, left: 120, right: 300, width: 180, height: 32, x: 120, y: 300, toJSON: () => ({}),
    }) as DOMRect;
};

const open = (props: React.ComponentProps<typeof ModelPicker>): void => {
    stubRect();
    render(<ModelPicker {...props} />);
    fireEvent.click(screen.getByTestId('model-picker-trigger'));
};

/** Reveal the provider panel — the rest of the providers are one gesture away
 *  now, which is what made this panel one design instead of two. */
const openProviders = (): HTMLElement => {
    fireEvent.click(screen.getByTestId('model-menu-provider-row'));
    return screen.getByTestId('model-menu-providers');
};

const pickRow = (pair: string): HTMLElement =>
    within(screen.getByTestId(`model-row-${pair}`)).getByRole('menuitemradio');

describe('ModelPicker readiness filtering', () => {
    it('offers exactly the providers providerUtils.isProviderReady accepts', () => {
        const providers = [
            mk('a', 'Alpha Ready'),
            mk('off', 'Disabled One', { isEnabled: false }),
            mk('nokey', 'Keyless One', { apiKey: '   ' }),
            mk('b', 'Beta Ready'),
        ];
        open({ providers, value: 'a::a-m1', onChange: () => undefined });
        const panel = openProviders();

        // The contract is PARITY with providerUtils.isProviderReady — not a
        // snapshot of its current rule (readiness semantics, e.g. keyless
        // providers, are the shared predicate's to evolve; the picker must
        // follow it automatically, which is exactly what this guards).
        const expected = providers.filter(isProviderReady).map(p => p.name);
        const unexpected = providers.filter(p => !isProviderReady(p)).map(p => p.name);
        expect(expected.length).toBeGreaterThan(0);
        expect(expected.length + unexpected.length).toBe(providers.length);
        for (const name of expected) {
            expect(within(panel).getByRole('menuitemradio', { name: new RegExp(name) })).toBeTruthy();
        }
        for (const name of unexpected) {
            expect(within(panel).queryByRole('menuitemradio', { name: new RegExp(name) })).toBeNull();
        }
    });

    it('renders a refresh affordance in the panel header, and no effort dial', () => {
        open({ providers: [mk('a', 'Alpha Ready')], value: 'a::a-m1', onChange: () => undefined });
        expect(screen.getByRole('button', { name: /refresh models/i })).toBeTruthy();
        // A form field that picks a vision or memory model has no chat session
        // whose thinking tier to edit.
        expect(screen.queryByTestId('model-menu-effort')).toBeNull();
    });

    it('invokes onRefreshModels and shows the feedback word when clicked', async () => {
        const onRefresh = vi.fn().mockResolvedValue(undefined);
        open({ providers: [mk('a', 'Alpha Ready')], value: 'a::a-m1', onChange: () => undefined, onRefreshModels: onRefresh });
        const refreshBtn = screen.getByRole('button', { name: /refresh models/i });
        fireEvent.click(refreshBtn);
        expect(onRefresh).toHaveBeenCalledTimes(1);
        await waitFor(() => {
            expect(refreshBtn.textContent).toContain('Updated!');
        });
    });

    it('dispatches august:refresh-models when the host has no handler', () => {
        const eventSpy = vi.fn();
        window.addEventListener('august:refresh-models', eventSpy);
        open({ providers: [mk('a', 'Alpha Ready')], value: 'a::a-m1', onChange: () => undefined });
        fireEvent.click(screen.getByRole('button', { name: /refresh models/i }));
        expect(eventSpy).toHaveBeenCalledTimes(1);
        window.removeEventListener('august:refresh-models', eventSpy);
    });

    it('flags a pair whose provider is not ready', () => {
        stubRect();
        render(<ModelPicker providers={[mk('a', 'Alpha', { isEnabled: false })]} value="a::m1" onChange={() => undefined} />);
        expect(screen.getByTestId('model-picker-trigger').textContent).toMatch(/unavailable/);
    });

    it('flags a bare id no ready provider lists', () => {
        stubRect();
        render(<ModelPicker providers={[mk('b', 'Beta', { models: ['listed'] })]} value="gone-model" mode="model-only" onChange={() => undefined} />);
        expect(screen.getByTestId('model-picker-trigger').textContent).toMatch(/unavailable/);
    });

    it('does NOT flag a model id the catalog omits but the provider can still serve', () => {
        // A user-typed custom id is a real selection. Claiming it is
        // unavailable would refuse to run a model that answers, so the pair
        // path only checks the PROVIDER is ready.
        stubRect();
        render(<ModelPicker providers={[mk('c', 'Gamma', { models: ['other'] })]} value="c::custom-id" onChange={() => undefined} />);
        expect(screen.getByTestId('model-picker-trigger').textContent).not.toMatch(/unavailable/);
    });

    it('falls back to the placeholder when nothing is picked', () => {
        stubRect();
        render(<ModelPicker providers={[mk('d', 'Delta', { models: ['free-model:free'] })]} value="" onChange={() => undefined} />);
        expect(screen.getByTestId('model-picker-trigger').textContent).toBe('Select model');
    });
});

/**
 * Model search. The contract that matters, carried over unchanged from the
 * two-column flyout: the box searches EVERY model on EVERY ready provider, not
 * the one the pointer happens to be over. A search that only worked on the
 * hovered provider would be a filter wearing a search box's clothes.
 */
describe('ModelPicker search', () => {
    const twoProviders: ProviderConfig[] = [
        mk('alpha', 'Alpha', { models: ['gpt-4o', 'o3-mini'] }),
        mk('beta', 'Beta', { models: ['gpt-4o-mini', 'claude-opus'] }),
    ];

    const openSearch = (onChange = () => undefined): void => {
        open({ providers: twoProviders, value: 'alpha::gpt-4o', onChange });
    };

    it('finds a model on a provider the pointer was never over', () => {
        openSearch();
        fireEvent.change(screen.getByTestId('model-picker-search'), { target: { value: 'claude' } });
        expect(screen.getByTestId('model-picker-results')).toBeTruthy();
        expect(screen.getByTestId('model-row-beta::claude-opus')).toBeTruthy();
        // The row names the provider it came from, in words — a raw provider id
        // is not something the trader can read off a list.
        expect(screen.getByTestId('model-picker-results').textContent).toContain('Beta');
    });

    it('matches on a substring, case-insensitively', () => {
        openSearch();
        fireEvent.change(screen.getByTestId('model-picker-search'), { target: { value: 'GPT-4O' } });
        expect(screen.getByTestId('model-row-alpha::gpt-4o')).toBeTruthy();
        expect(screen.getByTestId('model-row-beta::gpt-4o-mini')).toBeTruthy();
    });

    it('shows the same model name on two providers as two distinct choices', () => {
        const dupes: ProviderConfig[] = [
            mk('alpha', 'Alpha', { models: ['gpt-4o'] }),
            mk('beta', 'Beta', { models: ['gpt-4o'] }),
        ];
        open({ providers: dupes, value: 'alpha::gpt-4o', onChange: () => undefined });
        fireEvent.change(screen.getByTestId('model-picker-search'), { target: { value: 'gpt-4o' } });
        const results = screen.getByTestId('model-picker-results');
        // One row per provider — the label alone cannot tell them apart.
        expect(within(results).getAllByRole('menuitemradio')).toHaveLength(2);
        expect(results.textContent).toContain('Alpha');
        expect(results.textContent).toContain('Beta');
        expect(screen.getByTestId('model-menu-count').textContent).toBe('2');
    });

    it('reports an honest miss rather than an empty box', () => {
        openSearch();
        fireEvent.change(screen.getByTestId('model-picker-search'), { target: { value: 'nosuchmodel' } });
        expect(screen.getByTestId('model-picker-results').textContent).toMatch(/No model matches/i);
        expect(screen.getByTestId('model-menu-count').textContent).toBe('0');
    });

    it('selects a hit through the same value shape as a provider pick', () => {
        const onChange = vi.fn();
        openSearch(onChange);
        fireEvent.change(screen.getByTestId('model-picker-search'), { target: { value: 'claude' } });
        fireEvent.click(pickRow('beta::claude-opus'));
        // provider-model mode still emits "provider::model".
        expect(onChange).toHaveBeenCalledWith('beta::claude-opus');
        expect(screen.queryByTestId('model-menu')).toBeNull();
    });

    it('Escape clears a stale filter first, and closes only when there is nothing to undo', () => {
        openSearch();
        const box = screen.getByTestId('model-picker-search');
        fireEvent.change(box, { target: { value: 'gpt' } });
        expect(screen.getByTestId('model-picker-results')).toBeTruthy();
        fireEvent.keyDown(box, { key: 'Escape' });
        expect((screen.getByTestId('model-picker-search') as HTMLInputElement).value).toBe('');
        expect(screen.queryByTestId('model-picker-results')).toBeNull();
        expect(screen.getByTestId('model-menu')).toBeTruthy();
        fireEvent.keyDown(screen.getByTestId('model-menu'), { key: 'Escape' });
        expect(screen.queryByTestId('model-menu')).toBeNull();
    });
});

describe('the two modes, and what a picker inside a form needs', () => {
    it('model-only opens on the provider that owns the stored id and writes the bare id back', () => {
        const onChange = vi.fn();
        const providers = [
            mk('alpha', 'Alpha', { models: ['gpt-4o'] }),
            mk('beta', 'Beta', { models: ['vision-pro'] }),
        ];
        open({ providers, value: 'vision-pro', mode: 'model-only', onChange });
        expect(screen.getByTestId('model-menu-provider-row').textContent).toContain('Beta');
        fireEvent.click(pickRow('beta::vision-pro'));
        expect(onChange).toHaveBeenCalledWith('vision-pro');
    });

    it('greys a value that is already taken, and refuses the click', () => {
        const onChange = vi.fn();
        const providers = [mk('a', 'Alpha', { models: ['m1', 'm2'] })];
        open({ providers, value: '', onChange, disabledValues: new Set(['a::m1']) });
        const taken = pickRow('a::m1');
        expect(taken).toBeDisabled();
        fireEvent.click(taken);
        expect(onChange).not.toHaveBeenCalled();
        // The other seat slot is still offerable — the rule is per value.
        fireEvent.click(pickRow('a::m2'));
        expect(onChange).toHaveBeenCalledWith('a::m2');
    });

    it('offers ONE Manage providers row, and only when the host can route there', () => {
        const onManage = vi.fn();
        open({ providers: [mk('a', 'Alpha')], value: '', onChange: () => undefined, onManageModels: onManage });
        const panel = openProviders();
        // The reference's `New provider` and `Manage models` are one destination
        // wearing two names; August has one row.
        expect(within(panel).queryByText('New provider')).toBeNull();
        expect(within(panel).getAllByRole('menuitem').map(el => el.textContent?.trim())).toEqual(['Manage providers']);
        fireEvent.click(within(panel).getByRole('menuitem', { name: /Manage providers/ }));
        expect(onManage).toHaveBeenCalledTimes(1);
        expect(screen.queryByTestId('model-menu')).toBeNull();
    });

    it('shows no provider-config row when the host cannot route to Settings', () => {
        open({ providers: [mk('b', 'Beta')], value: '', onChange: () => undefined });
        fireEvent.click(screen.getByTestId('model-menu-provider-row'));
        expect(within(screen.getByTestId('model-menu-providers')).queryByRole('menuitem')).toBeNull();
    });
});

describe('the picker speaks the menu contract', () => {
    it('advertises the menu it opens, the way every other menu in the app does', () => {
        stubRect();
        render(<ModelPicker providers={[mk('a', 'Alpha')]} value="a::a-m1" onChange={() => undefined} />);
        const trigger = screen.getByTestId('model-picker-trigger');
        expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        expect(trigger).toHaveAccessibleName(/^Model: Alpha · /);
        fireEvent.click(trigger);
        expect(screen.getByTestId('model-picker-trigger').getAttribute('aria-expanded')).toBe('true');
    });
});

describe('one panel, not two implementations', () => {
    const pickerSrc = fs.readFileSync('components/shared/ModelPicker.tsx', 'utf8');

    it('the picker holds no flyout of its own', () => {
        // The point of Phase 3. If a portal, a positioner or a mode with no
        // render site comes back into this file, the two designs are back and
        // the trader is again looking at two different model menus.
        expect(pickerSrc).not.toMatch(/createPortal/);
        expect(pickerSrc).not.toMatch(/computeFlyoutPosition/);
        expect(pickerSrc).not.toMatch(/'provider-only'/);
        expect(pickerSrc).toMatch(/<ModelMenu/);
    });

    it('and it keeps no second copy of the shared preferences', () => {
        // The star list and the free-only toggle belong to the panel; a local
        // copy is how the two homes drifted apart (G-4).
        expect(pickerSrc).not.toMatch(/readFreeOnlyPref|writeFreeOnlyPref|STARRED_MODELS_KEY/);
    });
});
