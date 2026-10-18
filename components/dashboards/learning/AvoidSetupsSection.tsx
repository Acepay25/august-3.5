
import React from 'react';
import type { PersonalizedLearningProfile } from '../../../services/learning/SelfLearningService';
import { phtStamp } from '../../../utils/timezone';

/** Where the profile says not to trade. */
export const AvoidSetupsSection: React.FC<{ profile: PersonalizedLearningProfile }> = ({ profile }) => (
    <>
        {/* Setups to Avoid */}
        {profile.worstSetups.length > 0 && (
            <div className="bg-rose-950/20 rounded-bubble border border-rose-500/20 p-3 sm:p-4">
                <h4 className="text-ui-xs sm:text-ui-sm font-bold text-rose-400 uppercase tracking-wider mb-2 sm:mb-3 flex items-center gap-2">
                    Setups to Avoid
                </h4>
                <div className="space-y-2">
                    {profile.worstSetups.slice(0, 4).map((s, i) => (
                        <div key={i} className="flex items-center justify-between text-ui-base">
                            <span className="text-zinc-400 truncate pr-2" title={s.description}>{s.description}</span>
                            <span className="text-rose-400 font-bold whitespace-nowrap">{s.winRate}% WR</span>
                        </div>
                    ))}
                </div>
            </div>
        )}

        {/* Last Updated */}
        <p className="text-ui-xs text-zinc-600 text-center">
            Last updated: {phtStamp(profile.lastUpdated)}
        </p>
    </>
);

export default AvoidSetupsSection;
