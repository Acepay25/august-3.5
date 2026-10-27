/**
 * askUserInput — a seat's one way to STOP and ask the trader.
 *
 * A desk turn has no human in it: a model that needs to know "which account is
 * this for?" or "is 2R acceptable here?" can only guess, and a guess becomes an
 * analysis the trader did not ask for. This is the suspend/resume channel: the
 * tool parks the loop on a promise, the UI renders the questions inline, and the
 * turn continues with the answer.
 *
 * Three exits, and all three are real:
 *   answered    — the trader tapped an option or typed one.
 *   cancelled   — the turn was stopped, the question was superseded by a newer
 *                 one, or the trader pressed Cancel. The loop ends honestly
 *                 instead of resuming with a fabricated answer.
 *   timeout     — nobody answered inside the window. The tool result says so and
 *                 the seat is told to proceed on stated assumptions, never on an
 *                 invented answer.
 *
 * In memory on purpose: a pending question belongs to a live turn in this tab.
 * Persisting it would let a reload resurrect a question whose turn is gone.
 */

export interface AskOption {
    id: string;
    label: string;
}

export interface AskQuestion {
    id: string;
    question: string;
    options: AskOption[];
    /** Also accept free text for this question (the option list is a shortcut,
     *  not a constraint). */
    allowText?: boolean;
}

export interface AskRequest {
    id: string;
    questions: AskQuestion[];
    createdAt: number;
    /** Human label of the seat that asked, for the card's header. */
    asker: string;
}

export type AskOutcome =
    | { kind: 'answered'; answers: Record<string, string> }
    | { kind: 'cancelled'; reason: string }
    | { kind: 'timeout' }
    | { kind: 'superseded' };

/** How long a question stays open. Long enough to read a chart and answer, short
 *  enough that a walk-away does not hold the turn open to the transport's own
 *  five-minute stream ceiling. */
export const ASK_USER_TIMEOUT_MS = 4 * 60_000;

interface Pending extends AskRequest {
    finish: (outcome: AskOutcome) => void;
    timer: ReturnType<typeof setTimeout>;
    onAbort?: () => void;
    signal?: AbortSignal;
}

const pending = new Map<string, Pending>();
const listeners = new Set<() => void>();
let sequence = 0;

const notify = (): void => {
    listeners.forEach(fn => {
        try { fn(); } catch { /* one bad subscriber must not break the channel */ }
    });
};

/** The questions waiting for an answer, oldest first. */
export const listPendingInput = (): AskRequest[] => [...pending.values()]
    .sort((a, b) => a.createdAt - b.createdAt)
    .map(({ id, questions, createdAt, asker }) => ({ id, questions, createdAt, asker }));

export const subscribeUserInput = (fn: () => void): (() => void) => {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
};

const settle = (id: string, outcome: AskOutcome): void => {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    clearTimeout(p.timer);
    if (p.signal && p.onAbort) p.signal.removeEventListener('abort', p.onAbort);
    notify();
    p.finish(outcome);
};

/** Park the turn until the trader answers, the turn stops, or the window closes. */
export const requestUserInput = (
    questions: AskQuestion[],
    opts: { asker?: string; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<AskOutcome> => {
    // One open question at a time: a second ask supersedes the first, and the
    // superseded turn's tool result says exactly that rather than pretending the
    // trader ignored it.
    for (const id of [...pending.keys()]) settle(id, { kind: 'superseded' });
    if (opts.signal?.aborted) return Promise.resolve({ kind: 'cancelled', reason: 'the turn was stopped before the question was shown' });

    sequence += 1;
    const id = `ask-${sequence.toString(36)}-${Date.now().toString(36)}`;
    return new Promise<AskOutcome>(resolve => {
        const finish = (outcome: AskOutcome): void => resolve(outcome);
        const p: Pending = {
            id,
            questions,
            createdAt: Date.now(),
            asker: opts.asker || 'the desk',
            finish,
            timer: setTimeout(() => settle(id, { kind: 'timeout' }), opts.timeoutMs ?? ASK_USER_TIMEOUT_MS),
            signal: opts.signal,
        };
        if (opts.signal) {
            p.onAbort = () => settle(id, { kind: 'cancelled', reason: 'the turn was stopped while the question was open' });
            opts.signal.addEventListener('abort', p.onAbort, { once: true });
        }
        pending.set(id, p);
        notify();
    });
};

/** The trader's answer. Unknown ids are ignored silently: the turn that asked
 *  may already be gone, and a stale card must not resurrect it. */
export const answerUserInput = (id: string, answers: Record<string, string>): boolean => {
    if (!pending.has(id)) return false;
    settle(id, { kind: 'answered', answers });
    return true;
};

export const cancelUserInput = (id: string, reason = 'the trader dismissed the question'): boolean => {
    if (!pending.has(id)) return false;
    settle(id, { kind: 'cancelled', reason });
    return true;
};

/** Diagnostics/tests. */
export const pendingInputCount = (): number => pending.size;
