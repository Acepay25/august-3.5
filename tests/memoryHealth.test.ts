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
import { initMemoryFiles, updateMemoryFile, getMemoryFiles, createMemoryFile } from '../services/learning/MemoryFilesService';
import {
    ingestCraftedSkillFromDraft, listSkills, setSkillStatus, parseSkillMarkdown,
    serializeSkill, titleFromMeta,
} from '../services/learning/SkillMemoryService';
import { queueSkillDraft } from '../utils/skillDrafts';
import { listLearningProposals, queueLearningProposal } from '../utils/learningQueue';
import { upsertSettledBelief } from '../services/learning/settledBeliefs';
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

    it('reports the contradiction sweep into the health log, beside queueing it', async () => {
        // WS-4.1: the sweep used to run from the weekly block and reach a
        // console.log only — the proposal existed, the report never mentioned
        // it. Both halves are asserted here.
        const skills = getMemoryFiles().folders.find(f => f.name === 'skills')!;
        await createMemoryFile(skills.id, 'btc-sweep-repeat.md', `---
status: confirmed
kind: repeat
coin: BTCUSDT
direction: Short
wins: 3
losses: 1
ifCondition: btc london sweep short reclaim
thenAction: enter after the reclaim
tradeIds: a1
---

# Repeat
`, USER, true);
        await createMemoryFile(skills.id, 'btc-sweep-avoid.md', `---
status: confirmed
kind: avoid
coin: BTCUSDT
direction: Short
wins: 1
losses: 3
ifCondition: btc london sweep short
thenAction: skip the short
tradeIds: b1
---

# Avoid
`, USER, true);

        const res = await runMemoryHygiene(USER, { providerConfigs: [] });
        expect(res.contradictionsQueued).toBe(1);

        const conflict = listLearningProposals(USER).filter(p => p.kind === 'contradiction');
        expect(conflict).toHaveLength(1);
        expect(conflict[0].text).toContain('btc-sweep-repeat');
        expect(conflict[0].text).toContain('btc-sweep-avoid');

        const logged = await loadHygieneLog(USER);
        const line = logged.map(l => l.text).find(t => /contradiction sweep/i.test(t));
        expect(line).toBeDefined();
        // pairs examined / proposals queued / dismissed-by-dedupe
        expect(line).toMatch(/examined \d+ live-skill pairs?/i);
        expect(line).toMatch(/1 proposal queued/i);
        expect(line).toMatch(/0 already pending/i);

        // Second pass in the same week: the pending fingerprint dismisses the
        // pair, and the line says so instead of reporting silence.
        const again = await runMemoryHygiene(USER, { providerConfigs: [] });
        expect(again.contradictionsQueued).toBe(0);
        const line2 = (await loadHygieneLog(USER)).map(l => l.text)
            .find(t => /contradiction sweep/i.test(t))!;
        expect(line2).toMatch(/0 proposals queued/i);
        expect(line2).toMatch(/1 already pending/i);
        expect(listLearningProposals(USER).filter(p => p.kind === 'contradiction')).toHaveLength(1);
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

    it('does not report curated book seeds as untested or stale', async () => {
        // The seed corpus is 0W/0L by design and stays that way unless it
        // proves out. Counting it made a healthy default workspace read as a
        // stalled learning loop.
        const skills = getMemoryFiles().folders.find(f => f.name === 'skills')!;
        await createMemoryFile(skills.id, 'book-trend-pullback.md', `---
status: candidate
kind: repeat
prior: book
wins: 0
losses: 0
ifCondition: trending regime with a clean pullback into dynamic support
thenAction: enter with the trend once the pullback low holds on a close
tradeIds:
---

# Repeat: trend-following pullback entry
`, USER, true);

        const report = await buildMemoryHealthReport(USER);
        expect(report.skills.bookSeeds).toBe(1);
        expect(report.skills.unproven).toBe(0);
        expect(report.skills.staleEvidence).toBe(0);
        expect(report.flags).toEqual([]);
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

    it('separates a file that stopped getting hits from one the log never saw', async () => {
        // WS-4.3 "stale files (no hits in N days)": the injection log stamps
        // every run, so a file it CAN place a hit on gets a real last-hit age.
        // A file it cannot is absence, not staleness, and stays in `unobserved`.
        const DAY = 86_400_000;
        const profile = getMemoryFiles().folders.find(f => f.name === 'profile')!;
        // Padded well past the seeded notebook so both lists (capped at 12
        // rows, `unobserved` by size) actually have room to show the notes.
        const note = (title: string): string => `# ${title}\n\n${'holding line '.repeat(400)}`;
        await createMemoryFile(profile.id, 'gone-quiet.md', note('Gone quiet — served once, long ago.'), USER, true);
        await createMemoryFile(profile.id, 'still-serving.md', note('Still serving — hit two days ago.'), USER, true);
        await createMemoryFile(profile.id, 'never-served.md', note('Never served — no hit in the retained window.'), USER, true);
        store[`memory_injections_v1_${USER}`] = [
            {
                ts: new Date(Date.now() - 45 * DAY).toISOString(),
                stage: 'verdict', audience: 'moderator',
                sources: [{ path: 'profile/gone-quiet', kind: 'note' }],
            },
            {
                ts: new Date(Date.now() - 2 * DAY).toISOString(),
                stage: 'verdict', audience: 'moderator',
                sources: [{ path: 'profile/still-serving.md', kind: 'note' }],
            },
        ];

        const report = await buildMemoryHealthReport(USER);
        expect(report.injectionLogWindowRuns).toBeGreaterThan(0);
        expect(report.staleFiles.map(f => f.path)).toEqual(['profile/gone-quiet.md']);
        expect(report.staleFiles[0].daysSinceHit).toBeGreaterThanOrEqual(44);
        expect(Date.parse(report.staleFiles[0].lastHitAt)).toBeGreaterThan(0);
        // The two honest non-stale cases: recently hit, and no history at all.
        expect(report.unobserved.map(u => u.path)).not.toContain('profile/still-serving.md');
        expect(report.unobserved.map(u => u.path)).toContain('profile/never-served.md');
        expect(report.flags.join(' ')).toMatch(/last reached a prompt 30\+ days ago/);
    });

    it('names a settled belief that is standing but contradicted', async () => {
        // WS-4.3 "contradicted settled beliefs": the challenge pass only FLAGS
        // (nothing auto-invalidates), so `status` alone cannot express it and
        // the flag used to be buried in the generic needsRewrite count.
        await upsertSettledBelief(
            { slug: 'never-short-premium', body: 'Never short BTC into a premium sweep.', evidenceCount: 9 },
            USER,
        );
        queueLearningProposal({
            kind: 'contradiction',
            skillSlug: 'never-short-premium',
            text: 'Settled belief "never-short-premium" has been contradicted by 3 winning short trades in 30 days.',
            fingerprint: 'belief|never-short-premium',
        }, USER);
        // A skill-pair contradiction shares the proposal KIND but is not a
        // belief challenge — the named signal must not absorb it.
        queueLearningProposal({
            kind: 'contradiction', skillSlug: 'a-skill', relatedSlug: 'b-skill',
            text: 'Contradicting live skills.', fingerprint: 'contradiction|a-skill|b-skill',
        }, USER);

        const report = await buildMemoryHealthReport(USER);
        expect(report.beliefs.settled).toBe(1);
        expect(report.beliefs.invalidated).toBe(0);
        expect(report.beliefs.challenged).toBe(1);
        expect(report.flags.join(' '))
            .toMatch(/settled belief is contradicted by winning trades and still standing/);
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
