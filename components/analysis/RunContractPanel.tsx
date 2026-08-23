import React from 'react';
import AuditPanel from '../shared/AuditPanel';

/**
 * Run-contract stage states, mirrored on Message.runContract (structural
 * shape — the component does not import pipeline code).
 */
export type RunContractStageState = 'pending' | 'running' | 'done' | 'skipped' | 'failed';

export interface RunContractStage {
    id: string;
    label: string;
    state: RunContractStageState;
    /** Why a stage was skipped (budget cap, floor alignment, resume…). */
    note?: string;
}

interface RunContractPanelProps {
    stages?: RunContractStage[];
}

const STATE_MARK: Record<RunContractStageState, { glyph: string; cls: string }> = {
    pending: { glyph: '○', cls: 'text-zinc-600' },
    running: { glyph: '◐', cls: 'text-cyan-300 animate-pulse' },
    done: { glyph: '●', cls: 'text-zinc-200' },
    skipped: { glyph: '○', cls: 'text-zinc-500' },
    failed: { glyph: '×', cls: 'text-rose-400 status-surface' },
};

/**
 * Run Contract panel (ROUND-28/U1): the run's stage ladder as a live todo —
 * gate → openings → rebuttals → clarification → verdict → journal. Skips are
 * honest (budget cap / aligned floor / resume), so a lopsided-floor verdict is
 * visible instead of silent (W8). Persisted into DebateReplay via the message.
 */
const RunContractPanel: React.FC<RunContractPanelProps> = ({ stages }) => {
    if (!stages || stages.length === 0) return null;
    const doneCount = stages.filter(s => s.state === 'done').length;
    return (
        <AuditPanel className="mb-2">
            <p className="text-[10px] uppercase tracking-wider text-zinc-500">
                Run contract · {doneCount}/{stages.length}
            </p>
            <ul className="mt-1 space-y-0.5">
                {stages.map(stage => {
                    const mark = STATE_MARK[stage.state];
                    return (
                        <li key={stage.id} className="flex items-baseline gap-2 text-[11px] leading-snug">
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
