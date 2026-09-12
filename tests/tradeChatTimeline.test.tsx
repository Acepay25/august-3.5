/**
 * The ZCode-style WORK TIMELINE: Thought rows interleave with tool rounds
 * (the `[Desk tools] …` mirrors inside the reasoning stream are the cut
 * points), and everything folds into ONE "Analyzed for Ns" wrapper that
 * collapses when the answer lands.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

vi.mock('lucide-react', async (importOriginal) => {
    const actual = await importOriginal<typeof import('lucide-react')>();
    // ReasoningRow/AnalyzedRow render lucide glyphs; keep them inert but real.
    return { ...actual };
});

import AnalyzedRow from '../components/shared/AnalyzedRow';
import TradeChatPanel from '../components/trade/TradeChatPanel';
import * as chatStore from '../services/trade/chatStore';
import type { ProviderConfig } from '../types/provider';

vi.mock('../services/analysis/DeskToolsService', () => ({
    streamChatWithDeskTools: vi.fn(async function* () { yield 'ok'; }),
}));
vi.mock('../services/analysis/HybridIntelligenceService', () => ({
    fetchHybridData: vi.fn(async () => ({})),
    generateHybridPromptInjection: vi.fn(() => '## packet'),
}));
vi.mock('../services/learning/SkillMemoryService', () => ({
    listSkills: vi.fn(() => []),
}));
vi.mock('../utils/activeUser', () => ({
    getActiveUsername: () => 'alice',
    LAST_ACTIVE_USER_KEY: 'last_active_user',
}));

const config: ProviderConfig = {
    id: 'prov-a', name: 'Provider A', apiKey: 'key-a',
    baseUrl: 'https://api.example.com/v1', apiFormat: 'chat_completions',
    isEnabled: true, isBuiltIn: true, models: ['model-a'], selectedModel: 'model-a',
};

describe('AnalyzedRow (the Worked-for wrapper)', () => {
    it('stays OPEN while working and folds to "Analyzed for Ns" on settle', async () => {
        const { rerender } = render(<AnalyzedRow running><p>timeline</p></AnalyzedRow>);
        const row = document.querySelector('[data-testid="analyzed-row"]') as HTMLDetailsElement;
        expect(row.open).toBe(true);
        expect(row.textContent).toMatch(/Analyzing for \d+s/);
        rerender(<AnalyzedRow running={false}><p>timeline</p></AnalyzedRow>);
        expect(row.open).toBe(false);
        expect(row.textContent).toMatch(/Analyzed for \d+s/);
        // The timeline stays in the DOM one click away.
        expect(screen.getByText('timeline')).toBeTruthy();
    });

    it('mounts settled history collapsed with no clock', () => {
        render(<AnalyzedRow><p>old work</p></AnalyzedRow>);
        const row = document.querySelector('[data-testid="analyzed-row"]') as HTMLDetailsElement;
        expect(row.open).toBe(false);
        expect(row.textContent).toMatch(/Analyzed/);
        expect(row.textContent).not.toMatch(/for \d+s/);
    });
});

describe('work timeline in the Chart AI transcript', () => {
    beforeEach(() => {
        chatStore.__resetForTests();
        localStorage.clear();
    });

    it('interleaves Thought rows with tool events and pairs call→result', () => {
        render(<TradeChatPanel symbol="BTCUSDT" interval="15m" providers={[config]} selectedChatModel="model-a" onSelectChatModel={() => {}} />);
        const sid = chatStore.getActiveId();
        act(() => {
            chatStore.mutate(sid, s => ({
                ...s,
                entries: [{
                    id: 'a-tl',
                    role: 'ai',
                    streaming: false,
                    text: 'Final answer here',
                    // The mirrors arrive INTERLEAVED with the reasoning exactly
                    // like the live stream produces them.
                    reasoning: 'pre-tool thinking\n[Desk tools] calling chart view…\n[Desk tools] chart view · ok\npost-tool conclusion',
                    tools: ['calling chart view…', 'chart view · ok'],
                }],
            }));
        });

        // The work folded into ONE wrapper, collapsed after settle…
        const row = document.querySelector('[data-testid="analyzed-row"]') as HTMLDetailsElement;
        expect(row).toBeTruthy();
        expect(row.open).toBe(false);
        expect(row.textContent).toMatch(/Analyzed/);

        // …which holds TWO Thought rows (before + after the tool round)…
        expect(screen.getAllByText('Thought')).toHaveLength(2);
        expect(screen.getByText('pre-tool thinking')).toBeTruthy();
        expect(screen.getByText('post-tool conclusion')).toBeTruthy();

        // …and the call/result PAIRED into one row — no lingering "calling…".
        expect(screen.getAllByText('chart view')).toHaveLength(1);
        expect(screen.queryByText('· calling…')).toBeNull();
        expect(screen.getByText('· ok')).toBeTruthy();

        // The final answer renders after the wrapper.
        expect(screen.getByText('Final answer here')).toBeTruthy();
    });

    it('renders tools-only turns (no reasoning) inside the same wrapper', () => {
        render(<TradeChatPanel symbol="BTCUSDT" interval="15m" providers={[config]} selectedChatModel="model-a" onSelectChatModel={() => {}} />);
        const sid = chatStore.getActiveId();
        act(() => {
            chatStore.mutate(sid, s => ({
                ...s,
                entries: [{
                    id: 'a-tools', role: 'ai', streaming: false,
                    text: 'done',
                    reasoning: '',
                    tools: ['calling watch price…', 'watch price · ok'],
                }],
            }));
        });
        expect(document.querySelector('[data-testid="analyzed-row"]')).toBeTruthy();
        expect(screen.getAllByText('watch price')).toHaveLength(1);
        expect(screen.queryByText('· calling…')).toBeNull();
    });
});
