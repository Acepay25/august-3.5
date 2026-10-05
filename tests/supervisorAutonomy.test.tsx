/**
 * WS-2's acceptance line, re-pointed at what the supervisor may now do alone.
 *
 * CONTRACT CHANGE (2026-10-05). This file used to prove the opposite of what it
 * says: with `manual` never passed, an autonomous pass turned a queued draft into
 * a LIVE skill stamped `approvedBy: 'supervisor'`, and a reject consumed the draft
 * and tombstoned its trigger key. The trader had asked that nothing model-generated
 * becomes active without their approval, so the supervisor is now AUTO-TRIAGE: it
 * reads, judges and records, and it changes nothing. These three cases therefore
 * assert what it DOES on its own — reads once, says something useful, leaves the
 * inbox exactly as it found it — and that the human's button is still the only
 * thing that creates or removes a skill.
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
import {
    ensureSupervisorListeners, setSessionModel, runSupervisorPass, triageNote,
} from '../services/learning/skillSupervisor';
import { useSupervisorBootstrap } from '../hooks/useSupervisorBootstrap';
import { queueSkillDraft, listSkillDrafts } from '../utils/skillDrafts';
import { initMemoryFiles, getMemoryFiles } from '../services/learning/MemoryFilesService';
import { isSkillFile } from '../services/learning/SkillMemoryService';
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

const verdict = (obj: unknown): void => {
    vi.mocked(streamChatRequest).mockReset();
    vi.mocked(streamChatRequest).mockImplementation(async function* (): AsyncGenerator<string> {
        yield JSON.stringify(obj);
    } as never);
};

const landedSkills = (): string[] => getMemoryFiles().files.filter(isSkillFile).map(f => f.name);
const decidedEvents = () => store.getSnapshot().events.filter(e => e.decision);

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

describe('autonomous triage — nobody presses anything, and nothing changes', () => {
it('the boot hook counts the backlog but never fires a pass on its own', async () => {
        // Seed the backlog BEFORE mounting (that is what the count must report),
        // with the queue listener deliberately not installed: this case is about
        // the boot hook, and the module-global listener installed by the earlier
        // cases in this file would answer the event instead.
        queueSkillDraft({ tradeId: 'a3', coin: 'ETHUSDT', crafted: { ...crafted(), name: 'Reclaim ETH' } }, USER);
        verdict({ action: 'approve', reason: 'fine by me' });
        const Harness: React.FC = () => { useSupervisorBootstrap(USER); return null; };
        render(<Harness />);
        // The hook installs listeners — which is what schedules a pass on the NEXT
        // queue event, and why the draft is queued before the mount here.
        expect(store.getSnapshot().pendingCount).toBe(1);
        // …and 30 s later nothing has been spent: the 12 s startup sweep is gone.
        await vi.advanceTimersByTimeAsync(30_000);
        expect(decidedEvents()).toHaveLength(0);
        expect(listSkillDrafts(USER)).toHaveLength(1);
    });

    it('a draft queued while the app runs is READ and annotated, never ingested', async () => {
        queueSkillDraft({ tradeId: 'a1', coin: 'BTCUSDT', crafted: crafted() }, USER);
        verdict({ action: 'approve', reason: 'mechanical trigger, falsifiable claim, not covered' });
        ensureSupervisorListeners();
        window.dispatchEvent(new Event('august-skill-drafts'));

        await vi.advanceTimersByTimeAsync(11_000);

        // The inbox is untouched — the trader's decision, not the model's.
        expect(listSkillDrafts(USER)).toHaveLength(1);
        expect(landedSkills()).toHaveLength(0);
        // …and the model still said something worth reading.
        const decided = decidedEvents();
        expect(decided).toHaveLength(1);
        expect(decided[0].decision?.verdict).toBe('approved');
        expect(decided[0].decision?.reason).toMatch(/triaged/i);
    });

    it('a rejected draft is NOT consumed and NOT tombstoned', async () => {
        queueSkillDraft({ tradeId: 'a2', coin: 'BTCUSDT', crafted: crafted() }, USER);
        verdict({ action: 'reject', reason: 'too generic to be falsifiable' });
        ensureSupervisorListeners();
        window.dispatchEvent(new Event('august-skill-drafts'));

        await vi.advanceTimersByTimeAsync(11_000);

        // A reject used to take the draft out of the inbox and tombstone its
        // trigger key — the model retiring the trader's own proposal.
        expect(listSkillDrafts(USER)).toHaveLength(1);
        expect(landedSkills()).toHaveLength(0);
        expect(triageNote(USER, listSkillDrafts(USER)[0].id)?.verdict).toBe('rejected');
    });

    
    it('a second pass does not re-read an item it has already triaged', async () => {
        queueSkillDraft({ tradeId: 'a4', coin: 'BTCUSDT', crafted: crafted() }, USER);
        verdict({ action: 'approve', reason: 'mechanical trigger, falsifiable claim, not covered' });

        expect(await runSupervisorPass(USER, { manual: true })).toBe(1);
        expect(decidedEvents()).toHaveLength(1);
        // The ledger is what stops the second pass paying for the same opinion.
        expect(await runSupervisorPass(USER, { manual: true })).toBe(0);
        expect(decidedEvents()).toHaveLength(1);
        expect(store.getSnapshot().pendingCount).toBe(0);
        expect(listSkillDrafts(USER)).toHaveLength(1);
    });
});
