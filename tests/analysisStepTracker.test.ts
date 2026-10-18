/**
 * The step tracker mints rows the run must be able to finish, and the panel
 * must not describe rows that no run produces.
 *
 * Stage 19 deleted the debate engine and with it the calls that moved three of
 * the four rows: `gate-scan` and `debate` were created and never started, and
 * `analysis` was started but never completed, so a successful Full-analysis run
 * left a spinner turning forever and the summary line kept clauses for steps
 * that could no longer exist (validation died with accuracy mode). Both halves
 * are invisible to a component test, because those fabricate their own steps.
 *
 * So this reads the two real files. Every check is paired with a control on
 * synthetic source: a scan whose regex stops matching reports "nothing wrong",
 * which is exactly what a pass looks like.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const PIPELINE = 'hooks/useAnalysisPipeline.ts';
const PANEL = 'components/analysis/AnalysisProgress.tsx';

/** Ids created as rows by the `initAnalysisSteps([…])` call site. */
const mintedIds = (src: string): string[] => {
    const call = src.match(/initAnalysisSteps\(\[([\s\S]*?)\]\)/);
    return call ? [...call[1].matchAll(/\bid:\s*'([^']+)'/g)].map(m => m[1]) : [];
};

const startedIds = (src: string): string[] =>
    [...src.matchAll(/startStep\('([^']+)'\)/g)].map(m => m[1]);

/** Ids the summary line keys on (`s.id === 'x'`). */
const summarisedIds = (src: string): string[] =>
    [...src.matchAll(/s\.id === '([^']+)'/g)].map(m => m[1]);

const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

describe('the analysis step tracker only promises work it can finish', () => {
    it('every row the run mints is actually started somewhere (census: 2 rows)', () => {
        const minted = mintedIds(read(PIPELINE));
        const started = startedIds(read(PIPELINE));
        expect(minted.length).toBeGreaterThan(0);
        expect(minted.filter(id => !started.includes(id))).toEqual([]);
    });

    it('no row is minted for the debate or the gate scan any more', () => {
        const minted = mintedIds(read(PIPELINE));
        expect(minted).not.toContain('debate');
        expect(minted).not.toContain('gate-scan');
    });

    it('the panel only summarises rows the pipeline mints', () => {
        const minted = mintedIds(read(PIPELINE));
        const summarised = summarisedIds(read(PANEL));
        expect(summarised.length).toBeGreaterThan(0);
        expect(summarised.filter(id => !minted.includes(id))).toEqual([]);
    });

    it('the run sweeps open rows only after the failure path has marked its own', () => {
        const src = read(PIPELINE);
        const failure = src.indexOf(`failStep('analysis'`);
        const stopped = src.indexOf(`stopStep('analysis'`);
        const sweep = src.indexOf('settleOpenSteps();');
        expect(failure).toBeGreaterThan(-1);
        expect(stopped).toBeGreaterThan(-1);
        expect(sweep).toBeGreaterThan(-1);
        // The sweep paints anything still open "complete". Run before the
        // catch and a failed step is reported as a success.
        expect(sweep).toBeGreaterThan(failure);
        expect(sweep).toBeGreaterThan(stopped);
    });

    it('the scans see a planted stranded row, a planted dead clause and a planted bad order', () => {
        // The planted source is written the way the real files write it — same
        // quote style — or this control proves only that the fixture matched
        // its own shape.
        const stranded = mintedIds("initAnalysisSteps([{ id: 'debate', status: 'pending' }]);");
        const noStart = startedIds("startStep('market-data');");
        expect(stranded).toEqual(['debate']);
        expect(stranded.filter(id => !noStart.includes(id))).toEqual(['debate']);

        const deadClause = summarisedIds("if (s.id === 'validation') parts.push('1 validation')");
        expect(deadClause.filter(id => !['analysis', 'market-data'].includes(id))).toEqual(['validation']);

        const ordered = "catch { failStep('analysis', e) } finally { settleOpenSteps(); }";
        expect(ordered.indexOf('settleOpenSteps();')).toBeGreaterThan(ordered.indexOf("failStep('analysis'"));
    });
});
