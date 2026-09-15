import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Guards the A/B eval's arm construction. The whole point of the eval is a
 * clean with-skill vs without-skill comparison, so:
 *   1. the treatment arm carries the skill body, the baseline does NOT
 *      (eval trades match the skill by design — an unfiltered baseline
 *      would silently contain it),
 *   2. both arms otherwise share the same production notebook context,
 *   3. neither arm records prompt-injection telemetry — synthetic arms
 *      must never pollute the attribution data that weighted evidence
 *      credit reads (skillInjectedSince).
 */

const analyzeCalls: Array<{ prompt: string }> = [];

vi.mock('../services/providers/GenericAnalysisService', () => ({
    analyzeTradingView: (async (_cfg: unknown, params: { prompt: string }) => {
        analyzeCalls.push({ prompt: params.prompt });
        return { analysis: { confidence: 'Medium', direction: 'Long' } };
    }) as never,
}));

vi.mock('../services/learning/MemoryModelService', () => ({
    resolveMemoryConfig: (async () => ({
        id: 'test-provider',
        name: 'Test',
        apiKey: 'k',
        isEnabled: true,
        apiFormat: 'chat_completions',
        models: ['m'],
        selectedModel: 'm',
    })) as never,
}));

import { buildDefaultRunner } from '../services/learning/SkillEvalScheduler';
import {
    initMemoryFiles,
    createMemoryFile,
    getMemoryFiles,
} from '../services/learning/MemoryFilesService';
import { parseSkillMarkdown, serializeSkill, type SkillMeta } from '../services/learning/SkillMemoryService';
import { getRecentMemoryInjections } from '../services/learning/MemoryInjectionService';
import type { LoggedTrade, TradeAnalysis } from '../types';

const USER = 'eval-arms-user';

const makeTrade = (id = 't1'): LoggedTrade => ({
    id,
    analysis: {
        coinName: 'BTCUSDT',
        direction: 'Short',
        detectedPatternFamily: 'Family A',
        entryPoints: [{ price: 100 }],
        stopLoss: 105,
        takeProfit: [{ price: 90 }],
    } as unknown as TradeAnalysis,
    outcome: 'LOSS' as never,
    timestamp: '2026-08-09T12:00:00.000Z',
});

const SKILL_BODY_MARKER = 'wait for the 4h close below the range low';

/**
 * A REAL-SIZE skill file: serializeSkill is exactly what the production
 * writer emits, and on a lived-in skill its YAML frontmatter runs 25-35
 * lines (description, prediction line, history JSON, controlIds…). Earlier
 * versions of this suite seeded a 10-line frontmatter stub, which let the
 * raw-file injection ride under the eval body budget and MASKED the
 * frontmatter-eats-the-budget bug. With this seed, the raw markdown is far
 * longer than EVAL_SKILL_BODY_MAX (700) — the body marker sits deep in the
 * file, so any implementation that injects the RAW content truncates it
 * away.
 */
const realSizeSkillContent = (): string => {
    const iso = new Date().toISOString();
    const meta: SkillMeta = {
        status: 'confirmed',
        kind: 'avoid',
        description: 'Avoid: IF BTC short setup in Family A prints without a reclaim close THEN skip the short — learned from ranging-tape clusters where every such short ran into the funding squeeze.',
        coin: 'BTCUSDT',
        direction: 'Short',
        family: 'Family A',
        regime: 'ranging',
        wins: 1,
        losses: 7,
        consecutiveLosses: 3,
        tradeIds: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'],
        evidenceCount: 10,
        ifCondition: 'BTC short setup in Family A without a reclaim close',
        thenAction: 'skip the short until the reclaim candle closes',
        strategyFamily: 'mean_reversion',
        horizon: 'intraday',
        recentOutcomes: 'LLWLWLLLLL',
        prediction: { expectedLiftPts: 6, horizonTrades: 10, scope: { coin: 'BTC', family: 'Family A', regime: 'ranging' } },
        claimTestedEvidence: 10,
        evalVerdict: 'helps',
        evalDetail: '3/3',
        lastEvalAt: iso,
        lastEvidenceAt: iso,
        modifiedAt: iso,
        controlIds: ['c1', 'c2', 'c3'],
        history: [
            { status: 'candidate', validFrom: '2026-08-01T00:00:00.000Z', invalidAt: '2026-08-05T00:00:00.000Z', reason: 'evidence' },
            { status: 'confirmed', validFrom: '2026-08-05T00:00:00.000Z', reason: 'evidence' },
        ],
        body: [
            '**When:** BTC short setup in Family A without a reclaim close',
            '**What I do:** skip the short; demand the reclaim candle first;',
            `and before anything else ${SKILL_BODY_MARKER}.`,
        ].join('\n'),
    };
    return serializeSkill(meta, 'Avoid BTC short');
};

const seedNotebook = async (): Promise<{ fileId: string }> => {
    await initMemoryFiles(USER);
    const folders = getMemoryFiles().folders;
    const profile = folders.find(f => f.name === 'profile')!;
    await createMemoryFile(
        profile.id,
        'doctrine.md',
        'DOCTRINE-MARKER: I do not chase extended moves.',
        USER,
        true,
    );
    const skills = folders.find(f => f.name === 'skills')!;
    const content = realSizeSkillContent();
    // Guard the guard: if this fixture ever shrinks back under the eval body
    // budget it stops proving the truncation bug is fixed.
    expect(content.length).toBeGreaterThan(700);
    const file = await createMemoryFile(skills.id, 'btc-short-avoid.md', content, USER, true);
    return { fileId: file.id };
};

describe('skill A/B eval arm construction', () => {
    beforeEach(async () => {
        analyzeCalls.length = 0;
        localStorage.clear();
        await seedNotebook();
    });

    const skillContext = () => {
        const file = getMemoryFiles().files.find(f => f.name === 'btc-short-avoid.md')!;
        return { name: file.name, content: file.content, meta: parseSkillMarkdown(file.content)! };
    };

    it('treatment carries the skill body; baseline genuinely excludes it', async () => {
        const runner = buildDefaultRunner({ id: 'test-provider' } as never, USER);
        const skill = skillContext();

        await runner(makeTrade(), { skillEnabled: true, skill });
        await runner(makeTrade(), { skillEnabled: false, skill });

        expect(analyzeCalls).toHaveLength(2);
        const [treatment, baseline] = analyzeCalls;
        // The body marker sits ~700 chars INTO THE RAW FILE behind the
        // frontmatter — if the treatment arm ever regresses to injecting
        // raw markdown, the 700-char cap truncates this away.
        expect(treatment.prompt).toContain(SKILL_BODY_MARKER);
        // And the budget buys PROCEDURE, not YAML: none of the file's
        // frontmatter keys may leak into the arm.
        expect(treatment.prompt).not.toContain('status: confirmed');
        expect(treatment.prompt).not.toContain('recentOutcomes:');
        expect(treatment.prompt).not.toContain('controlIds:');
        expect(baseline.prompt).not.toContain(SKILL_BODY_MARKER);
        // The skill's frontmatter header must not leak into the baseline either.
        expect(baseline.prompt).not.toContain('skills/btc-short-avoid.md');
    });

    it('both arms share the production notebook context', async () => {
        const runner = buildDefaultRunner({ id: 'test-provider' } as never, USER);
        const skill = skillContext();

        await runner(makeTrade(), { skillEnabled: true, skill });
        await runner(makeTrade(), { skillEnabled: false, skill });

        const [treatment, baseline] = analyzeCalls;
        expect(treatment.prompt).toContain('DOCTRINE-MARKER');
        expect(baseline.prompt).toContain('DOCTRINE-MARKER');
    });

    it('neither arm records injection telemetry', async () => {
        const runner = buildDefaultRunner({ id: 'test-provider' } as never, USER);
        const skill = skillContext();

        await runner(makeTrade(), { skillEnabled: true, skill });
        await runner(makeTrade(), { skillEnabled: false, skill });

        // Telemetry writes are fire-and-forget; give them a tick to land.
        await new Promise(r => setTimeout(r, 20));
        const records = await getRecentMemoryInjections(USER);
        expect(records).toHaveLength(0);
    });
});
