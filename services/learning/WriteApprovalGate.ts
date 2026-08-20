/**
 * WriteApprovalGate.ts
 *
 * Opt-in trust gate for auto-learned rules (Hermes `write_approval` pattern).
 * When enabled, newly extracted IF/THEN rules are staged into a pending queue
 * instead of being persisted directly. The user reviews and approves/rejects
 * them. Default OFF — existing behavior is unchanged until opted in, so this
 * module is purely additive and cannot regress the current learning loop.
 *
 * Concurrency: every mutation of the pending queue is serialized through a
 * single module-level promise chain (`enqueue`), so a background rule job
 * (stageRules) cannot interleave with a UI approve/reject and lose or
 * resurrect entries. Reads (getPending) are not serialized and may see a
 * snapshot one mutation behind; callers await a mutation before reading.
 */

import { LearningRule } from '../../types';
import {
    getPreferenceObject,
    setPreferenceObject,
    PREF_KEYS,
} from '../infrastructure/PreferencesService';
import { loadLearningRules, saveLearningRules, storeRule } from './LearningRulesService';

export interface PendingRuleItem {
    id: string;
    rule: LearningRule;
    stagedAt: string;
    source: 'regex' | 'llm';
}

interface PendingRulesStorage {
    items: PendingRuleItem[];
    lastUpdated: string;
}

const MAX_PENDING = 200;
const APPROVAL_KEY = PREF_KEYS.LEARNING_WRITE_APPROVAL;

/** The active-user scope mirrors the per-user active rule store. */
const activeUsername = (): string =>
    (typeof localStorage !== 'undefined' ? localStorage.getItem('last_active_user') : null) || 'default';

const pendingKey = (): string => `${PREF_KEYS.LEARNING_PENDING_RULES}_${activeUsername()}`;

const emptyStorage = (): PendingRulesStorage => ({
    items: [],
    lastUpdated: new Date().toISOString(),
});

// Serialize all pending-queue mutations (M1 lost-update fix).
let queue: Promise<unknown> = Promise.resolve();
const enqueue = <T>(op: () => Promise<T>): Promise<T> => {
    const run = queue.then(op, op); // run regardless of the prior op's outcome
    queue = run.catch(() => undefined); // keep the chain alive after a failure
    return run;
};

async function loadPending(): Promise<PendingRulesStorage> {
    try {
        const data = await getPreferenceObject<PendingRulesStorage>(pendingKey());
        if (data && Array.isArray(data.items)) return data;
    } catch {
        // ignore — treat as empty
    }
    return emptyStorage();
}

async function savePending(storage: PendingRulesStorage): Promise<void> {
    await setPreferenceObject(pendingKey(), {
        ...storage,
        lastUpdated: new Date().toISOString(),
    });
}

/** Content identity: matches `storeRule`'s dedupe (IF + THEN + outcome). */
const sameRule = (a: LearningRule, b: LearningRule): boolean =>
    (a.ifCondition || '').trim().toLowerCase() === (b.ifCondition || '').trim().toLowerCase() &&
    (a.thenAction || '').trim().toLowerCase() === (b.thenAction || '').trim().toLowerCase() &&
    a.outcome === b.outcome;

/**
 * Merge approved rules into the active learning-rule store (reuses the same
 * dedupe + eviction logic as the live extraction path). Synchronous and
 * idempotent — approving the same content twice is a no-op.
 */
function commitRules(rules: LearningRule[]): void {
    if (rules.length === 0) return;
    let storage = loadLearningRules();
    for (const rule of rules) {
        storage = storeRule(storage, rule);
    }
    saveLearningRules(storage);
}

export const WriteApprovalGate = {
    async isEnabled(): Promise<boolean> {
        try {
            const val = await getPreferenceObject<{ enabled: boolean }>(APPROVAL_KEY);
            return val?.enabled === true;
        } catch {
            return false;
        }
    },

    async setEnabled(enabled: boolean): Promise<void> {
        await setPreferenceObject(APPROVAL_KEY, { enabled });
    },

    /**
     * Stage new rules for review. Content-deduped against both the pending
     * queue and the active store; returns the number actually staged.
     */
    stageRules(rules: LearningRule[], source: 'regex' | 'llm'): Promise<number> {
        return enqueue(async () => {
            if (rules.length === 0) return 0;
            const storage = await loadPending();
            const active = loadLearningRules().rules;

            const staged: PendingRuleItem[] = [];
            for (const rule of rules) {
                if (storage.items.some(i => sameRule(i.rule, rule))) continue;
                if (active.some(a => sameRule(a, rule))) continue;
                staged.push({
                    id: `pending_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
                    rule,
                    stagedAt: new Date().toISOString(),
                    source,
                });
            }
            if (staged.length === 0) return 0;
            const next = [...storage.items, ...staged];
            await savePending({ items: next.slice(-MAX_PENDING), lastUpdated: storage.lastUpdated });
            return staged.length;
        });
    },

    async getPending(): Promise<PendingRuleItem[]> {
        return (await loadPending()).items;
    },

    approve(itemId: string): Promise<void> {
        return enqueue(async () => {
            const storage = await loadPending();
            const item = storage.items.find(i => i.id === itemId);
            if (!item) return;
            commitRules([item.rule]); // sync + deduped, safe to retry
            const idSet = new Set([itemId]);
            await savePending({ items: storage.items.filter(i => !idSet.has(i.id)), lastUpdated: storage.lastUpdated });
        });
    },

    reject(itemId: string): Promise<void> {
        return enqueue(async () => {
            const storage = await loadPending();
            const idSet = new Set([itemId]);
            await savePending({ items: storage.items.filter(i => !idSet.has(i.id)), lastUpdated: storage.lastUpdated });
        });
    },

    approveAll(): Promise<number> {
        return enqueue(async () => {
            const storage = await loadPending();
            if (storage.items.length === 0) return 0;
            const count = storage.items.length;
            // Remove from pending FIRST (durable), then commit (deduped), so a
            // failed queue write cannot leave committed-but-still-pending items.
            await savePending(emptyStorage());
            commitRules(storage.items.map(i => i.rule));
            return count;
        });
    },

    rejectAll(): Promise<void> {
        return enqueue(async () => {
            await savePending(emptyStorage());
        });
    },
};
