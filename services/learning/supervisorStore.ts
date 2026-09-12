/**
 * supervisorStore — live state for the SKILL SUPERVISOR, the LLM that
 * reviews/verifies/enhances/approves the approval queues the way a human
 * used to. Module singleton (chatStore pattern) so the dock's indicator and
 * the detail panel subscribe to the SAME stream of what the model is doing
 * right now — including the streamed text of the call in flight — from
 * anywhere in the tree, and so a run survives surface switches.
 *
 * The log is intentionally small and ephemeral (this session's supervision),
 * while the automation toggle is persisted per user. Phase names are what
 * the indicator renders: they must stay honest — the UI shows exactly the
 * phase the service set, never a generic spinner.
 */

export type SupervisorPhase =
    | 'idle'
    | 'reviewing'   // reading the item + its context
    | 'verifying'   // checking against catalog/graveyard/evidence
    | 'enhancing'   // rewriting IF/THEN + description
    | 'deciding'    // applying the verdict
    | 'learning';   // trader-profile distill (Part of the same oversight UI)

export type SupervisorItemKind = 'skill' | 'tool' | 'amendment' | 'proposal';

export type SupervisorVerdict = 'approved' | 'enhanced' | 'rejected' | 'skipped';

export interface SupervisorDecision {
    verdict: SupervisorVerdict;
    reason: string;
    atMs: number;
    /** The skill file created by an approve/enhance (for override-reject). */
    createdFileId?: string;
    createdFileName?: string;
    /** The user overrode this verdict from the panel. */
    overriddenByUser?: boolean;
}

export interface SupervisorEvent {
    id: string;
    atMs: number;
    phase: SupervisorPhase;
    text: string;
    itemKind?: SupervisorItemKind;
    itemTitle?: string;
    itemId?: string;
    /** Snapshot of a skill draft kept so the user can override the verdict
     *  after the fact (approve a rejected draft / reject an approved one). */
    draftSnapshot?: unknown;
    /** Live streamed text of the supervising model for THIS item. */
    streamText?: string;
    streaming?: boolean;
    decision?: SupervisorDecision;
}

export interface SupervisorSnapshot {
    phase: SupervisorPhase;
    /** One human-readable line — the indicator's tooltip and panel header. */
    activity: string;
    /** Display name of the model currently doing the supervising. */
    modelName: string;
    running: boolean;
    /** Automation toggle (persisted). When off, only an explicit "Run now" works. */
    autoEnabled: boolean;
    events: SupervisorEvent[];
}

import { getActiveUsername } from '../../utils/activeUser';

const AUTO_KEY = (user: string): string => `supervisor_auto_v1_${user}`;
const EVENT_CAP = 80;

let phase: SupervisorPhase = 'idle';
let activity = '';
let modelName = '';
let running = false;
let autoEnabled = true;
let events: SupervisorEvent[] = [];
const listeners = new Set<() => void>();
let controller: AbortController | null = null;
let autoLoadedFor = '';

let snapshot: SupervisorSnapshot = { phase, activity, modelName, running, autoEnabled, events };

const rebuild = (): void => {
    snapshot = { phase, activity, modelName, running, autoEnabled, events };
};

const emit = (): void => {
    rebuild();
    for (const l of listeners) l();
};

const ensureAutoLoaded = (): void => {
    const user = getActiveUsername();
    if (autoLoadedFor === user) return;
    autoLoadedFor = user;
    try {
        const raw = localStorage.getItem(AUTO_KEY(user));
        if (raw !== null) autoEnabled = raw === '1';
    } catch { /* private mode — default stays */ }
};

export const subscribe = (fn: () => void): (() => void) => {
    ensureAutoLoaded();
    listeners.add(fn);
    return () => { listeners.delete(fn); };
};

export const getSnapshot = (): SupervisorSnapshot => {
    ensureAutoLoaded();
    return snapshot;
};

export const setPhase = (next: SupervisorPhase, activityText = ''): void => {
    phase = next;
    activity = activityText;
    emit();
};

export const setModelName = (name: string): void => {
    if (modelName === name) return;
    modelName = name;
    emit();
};

export const getModelName = (): string => modelName;

export const pushEvent = (ev: Omit<SupervisorEvent, 'id' | 'atMs'>): string => {
    const id = `sv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    events = [...events, { ...ev, id, atMs: Date.now() }].slice(-EVENT_CAP);
    emit();
    return id;
};

/** Live-stream patch onto one event (the in-flight model call). */
export const patchEvent = (id: string, patch: Partial<Pick<SupervisorEvent, 'streamText' | 'streaming' | 'phase' | 'text'>>): void => {
    events = events.map(e => (e.id === id ? { ...e, ...patch } : e));
    emit();
};

export const setDecision = (id: string, decision: SupervisorDecision): void => {
    events = events.map(e => (e.id === id ? { ...e, decision, streaming: false } : e));
    emit();
};

/** The user overrode a verdict from the panel (approve-anyway / reject). */
export const markOverridden = (id: string, verdict: SupervisorVerdict): void => {
    events = events.map(e => (e.id === id && e.decision
        ? { ...e, decision: { ...e.decision, verdict, overriddenByUser: true } }
        : e));
    emit();
};

export const setRunning = (next: boolean): void => {
    running = next;
    if (!next) {
        phase = 'idle';
        activity = '';
        controller = null;
        events = events.map(e => (e.streaming ? { ...e, streaming: false } : e));
    }
    emit();
};

export const setController = (c: AbortController | null): void => { controller = c; };
export const getController = (): AbortController | null => controller;
export const abortRun = (): void => { controller?.abort(); };

export const isAutoEnabled = (): boolean => {
    ensureAutoLoaded();
    return autoEnabled;
};

export const setAutoEnabled = (next: boolean): void => {
    autoEnabled = next;
    try { localStorage.setItem(AUTO_KEY(getActiveUsername()), next ? '1' : '0'); } catch { /* private mode */ }
    emit();
};

/** Test hook — resets the singleton between suites. */
export const __resetForTests = (): void => {
    phase = 'idle';
    activity = '';
    modelName = '';
    running = false;
    autoEnabled = true;
    events = [];
    controller = null;
    autoLoadedFor = '';
    rebuild();
};
