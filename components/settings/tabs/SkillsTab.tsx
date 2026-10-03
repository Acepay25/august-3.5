// TAB: Skills — the pointer into the Strategy Studio plus forged-tool
// approvals (the skill library itself lives in the Studio).
//
// Moved verbatim from the inline body in SettingsMenu.tsx.
import React from 'react';
import ToolForgeManager from '../ToolForgeManager';
import StrategyPlans from '../StrategyPlans';
import type { SettingsTabProps } from './types';

/** Skills consumes only the shared props (the Studio pointer). */
export type SkillsTabProps = SettingsTabProps;

const SkillsTab: React.FC<{ tab: SkillsTabProps }> = ({ tab: props }) => {
    const { onOpenStrategyStudio } = props;

    return (
        <div className="h-full min-h-0 animate-fade-in flex flex-col px-4 pb-4 gap-6">
            {/* The skill library now lives in the
                full-screen Strategy Studio; Settings
                keeps only the pointer + forged-tool
                approvals (which have no Studio home). */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <h3 className="text-ui-caption font-bold text-zinc-100">Skills</h3>
                        <p className="mt-0.5 text-ui-dense text-zinc-500">
                            Browse, prove, retire and import your skill library in the Strategy Studio.
                        </p>
                    </div>
                    {onOpenStrategyStudio && (
                        <button
                            type="button"
                            onClick={onOpenStrategyStudio}
                            className="shrink-0 rounded-lg border border-white/10 bg-zinc-800 px-3 py-1.5 text-ui-dense font-bold uppercase tracking-wider text-zinc-200 hover:border-white/20 hover:bg-zinc-700"
                        >
                            Open Strategy Studio
                        </button>
                    )}
                </div>
            </div>
            <div className="border-t border-zinc-800 pt-4">
                <h3 className="text-ui-caption font-bold text-zinc-100">Trade plans</h3>
                <p className="mt-0.5 text-ui-dense text-zinc-500 mb-3">
                    Named strategies the model proposed. Only an ACTIVE plan is shown to the desk —
                    a draft is an unapproved proposal and no seat follows it.
                </p>
                <StrategyPlans />
            </div>
            <div className="border-t border-zinc-800 pt-4">
                <h3 className="text-ui-caption font-bold text-zinc-100">Forged tools</h3>
                <p className="mt-0.5 text-ui-dense text-zinc-500 mb-3">
                    Model-authored desk tools awaiting your approval.
                </p>
                <ToolForgeManager />
            </div>
        </div>
    );
};

export default SkillsTab;
