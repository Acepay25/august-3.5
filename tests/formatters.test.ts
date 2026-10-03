import { describe, it, expect } from 'vitest';
import { fmtPercent, fmtPrice } from '../utils/formatters';

/**
 * The audit (2026-09-15, dead-code sweep "duplicated fmtPrice ×4") consolidation:
 * utils/formatters.fmtPrice is the single canonical price formatter for the
 * trade surface. These tests pin the merged behavior — the desk variant's
 * fixed en-US locale + 2-decimal floor for tabular alignment, and the
 * screener variant's sub-$1 six-decimal precision (the desk's old max-4
 * printed SHIB/PEPE-class marks as "0.0000", destroying data).
 */
describe('utils/formatters fmtPrice', () => {
    it('groups with en-US separators and pads to 2 decimals (tabular alignment)', () => {
        expect(fmtPrice(45.3)).toBe('45.30');
        expect(fmtPrice(113456.789)).toBe('113,456.79');
    });

    it('keeps ≥$1000 prices at exactly 2 decimals', () => {
        expect(fmtPrice(1000)).toBe('1,000.00');
        expect(fmtPrice(75496.67)).toBe('75,496.67');
    });

    it('keeps $1–$999 prices at up to 4 decimals', () => {
        expect(fmtPrice(0.9)).toBe('0.90'); // below $1 → 6-decimal leg
        expect(fmtPrice(1.0001)).toBe('1.0001');
        expect(fmtPrice(2.3456)).toBe('2.3456');
        expect(fmtPrice(3.14159)).toBe('3.1416');
    });

    it('preserves sub-$1 precision up to 6 decimals (the screener leg)', () => {
        expect(fmtPrice(0.1234)).toBe('0.1234');
        expect(fmtPrice(0.0000118)).toBe('0.000012');
        // The old desk copy rendered this as "0.0000".
        expect(fmtPrice(0.0000444)).toBe('0.000044');
    });

    it('never prints NaN/Infinity on the desk', () => {
        expect(fmtPrice(Number.NaN)).toBe('—');
        expect(fmtPrice(Infinity)).toBe('—');
    });
});

/**
 * fmtPercent exists because percent readouts each carried whatever digits
 * their author left behind: a mean win rate reached the UI as
 * `66.66666666666666%` in one panel and `67%` in another, and a raw float
 * reflows its own column every tick. The digit count is a REQUIRED argument
 * so a call site has to state its precision rather than inherit one by
 * accident. Stage 2 Phase 0 (2026-10-03), paired with the house standard:
 * win rates 0, P&L 1, spread 3, funding 4.
 */
describe('utils/formatters fmtPercent', () => {
    it('takes the value in percent units and does NOT rescale it', () => {
        // A helper that silently multiplied by 100 would double-scale the
        // ledger, which already stores 0–100.
        expect(fmtPercent(0.5, 1)).toBe('0.5%');
        expect(fmtPercent(100, 0)).toBe('100%');
    });

    it('fixes the digit count so the glyph width never moves', () => {
        expect(fmtPercent(66.66666666666667, 0)).toBe('67%');
        expect(fmtPercent(3, 1)).toBe('3.0%');
        expect(fmtPercent(0.0001, 4)).toBe('0.0001%');
        expect(fmtPercent(0.00004, 3)).toBe('0.000%');
    });

    it('keeps en-US grouping and the caller sign', () => {
        expect(fmtPercent(1234.567, 1)).toBe('1,234.6%');
        expect(fmtPercent(-1.4, 1)).toBe('-1.4%');
    });

    it('never prints NaN/Infinity as a percent', () => {
        expect(fmtPercent(Number.NaN, 0)).toBe('—');
        expect(fmtPercent(Infinity, 1)).toBe('—');
    });
});
