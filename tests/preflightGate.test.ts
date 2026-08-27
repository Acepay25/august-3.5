import { describe, it, expect } from 'vitest';

import {
    validateLensResponse,
    preflightFailureLine,
    buildPreflightBlock,
} from '../services/learning/preflight';

describe('validateLensResponse — happy path', () => {
    it('passes when all three lines are present and specific', () => {
        const text = `DATA: BTC 4H close below 94200
SOURCE: chart 4h bar
FALSIFICATION: a 4H close back above 94500`;
        expect(validateLensResponse(text)).toEqual({ pass: true });
    });

    it('passes with a named pattern + level + falsifier', () => {
        const text = `DATA: breakout above resistance at 94200
SOURCE: hybrid snapshot desk
FALSIFICATION: a sweep back below 94000`;
        expect(validateLensResponse(text)).toEqual({ pass: true });
    });

    it('is case-insensitive on the labels', () => {
        const text = `data: range-bound day 5
source: hybrid
falsification: a trend day reclaim above the range high`;
        expect(validateLensResponse(text)).toEqual({ pass: true });
    });
});

describe('validateLensResponse — rejections', () => {
    it('rejects empty text', () => {
        expect(validateLensResponse('')).toEqual({ pass: false, reason: 'no_preflight' });
    });

    it('rejects undefined / null', () => {
        expect(validateLensResponse(undefined)).toEqual({ pass: false, reason: 'no_preflight' });
        expect(validateLensResponse(null)).toEqual({ pass: false, reason: 'no_preflight' });
    });

    it('rejects when DATA is missing', () => {
        const text = `SOURCE: chart
FALSIFICATION: a 4H close back above 94500`;
        expect(validateLensResponse(text)).toEqual({ pass: false, reason: 'no_preflight' });
    });

    it('rejects when SOURCE is missing', () => {
        const text = `DATA: BTC 4H close below 94200
FALSIFICATION: a 4H close back above 94500`;
        expect(validateLensResponse(text)).toEqual({ pass: false, reason: 'no_preflight' });
    });

    it('rejects when FALSIFICATION is missing', () => {
        const text = `DATA: BTC 4H close below 94200
SOURCE: chart`;
        expect(validateLensResponse(text)).toEqual({ pass: false, reason: 'no_preflight' });
    });

    it('rejects when DATA is a placeholder ("N/A")', () => {
        const text = `DATA: N/A
SOURCE: chart
FALSIFICATION: a 4H close back above 94500`;
        expect(validateLensResponse(text)).toEqual({ pass: false, reason: 'junk_data' });
    });

    it('rejects when DATA is empty after the label', () => {
        const text = `DATA:
SOURCE: chart
FALSIFICATION: a 4H close back above 94500`;
        expect(validateLensResponse(text)).toEqual({ pass: false, reason: 'no_preflight' });
    });

    it('rejects when DATA is non-specific (no number, no level, no pattern)', () => {
        const text = `DATA: looks pretty bearish to me
SOURCE: chart
FALSIFICATION: a 4H close back above 94500`;
        expect(validateLensResponse(text)).toEqual({ pass: false, reason: 'non_specific_data' });
    });

    it('rejects when DATA is too short', () => {
        const text = `DATA: low
SOURCE: chart
FALSIFICATION: a 4H close back above 94500`;
        expect(validateLensResponse(text)).toEqual({ pass: false, reason: 'non_specific_data' });
    });

    it('rejects when FALSIFICATION is too thin', () => {
        const text = `DATA: BTC 4H close below 94200
SOURCE: chart
FALSIFICATION: nope`;
        expect(validateLensResponse(text)).toEqual({ pass: false, reason: 'thin_falsification' });
    });
});

describe('preflightFailureLine', () => {
    it('formats each reason as a one-line NO CLAIM message', () => {
        expect(preflightFailureLine('no_preflight')).toMatch(/^NO CLAIM — preflight failed/);
        expect(preflightFailureLine('junk_data')).toMatch(/junk DATA/);
        expect(preflightFailureLine('non_specific_data')).toMatch(/DATA line lacks/);
        expect(preflightFailureLine('thin_falsification')).toMatch(/FALSIFICATION/);
    });
});

describe('buildPreflightBlock', () => {
    it('renders a fixed template with all three labels', () => {
        const block = buildPreflightBlock();
        expect(block).toMatch(/DATA:/);
        expect(block).toMatch(/SOURCE:/);
        expect(block).toMatch(/FALSIFICATION:/);
        expect(block.toLowerCase()).toContain('preflight');
    });
});
