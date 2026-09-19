/**
 * WS-2's acceptance line, which no other test reaches.
 *
 * Every existing supervisor test calls `runSupervisorPass(user, { manual: true })`
 * — and `manual` is the "Run now" BUTTON. The plan's claim is that zero human
 * actions are REQUIRED, so the claim has to be proven through the autonomous
 * triggers instead: the queue-event debounce and the app-boot sweep. Neither was
 * ever exercised, and the other half of the acceptance ("auto off leaves
 * everything queued AND human-reachable") was only proven halfway.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup } from '@testing-library/react';

vi.mock('../services/providers/GenericProviderService', () => ({
    streamChatRequest: vi.fn(),
    sendChatRequest: vi.fn(),
    getQuickResponse: vi.fn(),
}));

import { streamChatRequest } from '../services/providers/GenericProviderService';
import * as store from '../services/learning/supervisorStore';
import { ensureSupervisorListeners, setSessionModel, runSupervisorPass } from '../services/learning/skillSupervisor';
import { useSupervisorBootstrap } from '../hooks/useSupervisorBootstrap';
import { queueSkillDraft, listSkillDrafts } from '../utils/skillDrafts';
import { initMemoryFiles, getMemoryFiles } from '../services/learning/MemoryFilesService';
import { isSkillFile, parseSkillMarkdown } from '../services/learning/SkillMemoryService';
import { LAST_ACTIVE_USER_KEY } from '../utils/activeUser';
import type { ProviderConfig } from '../types/provider';

const USER = 'auto-user';
const cfg: ProviderConfig = {
    id: 'prov-a', name: 'Judge', apiKey: 'k', baseUrl: 'https://x/v1',
    apiFormat: 'chat_completions', isEnabled: true, isBuiltIn: false,
    models: ['judge-1'], selectedModel: 'judge-1',
};

const crafted = () => ({
    name: 'Repeat BTC sweep reclaim',
    kind: 'repeat' as const,
    when: 'BTC sweeps the lows and reclaims within a bar or two',
    inputs: ['price'],
    steps: ['Watch the sweep', 'Enter the reclaim'],
    validate: 'Sweep plus reclaim confirmed on the close',
    output: 'Long entry',
    approval: 'draft until allowed',
    ifCondition: `BTC long reclaim after a liquidity sweep of the prior low`,
    thenAction: 'Enter long once the reclaim candle closes above the swept level',
});

const approve = (): void => {
    vi.mocked(streamChatRequest).mockReset();
    vi.mocked(streamChatRequest).mockImplementation(async function* (): AsyncGenerator<string> {
        yield JSON.stringify({ action: 'approve', reason: 'mechanical trigger, falsifiable claim, not covered' });
    } as never);
};

const landedSkills = (): Array<{ name: string; approvedBy?: string }> => getMemoryFiles().files
    .filter(isSkillFile)
    .map(f => ({ name: f.name, ...parseSkillMarkdown(f.content) } as { name: string; approvedBy?: string }));

beforeEach(async () => {
    store.__resetForTests();
    vi.useFakeTimers();
    localStorage.clear();
    localStorage.setItem(LAST_ACTIVE_USER_KEY, USER);
    setSessionModel(cfg);
    await initMemoryFiles(USER);
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe('autonomous supervision — nobody presses anything', () => {
    it('a draft queued while the app runs is supervised by the event debounce alone', async () => {
        queueSkillDraft({ tradeId: 'a1', coin: 'BTCUSDT', crafted: crafted() }, USER);
        approve();
        ensureSupervisorListeners();
        window.dispatchEvent(new Event('august-skill-drafts'));

        // Nothing before the debounce: the plan promises no silent immediate
        // spend, and no human step either.
        await vi.advanceTimersByTimeAsync(9_000);
        expect(listSkillDrafts(USER)).toHaveLength(1);

        await vi.advanceTimersByTimeAsync(2_000);
        expect(listSkillDrafts(USER)).toHaveLength(0);
        const skills = landedSkills();
        expect(skills).toHaveLength(1);
        expect(skills[0].approvedBy).toBe('supervisor');
    });

    it('a backlog that predates boot is drained by the startup sweep', async () => {
        queueSkillDraft({ tradeId: 'a2', coin: 'ETHUSDT', crafted: { ...crafted(), name: 'Reclaim ETH' } }, USER);
        approve();
        const Harness: React.FC = () => { useSupervisorBootstrap(USER); return null; };
        render(<Harness />);

        await vi.advanceTimersByTimeAsync(12_001);
        expect(listSkillDrafts(USER)).toHaveLength(0);
        expect(landedSkills()).toHaveLength(1);
        expect(store.getSnapshot().pendingCount).toBe(0);
    });

    it('with auto paused nothing moves on its own — and the human can still act', async () => {
        store.setAutoEnabled(false);
        queueSkillDraft({ tradeId: 'a3', coin: 'BTCUSDT', crafted: crafted() }, USER);
        approve();
        ensureSupervisorListeners();
        window.dispatchEvent(new Event('august-skill-drafts'));
        await vi.advanceTimersByTimeAsync(11_000);

        expect(listSkillDrafts(USER)).toHaveLength(1);
        expect(landedSkills()).toHaveLength(0);
        // Still queued AND still reachable: the pause is not a dead end.
        expect(await runSupervisorPass(USER, { manual: true })).toBe(1);
        expect(listSkillDrafts(USER)).toHaveLength(0);
    });
});
