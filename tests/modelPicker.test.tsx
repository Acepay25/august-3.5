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
