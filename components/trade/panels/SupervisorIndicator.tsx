/**
 * SupervisorIndicator — the Chart AI header's live view of the skill
 * supervisor.
 *
 * The icon always tells the truth about which phase the supervising model is
 * in, and it pulses only while a call is actually in flight. Extracted from
 * TradeChatPanel unchanged; the detail panel it opens is
 * `components/trade/SupervisorPanel`.
 */

import React, { useSyncExternalStore } from 'react';
import { Brain, Gavel, Search, ShieldCheck, Sparkles } from 'lucide-react';
import * as supervisorStore from '../../../services/learning/supervisorStore';
import type { SupervisorPhase } from '../../../services/learning/supervisorStore';

const PHASE_ICON: Record<SupervisorPhase, React.ReactNode> = {
    idle: <Sparkles className="h-4 w-4" />,
    reviewing: <Search className="h-4 w-4" />,
    verifying: <ShieldCheck className="h-4 w-4" />,
    enhancing: <Sparkles className="h-4 w-4" />,
    deciding: <Gavel className="h-4 w-4" />,
    learning: <Brain className="h-4 w-4" />,
};

const SupervisorIndicator: React.FC<{ onOpen: () => void; compact?: boolean }> = ({ onOpen, compact = false }) => {
    const snap = useSyncExternalStore(supervisorStore.subscribe, supervisorStore.getSnapshot, supervisorStore.getSnapshot);
    const active = snap.running;
    const Icon = PHASE_ICON[snap.phase] ?? PHASE_ICON.idle;
    return (
        <button
            type="button"
            onClick={onOpen}
            data-testid="supervisor-indicator"
            aria-label="Skill supervisor"
            title={active ? `${snap.modelName ? `${snap.modelName} — ` : ''}${snap.activity || 'supervising…'}` : 'Skill supervisor — watching the queues (click to open)'}
            className={`shrink-0 rounded-control transition-colors ${active ? 'animate-pulse text-cyan-300' : 'text-zinc-600 hover:text-zinc-300'} ${compact ? 'p-1' : 'p-1.5'}`}
        >
            {Icon}
        </button>
    );
};

export default React.memo(SupervisorIndicator);
