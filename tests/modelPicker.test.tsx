/**
 * ModelPicker readiness filter — regression guard for the 2026-09-15 audit
 * fix: the picker must use the SHARED providerUtils.isProviderReady
 * predicate, never a local copy of its rule (a local copy silently diverged
 * from the roster/pipeline readiness semantics).
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import ModelPicker from '../components/shared/ModelPicker';
import { isProviderReady } from '../utils/providerUtils';
import type { ProviderConfig } from '../types/provider';

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

describe('ModelPicker readiness filtering', () => {
    it('lists exactly the providers providerUtils.isProviderReady accepts', () => {
        const providers = [
            mk('a', 'Alpha Ready'),
            mk('off', 'Disabled One', { isEnabled: false }),
            mk('nokey', 'Keyless One', { apiKey: '   ' }),
            mk('b', 'Beta Ready'),
        ];
        render(
            <ModelPicker
                providers={providers}
                value="a::a-m1"
                onChange={() => undefined}
            />,
        );
        fireEvent.click(screen.getByRole('button'));

        // The contract is PARITY with providerUtils.isProviderReady — not a
        // snapshot of its current rule (readiness semantics, e.g. keyless
        // providers, are the shared predicate's to evolve; the picker must
        // follow it automatically, which is exactly what this guards).
        const expected = providers.filter(isProviderReady).map(p => p.name);
        const unexpected = providers.filter(p => !isProviderReady(p)).map(p => p.name);
        expect(expected.length).toBeGreaterThan(0);
        expect(expected.length + unexpected.length).toBe(providers.length);
        for (const name of expected) expect(screen.queryByText(name)).not.toBeNull();
        for (const name of unexpected) expect(screen.queryByText(name)).toBeNull();
    });

    it('renders a refresh models button in the flyout header', () => {
        const providers = [mk('a', 'Alpha Ready')];
        render(
            <ModelPicker
                providers={providers}
                value="a::a-m1"
                onChange={() => undefined}
            />,
        );
        fireEvent.click(screen.getByRole('button'));
        const refreshBtn = screen.getByRole('button', { name: /refresh models/i });
        expect(refreshBtn).not.toBeNull();
        expect(refreshBtn.textContent).toContain('Refresh');
    });

    it('invokes onRefreshModels and shows feedback when clicked', async () => {
        const providers = [mk('a', 'Alpha Ready')];
        const onRefresh = vi.fn().mockResolvedValue(undefined);
        render(
            <ModelPicker
                providers={providers}
                value="a::a-m1"
                onChange={() => undefined}
                onRefreshModels={onRefresh}
            />,
        );
        fireEvent.click(screen.getByRole('button'));
        const refreshBtn = screen.getByRole('button', { name: /refresh models/i });
        fireEvent.click(refreshBtn);
        expect(onRefresh).toHaveBeenCalledTimes(1);
        await waitFor(() => {
            expect(refreshBtn.textContent).toContain('Updated!');
        });
    });

    it('dispatches august:refresh-models event when onRefreshModels is not provided', () => {
        const providers = [mk('a', 'Alpha Ready')];
        const eventSpy = vi.fn();
        window.addEventListener('august:refresh-models', eventSpy);
        render(
            <ModelPicker
                providers={providers}
                value="a::a-m1"
                onChange={() => undefined}
            />,
        );
        fireEvent.click(screen.getByRole('button'));
        const refreshBtn = screen.getByRole('button', { name: /refresh models/i });
        fireEvent.click(refreshBtn);
        expect(eventSpy).toHaveBeenCalledTimes(1);
        window.removeEventListener('august:refresh-models', eventSpy);
    });
});

/**
 * Model search. The contract that matters: the box searches EVERY model on
 * EVERY ready provider, not the one the pointer happens to be over. A search
 * that only worked on the hovered provider would be a filter wearing a
 * search box's clothes.
 */
describe('ModelPicker search', () => {
    const twoProviders: ProviderConfig[] = [
        mk('alpha', 'Alpha', { models: ['gpt-4o', 'o3-mini'] }),
        mk('beta', 'Beta', { models: ['gpt-4o-mini', 'claude-opus'] }),
    ];

    const open = (onChange = () => undefined) => {
        render(<ModelPicker providers={twoProviders} value="alpha::gpt-4o" onChange={onChange} />);
        fireEvent.click(screen.getByRole('button'));
    };

    it('finds a model on a provider the pointer was never over', () => {
        open();
        fireEvent.change(screen.getByTestId('model-picker-search'), { target: { value: 'claude' } });
        expect(screen.getByTestId('model-picker-results')).toBeTruthy();
        expect(screen.getByTitle('claude-opus')).toBeTruthy();
        // The provider column narrows to the one that actually has the hit.
        expect(screen.getByTestId('model-picker-results').textContent).toContain('beta');
    });

    it('matches on a substring, case-insensitively', () => {
        open();
        fireEvent.change(screen.getByTestId('model-picker-search'), { target: { value: 'GPT-4O' } });
        expect(screen.getByTitle('gpt-4o')).toBeTruthy();
        expect(screen.getByTitle('gpt-4o-mini')).toBeTruthy();
    });

    it('shows the same model name from two providers as two distinct choices', () => {
        const dupes: ProviderConfig[] = [
            mk('alpha', 'Alpha', { models: ['gpt-4o'] }),
            mk('beta', 'Beta', { models: ['gpt-4o'] }),
        ];
        render(<ModelPicker providers={dupes} value="alpha::gpt-4o" onChange={() => undefined} />);
        fireEvent.click(screen.getByRole('button'));
        fireEvent.change(screen.getByTestId('model-picker-search'), { target: { value: 'gpt-4o' } });
        const results = screen.getByTestId('model-picker-results');
        // One row per provider — the label alone cannot tell them apart.
        expect(screen.getAllByTitle('gpt-4o')).toHaveLength(2);
        expect(results.textContent).toContain('alpha');
        expect(results.textContent).toContain('beta');
    });

    it('reports an honest miss rather than an empty box', () => {
        open();
        fireEvent.change(screen.getByTestId('model-picker-search'), { target: { value: 'nosuchmodel' } });
        expect(screen.getByTestId('model-picker-results').textContent).toMatch(/No model matches/i);
        expect(screen.getByTestId('model-picker-count').textContent).toBe('0');
    });

    it('selects a hit through the same value shape as a hovered pick', () => {
        const onChange = vi.fn();
        open(onChange);
        fireEvent.change(screen.getByTestId('model-picker-search'), { target: { value: 'claude' } });
        fireEvent.click(screen.getByTitle('claude-opus'));
        // provider-model mode still emits "provider::model".
        expect(onChange).toHaveBeenCalledWith('beta::claude-opus');
    });

    it('Escape stops searching rather than leaving a stale filter behind', () => {
        open();
        const box = screen.getByTestId('model-picker-search');
        fireEvent.change(box, { target: { value: 'gpt' } });
        expect(screen.getByTestId('model-picker-results')).toBeTruthy();
        fireEvent.keyDown(box, { key: 'Escape' });
        // Escape also closes the flyout, so the input may unmount — assert
        // the OUTCOME (search stopped) rather than reading a detached node.
        const live = document.querySelector('[data-testid="model-picker-search"]') as HTMLInputElement | null;
        if (live) expect(live.value).toBe('');
        expect(screen.queryByTestId('model-picker-results')).toBeNull();
    });
});
