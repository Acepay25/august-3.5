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

// The Talk-to control is a SelectMenu (reference-styled dropdown): the
// trigger carries the aria-label, options render in a portal listbox with
// data-option values. Helpers below replace the old native-<select> access.

const getTrigger = (): HTMLElement => screen.getByLabelText('Talk to');

const openMenu = (): void => {
    fireEvent.click(getTrigger());
};

const pickOption = (value: string): void => {
    openMenu();
    const opt = document.querySelector(`[data-option="${value}"]`) as HTMLElement;
    if (!opt) throw new Error(`option ${value} not rendered`);
    fireEvent.click(opt);
};

const optionValues = (): string[] => {
    openMenu();
    const vals = Array.from(document.querySelectorAll('[data-option]')).map(el => el.getAttribute('data-option')!);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    return vals;
};

describe('Talk-to selector with named bots', () => {
    it('lists the bot roster ahead of raw provider models', () => {
        render(
            <ChatInput
                {...base}
                bots={[bot({ id: 'b1', name: 'Scout', modelId: 'model-a' })]}
                providers={[provider()]}
            />,
        );
        const values = optionValues();
        expect(values.some(v => v.startsWith('bot:'))).toBe(true);
        expect(values.some(v => v === 'gpt-test')).toBe(true);
        // Bots come first (after Team).
        expect(values.indexOf('bot:b1')).toBeLessThan(values.indexOf('gpt-test'));
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
        pickOption('bot:b2');
        expect(onSelectBot).toHaveBeenCalledWith('b2');
    });

    it('the New bot… entry opens the New Bot dialog', () => {
        const onNewBot = vi.fn();
        render(<ChatInput {...base} bots={[bot()]} onNewBot={onNewBot} />);
        pickOption('__new_bot__');
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
        pickOption('__team__');
        expect(setIsEnsembleEnabled).toHaveBeenCalledWith(true);
    });

    it('no New bot… entry without the callback; selector hidden in thread mode', () => {
        const { rerender } = render(<ChatInput {...base} bots={[bot()]} />);
        expect(optionValues().some(v => v === '__new_bot__')).toBe(false);
        rerender(<ChatInput {...base} bots={[bot()]} threadMode onNewBot={vi.fn()} />);
        expect(screen.queryByTestId('talk-to-selector')).toBeNull();
    });
});

// ── G4 (plan botmode-scan): @mention autocomplete from the live roster ────
describe('@mention popover (G4)', () => {
    it('offers collapsed roster handles while typing @ (multi-word names included)', () => {
        const setInput = vi.fn();
        render(
            <ChatInput
                {...base}
                bots={[bot({ name: 'Risk Bot' }), bot({ id: 'b2', name: 'Macro' })]}
                input="check @"
                setInput={setInput}
            />,
        );
        // "Risk Bot" must surface as @riskbot — the exact token the room
        // engine and mailbox resolve (the old hack truncated to "@Risk",
        // which no parser matched).
        expect(screen.getByRole('button', { name: '@riskbot' })).toBeTruthy();
        expect(screen.getByRole('button', { name: '@macro' })).toBeTruthy();
    });

    it('clicking a chip inserts the handle into the composer', () => {
        const setInput = vi.fn();
        render(
            <ChatInput {...base} bots={[bot({ name: 'Macro' })]} input="ask @" setInput={setInput} />,
        );
        fireEvent.click(screen.getByRole('button', { name: '@macro' }));
        expect(setInput).toHaveBeenCalledTimes(1);
        expect(String(setInput.mock.calls[0][0])).toContain('@macro');
    });

    it('works in casual mode too (mentions route room turns, not debates)', () => {
        render(
            <ChatInput {...base} isEnsembleEnabled={false} bots={[bot({ name: 'Scout' })]} input="@" />,
        );
        expect(screen.getByRole('button', { name: '@scout' })).toBeTruthy();
    });

    it('no popover without bots', () => {
        render(<ChatInput {...base} bots={[]} input="@" />);
        expect(screen.queryByText('Mention')).toBeNull();
    });
});
