// TAB: Memory — the switches Settings still owns (the notebook itself, the
// amendment inbox and the supervisor stream moved to the Learn surface).
//
// Moved verbatim from the inline body in SettingsMenu.tsx. `openLearnQueue` is
// the parent's pre-bound Learn queue opener.
import React from 'react';
import SupervisorCard from '../SupervisorCard';
import ProfileMemoryCard from '../ProfileMemoryCard';
import type { SettingsTabProps } from './types';

export interface MemoryTabProps extends SettingsTabProps {
    isGlobalMemoryEnabled?: boolean;
    setIsGlobalMemoryEnabled?: (enabled: boolean) => void;
    /** Pre-bound `onOpenLearn('queue')` — bound once in SettingsMenu so the
     *  narrowing survives into the callback the child gets. */
    openLearnQueue?: () => void;
}

const MemoryTab: React.FC<{ tab: MemoryTabProps }> = ({ tab: props }) => {
    const {
        memoryConfig,
        isGlobalMemoryEnabled,
        setIsGlobalMemoryEnabled,
        onOpenLearn,
        openLearnQueue,
    } = props;

    return (
        <div className="h-full min-h-0 animate-fade-in flex flex-col gap-4">
            {/* Settings owns the SWITCHES; the notebook
                itself, the amendment inbox and the
                supervisor's decision stream all live on
                the Learn surface now. Mounting them in
                both places meant two ways to reach the
                same file and neither was obviously
                canonical. */}
            <div className="px-4 pt-4">
                <h3 className="text-ui-caption font-bold text-zinc-100">Memory</h3>
                <p className="mt-0.5 mb-3 text-ui-dense text-zinc-500">
                    The notebook, the skill library, the approval queues and memory
                    health all live on the Learn surface. Settings keeps the switches.
                </p>
                <div className="flex flex-wrap items-center gap-3 rounded-control border border-zinc-800 bg-zinc-950/40 p-2.5">
                    {memoryConfig && (
                        <span className="text-ui-dense text-zinc-400">
                            <span className="text-ui-xs uppercase tracking-widest text-zinc-600">Managed by </span>
                            {memoryConfig.selectedModel || memoryConfig.name || 'memory model'}
                        </span>
                    )}
                    {setIsGlobalMemoryEnabled && (
                        <label className="flex cursor-pointer items-center gap-2" data-testid="global-memory-setting">
                            <input
                                type="checkbox"
                                checked={!!isGlobalMemoryEnabled}
                                onChange={() => setIsGlobalMemoryEnabled(!isGlobalMemoryEnabled)}
                                className="h-3.5 w-3.5 accent-cyan-400"
                            />
                            <span className="text-ui-dense text-zinc-300">Global memory</span>
                        </label>
                    )}
                    {onOpenLearn && (
                        <button type="button" onClick={() => onOpenLearn('memory')}
                            data-testid="open-learn-memory"
                            className="ml-auto rounded-control border border-zinc-700 px-2 py-1 text-ui-dense font-semibold text-zinc-300 transition-colors hover:bg-zinc-800">
                            Open the notebook
                            <span className="ml-1 font-mono text-ui-xs text-zinc-600">Alt+5</span>
                        </button>
                    )}
                </div>
            </div>
            <SupervisorCard onOpenLearn={openLearnQueue} />
            <ProfileMemoryCard />
        </div>
    );
};

export default MemoryTab;
