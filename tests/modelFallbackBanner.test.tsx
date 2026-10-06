/**
 * The amber stale-model banner — one component, two composers.
 *
 * The Chat surface used to have no path to this warning at all: the same stored
 * pick that printed "Answering with X" in the dock silently answered from a
 * different model here. These pin that the words come from the shared component
 * and that the surface actually mounts it.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ModelFallbackBanner } from '../components/trade/panels/ChatComposer';
import { formatModelDisplayName } from '../utils/providerUtils';
import fs from 'node:fs';
import type { ProviderConfig } from '../types/provider';

const provider = {
    id: 'prov-a', name: 'Gemini', apiKey: 'k', baseUrl: '', apiFormat: 'chat_completions',
    isEnabled: true, isBuiltIn: false, models: ['gemini-2.5-pro'], selectedModel: 'gemini-2.5-pro',
} as unknown as ProviderConfig;

describe('ModelFallbackBanner', () => {
    it('renders nothing when the pick answers', () => {
        const { container } = render(<ModelFallbackBanner modelIssue={null} provider={provider} />);
        expect(container).toBeEmptyDOMElement();
        expect(screen.queryByTestId('model-fallback-warning')).toBeNull();
    });

    it('names the reason, the provider and the model that WILL answer', () => {
        render(
            <ModelFallbackBanner
                modelIssue={'The selected model "gpt-x" is no longer configured on any provider.'}
                provider={provider}
            />,
        );
        const banner = screen.getByTestId('model-fallback-warning');
        expect(banner).toHaveAttribute('role', 'status');
        expect(banner.textContent).toContain('is no longer configured on any provider');
        expect(banner.textContent).toContain('Answering with');
        expect(banner.textContent).toContain('Gemini');
        // The display form, not the wire id — the trader reads a name.
        expect(banner.textContent).toContain(formatModelDisplayName('gemini-2.5-pro'));
    });
});

describe('the Chat surface mounts the same banner', () => {
    it('renders it above the composer, and only for the solo path', () => {
        const src = fs.readFileSync('components/agents/AgentsView.tsx', 'utf8');
        // A bot answers from its own config, so the solo pick must not shout
        // over a conversation that never uses it.
        expect(src).toMatch(/\{!activeBot && modelFallback && \(\s*<ModelFallbackBanner/);
        expect(src).toMatch(/modelFallback\?: \{ issue: string; provider: ProviderConfig \} \| null;/);
    });

    it('is handed real facts by App, not a copy of the dock logic', () => {
        const app = fs.readFileSync('App.tsx', 'utf8');
        expect(app).toMatch(/computeChatModelFallback\(providerConfigs, selectedChatModel\)/);
        const panel = fs.readFileSync('components/trade/TradeChatPanel.tsx', 'utf8');
        expect(panel).toMatch(/computeChatModelFallback\(providers, selectedChatModel\)/);
        // The dock must not keep a second, divergent copy of the reason.
        expect(panel).not.toContain('is disabled or has no API key.`;\n        }');
    });
});
