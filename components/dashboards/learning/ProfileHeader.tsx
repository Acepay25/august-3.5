
import React, { useEffect, useState } from 'react';
import type { PersonalizedLearningProfile } from '../../../services/learning/SelfLearningService';
import type { MetaCalibrationRatios } from '../../../services/learning/metaCalibration';
import { getActiveUsername } from '../../../utils/activeUser';
import { getWinRateColor } from './shared';

/**
 * Header + meta-calibration (the loop on the loop) + the two headline
 * numbers. The ratios are a deterministic read of a sidecar store, so they
 * arrive async and simply don't render until they do.
 */
export const ProfileHeader: React.FC<{
    profile: PersonalizedLearningProfile;
    username?: string;
}> = ({ profile, username }) => {
    const [metaCalibration, setMetaCalibration] = useState<MetaCalibrationRatios | null>(null);
    useEffect(() => {
        let cancelled = false;
        const user = username || getActiveUsername();
        void (async () => {
            try {
                const { loadMetaCalibration, computeMetaCalibrationRatios } = await import('../../../services/learning/metaCalibration');
                const d = await loadMetaCalibration(user);
                if (!cancelled) setMetaCalibration(d.ratios ?? computeMetaCalibrationRatios(d));
            } catch { /* surface only — never crash the dashboard */ }
        })();
        return () => { cancelled = true; };
    }, [username]);

    return (
        <>
            {/* Header */}
            <div className="text-center pb-3 sm:pb-4 border-b border-white/5">
                <h2 className="text-base sm:text-lg font-bold text-cyan-400 mb-1">AI Learning Profile</h2>
                <p className="text-[10px] sm:text-xs text-zinc-500">
                    Based on {profile.totalAnalyzedTrades} analyzed trades
                </p>
            </div>

            {/* meta-calibration: the loop on the loop (deterministic ratios) */}
            {metaCalibration && (
                <div className="grid grid-cols-3 gap-2 sm:gap-4">
                    <div className="bg-zinc-900 rounded-xl p-2 sm:p-3 border border-white/5">
                        <p className="text-[9px] sm:text-[10px] text-zinc-500 uppercase tracking-wider mb-0.5">Worth-gate precision</p>
                        <p className="text-sm sm:text-base font-bold text-white">
                            {metaCalibration.worthGatePrecision !== null ? `${Math.round(metaCalibration.worthGatePrecision * 100)}%` : '—'}
                        </p>
                    </div>
                    <div className="bg-zinc-900 rounded-xl p-2 sm:p-3 border border-white/5">
                        <p className="text-[9px] sm:text-[10px] text-zinc-500 uppercase tracking-wider mb-0.5">Refinement recovery</p>
                        <p className="text-sm sm:text-base font-bold text-white">
                            {metaCalibration.refinementRecovery !== null ? `${Math.round(metaCalibration.refinementRecovery * 100)}%` : '—'}
                        </p>
                    </div>
                    <div className="bg-zinc-900 rounded-xl p-2 sm:p-3 border border-white/5">
                        <p className="text-[9px] sm:text-[10px] text-zinc-500 uppercase tracking-wider mb-0.5">Eval agreement</p>
                        <p className="text-sm sm:text-base font-bold text-white">
                            {metaCalibration.evalAgreement !== null ? `${Math.round(metaCalibration.evalAgreement * 100)}%` : '—'}
                        </p>
                    </div>
                </div>
            )}

            {/* Overall Performance */}
            <div className="grid grid-cols-2 gap-2 sm:gap-4">
                <div className="bg-gradient-to-br from-cyan-950/50 to-zinc-900 rounded-xl p-3 sm:p-4 border border-cyan-500/20">
                    <p className="text-[9px] sm:text-xs text-cyan-400/70 uppercase tracking-wider mb-1">Win Rate</p>
                    <p className={`text-2xl sm:text-3xl font-black ${getWinRateColor(profile.overallWinRate)}`}>
                        {profile.overallWinRate}%
                    </p>
                </div>
                <div className="bg-zinc-900 rounded-xl p-3 sm:p-4 border border-zinc-800/80">
                    <p className="text-[9px] sm:text-xs text-zinc-500 uppercase tracking-wider mb-1">Trades</p>
                    <p className="text-2xl sm:text-3xl font-black text-white">
                        {profile.totalAnalyzedTrades}
                    </p>
                </div>
            </div>
        </>
    );
};

export default ProfileHeader;
