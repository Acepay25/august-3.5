// TABS: Prompts AND Instructions — one body with a conditional inside (the
// CustomInstructionsEditor when the Instructions nav entry is active,
// PromptManager otherwise), so it stays ONE component serving both nav entries
// rather than being split in two. `activeTab` and `activeInstructionTab` are
// the parent's state passed under their local names.
//
// Moved verbatim from the inline body in SettingsMenu.tsx.
import React from 'react';
import CustomInstructionsEditor from '../CustomInstructionsEditor';
import PromptManager from '../PromptManager';
import type { InstructionTab } from '../CustomInstructionsEditor';
import type { CustomInstructionsMap } from '../../../types/user';
import type { SettingsTab } from '../SettingsMenu';
import type { SettingsTabProps } from './types';

export interface PromptsTabProps extends SettingsTabProps {
    /** Which of the twin nav entries ('prompts' | 'instructions') is active. */
    activeTab: SettingsTab;
    customInstructions: CustomInstructionsMap;
    setCustomInstructions: (instructions: CustomInstructionsMap) => void;
    activeInstructionTab: InstructionTab;
    setActiveInstructionTab: React.Dispatch<React.SetStateAction<InstructionTab>>;
}

const PromptsTab: React.FC<{ tab: PromptsTabProps }> = ({ tab: props }) => {
    const {
        activeTab,
        customInstructions,
        setCustomInstructions,
        activeInstructionTab,
        setActiveInstructionTab,
    } = props;

    return (
        <div className="h-full min-h-0 animate-fade-in flex flex-col">
            {activeTab === 'instructions' ? (
                <div className="flex-1 min-h-[480px] px-4 pb-4">
                    <CustomInstructionsEditor
                        customInstructions={customInstructions}
                        setCustomInstructions={setCustomInstructions}
                        activeTab={activeInstructionTab}
                        onTabChange={setActiveInstructionTab}
                    />
                </div>
            ) : (
                <div className="flex-1 min-h-0">
                    <PromptManager username={props.username} />
                </div>
            )}
        </div>
    );
};

export default PromptsTab;
