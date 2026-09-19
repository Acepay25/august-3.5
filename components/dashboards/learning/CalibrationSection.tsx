
import React from 'react';
import type { PersonalizedLearningProfile } from '../../../services/learning/SelfLearningService';
import { CalibrationBar } from './CalibrationBar';

/** Where the profile says not to trade, and whether confidence means anything. */
export const CalibrationSection: React.FC<{ profile: PersonalizedLearningProfile }> = ({ profile }) => (
    <>
        {/* Setups to Avoid */}
        {profile.worstSetups.length > 0 && (
            <div className="bg-red-950/20 rounded-xl border border-red-500/20 p-3 sm:p-4">
                <h4 className="text-[10px] sm:text-xs font-bold text-red-400 uppercase tracking-wider mb-2 sm:mb-3 flex items-center gap-2">
                    Setups to Avoid
                </h4>
                <div className="space-y-2">
                    {profile.worstSetups.slice(0, 4).map((s, i) => (
                        <div key={i} className="flex items-center justify-between text-sm">
                            <span className="text-zinc-400 truncate pr-2">{s.description}</span>
                            <span className="text-red-400 font-bold whitespace-nowrap">{s.winRate}% WR</span>
                        </div>
                    ))}
                </div>
            </div>
        )}

        {/*Confidence Calibration */}
        {profile.confidenceAccuracy.length > 0 && (
            <div className="bg-zinc-800 rounded-xl border border-white/5 p-3 sm:p-4">
                <h4 className="text-[10px] sm:text-xs font-bold text-zinc-500 uppercase tracking-wider mb-3 sm:mb-4">
                    Confidence Calibration
                </h4>
                <div className="space-y-4">
                    {profile.confidenceAccuracy
                        .filter(c => c.count >= 3)
                        .map((c, i) => {
                            const expected = c.level === 'High' ? 70 : c.level === 'Medium' ? 55 : 40;
                            return (
                                <CalibrationBar
                                    key={i}
                                    label={`${c.level} Confidence`}
                                    actual={c.winRate}
                                    expected={expected}
                                    count={c.count}
                                />
                            );
                        })}
                </div>
                <p className="text-[10px] text-zinc-600 mt-4">
                    * White line = expected win rate for that confidence level
                </p>
            </div>
        )}

        {/* Last Updated */}
        <p className="text-[10px] text-zinc-600 text-center">
            Last updated: {new Date(profile.lastUpdated).toLocaleString()}
        </p>
    </>
);

export default CalibrationSection;
