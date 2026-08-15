import React, { useEffect, useMemo, useState } from 'react';
import { clearSessionUsage, loadSessionUsage, SessionUsageEntry, summarizeUsagePeriod } from '../../utils/sessionUsage';
import { formatChars } from '../../utils/runUsage';

const startOfToday = (): number => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
};

const SessionUsagePanel: React.FC = () => {
    const [entries, setEntries] = useState<SessionUsageEntry[]>([]);

    useEffect(() => {
        void loadSessionUsage().then(setEntries);
    }, []);

    const today = useMemo(() => summarizeUsagePeriod(entries, startOfToday()), [entries]);
    const week = useMemo(() => summarizeUsagePeriod(entries, Date.now() - 7 * 24 * 60 * 60 * 1000), [entries]);

    const renderSummary = (label: string, s: ReturnType<typeof summarizeUsagePeriod>): React.ReactNode => {
        const tokens = s.promptTokens + s.completionTokens || s.tokensEst;
        return (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
                <p className="text-[11px] text-zinc-500">{label}</p>
                <p className="mt-1 text-sm text-zinc-100">{s.runs} runs · {Math.round(s.durationMs / 1000)}s</p>
                <p className="mt-1 text-[11px] text-zinc-500">
                    {formatChars(tokens)} tok
                    {s.costUsd > 0 ? ` · $${s.costUsd.toFixed(3)}` : ''}
                </p>
            </div>
        );
    };

    return (
        <div className="space-y-3">
            <div>
                <h4 className="text-sm font-bold text-white">Usage</h4>
                <p className="text-xs text-zinc-500 mt-0.5">Tokens from provider responses when available; otherwise estimated from output size.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
                {renderSummary('Today', today)}
                {renderSummary('Last 7 days', week)}
            </div>
            {entries.length > 0 && (
                <button
                    type="button"
                    className="text-[11px] text-zinc-500 hover:text-zinc-300"
                    onClick={() => { void clearSessionUsage().then(() => setEntries([])); }}
                >
                    Clear usage history
                </button>
            )}
        </div>
    );
};

export default React.memo(SessionUsagePanel);
