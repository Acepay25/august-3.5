import { describe, it, expect, beforeEach } from 'vitest';
import {
    draftTriggerKey,
    isDraftTombstoned,
    tombstoneSkillDraftKey,
} from '../utils/skillDrafts';
import { maybeQueueVerdictSkillDraft } from '../utils/verdictSkillDraft';
import { initMemoryFiles } from '../services/learning/MemoryFilesService';
import type { TradeAnalysis } from '../types';

// Rejected skill triggers must stay quiet for the cooldown instead of
// re-queueing on the next verdict that cites the same pattern.

const analysis = (): TradeAnalysis => ({
    coinName: 'BTCUSDT',
    direction: 'Short',
    detectedPatternFamily: 'liquidity sweep',
    confidence: 'Avoid',
} as TradeAnalysis);

describe('draft rejection tombstones', () => {
    beforeEach(() => {
        localStorage.clear();
        return initMemoryFiles('tomb-user');
    });

    it('trigger keys are stable across equivalent inputs', () => {
        expect(draftTriggerKey('BTCUSDT', { kind: 'avoid', ifCondition: 'X then Y' }))
            .toBe(draftTriggerKey('btc', { kind: 'avoid', ifCondition: 'X then Y' }));
        expect(draftTriggerKey('BTCUSDT', { kind: 'avoid', ifCondition: 'A' }))
            .not.toBe(draftTriggerKey('BTCUSDT', { kind: 'avoid', ifCondition: 'B' }));
    });

    it('a discarded trigger is not re-queued within the cooldown', () => {
        const first = maybeQueueVerdictSkillDraft('m1', analysis(), 'tomb-user');
        expect(first).toBeTruthy();

        tombstoneSkillDraftKey(
            draftTriggerKey(first!.coin, first!.crafted),
            'tomb-user',
        );

        // Different messageId — same pattern — must now be suppressed.
        expect(maybeQueueVerdictSkillDraft('m2', analysis(), 'tomb-user')).toBeNull();
    });

    it('a tombstone expires after the cooldown and the trigger can queue again', () => {
        const first = maybeQueueVerdictSkillDraft('m1', analysis(), 'expire-user');
        const key = draftTriggerKey(first!.coin, first!.crafted);
        tombstoneSkillDraftKey(key, 'expire-user');
        expect(isDraftTombstoned(key, 'expire-user')).toBe(true);

        // Age the tombstone past the 7-day cooldown.
        const stored = JSON.parse(localStorage.getItem('skill_drafts_v1_rejected:expire-user')!);
        stored[0].ts = new Date(Date.now() - 8 * 24 * 3_600_000).toISOString();
        localStorage.setItem('skill_drafts_v1_rejected:expire-user', JSON.stringify(stored));

        expect(isDraftTombstoned(key, 'expire-user')).toBe(false);
        expect(maybeQueueVerdictSkillDraft('m3', analysis(), 'expire-user')).toBeTruthy();
    });

    it('a different pattern is never suppressed by an unrelated rejection', () => {
        tombstoneSkillDraftKey(draftTriggerKey('BTCUSDT', { kind: 'avoid', ifCondition: 'liquidity sweep short setup showing the liquidity sweep pattern' }), 'tomb-other');
        const other = maybeQueueVerdictSkillDraft('m1', analysis(), 'tomb-other');
        expect(other).toBeTruthy();
    });
});
