import React from 'react';
import AuditPanel from '../shared/AuditPanel';
import type { RunContractStage, RunContractStageState } from '../../utils/runContract';

/**
 * The stage ladder is `utils/runContract.ts`'s vocabulary, not this component's:
 * the derivation lives there, `DebateStage` already types its prop from it, and
 * a local copy of the same union is how a renamed state ends up rendering as
 * `undefined` instead of failing to compile.
 */
export type { RunContractStage, RunContractStageState };

interface RunContractPanelProps {
    stages?: RunContractStage[];
}

const STATE_MARK: Record<RunContractStageState, { glyph: string; cls: string }> = {
    pending: { glyph: '○', cls: 'text-zinc-600' },
    running: { glyph: '◐', cls: 'text-cyan-300 animate-pulse' },
    done: { glyph: '●', cls: 'text-zinc-200' },
    skipped: { glyph: '○', cls: 'text-zinc-500' },
    failed: { glyph: '×', cls: 'text-rose-300' },
};

/** What an unrecognized state looks like. `Message.runContract` is persisted,
 *  so a row written by an older build can name a state this union no longer
 *  knows; indexing straight into `STATE_MARK` would return undefined and throw
 *  on `mark.cls` — which does not drop one row, it drops every message after
 *  the one being rendered. */
const UNKNOWN_MARK = { glyph: '○', cls: 'text-zinc-500' };

/**
 * Run Contract panel: the run's stage ladder as a live todo —
 * gate → openings → rebuttals → clarification → verdict → journal. Skips are
 * honest (budget cap / aligned floor / resume), so a lopsided-floor verdict is
 * visible instead of silent (W8). Persisted into DebateReplay via the message.
 */
const RunContractPanel: React.FC<RunContractPanelProps> = ({ stages }) => {
    if (!Array.isArray(stages) || stages.length === 0) return null;
    const rows = stages.filter(s => s && typeof s.id === 'string' && typeof s.label === 'string');
    if (rows.length === 0) return null;
    const doneCount = rows.filter(s => s.state === 'done').length;
    return (
        <AuditPanel className="mb-2">
            <p className="text-ui-xs uppercase tracking-wider text-zinc-500" data-testid="run-contract">
                Run contract · {doneCount}/{rows.length}
            </p>
            <ul className="mt-1 space-y-0.5">
                {rows.map(stage => {
                    const mark = STATE_MARK[stage.state] ?? UNKNOWN_MARK;
                    return (
                        <li key={stage.id} className="flex items-baseline gap-2 text-ui-sm leading-snug">
                            <span className={`w-3 shrink-0 ${mark.cls}`}>{mark.glyph}</span>
                            <span className={stage.state === 'skipped' ? 'text-zinc-500 line-through decoration-zinc-700' : stage.state === 'pending' ? 'text-zinc-500' : 'text-zinc-300'}>
                                {stage.label}
                            </span>
                            {stage.note ? <span className="text-zinc-600">— {stage.note}</span> : null}
                        </li>
                    );
                })}
            </ul>
        </AuditPanel>
    );
};

export default RunContractPanel;
