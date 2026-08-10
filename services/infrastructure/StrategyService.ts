/**
 * StrategyService — user-uploaded trading strategies (summarized from PDFs).
 *
 * The Settings → Strategies tab uploads PDF books, extracts the text, and
 * has a model summarize them into concise strategies. The summaries are
 * stored per-user in Preferences (`strategy_docs_v1_<user>`) and mirrored in
 * a synchronous module cache so analysis-prompt assembly (which runs at call
 * time, not render time) can read them without awaiting storage — same
 * pattern as PromptOverrideService.
 */

import { getPreferenceObject, setPreferenceObject, removePreference } from './PreferencesService';

const STRATEGY_KEY_PREFIX = 'strategy_docs_v1_';

export interface StrategyDoc {
    /** Stable id (used as the React key and for updates/deletes). */
    id: string;
    /** Original PDF file name. */
    sourceName: string;
    pageCount: number;
    charCount: number;
    createdAt: number;
    updatedAt: number;
    /** The AI-summarized strategy list (user-editable in Settings). */
    summary: string;
    /** Whether this doc's strategies are injected into analysis prompts. */
    enabled: boolean;
}

interface StrategyStore {
    version: 1;
    docs: StrategyDoc[];
}

/** Synchronous cache — populated by initStrategyDocs/save/delete. */
let strategyCache: StrategyStore = { version: 1, docs: [] };

/**
 * Load the active user's strategy docs into the sync cache.
 * Call on app boot and on every user switch.
 */
export const initStrategyDocs = async (username: string): Promise<void> => {
    try {
        const stored = await getPreferenceObject<StrategyStore>(`${STRATEGY_KEY_PREFIX}${username}`);
        strategyCache = stored && Array.isArray(stored.docs) ? stored : { version: 1, docs: [] };
    } catch (e) {
        console.warn('[Strategy] Failed to load strategy docs:', e);
        strategyCache = { version: 1, docs: [] };
    }
};

/** Current docs (for the Settings UI and analysis injection). */
export const getStrategyDocs = (): StrategyDoc[] => strategyCache.docs;

/** Persist the cache for the active user (empty list clears the key). */
const persist = async (username: string): Promise<void> => {
    try {
        if (strategyCache.docs.length === 0) {
            await removePreference(`${STRATEGY_KEY_PREFIX}${username}`);
        } else {
            await setPreferenceObject(`${STRATEGY_KEY_PREFIX}${username}`, strategyCache);
        }
    } catch (e) {
        console.warn('[Strategy] Failed to persist strategy docs:', e);
    }
};

/** Add a new doc or replace an existing one (matched by id). */
export const saveStrategyDoc = async (doc: StrategyDoc, username: string): Promise<void> => {
    const existing = strategyCache.docs.findIndex(d => d.id === doc.id);
    if (existing >= 0) {
        strategyCache.docs[existing] = { ...doc, updatedAt: Date.now() };
    } else {
        strategyCache.docs.push({ ...doc, createdAt: Date.now(), updatedAt: Date.now() });
    }
    await persist(username);
};

/** Patch fields of an existing doc (summary edits, enable toggle). */
export const updateStrategyDoc = async (id: string, patch: Partial<StrategyDoc>, username: string): Promise<void> => {
    const existing = strategyCache.docs.findIndex(d => d.id === id);
    if (existing < 0) return;
    strategyCache.docs[existing] = { ...strategyCache.docs[existing], ...patch, updatedAt: Date.now() };
    await persist(username);
};

export const deleteStrategyDoc = async (id: string, username: string): Promise<void> => {
    strategyCache.docs = strategyCache.docs.filter(d => d.id !== id);
    await persist(username);
};

/**
 * Concatenated summaries of all enabled docs, for prompt injection.
 * Returns '' when nothing is enabled — callers skip the block entirely.
 */
export const getEnabledStrategiesText = (): string => {
    const enabled = strategyCache.docs.filter(d => d.enabled && d.summary.trim());
    if (enabled.length === 0) return '';
    return enabled
        .map(d => `**${d.sourceName}:**\n${d.summary.trim()}`)
        .join('\n\n---\n\n');
};
