/**
 * SupervisorIndicator — the Chart AI header's live view of the skill
 * supervisor.
 *
 * It used to carry six different glyphs, one per phase: Eye, Search,
 * ShieldCheck, Zap, Gavel, Brain. Nothing on screen said which was which, so a
 * trader had to memorise a shape vocabulary for one fact — and the shape that
 * changed while the model worked was the least reliable signal in the header.
 * The reference clients put a WORD where a state matters and reserve the icon
 * for identity. So: one glyph that means "the supervisor is watching", colour
 * and pulse for whether it is busy, and the phase written out in the one place
 * there is room to read it (the expanded header). The title attribute still
 * carries the model and the activity line for a hover.
 */

import React, { useSyncExternalStore } from 'react';
import { Eye } from '../../shared/Icons';
import * as supervisorStore from '../../../services/learning/supervisorStore';
import type { SupervisorPhase } from '../../../services/learning/supervisorStore';

/** What the supervising model is doing, in the words the stream already uses. */
const PHASE_WORD: Record<SupervisorPhase, string> = {
    idle: 'watching',
    reviewing: 'reviewing',
    verifying: 'verifying',
    enhancing: 'enhancing',
    deciding: 'deciding',
    learning: 'learning',
};

const SupervisorIndicator: React.FC<{ onOpen: () => void; compact?: boolean }> = ({ onOpen, compact = false }) => {
    const snap = useSyncExternalStore(supervisorStore.subscribe, supervisorStore.getSnapshot, supervisorStore.getSnapshot);
    const active = snap.running;
    const word = PHASE_WORD[snap.phase] ?? PHASE_WORD.idle;
    return (
        <button
            type="button"
            onClick={onOpen}
            data-testid="supervisor-indicator"
            aria-label={`Skill supervisor — ${word}`}
            title={active ? `${snap.modelName ? `${snap.modelName} — ` : ''}${snap.activity || 'supervising…'}` : 'Skill supervisor — watching the queues (click to open)'}
            className={`inline-flex min-h-6 shrink-0 items-center gap-1.5 rounded-control px-1 transition-colors ${
                active ? 'animate-pulse text-cyan-300' : 'text-zinc-600 hover:text-zinc-300'
            } ${compact ? 'py-1' : 'py-1.5 text-ui-sm font-semibold'}`}
        >
            <Eye className="h-4 w-4" aria-hidden="true" />
            {!compact ? <span data-testid="supervisor-phase-word">{word}</span> : null}
        </button>
    );
};

export default React.memo(SupervisorIndicator);
