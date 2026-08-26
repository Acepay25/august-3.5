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
import { parseSkillMarkdown } from '../services/learning/SkillMemoryService';
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
    const file = await createMemoryFile(skills.id, 'btc-short-avoid.md', `---
status: confirmed
kind: avoid
coin: BTCUSDT
direction: Short
family: Family A
wins: 1
losses: 6
ifCondition: BTC short setup in Family A
thenAction: skip the short
tradeIds: a,b,c
---

# Avoid BTC short

**When:** BTC short in Family A
**What I do:** ${SKILL_BODY_MARKER}.
`, USER, true);
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
        expect(treatment.prompt).toContain(SKILL_BODY_MARKER);
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
