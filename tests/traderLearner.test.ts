/**
 * traderLearner — the Kimi-style loop: every couple of sessions, ONE
 * independent call distills durable TRADER facts into profileMemory tagged
 * source:'auto', upserting by slug (update over duplicate), with a toggle
 * and counter cadence the chat never blocks on.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/providers/GenericProviderService', () => ({
    sendChatRequest: vi.fn(),
}));

import { sendChatRequest } from '../services/providers/GenericProviderService';
import {
    runTraderLearner, recordSessionForLearning,
    isTraderLearningEnabled, setTraderLearningEnabled,
} from '../services/learning/traderLearner';
import { listProfileMemories, __clearProfileMemoriesForTests } from '../services/learning/profileMemory';
import type { ProviderConfig } from '../types/provider';

const USER = 'learn-user';
const cfg = {
    id: 'p', name: 'P', apiKey: 'k', baseUrl: 'https://x/v1',
    apiFormat: 'chat_completions', isEnabled: true, isBuiltIn: false,
    models: ['m'], selectedModel: 'm',
} as ProviderConfig;

const FACTS = JSON.stringify([
    {
        name: 'prefers-15m-btc',
        description: 'Prefers BTC setups on the 15m chart with 4h confirmation.',
        kind: 'user',
        body: 'Almost every discussed plan is BTC 15m; the user checks the 4h before entering.',
    },
    {
        name: 'risk-2pct-fixed',
        description: 'Sizes every trade at a fixed 2% account risk.',
        kind: 'feedback',
        body: 'The user states 2% is their cap and asks to be reminded when sizing drifts.\n\n**Why:** protects against streaks.\n**How to apply:** flag any plan implying >2%.',
    },
]);

beforeEach(() => {
    localStorage.clear();
    __clearProfileMemoriesForTests(USER);
    vi.mocked(sendChatRequest).mockReset();
});

describe('traderLearner cadence + toggle', () => {
    it('fires every 2 sessions', () => {
        expect(recordSessionForLearning(USER)).toBe(false);
        expect(recordSessionForLearning(USER)).toBe(true);
        expect(recordSessionForLearning(USER)).toBe(false);
    });

    it('respects the toggle (default on, persists off)', () => {
        expect(isTraderLearningEnabled(USER)).toBe(true);
        setTraderLearningEnabled(false, USER);
        expect(isTraderLearningEnabled(USER)).toBe(false);
        expect(localStorage.getItem(`trader_learning_v1:${USER}`)).toBe('0');
    });

    it('a disabled learner makes no calls and writes nothing', async () => {
        setTraderLearningEnabled(false, USER);
        const n = await runTraderLearner(USER, cfg, ['User: I always trade BTC on the 15m chart and keep risk at two percent. Assistant: noted, I will watch sizing with you. Additional context: the user discusses entries, stops and position size at length across the session.']);
        expect(n).toBe(0);
        expect(vi.mocked(sendChatRequest)).not.toHaveBeenCalled();
        expect(listProfileMemories(USER)).toHaveLength(0);
    });
});

describe('traderLearner extraction', () => {
    it('writes durable facts tagged source:auto into profileMemory', async () => {
        recordSessionForLearning(USER); // one more bump inside the learner makes it due
        vi.mocked(sendChatRequest).mockResolvedValue(FACTS);
        const n = await runTraderLearner(USER, cfg, ['User: I only trade BTC 15m with 2% risk. Assistant: understood. The user keeps coming back to the same routine: BTC perps, the 15m chart, a 4h confirmation, and a hard two percent risk cap on every position they open.']);
        expect(n).toBe(2);
        const entries = listProfileMemories(USER);
        expect(entries.map(e => e.slug)).toContain('prefers-15m-btc');
        expect(entries.every(e => e.source === 'auto')).toBe(true);
        expect(entries.find(e => e.slug === 'risk-2pct-fixed')?.kind).toBe('feedback');
    });

    it('does not churn an unchanged fact on the next pass (update-not-duplicate)', async () => {
        recordSessionForLearning(USER);
        vi.mocked(sendChatRequest).mockResolvedValue(FACTS);
        await runTraderLearner(USER, cfg, ['User: as always, BTC 15m entries with the 4h confirmation and the two percent cap before anything else. Assistant: noted, the routine is unchanged from last session and the risk discipline holds. Journal notes confirm this pattern repeats across the last several sessions without exception.']);
        expect(vi.mocked(sendChatRequest)).toHaveBeenCalledTimes(1);
        // Two more sessions → due again; the model repeats the SAME facts.
        recordSessionForLearning(USER); recordSessionForLearning(USER);
        await runTraderLearner(USER, cfg, ['User: same routine again, BTC on the 15m with the 4h check first and the same sizing rules as before. Assistant: consistent as ever, the preferences have not changed. Journal notes confirm this pattern repeats across the last several sessions without exception.']);
        expect(listProfileMemories(USER)).toHaveLength(2); // updated in place, not duplicated
        expect(listProfileMemories(USER).every(e => e.source === 'auto')).toBe(true);
    });

    it('garbage output writes nothing', async () => {
        recordSessionForLearning(USER);
        vi.mocked(sendChatRequest).mockResolvedValue('no json here');
        const n = await runTraderLearner(USER, cfg, ['User: lets talk about the chart setup for a while, the tape looks heavy here today and I want a second opinion before I size in. Assistant: happy to walk through it. Journal notes confirm this pattern repeats across the last several sessions without exception.']);
        expect(n).toBe(0);
        expect(listProfileMemories(USER)).toHaveLength(0);
    });
});
