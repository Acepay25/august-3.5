import { describe, it, expect, beforeEach } from 'vitest';

/**
 * The activity block must SURVIVE A RELOAD and must NAME ITS WORK from data it
 * already has. Before this stage the block's "Analyzed for Ns" was a live tick
 * only: it was right while the turn ran and gone the moment you came back to
 * the session. These tests pin both halves — the number round-trips through
 * storage, and the title is derived from the transcript rather than invented.
 */

const USER = 'workedms-user';

/** The store's own key, derived the same way the service does — it reads the
 *  active user, so the test must publish one or the key falls back to
 *  'default' and the round-trip reads nothing. */
const key = (u: string): string => `trade_chat_sessions_v1_${u}`;

const entry = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: 'a-1',
    role: 'ai',
    text: 'answer',
    tools: [],
    ...over,
});

const session = (entries: Record<string, unknown>[], over: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: 's-1',
    title: 'A turn',
    createdAt: 1,
    updatedAt: 2,
    kind: 'solo',
    entries,
    ...over,
});

describe('workedMs survives a reload', () => {
    beforeEach(() => {
        localStorage.clear();
        // `chatSessions` scopes its key to the active user (`utils/activeUser`),
        // defaulting to 'default' when no marker is set — so publish one.
        localStorage.setItem('last_active_user', USER);
    });

    it('round-trips through save → load, because sanitizeEntry spreads the entry', async () => {
        // THE FIELD-LEVEL ASYMMETRY THIS STAGE RELIES ON: `sanitizeEntry`
        // spreads `...e`, so a new ENTRY field survives `loadSessions` with no
        // loader change. A new SESSION field would be stripped — that is why
        // the pin set (Stage 8) gets its own key instead.
        localStorage.setItem(key(USER), JSON.stringify([session([
            entry({ workedMs: 34_000, tools: ['order book · buy wall'] }),
        ])]));

        const { loadSessions } = await import('../services/trade/chatSessions');
        const loaded = loadSessions();
        expect(loaded).toHaveLength(1);
        expect(loaded[0].entries[0].workedMs).toBe(34_000);
    });

    it('keeps the value when other entry fields are trimmed in the same pass', () => {
        // A long reasoning trace is capped and a bad image dropped; neither may
        // take `workedMs` with it.
        localStorage.setItem(key(USER), JSON.stringify([session([
            entry({
                workedMs: 12_500,
                reasoning: 'x'.repeat(5000),
                image: 'not-a-data-url',
            }),
        ])]));

        return import('../services/trade/chatSessions').then(({ loadSessions }) => {
            const e = loadSessions()[0].entries[0];
            expect(e.workedMs).toBe(12_500);
            expect(e.image).toBeUndefined();
            expect((e.reasoning ?? '').length).toBeLessThan(5000);
        });
    });

    it('leaves it undefined for an entry that never had one — no invented zero', () => {
        // The renderer's precedence is live > frozen > persisted, and a missing
        // value must render NO duration rather than "0s".
        localStorage.setItem(key(USER), JSON.stringify([session([entry()])]));

        return import('../services/trade/chatSessions').then(({ loadSessions }) => {
            expect(loadSessions()[0].entries[0].workedMs).toBeUndefined();
        });
    });
});

describe('the pipeline path maps runStats into workedMs', () => {
    it('carries durationMs so a dock row built from a Message keeps its duration', async () => {
        const { liveEntryFromMessage } = await import('../services/trade/chatSessions');
        const { MessageRole } = await import('../types');
        const m = {
            id: 'm-1',
            role: MessageRole.AI,
            text: 'answer',
            createdAt: new Date().toISOString(),
            runStats: {
                runId: 'r-1',
                startedAt: new Date(0).toISOString(),
                finishedAt: new Date(9000).toISOString(),
                durationMs: 9000,
            },
        };
        // `liveEntryFromMessage` types its input as Message; the object above is
        // the shape that matters, so cast rather than build a whole Message.
        expect(liveEntryFromMessage(m as never).workedMs).toBe(9000);
    });

    it('is undefined when the message carries no runStats — the dock-native case', async () => {
        const { liveEntryFromMessage } = await import('../services/trade/chatSessions');
        const { MessageRole } = await import('../types');
        const m = {
            id: 'm-2',
            role: MessageRole.AI,
            text: 'answer',
            createdAt: new Date().toISOString(),
        };
        expect(liveEntryFromMessage(m as never).workedMs).toBeUndefined();
    });
});

describe('the block names its work from the transcript', () => {
    // No model call, no new store: the title is built from the same human labels
    // the rows below it display, so the summary promises exactly what opening
    // the block delivers.
    const label = async (): Promise<typeof import('../components/trade/panels/ChatWorkTimeline').workSummaryLabel> => {
        const mod = await import('../components/trade/panels/ChatWorkTimeline');
        return mod.workSummaryLabel;
    };

    it('names reasoning once and folds duplicate tool labels', async () => {
        const f = await label();
        expect(f(['order book · a', 'order book · b', 'order book · c', 'indicators · d'], true))
            .toBe('Read the chart, order book, indicators');
    });

    it('strips the trailing outcome so the title is the tool, not the result line', async () => {
        const f = await label();
        expect(f(['calling order book…', 'order book · buy wall at 88k'], false))
            .toBe('order book');
    });

    it('caps a tool-heavy turn rather than becoming a paragraph', async () => {
        const f = await label();
        const out = f(['t1', 't2', 't3', 't4', 't5', 't6'], false);
        expect(out).toBe('t1, t2, t3, t4 +2');
    });

    it('is null when there is no work to name', async () => {
        const f = await label();
        expect(f([], false)).toBeNull();
        expect(f(['   '], false)).toBeNull();
    });
});
