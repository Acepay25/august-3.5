import { describe, it, expect } from 'vitest';
import { getMemoryFilesContext, SKILL_BLOCK_MAX } from '../services/learning/MemoryRetrievalService';
import { initMemoryFiles, createMemoryFile, getMemoryFiles } from '../services/learning/MemoryFilesService';
import { serializeSkill, type SkillMeta } from '../services/learning/SkillMemoryService';

// THE TRADING DEFECT: the verdict stage is the only stage that produces a
// binding decision, and it receives the skill procedure through a naive
// slice(0, 400) — the FIRST 400 chars of whatever order the prose arrived in.
// The recall tool (which the model must ASK for) receives the smart
// projectSkillCard projection: rule, trigger, when-NOT, first pitfall,
// verification, ticket fields, then numbered procedure.
//
// So a seat deciding on THIS exact setup can be handed 400 chars of "When:"
// prose and never reach a step — while a seat that calls recall gets the
// procedure in priority order. The verdict is the stage that must never lose
// the steps.

const QUERY = { coin: 'BTCUSDT', direction: 'Short' as const, family: 'Family A', regime: 'ranging' };

// A real skill written the way the craft writes it: verbose trigger prose
// first, the actual PROCEDURE far below. The steps sit well past 400 chars,
// so a first-400-chars implementation CANNOT deliver them.
const seedProcedureSkill = async (username: string): Promise<void> => {
    const trigger = '**When:** ' + 'the BTC short fires into resistance after a lower-high sweep without reclaim. '.repeat(6);
    const body = [
        trigger,
        '**When not to use:** a reclaim above the sweep high cancels this.',
        '**Watch:** funding flipping positive into the sweep.',
        '**Procedure:**',
        '1. Wait for the sweep low to print.',
        '2. Enter on the reclaim candle close.',
        '3. Stop above the sweep high.',
        '4. First target the prior range low.',
    ].join('\n');
    const meta: SkillMeta = {
        status: 'confirmed',
        kind: 'avoid',
        coin: 'BTCUSDT',
        direction: 'Short',
        family: 'Family A',
        regime: 'ranging',
        wins: 4,
        losses: 1,
        consecutiveLosses: 0,
        tradeIds: ['a', 'b', 'c', 'd', 'e'],
        evidenceCount: 5,
        approvedBy: 'grandfathered',
        ifCondition: 'BTC short into resistance without reclaim',
        thenAction: 'wait for the reclaim close before entering',
        body,
    };
    const skills = getMemoryFiles().folders.find(f => f.name === 'skills')!;
    await createMemoryFile(skills.id, 'btc-short-procedure.md', serializeSkill(meta, 'Avoid BTC short'), username, true);
};

describe('verdict stage delivers the PROCEDURE, not the first 400 chars', () => {
    it('serves the numbered steps to the binding stage', async () => {
        const user = `vp-steps-${Math.random().toString(36).slice(2)}`;
        await initMemoryFiles(user);
        await seedProcedureSkill(user);
        const out = getMemoryFilesContext(QUERY, undefined, 'analyst', 'verdict');
        // The seat deciding on this setup must reach an actionable step.
        expect(out).toContain('Enter on the reclaim candle close');
        expect(out).toMatch(/\d\.\s/); // a numbered step survived
    });

    it('spends the budget in priority order and reports the clip honestly', async () => {
        const user = `vp-not-${Math.random().toString(36).slice(2)}`;
        await initMemoryFiles(user);
        await seedProcedureSkill(user);
        const out = getMemoryFilesContext(QUERY, undefined, 'analyst', 'verdict');
        // projectSkillCard spends the budget in priority order — rule, trigger,
        // when-NOT, pitfall, verification, ticket, procedure — so a clipped
        // card loses the TAIL, never the trigger or the steps. This fixture's
        // trigger prose is deliberately huge (718 chars against a 400 cap), so
        // the exclusion is exactly the tail that must yield. What must NEVER
        // yield is the rule and the procedure.
        expect(out).toContain('IF BTC short into resistance without reclaim');
        expect(out).toContain('Enter on the reclaim candle close');
        // And the clip is named, so an absent step reads as MISSING, not as
        // the skill ending.
        expect(out).toMatch(/truncated skill procedure: first \d+ of \d+ chars/);
        expect(out).toContain('call recall for it if a step you need is missing');
    });

    it('reports the clip in the app ONE marker voice when it bites', async () => {
        const user = `vp-clip-${Math.random().toString(36).slice(2)}`;
        await initMemoryFiles(user);
        await seedProcedureSkill(user);
        const out = getMemoryFilesContext(QUERY, undefined, 'analyst', 'verdict');
        // If anything was withheld, it is named through harnessMarks — never a
        // bare "…" the model would read as the skill simply ending.
        if (out.includes('…')) {
            expect(out).toMatch(/truncated skill|first \d+ of \d+ chars/);
        }
        // And the block still respects the stage cap.
        expect(SKILL_BLOCK_MAX).toBe(400);
    });
});
