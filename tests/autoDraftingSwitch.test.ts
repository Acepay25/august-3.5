import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

import { getHarnessSettings, saveHarnessSettings } from '../utils/harnessSettings';
import { scanChartForSkills } from '../services/learning/chartScanSkills';
import { runSessionSkillReview } from '../services/learning/sessionSkillReview';
import type { ProviderConfig } from '../types/provider';

/**
 * The loop can produce playbook drafts it was not asked for: after every
 * finished turn it studies the conversation, and a seat can call the chart scan
 * itself. Both spend a model call and both put rows in the inbox.
 *
 * That is a capability, and a capability the app runs on its own has to be
 * something the trader turns ON. It shipped always-on. These tests pin three
 * things: the default is off, the guard lives at the SERVICE entry (so a caller
 * cannot bypass it), and an off switch makes no network request at all — not
 * merely "reads the candles and queues nothing".
 */

const CONFIG = {
    id: 'prov-a', name: 'Provider A', apiKey: 'k', baseUrl: 'https://api.example.com/v1',
    apiFormat: 'chat_completions', isEnabled: true, isBuiltIn: true,
    models: ['m'], selectedModel: 'm',
} as ProviderConfig;

const fetchSpy = vi.fn(async () => { throw new Error('a provider call was made'); });

beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('fetch', fetchSpy);
});
afterEach(() => { vi.unstubAllGlobals(); fetchSpy.mockClear(); });

describe('the auto-drafting switch', () => {
    it('is off until the trader turns it on', () => {
        expect(getHarnessSettings().autoDraftingEnabled).toBe(false);
        saveHarnessSettings({ autoDraftingEnabled: true });
        expect(getHarnessSettings().autoDraftingEnabled).toBe(true);
    });

    it('the chart scan drafts nothing and reads nothing while it is off', async () => {
        const r = await scanChartForSkills({ symbol: 'BTCUSDT', interval: '15m', username: 'u' });
        expect(r.queued).toBe(0);
        expect(r.candidates).toBe(0);
        expect(r.bars).toBe(0);
        expect(r.error).toMatch(/switched off/i);
        // The receipt tells the seat WHERE the switch is. A bare "no results"
        // would read as an empty market rather than as a refusal.
        expect(r.receipt).toMatch(/Settings/i);
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('the session review queues nothing and calls nothing while it is off', async () => {
        const queued = await runSessionSkillReview('u', [
            { transcript: 'User: BTC rejected the reclaim and I sized down', atMs: Date.now(), symbol: 'BTCUSDT' },
        ] as never, CONFIG, []);
        expect(queued).toBe(0);
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('the callers refuse too, so the answer arrives before any work is queued', () => {
        // Source contract: the desk tool must not let a seat call the scan and
        // get silence, and the turn runner must not even advance the "3 sessions
        // studied" counter while the switch is off — an off switch that accrues a
        // backlog would fire a burst of drafts the moment someone flips it.
        const tools = readFileSync('services/analysis/DeskToolsService.ts', 'utf8');
        expect(tools).toMatch(/if \(!getHarnessSettings\(\)\.autoDraftingEnabled\) \{\s*\n\s*content = 'DRAFTING IS SWITCHED OFF\./);
        const runner = readFileSync('services/trade/chatTurnRunner.ts', 'utf8');
        expect(runner).toMatch(/getHarnessSettings\(\)\.autoDraftingEnabled && recordSessionForReview\(/);
    });

    it('is offered in Settings beside the other harness switches', () => {
        const panel = readFileSync('components/settings/SessionUsagePanel.tsx', 'utf8');
        expect(panel).toContain('harness-auto-drafting');
        expect(panel).toMatch(/autoDraftingEnabled === true/);
        // It must not read as a checkbox with no consequence.
        expect(panel).toMatch(/Off — only what you ask for/);
    });
});
