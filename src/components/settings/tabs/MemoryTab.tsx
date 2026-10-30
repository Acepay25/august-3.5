// TAB: Memory — the switches Settings still owns (the notebook itself, the
// amendment inbox and the supervisor stream moved to the Learning surface).
//
// The page is the reference Settings → Memory shape: a short stack of switches,
// then the assistant's memories as named topics grouped under You / Topics /
// Areas, each opening its own page. The notebook stays one row away.
import React, { useState } from 'react';
import ProfileMemoryCard from '../ProfileMemoryCard';
import { SettingsPageHeader } from './shared';
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

    const model = memoryConfig?.selectedModel || memoryConfig?.name || undefined;
    // An entry's page IS the page — the reference drops the page title there and
    // leads with the back link, so the Memory heading belongs to the list only.
    const [detailOpen, setDetailOpen] = useState(false);

    return (
        <div className="pt-7 animate-fade-in" data-testid="memory-tab">
            {!detailOpen && <SettingsPageHeader title="Memory" bare />}

            <div className={detailOpen ? '' : 'mt-7'}>
                <ProfileMemoryCard
                    memoryModel={model}
                    onOpenNotebook={onOpenLearn ? () => onOpenLearn('memory') : undefined}
                    onDetailOpenChange={setDetailOpen}
                />
            </div>
        </div>
    );
};

export default MemoryTab;
