import { useEffect, useState } from 'react';
import { loadSessionUsage, PeriodUsageSummary, summarizeUsagePeriod } from '../utils/sessionUsage';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Rolling 7-day usage total from the session-usage ledger. Used by the
 * signal card's cost badge so each verdict shows its share of the week.
 * Pass enabled=false to skip the storage read entirely.
 */
export const useWeeklyUsage = (enabled: boolean = true): PeriodUsageSummary | null => {
    const [summary, setSummary] = useState<PeriodUsageSummary | null>(null);
    useEffect(() => {
        if (!enabled) return undefined;
        let cancelled = false;
        void loadSessionUsage().then(entries => {
            if (cancelled) return;
            setSummary(summarizeUsagePeriod(entries, Date.now() - WEEK_MS));
        });
        return () => { cancelled = true; };
    }, [enabled]);
    return summary;
};
