const STORAGE_KEY = 'thinking_leak_bin_v1';
const MAX_ENTRIES = 20;
const SNIPPET = 200;

export interface ThinkingLeakEntry {
    at: string;
    snippet: string;
}

const readRaw = (): ThinkingLeakEntry[] => {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (!stored) return [];
        const parsed = JSON.parse(stored) as ThinkingLeakEntry[];
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

export const loadThinkingLeakBin = (): ThinkingLeakEntry[] => readRaw();

/** Keep a short sample when content still looks like CoT after the splitter. */
export const noteThinkingLeak = (text: string): void => {
    const snippet = (text || '').replace(/\s+/g, ' ').trim().slice(0, SNIPPET);
    if (snippet.length < 24) return;
    try {
        const prev = readRaw();
        if (prev.some(e => e.snippet === snippet)) return;
        const next = [...prev, { at: new Date().toISOString(), snippet }].slice(-MAX_ENTRIES);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
        // private mode / quota
    }
};

export const stillLooksLikeLeakedThinking = (output: string): boolean => {
    const raw = (output || '').trim();
    if (!raw) return false;
    return /<(?:think|thinking|thought|reasoning)\b/i.test(raw)
        || /thinking process\s*:/i.test(raw)
        || /<\|begin_of_thought\|/i.test(raw);
};
