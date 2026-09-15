/**
 * ModelPicker readiness filter — regression guard for the 2026-09-15 audit
 * fix: the picker must use the SHARED providerUtils.isProviderReady
 * predicate, never a local copy of its rule (a local copy silently diverged
 * from the roster/pipeline readiness semantics).
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
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
});
