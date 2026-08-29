import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

import { ChatInput } from '../components/chat/ChatInput';
import type { AgentBot } from '../services/agents/agentRoster';
import type { ProviderConfig } from '../types/provider';

beforeAll(() => {
    if (typeof window !== 'undefined' && !window.matchMedia) {
        window.matchMedia = ((query: string) => ({
            matches: false, media: query, onchange: null,
            addListener: () => {}, removeListener: () => {},
            addEventListener: () => {}, removeEventListener: () => {},
            dispatchEvent: () => false,
        })) as unknown as typeof window.matchMedia;
    }
});

afterEach(() => cleanup());

const noop = (): void => {};

const bot = (over: Partial<AgentBot> = {}): AgentBot => ({
    id: over.id ?? 'b1',
    name: over.name ?? 'Scout',
    providerId: over.providerId ?? 'p1',
    modelId: over.modelId ?? 'model-a',
    avatar: over.avatar ?? { kind: 'auto' },
    createdAt: over.createdAt ?? new Date().toISOString(),
    ...over,
});

const provider = (over: Partial<ProviderConfig> = {}): ProviderConfig => ({
    id: over.id ?? 'p1',
    name: over.name ?? 'OpenAI',
    apiKey: over.apiKey ?? 'sk-test',
    baseUrl: over.baseUrl ?? 'https://api.example.com',
    apiFormat: over.apiFormat ?? 'chat_completions',
    isEnabled: over.isEnabled ?? true,
    isBuiltIn: over.isBuiltIn ?? false,
    models: over.models ?? ['gpt-test'],
    selectedModel: over.selectedModel ?? 'gpt-test',
    ...over,
});

const base = {
    images: [],
    removeImage: noop,
    leverageInput: '',
    handleLeverageChange: noop,
    handleLeverageBlur: noop,
    handlePresetLeverage: noop,
    fileInputRef: { current: null } as React.RefObject<HTMLInputElement | null>,
    isImageUploadDisabled: false,
    handleImageUpload: noop,
    input: '',
    setInput: noop,
    handleSendMessage: noop,
    handleCancelAnalysis: noop,
    loadingMessage: null,
    isSummarizing: false,
    isAnalysisInProgress: false,
    isRateLimited: false,
    isAnyProviderEnabled: true,
    providers: [] as ProviderConfig[],
    selectedVisionModel: '',
    setSelectedVisionModel: noop,
    lensConfig: { enabled: false, assignments: [], tradingStyle: 'auto' as const },
    setLensConfig: noop,
    ensembleModelSelection: [],
    setEnsembleModelSelection: noop,
    customEnsemblePrompt: null,
    setCustomEnsemblePrompt: noop,
    customLensPrompts: {},
    setCustomLensPrompts: noop,
    isEnsembleEnabled: true,
    setIsEnsembleEnabled: noop,
    selectedChatModel: '',
    setSelectedChatModel: noop,
};

const getSelect = (): HTMLSelectElement =>
    screen.getByLabelText('Talk to') as HTMLSelectElement;

describe('Talk-to selector with named bots', () => {
    it('lists the bot roster ahead of raw provider models', () => {
        render(
            <ChatInput
                {...base}
                bots={[bot({ id: 'b1', name: 'Scout', modelId: 'model-a' })]}
                providers={[provider()]}
            />,
        );
        const select = getSelect();
        const labels = Array.from(select.options).map(o => o.textContent);
        expect(labels.some(l => l?.includes('Scout'))).toBe(true);
        expect(labels.some(l => l?.includes('OpenAI'))).toBe(true);
        // Bots come first.
        expect(labels.findIndex(l => l?.includes('Scout')))
            .toBeLessThan(labels.findIndex(l => l?.includes('OpenAI')));
    });

    it('selecting a bot opens its thread', () => {
        const onSelectBot = vi.fn();
        render(
            <ChatInput
                {...base}
                bots={[bot({ id: 'b1', name: 'Scout' }), bot({ id: 'b2', name: 'Raven' })]}
                onSelectBot={onSelectBot}
            />,
        );
        fireEvent.change(getSelect(), { target: { value: 'bot:b2' } });
        expect(onSelectBot).toHaveBeenCalledWith('b2');
    });

    it('the New bot… entry opens the New Bot dialog', () => {
        const onNewBot = vi.fn();
        render(<ChatInput {...base} bots={[bot()]} onNewBot={onNewBot} />);
        fireEvent.change(getSelect(), { target: { value: '__new_bot__' } });
        expect(onNewBot).toHaveBeenCalledTimes(1);
    });

    it('selecting Team still routes to the ensemble debate', () => {
        const setIsEnsembleEnabled = vi.fn();
        render(
            <ChatInput
                {...base}
                isEnsembleEnabled={false}
                setIsEnsembleEnabled={setIsEnsembleEnabled}
                bots={[bot()]}
            />,
        );
        fireEvent.change(getSelect(), { target: { value: '__team__' } });
        expect(setIsEnsembleEnabled).toHaveBeenCalledWith(true);
    });

    it('no New bot… entry without the callback; selector hidden in thread mode', () => {
        const { rerender } = render(<ChatInput {...base} bots={[bot()]} />);
        expect(Array.from(getSelect().options).some(o => o.value === '__new_bot__')).toBe(false);
        rerender(<ChatInput {...base} bots={[bot()]} threadMode onNewBot={vi.fn()} />);
        expect(screen.queryByTestId('talk-to-selector')).toBeNull();
    });
});
