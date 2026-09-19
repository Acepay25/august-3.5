/**
 * WS-4 — memory hygiene + the health report + bot provenance.
 *
 * The hygiene pass must be idempotent within a week (a fingerprinted proposal
 * per complaint, not one per boot), must never mutate a belief by itself (it
 * proposes; the supervisor or the human decides), and must survive having no
 * provider. The health report is the single read the Learn surface's Health
 * tab renders, so it has to reflect the queues it claims to reflect.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

let store: Record<string, unknown> = {};
vi.mock('../services/infrastructure/PreferencesService', () => ({
    getPreferenceObject: vi.fn(async (key: string) => store[key] ?? null),
    getPreferenceArray: vi.fn(async (key: string, guard?: (item: unknown) => boolean) => {
        const raw = store[key];
        if (!Array.isArray(raw)) return [];
        return guard ? raw.filter(guard) : raw;
    }),
    setPreferenceObject: vi.fn(async (key: string, value: unknown) => { store[key] = value; }),
    removePreference: vi.fn(async (key: string) => { delete store[key]; }),
}));

vi.mock('../services/learning/MemoryModelService', () => ({
    resolveMemoryConfig: vi.fn(async () => null),
}));

import {
    runMemoryHygiene, runMemoryHygieneIfDue, isHygieneDue, loadHygieneLog,
} from '../services/learning/memoryHygiene';
import { buildMemoryHealthReport } from '../services/learning/memoryHealth';
import { initMemoryFiles, updateMemoryFile, getMemoryFiles } from '../services/learning/MemoryFilesService';
import {
    ingestCraftedSkillFromDraft, listSkills, setSkillStatus, parseSkillMarkdown,
    serializeSkill, titleFromMeta,
} from '../services/learning/SkillMemoryService';
import { queueSkillDraft } from '../utils/skillDrafts';
import { listLearningProposals } from '../utils/learningQueue';
import { recordBotTurnOutcome, loadBotLearningStats } from '../services/agents/botLearning';
import { saveBot, getBots } from '../services/agents/agentRoster';
import { LAST_ACTIVE_USER_KEY } from '../utils/activeUser';
import type { LoggedTrade, TradeAnalysis } from '../types';
import { TradeOutcome } from '../types';

const USER = 'health-user';

const craft = (n: number) => ({
    name: `Rule ${n}`,
    kind: 'avoid' as const,
    when: `BTC sweeps the prior low on variant ${n} and closes back above it`,
    inputs: ['price'],
    steps: ['mark the low', 'wait for the reclaim close'],
    validate: 'the reclaim candle closed above the level',
    output: 'skip the short',
    approval: 'only when size changes',
    ifCondition: `BTC sweeps the prior low on variant ${n} but closes back above it`,
    thenAction: `Do not short variant ${n} — the failed sweep removes downside conviction`,
});

const botTrade = (id: string): LoggedTrade => ({
    id,
    analysis: {
        coinName: 'BTCUSDT', direction: 'Short', detectedPatternFamily: 'Family A',
        entryPoints: [{ price: 100 }], stopLoss: 105, takeProfit: [{ price: 90 }],
    } as unknown as TradeAnalysis,
    outcome: TradeOutcome.LOSS,
    postMortem: 'IF BTC sweeps the prior low and closes back above it THEN do not short the reclaim',
    timestamp: new Date(Date.now() - 5000).toISOString(),
    modelsUsed: { 'prov-bot': 'm' },
});

beforeEach(async () => {
    store = {};
    localStorage.clear();
    localStorage.setItem(LAST_ACTIVE_USER_KEY, USER);
    await initMemoryFiles(USER);
});

describe('runMemoryHygiene', () => {
    it('proposes demotion for a confirmed skill with no fresh evidence — and only once', async () => {
        await ingestCraftedSkillFromDraft(craft(1) as never, 'BTCUSDT', USER);
        await setSkillStatus(listSkills()[0].file.id, 'confirmed', USER);

        const first = await runMemoryHygiene(USER, { providerConfigs: [] });
        expect(first.demotionsQueued).toBe(1);
        expect(listLearningProposals(USER).map(p => p.kind)).toEqual(['demote']);
        // The pass proposes; it does not act. The ladder stays as it was until
        // the supervisor (or the human) judges the demotion.
        expect(listSkills()[0].meta.status).toBe('confirmed');

        // Same week again — the fingerprint must absorb it.
        const second = await runMemoryHygiene(USER, { providerConfigs: [] });
        expect(second.demotionsQueued).toBe(0);
        expect(listLearningProposals(USER)).toHaveLength(1);
    });

    it('leaves an evidenced skill alone and records what it did', async () => {
        await ingestCraftedSkillFromDraft(craft(2) as never, 'BTCUSDT', USER);
        const id = listSkills()[0].file.id;
        await setSkillStatus(id, 'confirmed', USER);
        const meta = parseSkillMarkdown(listSkills()[0].file.content)!;
        meta.lastEvidenceAt = new Date().toISOString();
        await updateMemoryFile(id, { content: serializeSkill(meta, titleFromMeta(meta)) }, USER);

        const res = await runMemoryHygiene(USER, { providerConfigs: [] });
        expect(res.demotionsQueued).toBe(0);
        expect(listLearningProposals(USER)).toHaveLength(0);
        expect(res.reviewWritten).toBe(false); // no provider ⇒ skipped, not failed
        expect(res.lines.join(' ')).toMatch(/no ready provider/i);
        await loadHygieneLog(USER).then(lines => expect(lines.length).toBeGreaterThan(0));
    });

    it('is due on a fresh install and not due right after a pass', async () => {
        expect(await isHygieneDue(USER)).toBe(true);
        await runMemoryHygieneIfDue(USER, []);
        expect(await isHygieneDue(USER)).toBe(false);
        expect(await runMemoryHygieneIfDue(USER, [])).toBeNull();
    });
});

describe('buildMemoryHealthReport', () => {
    it('reports the queues and skills it claims to', async () => {
        await ingestCraftedSkillFromDraft(craft(3) as never, 'BTCUSDT', USER);
        queueSkillDraft({ tradeId: 'h-1', coin: 'BTCUSDT', crafted: craft(4) as never }, USER);
        const report = await buildMemoryHealthReport(USER);
        expect(report.skills.total).toBe(1);
        expect(report.skills.candidate).toBe(1);
        expect(report.skills.unproven).toBe(1);
        expect(report.queues.drafts).toBe(1);
        expect(report.notebook.files).toBeGreaterThan(0);
        expect(report.folders.some(f => f.name === 'skills')).toBe(true);
        expect(report.generatedAt).toBeGreaterThan(0);
    });

    it('raises a flag when something is actually waiting', async () => {
        queueSkillDraft({ tradeId: 'h-2', coin: 'BTCUSDT', crafted: craft(5) as never }, USER);
        const report = await buildMemoryHealthReport(USER);
        expect(report.flags.join(' ')).toMatch(/waiting on the supervisor/i);
    });

    it('is clean when nothing needs attention', async () => {
        const report = await buildMemoryHealthReport(USER);
        expect(report.flags).toEqual([]);
        expect(report.queues.supervisorPending).toBe(0);
    });
});

describe('WS-3.3 provenance', () => {
    it('labels a skill a bot created, and only that one', async () => {
        saveBot({
            id: 'bot-9', name: 'Sweep', providerId: 'prov-bot', modelId: 'm',
            avatar: { kind: 'auto' }, createdAt: new Date().toISOString(),
        } as never);
        // A chart-AI skill already exists and will also count the trade.
        await ingestCraftedSkillFromDraft(craft(6) as never, 'BTCUSDT', USER);
        const chartAi = listSkills()[0].file.id;

        const trade = botTrade('bt-9');
        await recordBotTurnOutcome(
            { id: 'bot-9', name: 'Sweep', providerId: 'prov-bot' },
            'BTC short?',
            'Lesson: BTC shorting a failed sweep has no edge — wait for the reclaim close.',
            { username: USER, trades: [trade] },
        );

        const stamped = listSkills().filter(s => s.meta.originBotId === 'bot-9');
        expect(stamped.length).toBeGreaterThan(0);
        for (const s of stamped) {
            expect(s.file.id).not.toBe(chartAi);
            expect(s.meta.originBotName).toBe('Sweep');
        }
        // The chart-AI skill that also counted this trade keeps no bot label.
        const chartAiMeta = parseSkillMarkdown(
            getMemoryFiles().files.find(f => f.id === chartAi)!.content,
        )!;
        expect(chartAiMeta.originBotId).toBeUndefined();

        const stats = loadBotLearningStats();
        const row = stats.find(s => s.id === 'bot-9')!;
        expect(row.name).toBe('Sweep');
        expect(row.lessons).toBe(1);
        expect(row.skillsAuthored).toBe(stamped.length);
        expect(row.lastLessonAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(getBots()).toHaveLength(1);
    });
});
