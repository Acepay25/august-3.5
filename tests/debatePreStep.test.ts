import { describe, expect, it } from 'vitest';
import { debatePreStep } from '../utils/debatePreStep';

describe('debatePreStep', () => {
    it('skips remaining rounds on HALT', () => {
        const d = debatePreStep({ gateResult: 'HALT', reason: '3 losses' });
        expect(d.action).toBe('skip_to_verdict');
        expect(d.inject).toContain('HALT');
    });

    it('continues with a size cap on REDUCE_SIZE', () => {
        const d = debatePreStep({ gateResult: 'REDUCE_SIZE' });
        expect(d.action).toBe('continue');
        expect(d.inject).toContain('REDUCE_SIZE');
    });

    it('is a no-op on PASS', () => {
        expect(debatePreStep({ gateResult: 'PASS' })).toEqual({ action: 'continue', inject: '' });
        expect(debatePreStep(null).action).toBe('continue');
    });

    it('skips rebuttals on a confirmed skill veto', () => {
        const d = debatePreStep({ skillVeto: 'avoid BTC short squeeze' });
        expect(d.action).toBe('skip_to_verdict');
        expect(d.inject).toContain('SKILL VETO');
    });
});
