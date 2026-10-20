/**
 * E-03 (the ledger half) — the skill R ledger is NET, and says so.
 *
 * The accumulator used to sum GROSS R multiples into a field called `netR`,
 * so the name lied and every expectancy in the app was gross (plan finding
 * F-13). The cost model (`utils/netRiskReward.ts`) is the one place that knows
 * what a round trip costs in R, and it charges the cost on a LOSS too.
 *
 * Three things this pins, because each of them is a way the truth can be lost:
 *  1. the NET is stored in `netR` and the GROSS stays available under its own
 *     name, so nothing that needs the raw market result loses it;
 *  2. a cost that could NOT be computed is never stored as a zero cost — the
 *     figure is flagged as not-a-net instead;
 *  3. a file written before the cost model is read as the GROSS it always was,
 *     never quietly relabelled as a net.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../services/infrastructure/PreferencesService', () => ({
    getPreferenceObject: vi.fn(async () => null),
    getPreference: vi.fn(async () => null),
    getPreferenceArray: vi.fn(async () => []),
    setPreferenceObject: vi.fn(async () => { }),
    removePreference: vi.fn(async () => { }),
}));

import {
    countTradeOutcome,
    halveCounts,
    parseSkillMarkdown,
    serializeSkill,
    skillExpectancyR,
    type SkillMeta,
} from '../services/learning/SkillMemoryService';
import { netRiskReward, stopDistancePercent } from '../utils/netRiskReward';

const meta = (over: Partial<SkillMeta> = {}): SkillMeta => ({
    status: 'candidate',
    kind: 'repeat',
    wins: 0,
    losses: 0,
    consecutiveLosses: 0,
    tradeIds: [],
    body: '**Trigger:** t\n**Procedure:** do it.',
    ...over,
} as SkillMeta);

/** A 1 % stop: entry 100, stop 99. */
const STOP_1PCT = stopDistancePercent(100, 99);

describe('the skill R ledger is net', () => {
    it('charges the round trip to a WIN and keeps the gross beside it', () => {
        const m = meta();
        const expected = netRiskReward({ grossR: 2, stopDistancePct: STOP_1PCT });
        expect(expected.known).toBe(true);

        countTradeOutcome(m, true, 2, { stopDistancePct: STOP_1PCT });

        // The gross is available under its own name.
        expect(m.grossR).toBe(2);
        // The net is the gross minus the modelled round trip.
        expect(m.netR).toBeCloseTo(expected.netR!, 4);
        expect(m.netR).toBeLessThan(m.grossR!);
        // And the file says which it is.
        expect(m.netRKnown).toBe(true);
        expect(m.netRUnknown).toBeUndefined();
    });

    it('charges the round trip to a LOSS too — you paid the fees and got stopped', () => {
        const m = meta();
        const expected = netRiskReward({ grossR: -1, stopDistancePct: STOP_1PCT });
        countTradeOutcome(m, false, -1, { stopDistancePct: STOP_1PCT });
        expect(m.grossR).toBe(-1);
        // A −1 R loss at a 0.10 R cost is −1.10, not −1.00.
        expect(m.netR).toBeCloseTo(expected.netR!, 4);
        expect(m.netR!).toBeLessThan(-1);
    });

    it('prefers the trade row\'s OWN net, so the cost is computed once per trade', () => {
        const m = meta();
        // The journal write path already netted this trade.
        countTradeOutcome(m, true, 2, { netR: 1.87, stopDistancePct: 99 });
        expect(m.netR).toBe(1.87);
        expect(m.netRKnown).toBe(true);
    });

    it('never stores a missing cost as a ZERO cost', () => {
        const m = meta();
        // No cost at all: the trade carried no stop distance.
        countTradeOutcome(m, true, 2);
        // The figure is the gross…
        expect(m.netR).toBe(2);
        expect(m.grossR).toBe(2);
        // …and it is flagged as NOT a net, with the reason.
        expect(m.netRKnown).toBe(false);
        expect(m.netRUnknown).toBe('stop-distance');
    });

    it('keeps the whole sum flagged once ONE outcome could not be costed', () => {
        const m = meta();
        countTradeOutcome(m, true, 2, { stopDistancePct: STOP_1PCT });
        expect(m.netRKnown).toBe(true);
        countTradeOutcome(m, false, -1);            // uncosted
        expect(m.netRKnown).toBe(false);
        expect(m.netRUnknown).toBe('stop-distance');
    });

    it('reads a file written before the cost model as the GROSS it always was', () => {
        // A legacy file: `netR` and no `grossR`. Its `netR` WAS the gross.
        const legacy = [
            '---',
            'name: "legacy"',
            'description: "a legacy skill"',
            'netR: 2.5',
            'rSampled: 10',
            '---',
            '',
            '# Legacy',
            '',
            'body',
            '',
        ].join('\n');
        const back = parseSkillMarkdown(legacy)!;
        // The number is where every reader expects it…
        expect(back.netR).toBe(2.5);
        expect(back.rSampled).toBe(10);
        // …and it is named honestly.
        expect(back.grossR).toBe(2.5);
        expect(back.netRKnown).toBe(false);
        expect(back.netRUnknown).toBe('legacy-gross');
        // The expectancy still reads it.
        expect(skillExpectancyR(back)).toBeCloseTo(0.25, 4);
    });

    it('keeps a legacy GROSS ledger in gross, so its sum never mixes two units', () => {
        // A legacy file's gross cannot be converted — the old trades' stop
        // distances are gone, so their costs are unknowable. The ledger keeps
        // its unit, and an outcome added to it is added GROSS.
        const legacy = parseSkillMarkdown([
            '---',
            'name: "legacy"',
            'description: "a legacy skill"',
            'netR: -0.9',
            'rSampled: 10',
            '---',
            '',
            '# Legacy',
            '',
            'body',
            '',
        ].join('\n'))!;

        countTradeOutcome(legacy, true, 0.1, { stopDistancePct: STOP_1PCT });
        // Gross, not net: the ledger's unit has not changed under it.
        expect(legacy.netR).toBeCloseTo(-0.8, 4);
        expect(legacy.grossR).toBeCloseTo(-0.8, 4);
        expect(legacy.netRKnown).toBe(false);
        expect(legacy.netRUnknown).toBe('legacy-gross');
    });

    it('keeps the legacy marker across a write, so the unit does not flip', () => {
        const legacy = parseSkillMarkdown([
            '---',
            'name: "legacy"',
            'description: "a legacy skill"',
            'netR: -0.9',
            'rSampled: 10',
            '---',
            '',
            '# Legacy',
            '',
            'body',
            '',
        ].join('\n'))!;
        const written = serializeSkill(legacy, 'Legacy');
        const back = parseSkillMarkdown(written)!;
        expect(back.netRUnknown).toBe('legacy-gross');
        // And the marker still means GROSS after the round trip.
        countTradeOutcome(back, true, 0.1, { stopDistancePct: STOP_1PCT });
        expect(back.netR).toBeCloseTo(-0.8, 4);
    });

    it('round-trips the gross/net pair through the markdown', () => {
        const m = meta();
        countTradeOutcome(m, true, 2, { stopDistancePct: STOP_1PCT });
        const back = parseSkillMarkdown(serializeSkill(m, 'R skill'))!;
        expect(back.grossR).toBeCloseTo(m.grossR!, 4);
        expect(back.netR).toBeCloseTo(m.netR!, 4);
        expect(back.netRKnown).toBe(true);
    });

    it('decays the gross with the same evidence the net decays with', () => {
        const m = meta();
        countTradeOutcome(m, true, 4, { stopDistancePct: STOP_1PCT });
        countTradeOutcome(m, false, -2, { stopDistancePct: STOP_1PCT });
        expect(m.rSampled).toBe(2);
        expect(m.grossR).toBe(2);
        const netBefore = m.netR!;
        halveCounts(m, 1);
        expect(m.rSampled).toBe(1);
        // The sum is scaled by the sample actually RETAINED (1 of 2), so the
        // gross and the net decay by the same factor and the average they
        // quote stays the same.
        expect(m.grossR).toBeCloseTo(1, 4);
        expect(m.netR).toBeCloseTo(netBefore / 2, 4);
    });
});
