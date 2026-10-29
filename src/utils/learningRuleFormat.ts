/**
 * learningRuleFormat — the one shape of a journal rule, and the migration from
 * the old one.
 *
 * A rule used to be stored as `{ ifCondition, thenAction }` — the same pair the
 * skills dropped on 2026-10-30. A rule is a single journal lesson, so it now
 * carries `when` (the trigger) and `action` (what to do), which is also what
 * the prompt line prints.
 *
 * Stored rows, profile snapshots and backups all predate this shape, so the
 * normalizer is applied on READ (StorageService.loadLearningRules) and on WRITE
 * (saveLearningRules). It is pure and idempotent: a row that already carries
 * `when`/`action` is returned untouched, so re-running it can never churn the
 * store. A row with no trigger, or no action, cannot be printed and is dropped.
 */

import type { LearningRule } from '../types/learning';

export interface RawLearningRule {
    id?: unknown;
    when?: unknown;
    action?: unknown;
    ifCondition?: unknown;
    thenAction?: unknown;
    sourceTradeId?: unknown;
    outcome?: unknown;
    coin?: unknown;
    pattern?: unknown;
    direction?: unknown;
    createdAt?: unknown;
    useCount?: unknown;
    lastUsed?: unknown;
    wins?: unknown;
    losses?: unknown;
    status?: unknown;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export interface NormalizedRules {
    rules: LearningRule[];
    /** True when at least one row had to be mapped, defaulted or dropped. */
    migrated: boolean;
}

export const normalizeLearningRule = (raw: RawLearningRule, index: number): LearningRule | null => {
    const when = text(raw.when) || text(raw.ifCondition);
    const action = text(raw.action) || text(raw.thenAction);
    if (!when || !action) return null;
    const outcome = raw.outcome === 'LOSS' ? 'LOSS' : raw.outcome === 'WIN' ? 'WIN' : undefined;
    const direction = raw.direction === 'Long' || raw.direction === 'Short' ? raw.direction : undefined;
    const status = raw.status === 'confirmed' || raw.status === 'retired' ? raw.status : 'candidate';
    const useCount = Number(raw.useCount);
    return {
        id: text(raw.id) || `lr-legacy-${index}-${when.slice(0, 24).replace(/\W+/g, '-')}`,
        when,
        action,
        sourceTradeId: text(raw.sourceTradeId),
        ...(outcome ? { outcome } : {}),
        ...(text(raw.coin) ? { coin: text(raw.coin) } : {}),
        ...(text(raw.pattern) ? { pattern: text(raw.pattern) } : {}),
        ...(direction ? { direction } : {}),
        createdAt: text(raw.createdAt) || new Date().toISOString(),
        useCount: Number.isFinite(useCount) && useCount > 0 ? useCount : 1,
        ...(text(raw.lastUsed) ? { lastUsed: text(raw.lastUsed) } : {}),
        ...(Number.isFinite(Number(raw.wins)) ? { wins: Number(raw.wins) } : {}),
        ...(Number.isFinite(Number(raw.losses)) ? { losses: Number(raw.losses) } : {}),
        status,
    };
};

export const normalizeLearningRules = (raw: readonly RawLearningRule[] | undefined): NormalizedRules => {
    const rows = Array.isArray(raw) ? raw : [];
    const rules: LearningRule[] = [];
    let migrated = !Array.isArray(raw);
    for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i];
        const rule = normalizeLearningRule(row ?? {}, i);
        if (!rule) { migrated = true; continue; }
        if ('ifCondition' in (row ?? {}) || 'thenAction' in (row ?? {}) || !('when' in (row ?? {})) || !('action' in (row ?? {}))) {
            migrated = true;
        }
        rules.push(rule);
    }
    return { rules, migrated };
};
