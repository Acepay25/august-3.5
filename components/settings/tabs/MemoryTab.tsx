// TAB: Memory — the switches Settings still owns (the notebook itself, the
// amendment inbox and the supervisor stream moved to the Learn surface).
//
// Moved verbatim from the inline body in SettingsMenu.tsx. The supervisor's
// own card used to sit here; it duplicated the auto-toggle and the pending count
// that Learn -> Health already shows, so the Settings copy is gone.
// the parent's pre-bound Learn queue opener.
import React from 'react';
import { BookOpen, Brain } from '../../shared/Icons';
import ProfileMemoryCard from '../ProfileMemoryCard';
import { SettingsGroup, SettingsPageHeader, SettingsRow } from './shared';
import type { SettingsTabProps } from './types';

/** `SettingsTabProps`, narrowed to what this tab reads. An alias rather than an
 *  empty `interface extends` — that form is equivalent to its supertype and the
 *  lint rule flags it, and there is nothing to add here. The `onOpenLearn`
 *  binding is pre-narrowed in `SettingsMenu` so the child's callback stays
 *  typed. */
export type MemoryTabProps = SettingsTabProps;

const MemoryTab: React.FC<{ tab: MemoryTabProps }> = ({ tab: props }) => {
    const {
        memoryConfig,
        onOpenLearn,
    } = props;

    const model = memoryConfig?.selectedModel || memoryConfig?.name || 'memory model';

    return (
        <div className="space-y-5 animate-fade-in" data-testid="memory-tab">
            {/* Settings owns the SWITCHES; the notebook
                itself, the amendment inbox and the
                supervisor's decision stream all live on
                the Learn surface now. Mounting them in
                both places meant two ways to reach the
                same file and neither was obviously
                canonical. */}
            <SettingsPageHeader
                title="Memory"
                description="The notebook, the skill library, the approval queues and memory health all live on the Learn surface. Settings keeps the switches."
            />

            {/* The notebook, as the reference's settings list: a group of
                hairline rows, each a label, a description and the control on
                the right edge. */}
            <SettingsGroup
                title="Notebook"
                description="What the model knows, and the place to change it."
            >
                <SettingsRow
                    icon={<BookOpen className="h-4 w-4" aria-hidden="true" />}
                    title="Notebook files"
                    description="The markdown the model reads on every analysis — the raw file browser."
                    control={onOpenLearn ? (
                        <button
                            type="button"
                            onClick={() => onOpenLearn('memory')}
                            data-testid="open-learn-memory"
                            className="rounded-control bg-zinc-800 px-3 py-1.5 text-ui-dense font-semibold text-zinc-100 transition-colors hover:bg-zinc-700"
                        >
                            Open the notebook
                            <span className="ml-1 font-mono text-ui-xs text-zinc-500">Alt+5</span>
                        </button>
                    ) : undefined}
                />
                {memoryConfig && (
                    <SettingsRow
                        icon={<Brain className="h-4 w-4" aria-hidden="true" />}
                        title="Memory model"
                        description="The model that reviews the notebook and drafts the amendments you approve."
                        control={<span className="text-ui-dense text-zinc-300">{model}</span>}
                    />
                )}
            </SettingsGroup>

            <ProfileMemoryCard />
        </div>
    );
};

export default MemoryTab;
