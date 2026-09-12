/**
 * traderLearner — the "keeps learning your preferences, habits, and ways of
 * working, making every collaboration the start of the next one" loop, for
 * trading. Every couple of Chart AI sessions it makes ONE independent LLM
 * call over the recent conversations and distills DURABLE facts about the
 * TRADER (not the market) into profileMemory:
 *
 *   • preferred symbols / timeframes / session times
 *   • risk habits (sizing, stop discipline, leverage comfort)
 *   • recurring mistakes the user themselves keeps making
 *   • strategy preferences and how they like answers delivered
 *
 * profileMemory's slug-upsert means a refined habit UPDATES its entry rather
 * than duplicating, and the always-loaded index means the very next session
 * starts with everything learned so far. Entries are tagged source:'auto',
 * visible (AUTO badge) and forgettable in Settings → Assistant memory —
 * automatic, never invisible. Market lessons do NOT belong here; they have
 * the whole skill/notebook pipeline.
 */

import type { ProviderConfig } from '../../types/provider';
import { sendChatRequest, type ChatMessage } from '../providers/GenericProviderService';
import { TASK_BUDGETS } from '../providers/taskBudgets';
import { effortForTask } from '../providers/reasoningControls';
import { extractAndParseJson } from '../../utils/jsonUtils';
import { z } from 'zod';
import { getActiveUsername } from '../../utils/activeUser';
import {
    rememberProfileMemory, listProfileMemories, normalizeKind, slugify,
    buildProfileMemoryIndex, type ProfileMemoryKind,
} from './profileMemory';

const COUNTER_KEY = 'trader_learner_counter_v1';
const TOGGLE_KEY = 'trader_learning_v1';
const EVERY_SESSIONS = 2;
const MIN_TRANSCRIPT_CHARS = 200;

export const isTraderLearningEnabled = (username = getActiveUsername()): boolean => {
    try { return localStorage.getItem(`${TOGGLE_KEY}:${username}`) !== '0'; } catch { return true; }
};

export const setTraderLearningEnabled = (on: boolean, username = getActiveUsername()): void => {
    try { localStorage.setItem(`${TOGGLE_KEY}:${username}`, on ? '1' : '0'); } catch { /* noop */ }
};

/** Bump the per-user session counter; true when a learn pass is due. */
export const recordSessionForLearning = (username: string, every = EVERY_SESSIONS): boolean => {
    try {
        const key = `${COUNTER_KEY}:${username}`;
        const n = Number(localStorage.getItem(key) || '0') + 1;
        if (n >= every) {
            localStorage.setItem(key, '0');
            return true;
        }
        localStorage.setItem(key, String(n));
        return false;
    } catch {
        return false;
    }
};

const LearnedFactSchema = z.object({
    name: z.string().min(3).max(60),
    description: z.string().min(10).max(160),
    kind: z.string(),
    body: z.string().min(10).max(1_000),
});

export type LearnedFact = z.infer<typeof LearnedFactSchema>;

const LEARNER_PROMPT = (transcript: string, existingIndex: string): string => [
    'From this trading-app conversation, extract DURABLE facts about the TRADER — the kind of thing that should shape every future collaboration.',
    'Look for: preferred symbols/timeframes/session times; risk habits (sizing, stop discipline, leverage comfort); recurring mistakes THEY make; strategy preferences; how they like answers delivered (concise vs deep, numbers-first, warnings wanted…).',
    'Rules:',
    '- Only durable facts: explicitly stated, or clearly repeated. One-off price talk is NOT a fact.',
    '- Facts about the TRADER, never market lessons (those live in the skill system) and never any keys/codes.',
    '- Update-not-duplicate: skip a fact whose slug+description already exists below unless it genuinely changed.',
    '- 0 to 3 facts per pass. Fewer, better.',
    'Return ONLY a JSON array of {"name":"short kebab-name","description":"one line ≤140 chars","kind":"user|feedback|project|reference","body":"the fact (markdown)"} — [] when nothing durable surfaced.',
    '',
    existingIndex ? `ALREADY KNOWN:\n${existingIndex}` : 'ALREADY KNOWN: (nothing yet)',
    '',
    'RECENT CONVERSATIONS:',
    transcript.slice(-12_000),
].join('\n');

/** One learner pass: distill durable trader facts from recent sessions into
 *  profileMemory. Returns how many entries were written. Never throws. */
export const runTraderLearner = async (
    username: string,
    config: ProviderConfig,
    transcripts: string[],
): Promise<number> => {
    if (!isTraderLearningEnabled(username)) return 0;
    const flat = transcripts.join('\n\n').trim();
    // Length + toggle checks come BEFORE the counter bump, so a tiny or
    // disabled session never consumes the every-2 cadence.
    if (flat.length < MIN_TRANSCRIPT_CHARS) return 0;
    if (!recordSessionForLearning(username)) return 0;
    const existing = buildProfileMemoryIndex(username);
    try {
        const raw = await sendChatRequest(
            config,
            [{ role: 'user', content: LEARNER_PROMPT(flat, existing) } as ChatMessage],
            { maxTokens: TASK_BUDGETS.chat, temperature: 0.2, reasoningEffort: effortForTask('postMortem') },
        );
        const parsed = extractAndParseJson(raw);
        const arr = Array.isArray(parsed) ? parsed : (parsed?.facts ?? []);
        if (!Array.isArray(arr)) return 0;
        const known = new Set(listProfileMemories(username).map(e => `${e.slug}|${e.description.toLowerCase()}`));
        let written = 0;
        for (const item of arr.slice(0, 3)) {
            const fact = LearnedFactSchema.safeParse(item);
            if (!fact.success) continue;
            const slug = slugify(fact.data.name);
            if (!slug) continue;
            if (known.has(`${slug}|${fact.data.description.toLowerCase()}`)) continue; // no churn
            const kind: ProfileMemoryKind = normalizeKind(fact.data.kind) ?? 'user';
            rememberProfileMemory({
                slug, name: fact.data.name,
                description: fact.data.description,
                kind,
                body: fact.data.body,
                source: 'auto',
            }, username);
            written += 1;
        }
        return written;
    } catch (e) {
        console.warn('[TraderLearner] pass failed:', e);
        return 0;
    }
};
