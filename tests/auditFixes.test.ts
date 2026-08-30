import { describe, it, expect, vi, beforeEach } from 'vitest';

// Batch 14 (plan §14) regression tests — audit fixes for landed batches.

// ─── 14-1: Kelly accepts the journal's NEGATIVE loss magnitudes ────────────

import { kellyAdvisory } from '../utils/ticketSize';

describe('§14-1 kellyAdvisory sign normalization', () => {
    it('renders from a negative avgLoss (the journal stores losses negative)', () => {
        // Same economics as the positive-literal tests: W=0.6, R=2 → f*=0.4
        const adv = kellyAdvisory(12, 8, 200, -100);
        expect(adv.line).toContain('Kelly f*=40.0%');
        expect(adv.fullKelly).toBeCloseTo(0.4);
    });
    it('negative edge still advises no size, not a negative number', () => {
        const adv = kellyAdvisory(6, 14, 100, -100);
        expect(adv.line).toContain('negative');
        expect(adv.quarterKelly).toBe(0);
    });
});

// ─── 14-2: messages + google transports emit the P5 wire audit ─────────────

// The transport builds real fetch calls — stub fetch so no network happens.
// jsdom's location.hostname is 'localhost', which routes sendChatRequest
// through the dev /__provider_proxy branch — override it to a non-local
// host so the DIRECT messagesCall/googleCall path (the one §14-2 fixed)
// is what the tests exercise. Same setHostname pattern as
// tests/warmProviderConnection.test.ts.
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const originalLocation = window.location;
Object.defineProperty(window, 'location', {
    value: { ...originalLocation, hostname: 'august.test' },
    writable: true,
});

import { sendChatRequest } from '../services/providers/GenericProviderService';
import type { ProviderConfig } from '../types/provider';

const baseConfig = (over: Partial<ProviderConfig> = {}): ProviderConfig => ({
    id: 'p1', name: 'P1', apiKey: 'k', baseUrl: 'https://api.anthropic.com',
    apiFormat: 'messages', isEnabled: true, isBuiltIn: false,
    models: ['m'], selectedModel: 'claude-sonnet-4-5', ...over,
});

const anthropicOk = () => ({
    ok: true, status: 200,
    json: async () => ({ content: [{ type: 'text', text: 'hello' }], usage: {} }),
});

describe('§14-2 wire audit on every transport', () => {
    beforeEach(() => fetchMock.mockReset());

    it('messages format with thinking applied → anthropic-thinking audit', async () => {
        fetchMock.mockResolvedValue(anthropicOk());
        const audits: any[] = [];
        await sendChatRequest(baseConfig(), [{ role: 'user', content: 'x' }], {
            maxTokens: 2560, reasoningEffort: 'high', onWireAudit: e => audits.push(e),
        });
        expect(audits).toHaveLength(1);
        expect(audits[0].route).toBe('anthropic-thinking');
        expect(audits[0].applied).toBe(true);
        expect(audits[0].reason).toContain('budget_tokens=1024');
        // The body actually carried the thinking block.
        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 1024 });
    });

    it('messages format below the thinking floor → no-op audit with the reason', async () => {
        fetchMock.mockResolvedValue(anthropicOk());
        const audits: any[] = [];
        await sendChatRequest(baseConfig(), [{ role: 'user', content: 'x' }], {
            maxTokens: 1024, reasoningEffort: 'low', onWireAudit: e => audits.push(e),
        });
        expect(audits[0].route).toBe('none');
        expect(audits[0].applied).toBe(false);
        expect(audits[0].reason).toContain('1024 thinking floor');
    });

    it('google format → explicit fail-closed audit line', async () => {
        fetchMock.mockResolvedValue({
            ok: true, status: 200,
            json: async () => ({ candidates: [{ content: { parts: [{ text: 'hi' }] } }] }),
        });
        const audits: any[] = [];
        await sendChatRequest(baseConfig({
            apiFormat: 'google', baseUrl: 'https://generativelanguage.googleapis.com', selectedModel: 'gemini-x',
        }), [{ role: 'user', content: 'x' }], {
            reasoningEffort: 'high', onWireAudit: e => audits.push(e),
        });
        expect(audits).toHaveLength(1);
        expect(audits[0].route).toBe('none');
        expect(audits[0].reason).toContain('fail closed');
    });
});

// ─── 14-6: trade cap buckets by OPEN time; P&L stays close-time ────────────

import { assessSession, DEFAULT_SESSION_GUARD, rowPnlUsd } from '../services/validation/SessionGuardService';
import { TradeOutcome } from '../types/enums';
import type { LoggedTrade } from '../types/trade';
import type { TradeAnalysis } from '../types';

const mkTrade = (over: Partial<LoggedTrade>): LoggedTrade => ({
    id: `t-${Math.random().toString(36).slice(2)}`,
    analysis: {} as TradeAnalysis,
    timestamp: new Date(Date.UTC(2026, 7, 30, 0, 30)).toISOString(),
    outcome: TradeOutcome.LOSS,
    ...over,
});

describe('§14-6 open-time trade cap', () => {
    const NOW = new Date(Date.UTC(2026, 7, 30, 1, 0)); // 01:00 UTC Aug 30
    it('a trade opened yesterday but closed today does NOT consume today\'s cap', () => {
        const t = mkTrade({
            analysis: { createdAt: new Date(Date.UTC(2026, 7, 29, 23, 50)).toISOString() } as TradeAnalysis,
            pnlAmount: -50,
        });
        const v = assessSession([t], 10_000, DEFAULT_SESSION_GUARD, NOW);
        expect(v.tradesToday).toBe(0);
        // ...but its realized loss still counts against today's breaker.
        expect(v.dayPnlUsd).toBe(-50);
    });
    it('falls back to close timestamp when createdAt is absent', () => {
        const v = assessSession([mkTrade({ pnlAmount: -50 })], 10_000, DEFAULT_SESSION_GUARD, NOW);
        expect(v.tradesToday).toBe(1);
    });
});

// ─── 14-7: rowPnlUsd converts leveraged percents through the margin ────────

describe('§14-7 rowPnlUsd', () => {
    it('uses investmentAmount as the margin when present', () => {
        const t = mkTrade({ pnlAmount: undefined, pnlPercent: -50, investmentAmount: 2000 });
        expect(rowPnlUsd(t, 10_000, 1)).toBeCloseTo(-1000);
    });
    it('falls back to the risk base (1% of equity) — documented convention', () => {
        const t = mkTrade({ pnlAmount: undefined, pnlPercent: -200 });
        expect(rowPnlUsd(t, 10_000, 1)).toBeCloseTo(-200);
    });
    it('pnlAmount stays authoritative', () => {
        const t = mkTrade({ pnlAmount: -75, pnlPercent: -200, investmentAmount: 2000 });
        expect(rowPnlUsd(t, 10_000, 1)).toBe(-75);
    });
});

// ─── 14-8: guard config resolution (preset + overrides + clamps) ───────────

import { getSessionGuardConfig } from '../utils/harnessSettings';

describe('§14-8 getSessionGuardConfig', () => {
    beforeEach(() => localStorage.clear());
    it('defaults to the tight preset', () => {
        const c = getSessionGuardConfig();
        expect(c.dailyLossLimitPct).toBeCloseTo(0.02);
        expect(c.maxTradesPerDay).toBe(2);
        expect(c.postLossCooldownMin).toBe(240);
    });
    it('FTMO preset loosens day loss and cap', () => {
        localStorage.setItem('harness_settings_v1', JSON.stringify({ guardPreset: 'ftmo' }));
        const c = getSessionGuardConfig();
        expect(c.dailyLossLimitPct).toBeCloseTo(0.03);
        expect(c.maxTradesPerDay).toBe(3);
    });
    it('per-field overrides win over the preset; junk clamps out', () => {
        localStorage.setItem('harness_settings_v1', JSON.stringify({
            guardPreset: 'ftmo', guardDailyLossPct: 1.5, guardMaxTradesPerDay: 999,
        }));
        const c = getSessionGuardConfig();
        expect(c.dailyLossLimitPct).toBeCloseTo(0.015);
        expect(c.maxTradesPerDay).toBe(3); // 999 rejected → preset value
    });
    it('carries the harness risk percent for the autopilot conversion', () => {
        localStorage.setItem('harness_settings_v1', JSON.stringify({ riskPercent: 0.5 }));
        expect(getSessionGuardConfig().tradeRiskPercent).toBe(0.5);
    });
});
