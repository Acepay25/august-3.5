import type { DebateRunEvent } from '../types/message';

/**
 * Run-contract derivation.
 *
 * The run's stage ladder as a live todo, derived from the append-only debate
 * run log — no new plumbing. Skips are honest: budget caps, floor alignment,
 * clarification shortcuts and resumes all emit run-log events, so the panel
 * can show WHY a stage did not run (fixes W8's silent lopsided-floor verdicts
 * at the UI layer).
 */

export type RunContractStageState = 'pending' | 'running' | 'done' | 'skipped' | 'failed';

export interface RunContractStage {
    id: string;
    label: string;
    state: RunContractStageState;
    note?: string;
}

interface ContractStageSpec {
    id: string;
    label: string;
}

const STAGE_SPECS: ContractStageSpec[] = [
    { id: 'gate', label: 'Gate scan' },
    { id: 'openings', label: 'Analyst openings' },
    { id: 'rebuttals', label: 'Rebuttal rounds' },
    { id: 'clarification', label: 'Clarification' },
    { id: 'verdict', label: 'Moderator verdict' },
];

/**
 * Derive stage states from the current run log.
 *
 *  gate          — done when a pre_step/gate event exists (the pipeline runs it
 *                  before the debate; its absence keeps the row pending).
 *  openings      — done once any round-1 episode/round event exists.
 *  rebuttals     — running/done by highest round seen; skipped with the
 *                  budget-cap or force-skip note when logged.
 *  clarification — skipped when an alignment/convergence shortcut fired;
 *                  otherwise follows round progression past the rebuttals.
 *  verdict       — running while the debate is live without a verdict event;
 *                  done on the verdict event.
 */
export const buildRunContractStages = (
    events: DebateRunEvent[],
    isLive: boolean,
): RunContractStage[] => {
    const has = (kind: DebateRunEvent['kind']): boolean => events.some(e => e.kind === kind);
    const lastRound = events.reduce((max, e) => (typeof e.round === 'number' && e.round > max ? e.round : max), 0);
    const skipNote = (() => {
        for (const e of events) {
            if (e.kind !== 'episode' && e.kind !== 'budget') continue;
            if (/skip/i.test(e.detail)) return e.detail;
        }
        return undefined;
    })();
    const budgetSkipped = events.some(e => e.kind === 'budget');
    const resumed = has('resume');
    const verdictDone = has('verdict');

    return STAGE_SPECS.map(spec => {
        switch (spec.id) {
            case 'gate':
                return { ...spec, state: has('pre_step') || has('gate') ? 'done' : (isLive ? 'running' : 'pending') };
            case 'openings':
                return { ...spec, state: lastRound >= 1 ? 'done' : 'pending', ...(resumed ? { note: 'resumed' } : {}) };
            case 'rebuttals':
                if (lastRound <= 1 && !verdictDone) return { ...spec, state: isLive ? 'running' : 'pending' };
                if (budgetSkipped) return { ...spec, state: 'skipped', note: 'USD budget cap reached' };
                return { ...spec, state: lastRound >= 2 || verdictDone ? 'done' : 'pending' };
            case 'clarification': {
                if (!isLive && !verdictDone) return { ...spec, state: 'pending' };
                if (skipNote) return { ...spec, state: 'skipped', note: shorten(skipNote) };
                // No explicit skip: treat as folded into the final rounds.
                return { ...spec, state: verdictDone ? 'done' : 'pending' };
            }
            case 'verdict':
                return { ...spec, state: verdictDone ? 'done' : isLive ? 'running' : 'pending' };
            default:
                return { ...spec, state: 'pending' };
        }
    });
};

const shorten = (note: string, max = 90): string =>
    note.length <= max ? note : `${note.slice(0, max - 1)}…`;
