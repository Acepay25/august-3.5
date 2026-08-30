/**
 * Pre-trade checklist (Batch 5, plan §4.3) — FTMO-derived defaults, OFF by
 * default. The checklist rides the log-trade capture path: when enabled,
 * the capture modal shows the items as checkboxes and the completion count
 * is stored on the trade (`checklistCompleted`), feeding adherence stats.
 * Pure helpers here; the UI is DataCaptureModal, the toggle is in Settings.
 */

export interface ChecklistItem {
    id: string;
    label: string;
}

/** FTMO-derived defaults from the research (plan §4.3). */
export const DEFAULT_CHECKLIST: ChecklistItem[] = [
    { id: 'mental-state', label: 'Mental state checked (calm, not chasing)' },
    { id: 'news', label: 'High-impact news checked' },
    { id: 'sl-tp', label: 'SL/TP defined before entry' },
    { id: 'size', label: 'Size computed for this stop' },
    { id: 'invalidation', label: 'Invalidation known (what kills the thesis)' },
];

const PREF_KEY = 'trading_checklist_v1';

export interface ChecklistConfig {
    enabled: boolean;
    items: ChecklistItem[];
}

const valid = (raw: unknown): ChecklistConfig | null => {
    if (!raw || typeof raw !== 'object') return null;
    const c = raw as Partial<ChecklistConfig>;
    if (typeof c.enabled !== 'boolean' || !Array.isArray(c.items)) return null;
    const items = c.items.filter(i => i && typeof i.id === 'string' && typeof i.label === 'string');
    if (items.length === 0) return null;
    return { enabled: c.enabled, items };
};

/** Read the stored checklist config (defaults: OFF, standard items). */
export const loadChecklistConfig = (): ChecklistConfig => {
    try {
        const raw = localStorage.getItem(PREF_KEY);
        const parsed = raw ? valid(JSON.parse(raw)) : null;
        if (parsed) return parsed;
    } catch { /* fall through to defaults */ }
    return { enabled: false, items: DEFAULT_CHECKLIST };
};

export const saveChecklistConfig = (cfg: ChecklistConfig): ChecklistConfig => {
    try {
        localStorage.setItem(PREF_KEY, JSON.stringify(cfg));
    } catch { /* best-effort */ }
    return cfg;
};

/**
 * Completion summary stored on the trade: how many items were checked and
 * of how many. `checked` is the set of item ids the user ticked.
 */
export const summarizeChecklist = (
    items: ChecklistItem[],
    checked: Set<string>,
): { done: number; total: number } => ({
    done: items.filter(i => checked.has(i.id)).length,
    total: items.length,
});

/** True when every item was checked — the strict adherence signal. */
export const checklistFullyDone = (done: number | undefined, total: number | undefined): boolean =>
    typeof done === 'number' && typeof total === 'number' && total > 0 && done >= total;
