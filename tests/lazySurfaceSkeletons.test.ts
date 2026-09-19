/**
 * UI-wave regressions (audit 2026-09-15):
 *  • Surface-level lazy screens (TradeView / StrategyStudio) used
 *    fallback={null} → the whole surface went blank while the chunk loaded.
 *    They now render the App-local SurfaceSkeleton. (AgentRosterRail was the
 *    third one; it is deleted — see the 'AgentRosterRail' case below.)
 *  • The full-analysis progress card + Stop is `hidden … md:block` now —
 *    the Electron window floor is 800px, and at lg (1024px) the card was
 *    invisible for the entire 800-1023px desktop band.
 *  • ProbabilityEngineService.calculateAlgoProbabilities gained a 5th
 *    slDistancePct input (barrier-race stop probability); the App Algo-mode
 *    call now computes the entry→SL distance exactly like the TP distances.
 *
 * Skeleton/breakpoint plumbing lives inside the 3k-line App component (which
 * no jsdom suite mounts in this repo), so those are source-contract scans
 * (same pattern as tests/journalSurfaceNavigation.test.tsx); the probability
 * engine half is a real unit test.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { ProbabilityEngineService } from '../services/analysis/ProbabilityEngineService';

const appSrc = readFileSync('App.tsx', 'utf8');

describe('lazy surface skeletons (fix 3)', () => {
    it('the surface-level Suspense boundaries render SurfaceSkeleton, not null', () => {
        expect(appSrc).toMatch(/fallback=\{<SurfaceSkeleton \/>\}>\s*<TradeView/);
        expect(appSrc).toMatch(/fallback=\{<SurfaceSkeleton \/>\}>\s*<StrategyStudio/);
        // The Agents surface is AgentsView and learning has its own LearnView.
        // Both lazy, both with the visible skeleton.
        expect(appSrc).toMatch(/fallback=\{<SurfaceSkeleton \/>\}>\s*<AgentsView/);
        expect(appSrc).toMatch(/fallback=\{<SurfaceSkeleton \/>\}>\s*<LearnView/);
    });

    it('AgentRosterRail is gone — deleted, not left backing no surface', () => {
        // AgentsView replaced its row model and the sidebar stopped embedding
        // it, so the file was deleted outright (no re-export, no shim). This
        // asserts the deletion rather than the old "unreferenced" state.
        expect(existsSync('components/chat/AgentRosterRail.tsx')).toBe(false);
        expect(appSrc).not.toMatch(/AgentRosterRail/);
    });

    it('SurfaceSkeleton is a pulsing zinc panel (no new deps, dark chrome)', () => {
        const decl = appSrc.match(/const SurfaceSkeleton: React\.FC = \(\) => \(\n[\s\S]*?\n\);/);
        expect(decl).not.toBeNull();
        expect(decl?.[0]).toMatch(/animate-pulse/);
        expect(decl?.[0]).toMatch(/bg-zinc-900/);
        expect(decl?.[0]).toMatch(/bg-zinc-950/);
    });
});

describe('progress card breakpoint (fix 4)', () => {
    it('the fixed overlay shows from md up (Electron floor is 800px < lg)', () => {
        expect(appSrc).toMatch(/className="pointer-events-none fixed right-4 top-24 z-40 hidden w-\[min\(20rem,calc\(100vw-2rem\)\)\] max-h-\[calc\(100vh-7rem\)\] md:block"/);
        expect(appSrc).not.toMatch(/top-24 z-40 hidden[\s\S]{0,120}lg:block/);
    });
});

describe('slDistancePct plumbed into the Algo probability engine (fix 6a)', () => {
    it('App computes the entry→SL distance and passes it as the 5th arg', () => {
        expect(appSrc).toMatch(/const slPrice = parsePrice\(msg\.analysis\.stopLoss\);/);
        expect(appSrc).toMatch(/tpPct\.length >= 2 \? tpPct : undefined,\s*slDistancePct\s*\n\s*\);/);
    });

    const engine = ProbabilityEngineService;

    it('with slDistancePct: a barrier-race stop estimate replaces the upper bound', () => {
        // TP1 5% away, SL 2.5% away → P(SL) ≈ P(TP1)·(5/2.5), capped at 99.
        const probs = engine.calculateAlgoProbabilities(null, [], 'Long', [5, 10], 2.5);
        expect(probs.slReasoning.indicatorBasis).toMatch(/Barrier race: TP1 5% away vs SL 2\.5% away/);
        expect(probs.slProbability).toBeGreaterThan(50);
        expect(probs.slProbability).toBeLessThanOrEqual(99);
        expect(probs.slProbability).toBeGreaterThanOrEqual(1);
    });

    it('without slDistancePct: the number stays labeled an UPPER BOUND', () => {
        const probs = engine.calculateAlgoProbabilities(null, [], 'Long', [5, 10]);
        expect(probs.slReasoning.indicatorBasis).toMatch(/UPPER BOUND/);
        // The old complementary-events math: 100 − P(TP1).
        expect(probs.tp1Probability).toBeDefined();
        expect(Math.abs(probs.slProbability + (probs.tp1Probability ?? 0) - 100)).toBeLessThanOrEqual(0.2);
    });

    it('a stop further from entry than TP1 yields a lower stop probability than a tight one', () => {
        const tight = engine.calculateAlgoProbabilities(null, [], 'Long', [5, 10], 1);
        const wide = engine.calculateAlgoProbabilities(null, [], 'Long', [5, 10], 15);
        expect(tight.slProbability).toBeGreaterThan(wide.slProbability);
    });
});
