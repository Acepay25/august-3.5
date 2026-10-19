// The skill library: the Studio, the trade plans it writes, and the forged-tool
// queue.
//
// It has had three homes. A full-screen surface in the rail (two ways to reach
// one library with two chrome treatments), then Settings → Skills under a
// "Customize" shortcut, and now the Skills tab of the Knowledge surface — which
// is where the target plan recorded it (`docs/plan/open-items.md` §5 Q2:
// one view, Skills and Learn as tabs, not two rail rows). The file moved out of
// `settings/tabs/` with it, because a component that belongs to no dialog
// should not live in one.
//
// The Studio is `flex h-full` with its own scroll, so it gets a measured box
// rather than the surrounding column's auto height — otherwise it collapses to
// its own header.
import React from 'react';
import ToolForgeManager from '../settings/ToolForgeManager';
import StrategyPlans from '../settings/StrategyPlans';

const SkillsLibrary: React.FC<{ studio?: React.ReactNode }> = ({ studio }) => {
    return (
        <div className="h-full min-h-0 animate-fade-in flex flex-col px-4 pb-4 gap-6">
            <div className="flex min-h-[60vh] flex-1 flex-col overflow-hidden rounded-bubble border border-zinc-800 bg-zinc-900">
                {studio}
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

export default SkillsLibrary;
