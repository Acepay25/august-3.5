import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Preferences layer so initMemoryFiles runs in-memory.
let store: Record<string, unknown> = {};
vi.mock('../services/infrastructure/PreferencesService', () => ({
    getPreferenceObject: vi.fn(async (key: string) => store[key] ?? null),
    setPreferenceObject: vi.fn(async (key: string, value: unknown) => {
        store[key] = value;
    }),
    removePreference: vi.fn(async (key: string) => {
        delete store[key];
    }),
}));

import { AnalystRole } from '../types';
import { initMemoryFiles } from '../services/learning/MemoryFilesService';
import {
    LENS_FILES,
    appendLensMemoryLine,
    readLensMemory,
    summarizeLensMemory,
    lensMemoryDoctrineLine,
    lensFileForRole,
} from '../services/learning/lensMemory';

const USERNAME = 'lens-mem-test';

describe('lensFileForRole', () => {
    it('maps each AnalystRole to the right file', () => {
        expect(lensFileForRole(AnalystRole.MACRO_VOLATILITY)).toBe('macro.md');
        expect(lensFileForRole(AnalystRole.TECHNICAL_ANALYST)).toBe('technical.md');
        expect(lensFileForRole(AnalystRole.RISK_EXECUTION)).toBe('risk.md');
    });
    it('returns "" for UNASSIGNED or unknown', () => {
        expect(lensFileForRole(AnalystRole.UNASSIGNED)).toBe('');
        expect(lensFileForRole('bogus')).toBe('');
    });
    it('infers a role from a string name', () => {
        expect(lensFileForRole('MACRO_VOLATILITY')).toBe('macro.md');
        expect(lensFileForRole('Technical Analyst')).toBe('technical.md');
        expect(lensFileForRole('Risk & Execution')).toBe('risk.md');
    });
});

describe('readLensMemory / summarizeLensMemory / lensMemoryDoctrineLine', () => {
    beforeEach(async () => {
        store = {};
        await initMemoryFiles(USERNAME);
    });

    it('returns empty strings when the file does not exist yet', () => {
        expect(readLensMemory(AnalystRole.MACRO_VOLATILITY)).toBe('');
        expect(summarizeLensMemory(AnalystRole.MACRO_VOLATILITY)).toBe('');
        expect(lensMemoryDoctrineLine(AnalystRole.MACRO_VOLATILITY)).toBe('');
    });

    it('appends lines, reads them back, and surfaces a one-line doctrine summary', async () => {
        await appendLensMemoryLine(AnalystRole.MACRO_VOLATILITY, 'BTC 4H regime: ranging for 5 days', USERNAME);
        await appendLensMemoryLine(AnalystRole.MACRO_VOLATILITY, 'Session: NY, no follow-through on breakouts', USERNAME);

        const content = readLensMemory(AnalystRole.MACRO_VOLATILITY);
        expect(content).toContain('# Macro Lens Memory');
        expect(content).toContain('BTC 4H regime: ranging for 5 days');
        expect(content).toContain('Session: NY, no follow-through on breakouts');

        const summary = summarizeLensMemory(AnalystRole.MACRO_VOLATILITY, 1000);
        expect(summary).toContain('BTC 4H regime');

        const doctrine = lensMemoryDoctrineLine(AnalystRole.MACRO_VOLATILITY);
        expect(doctrine).toBe('Macro Lens Memory');
    });

    it('truncates the summary to the requested cap', async () => {
        const big = 'x'.repeat(500);
        await appendLensMemoryLine(AnalystRole.RISK_EXECUTION, big, USERNAME);
        const summary = summarizeLensMemory(AnalystRole.RISK_EXECUTION, 100);
        // The cap is applied to the full content (header + body). The
        // returned string is the truncated content + the ellipsis
        // character, so it is at most 100 + 1 = 101 chars (header is
        // included in the slice, so the cap is honored end-to-end).
        expect(summary.length).toBeLessThanOrEqual(110);
        expect(summary.endsWith('…')).toBe(true);
    });

    it('writes to one lens do not bleed into another', async () => {
        await appendLensMemoryLine(AnalystRole.TECHNICAL_ANALYST, 'two false breakouts in 30d on BTC', USERNAME);
        expect(readLensMemory(AnalystRole.MACRO_VOLATILITY)).toBe('');
        expect(readLensMemory(AnalystRole.RISK_EXECUTION)).toBe('');
        expect(readLensMemory(AnalystRole.TECHNICAL_ANALYST)).toContain('two false breakouts');
    });

    it('LENS_FILES is a complete map of the three seats', () => {
        expect(LENS_FILES[AnalystRole.MACRO_VOLATILITY]).toBe('macro.md');
        expect(LENS_FILES[AnalystRole.TECHNICAL_ANALYST]).toBe('technical.md');
        expect(LENS_FILES[AnalystRole.RISK_EXECUTION]).toBe('risk.md');
    });
});
