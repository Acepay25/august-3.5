/**
 * UI-wave regressions (audit 2026-09-15):
 *  • Surface-level lazy screens (TradeView / StrategyStudio) used
 *    fallback={null} → the whole surface went blank while the chunk loaded.
 *    They now render the App-local SurfaceSkeleton. (AgentRosterRail was the
 *    third one; it is deleted — see the 'AgentRosterRail' case below.)
 *  • The full-analysis progress card + Stop is `hidden … md:block` now —
 *    the Electron window floor is 800px, and at lg (1024px) the card was
 *    invisible for the entire 800-1023px desktop band.
 *
 * Skeleton/breakpoint plumbing lives inside the 3k-line App component (which
 * no jsdom suite mounts in this repo), so those are source-contract scans
 * (same pattern as tests/journalSurfaceNavigation.test.tsx).
 *
 * The probability-engine half of this file was removed with
 * `services/analysis/ProbabilityEngineService.ts` (2026-10-20): that module
 * had ZERO production importers, so the engine it pinned was never loaded by
 * the app. The App-source contract guards above stay — they read the LIVE
 * App.tsx as text, so they are the repo's own lint, in test form, and must
 * not be deleted with a dead sibling.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';

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
