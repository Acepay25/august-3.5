/**
 * tradingTips — what the dock shows while a model thinks: a deterministic
 * rotation of specific trading tips, with every third slot preferring a
 * personal habit line drawn from the trader's learned memory.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TRADING_TIPS, nextTip, tipForSeed } from '../utils/tradingTips';
import { rememberProfileMemory, __clearProfileMemoriesForTests } from '../services/learning/profileMemory';

const USER = 'tips-user';

beforeEach(() => {
    localStorage.clear();
    __clearProfileMemoriesForTests(USER);
});

describe('tradingTips', () => {
    it('rotates the curated pool without repeating consecutive slots', () => {
        expect(TRADING_TIPS.length).toBeGreaterThanOrEqual(30);
        const a = nextTip(USER, 0);
        const b = nextTip(USER, 1);
        expect(TRADING_TIPS).toContain(a);
        expect(TRADING_TIPS).toContain(b);
        expect(a).not.toBe(b);
        expect(nextTip(USER, TRADING_TIPS.length)).toBe(a); // wraps
    });

    it('every third slot prefers a personal habit once memory exists', () => {
        // No memory yet → slot 2 falls back to the pool.
        expect(TRADING_TIPS).toContain(nextTip(USER, 2));
        rememberProfileMemory({
            name: 'prefers-15m-btc',
            description: 'Prefers BTC setups on the 15m chart.',
            kind: 'user',
            body: 'Habit.',
        }, USER);
        const personal = nextTip(USER, 2);
        expect(personal).toContain('Prefers BTC setups on the 15m chart');
        // Non-personal slots stay pool tips.
        expect(TRADING_TIPS).toContain(nextTip(USER, 3));
    });

    it('tipForSeed is stable per seed', () => {
        expect(tipForSeed('entry-abc', USER)).toBe(tipForSeed('entry-abc', USER));
        expect(tipForSeed('entry-abc', USER)).toBeTruthy();
    });
});
