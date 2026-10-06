/**
 * skillSupervisor — the LLM that sits where the human sat. Every approval
 * queue in the app (skill drafts, forged-tool candidates, memory amendments,
 * displacement/revival/demote proposals) is reviewed by a model that runs
 * AUTOMATICALLY and independently of any chat: one streamed API call per
 * item, its own abort controller, never inside a send. It verifies the item
 * against the live catalog + graveyard + trader memory, ENHANCES what is
 * salvageable (mechanical IF, activation-key description, tighter
 * prediction), and then decides — approve/enhance lands exactly where the
 * human "Save as skill" button lands (candidate status, evidence ladder
 * still governs enforcement); reject tombstones exactly where "Discard" does.
 *
 * The human is not removed, they are promoted: the dock's supervisor
 * indicator + panel stream every step live, every verdict is overridable
 * after the fact, and the automation can be paused from the UI.
 *
 * WHO supervises: whatever model the CURRENT session is using — a panel's
 * FIRST seat when several are selected (the panel reports it via
 * setSessionModel on each send), else the solo chat model; outside a chat
 * (event-debounced sweeps, startup) the Settings memory provider, else the
 * first ready provider.
 */

import type { ProviderConfig } from '../../types/provider';
import { streamChatRequest, type ChatMessage } from '../providers/GenericProviderService';
import { TASK_BUDGETS } from '../providers/taskBudgets';
import { effortForTask } from '../providers/reasoningControls';
import { extractAndParseJson } from '../../utils/jsonUtils';
import { z } from 'zod';
import { getActiveUsername } from '../../utils/activeUser';
import { formatModelDisplayName } from '../../utils/providerUtils';
import {
    listSkillDrafts, takeSkillDraft, tombstoneSkillDraftKey, draftTriggerKey,
    type SkillDraft,
} from '../../utils/skillDrafts';
import { listLearningProposals, dismissLearningProposal, queueLearningProposal, type LearningProposal } from '../../utils/learningQueue';
import { loadForgedTools, approveForgedTool, retireForgedTool } from '../tools/toolForge';
import { listAmendments, approveAmendment, rejectAmendment } from './memoryAmendments';
import { getMemoryFiles, updateMemoryFile, deleteMemoryFile } from './MemoryFilesService';
import {
    listSkills, parseSkillMarkdown,
    ingestCraftedSkillFromDraft, isSkillFile, type SkillIngestResult,
} from './SkillMemoryService';
import { graveyardBlock } from './skillGraveyard';
import { resolveMemoryConfig } from './MemoryModelService';
import { buildProfileMemoryIndex } from './profileMemory';
import { sanitizePrediction } from '../../utils/skillPrediction';
import * as store from './supervisorStore';

// ─── Session model preference (the "who supervises" rule) ───────────────────

let sessionConfig: ProviderConfig | null = null;

/** The panel calls this on every send + session switch: the CURRENT chat's
 *  model becomes the supervisor (panel ⇒ FIRST seat). Null clears it. */
export const setSessionModel = (config: ProviderConfig | null): void => {
    sessionConfig = config;
    if (config) store.setModelName(formatModelDisplayName(config.selectedModel));
};

const resolveSupervisorConfig = async (username: string): Promise<ProviderConfig | null> =>
    sessionConfig ?? await resolveMemoryConfig(username);

/** The chat model the CURRENT session answers with (null outside a chat).
 *  Other learning-loop features (the chart-scan crafter) reuse it so the
 *  model that sees your chart is the model that learns from it. */
export const getSessionModel = (): ProviderConfig | null => sessionConfig;

// ─── Verdict schema ─────────────────────────────────────────────────────────

const SupervisorVerdictSchema = z.object({
    action: z.enum(['approve', 'enhance', 'reject']),
    reason: z.string().min(4).max(400),
    enhanced: z.object({
        name: z.string().min(2).max(80).optional(),
        kind: z.enum(['repeat', 'avoid']).optional(),
        when: z.string().min(8).max(300).optional(),
        ifCondition: z.string().min(12).max(300).optional(),
        thenAction: z.string().min(12).max(300).optional(),
        description: z.string().min(10).max(300).optional(),
        prediction: z.unknown().optional(),
    }).partial().optional(),
});

type SupervisorVerdict = z.infer<typeof SupervisorVerdictSchema>;

// ─── Prompt context ─────────────────────────────────────────────────────────

const catalogIndex = (): string => {
    try {
        return listSkills()
            .filter(({ meta }) => meta.status !== 'retired')
            .slice(0, 12)
            .map(({ file, meta }) => `- ${file.name.replace(/\.md$/i, '')} · ${meta.kind} · ${meta.status} · ${meta.wins}W/${meta.losses}L — IF ${(meta.ifCondition || '').slice(0, 90)}`)
            .join('\n') || '(no skills yet)';
    } catch {
        return '(no skills yet)';
    }
};

const SUPERVISOR_SYSTEM = 'You are the quality gate for a trading skill system. You judge each item the way a rigorous human reviewer would: verify against the existing catalog, the graveyard (tried-and-failed) and the trader\'s memory; reject duplicates, vague or non-mechanical rules, and unfalsifiable claims; ENHANCE what is salvageable by making the IF mechanical and writing a description that states WHAT the skill does and WHEN to use it (with trigger words — that description is the activation key); approve what is already solid. You output ONLY JSON.';

const verdictPrompt = (itemBlock: string, evidence: { graveyard: string; memory: string; extra?: string }): string => `Judge this item.

ITEM:
${itemBlock}

EXISTING SKILL CATALOG:
${catalogIndex()}

GRAVEYARD (retired — a match means REJECT, revival is a separate human path):
${evidence.graveyard}

TRADER MEMORY (their habits/preferences — a skill contradicting these needs a strong reason):
${evidence.memory}

${evidence.extra || ''}

Decide:
- "approve" — specific, mechanical, not covered, prediction (if any) is falsifiable
- "enhance" — worth keeping but needs a sharper IF / activation description / prediction; return "enhanced" with the corrected fields (only the fields you change)
- "reject" — duplicate, graveyard twin, generic, unverifiable, or contradicted by evidence

Output ONLY JSON:
{"action":"approve|enhance|reject","reason":"why (20-300 chars)","enhanced":{"name?","kind?","when?","ifCondition?","thenAction?","description?","prediction?"}}`;

// ─── The streamed call ──────────────────────────────────────────────────────

/** One independent, streamed verdict call for one item. Deltas stream into
 *  the given event so the panel shows the model actually working. */
const streamVerdict = async (
    eventId: string,
    prompt: string,
    config: ProviderConfig,
): Promise<SupervisorVerdict | null> => {
    const controller = store.getController();
    try {
        let text = '';
        const messages: ChatMessage[] = [
            { role: 'system', content: SUPERVISOR_SYSTEM },
            { role: 'user', content: prompt },
        ];
        for await (const delta of streamChatRequest(config, messages, {
            maxTokens: TASK_BUDGETS.chat,
            temperature: 0.2,
            reasoningEffort: effortForTask('supervision'),
            signal: controller?.signal,
        })) {
            text += delta;
            store.patchEvent(eventId, { streamText: text, streaming: true });
        }
        store.patchEvent(eventId, { streaming: false });
        const parsed = SupervisorVerdictSchema.parse(extractAndParseJson(text));
        return parsed;
    } catch (e) {
        store.patchEvent(eventId, { streaming: false });
        if ((e as Error)?.name === 'AbortError') return null;
        // A malformed verdict NEVER auto-applies — the item stays queued for
        // the human. That is the fail-safe under the whole design.
        console.warn('[SkillSupervisor] verdict failed:', e);
        return null;
    }
};

// ─── Apply paths (mirror the human buttons exactly) ─────────────────────────

const applySkillDecision = async (
    eventId: string,
    draft: SkillDraft,
    verdict: SupervisorVerdict | null,
    username: string,
): Promise<void> => {
    if (verdict === null) {
        // Fail-safe: the verdict never completed (abort/malformed) — the
        // draft stays QUEUED for the human. Never auto-reject on a failure.
        store.setDecision(eventId, {
            verdict: 'skipped',
            reason: 'The review did not complete — the draft stays in the queue.',
            atMs: Date.now(),
        });
        return;
    }
    // AUTO-TRIAGE, NOT AUTO-APPLY (contract change, 2026-10-05). The model reads
    // the queue and says what it thinks; the trader's Save/Discard is the only thing
    // that creates or removes a skill. So "approve" no longer ingests, and "reject"
    // no longer consumes the draft and tombstones its trigger key — that was the
    // model retiring the trader's own proposal without asking. Both record the
    // verdict in the triage ledger so a pass does not re-read the same item forever.
    const suggestion = verdict.action === 'enhance' && verdict.enhanced?.ifCondition
        ? ` I would write it as: IF ${verdict.enhanced.ifCondition}`
        : '';
    const note = `${verdict.reason}${suggestion} (triaged — nothing was created or removed; your inbox is unchanged).`;
    // The LEDGER stores the DECISION verb, so `triageNote` answers "what did the
    // model conclude" — writing the raw action ("reject") would never match it.
    writeTriage(username, draft.id, JSON.stringify({
        verdict: verdict.action === 'reject' ? 'rejected' : verdict.action === 'enhance' ? 'enhanced' : 'approved',
        reason: note,
    }));
    store.setDecision(eventId, {
        verdict: verdict.action === 'reject' ? 'rejected' : verdict.action === 'enhance' ? 'enhanced' : 'approved',
        reason: note,
        atMs: Date.now(),
    });
};

const superviseSkillDraft = async (draft: SkillDraft, config: ProviderConfig, username: string): Promise<void> => {
    const eventId = store.pushEvent({
        phase: 'reviewing',
        itemKind: 'skill',
        itemTitle: draft.crafted.name,
        itemId: draft.id,
        draftSnapshot: draft,
        text: `Reviewing skill draft “${draft.crafted.name}” (${draft.crafted.kind})`,
    });
    store.setPhase('reviewing', `Reviewing skill draft “${draft.crafted.name}”`);
    store.setPhase('verifying', `Verifying “${draft.crafted.name}” against the catalog`);
    const verdict = await streamVerdict(eventId, verdictPrompt(
        JSON.stringify({ source: draft.tradeId, coin: draft.coin, ...draft.crafted }, null, 1),
        {
            graveyard: await graveyardBlock(username, 30) || '(none)',
            memory: buildProfileMemoryIndex(username) || '(none)',
            extra: 'A "repeat" skill without any supporting evidence yet is fine as a candidate — the evidence ladder will test it. Judge QUALITY (mechanical trigger, falsifiable claim, not covered), not seniority.',
        },
    ), config);
    store.setPhase('deciding', `Applying the verdict on “${draft.crafted.name}”`);
    await applySkillDecision(eventId, draft, verdict, username);
};

const superviseToolCandidate = async (tool: ReturnType<typeof loadForgedTools>[number], config: ProviderConfig): Promise<void> => {
    const eventId = store.pushEvent({
        phase: 'reviewing',
        itemKind: 'tool',
        itemTitle: tool.proposal.name,
        itemId: tool.id,
        text: `Reviewing forged tool “${tool.proposal.name}” → ${tool.proposal.urlTemplate}`,
    });
    store.setPhase('verifying', `Verifying tool “${tool.proposal.name}”`);
    const verdict = await streamVerdict(eventId, verdictPrompt(
        JSON.stringify({ name: tool.proposal.name, description: tool.proposal.description, url: tool.proposal.urlTemplate, method: tool.proposal.method ?? 'GET', parameters: tool.proposal.parameters }, null, 1),
        {
            graveyard: '(tools have no graveyard — judge URL sanity, param economy and description quality)',
            memory: buildProfileMemoryIndex() || '(none)',
            extra: 'A rejected tool is RETIRED (kept for audit). Approve only if the endpoint is a sensible read-only market/data call and the description explains when a model would use it.',
        },
    ), config);
    store.setPhase('deciding', `Applying the verdict on tool “${tool.proposal.name}”`);
    if (!verdict) {
        store.setDecision(eventId, { verdict: 'skipped', reason: 'Review did not complete — the candidate stays for the human.', atMs: Date.now() });
        return;
    }
    // Triage only: approving a tool makes it callable by every desk seat, and
    // retiring one removes it — both are decisions the model does not get to make
    // on its own. The candidate keeps its status; the verdict is recorded.
    writeTriage(getActiveUsername(), tool.id, JSON.stringify({ verdict: verdict.action === "reject" ? "rejected" : verdict.action === "enhance" ? "enhanced" : "approved", reason: verdict.reason }));
    store.setDecision(eventId, {
        verdict: verdict.action === 'reject' ? 'rejected' : verdict.action === 'enhance' ? 'enhanced' : 'approved',
        reason: `${verdict.reason} (triaged — the tool stays a candidate until you act.)`,
        atMs: Date.now(),
    });
};

const superviseAmendment = async (
    amendment: ReturnType<typeof listAmendments>[number],
    config: ProviderConfig,
    username: string,
): Promise<void> => {
    const eventId = store.pushEvent({
        phase: 'reviewing',
        itemKind: 'amendment',
        itemTitle: `${amendment.kind} → ${amendment.fileName}`,
        itemId: amendment.id,
        text: `Reviewing memory amendment (${amendment.kind}) for “${amendment.fileName}”`,
    });
    store.setPhase('verifying', `Verifying amendment for “${amendment.fileName}”`);
    const current = getMemoryFiles().files.find(f => f.id === amendment.fileId)?.content ?? '(file gone)';
    const verdict = await streamVerdict(eventId, verdictPrompt(
        JSON.stringify({ kind: amendment.kind, reason: amendment.reason, proposedContent: amendment.proposedContent.slice(0, 1500) }, null, 1),
        {
            graveyard: '(memory files have no graveyard — judge factual consistency and whether the correction improves the note)',
            memory: buildProfileMemoryIndex(username) || '(none)',
            extra: `CURRENT FILE CONTENT:\n${current.slice(0, 1500)}`,
        },
    ), config);
    store.setPhase('deciding', `Applying the verdict on the ${amendment.kind} amendment`);
    if (!verdict) {
        store.setDecision(eventId, { verdict: 'skipped', reason: 'Review did not complete — the amendment stays for the human.', atMs: Date.now() });
        return;
    }
    // Triage only. An amendment EDITS a notebook file the trader reads, so applying
    // one — or rejecting it — is a write to their own memory the model does not get
    // to make alone. The pending amendment stays pending; the verdict is recorded.
    writeTriage(username, amendment.id, JSON.stringify({ verdict: verdict.action === "reject" ? "rejected" : verdict.action === "enhance" ? "enhanced" : "approved", reason: verdict.reason }));
    store.setDecision(eventId, {
        verdict: verdict.action === 'reject' ? 'rejected' : verdict.action === 'enhance' ? 'enhanced' : 'approved',
        reason: `${verdict.reason} (triaged — the amendment stays pending until you act.)`,
        atMs: Date.now(),
    });
};

const APPLYABLE_PROPOSALS = new Set(['displacement', 'revival', 'demote', 'rescope', 'contradiction']);

/**
 * THE TRIAGE LEDGER — the supervisor's own notes on queue items it has already
 * read. Auto-triage means it may look at everything and act on nothing, so it
 * needs to know what it has seen: without this, a pass would re-review the same
 * draft forever and spend a call per item per pass.
 *
 * Raw localStorage (like `supervisor_auto_v1`), keyed by user + item, so it is
 * registered in `RAW_LOCAL_STORAGE_PREFIXES`. Losing it costs a re-read, never a
 * wrong decision: the worst case is the supervisor says again what it said.
 */
const TRIAGE_KEY = 'supervisor_triaged_v1';
const triageKey = (username: string, itemId: string): string => `${TRIAGE_KEY}_${username}:${itemId}`;

const readTriage = (username: string, itemId: string): string | null => {
    try {
        return localStorage.getItem(triageKey(username, itemId));
    } catch { return null; }
};
const writeTriage = (username: string, itemId: string, note: string): void => {
    try {
        localStorage.setItem(triageKey(username, itemId), note);
    } catch { /* private mode: the item is simply re-read next pass */ }
};

/** What the trader is shown for an item the model has already judged, and what
 *  keeps it out of the next pass. */
export const triageNote = (
    username: string,
    itemId: string,
): { verdict: 'approved' | 'enhanced' | 'rejected'; reason: string } | null => {
    const raw = readTriage(username, itemId);
    if (!raw) return null;
    try {
        const p = JSON.parse(raw) as { verdict?: string; reason?: string };
        const verdict = p.verdict === 'rejected' || p.verdict === 'enhanced' || p.verdict === 'approved'
            ? p.verdict : null;
        return verdict && typeof p.reason === 'string' ? { verdict, reason: p.reason } : null;
    } catch { return null; }
};

/** Deterministic applyability — displacement/revival/demote have exact
 *  actuation paths; rescope/contradiction need a model-authored rewrite. */
const MECHANICAL_PROPOSALS = new Set(['displacement', 'revival', 'demote']);

/** The clause text a PROPOSER stored on its own row. `revise_skill` writes
 *  exactly this (`DeskToolsService.ts:2364`), so a re-scope often arrives with
 *  the rewrite already in it — the wording the seat judged the skill needs. */
type StoredClauses = { ifCondition?: string; thenAction?: string; predicate?: string };

const storedClausesOf = (
    proposal: ReturnType<typeof listLearningProposals>[number],
): StoredClauses | null => {
    if (proposal.kind !== 'rescope') return null;
    const c = proposal.payload as StoredClauses | undefined;
    return c?.ifCondition && c?.thenAction ? c : null;
};

const superviseLearningProposal = async (
    proposal: ReturnType<typeof listLearningProposals>[number],
    config: ProviderConfig,
    username: string,
): Promise<void> => {
    const eventId = store.pushEvent({
        phase: 'reviewing',
        itemKind: 'proposal',
        itemTitle: `${proposal.kind}${proposal.skillSlug ? ` → ${proposal.skillSlug}` : ''}`,
        itemId: proposal.id,
        // Kept so a human can put a DROPPED proposal back into the queue;
        // dismissLearningProposal removes it from a store the panel cannot
        // otherwise reconstruct.
        itemSnapshot: proposal,
        text: `Reviewing ${proposal.kind} proposal`,
    });
    store.setPhase('verifying', `Verifying ${proposal.kind} proposal`);
    const affected = proposal.skillSlug
        ? listSkills().find(({ file }) => file.name.replace(/\.md$/i, '') === proposal.skillSlug)
        : undefined;
    const needsRewrite = !MECHANICAL_PROPOSALS.has(proposal.kind);
    const carriesClauses = !!storedClausesOf(proposal);
    const verdict = await streamVerdict(eventId, verdictPrompt(
        JSON.stringify({ kind: proposal.kind, text: proposal.text, skill: proposal.skillSlug, payload: proposal.payload }, null, 1),
        {
            graveyard: '(n/a — judge whether the proposed ladder move is justified by the evidence quoted in the proposal)',
            memory: buildProfileMemoryIndex(username) || '(none)',
            extra: (affected ? `AFFECTED SKILL: ${affected.file.name} · ${affected.meta.status} · ${affected.meta.wins}W/${affected.meta.losses}L — IF ${(affected.meta.ifCondition || '').slice(0, 120)}` : '(affected skill not found)')
                + (carriesClauses
                    // Telling a judge to "enhance" here would make it write a
                    // re-wording that this path then ignores — the silently-dropped
                    // half of the A2 bug. Say what actually happens.
                    ? '\nThis proposal ALREADY CARRIES its re-written IF/THEN clauses (in the payload above) and they are applied verbatim — your own rewrite cannot override them. Judge the stored clauses on their merits: "approve" installs them as written, "reject" dismisses the proposal.'
                    : needsRewrite
                        ? '\nThis proposal asks to RE-SCOPE or RESOLVE the affected skill. "approve" does nothing here: either "enhance" with the corrected ifCondition + thenAction (mechanical, specific — the rewrite applies verbatim), or "reject" if the claim is not justified.'
                        : ''),
        },
    ), config);
    store.setPhase('deciding', `Applying the verdict on the ${proposal.kind} proposal`);
    if (!verdict) {
        store.setDecision(eventId, { verdict: 'skipped', reason: 'Review did not complete — the proposal stays for the human.', atMs: Date.now() });
        return;
    }
    if (verdict.action === 'reject') {
        // Triage, not dismissal: a reject used to remove the proposal outright,
        // which quietly deleted the trader's own pending change.
        writeTriage(username, proposal.id, JSON.stringify({ verdict: 'rejected', reason: verdict.reason }));
        store.setDecision(eventId, {
            verdict: 'rejected',
            reason: `${verdict.reason} (triaged — I would drop this, but the proposal stays queued for you.)`,
            atMs: Date.now(),
        });
        return;
    }
    const payload = (proposal.payload ?? {}) as Record<string, unknown>;
    // AUTO-TRIAGE: the supervisor records what it thinks about a proposal and leaves
    // it queued. Displacing, reviving, demoting, re-scoping and rewriting are all
    // changes to what the trader believes and trades on — none of them are the
    // model's to make alone. The queue row keeps its text, its payload and its
    // buttons, which is where the decision now lives.
    const carried = storedClausesOf(proposal);
    const suggestion = verdict.action === 'enhance' && verdict.enhanced?.ifCondition
        ? ` I would write: IF ${verdict.enhanced.ifCondition} THEN ${verdict.enhanced.thenAction ?? '…'}`
        : carried
            ? ` It already carries clauses: IF ${carried.ifCondition} THEN ${carried.thenAction ?? '…'}`
            : '';
    writeTriage(username, proposal.id, JSON.stringify({
        verdict: verdict.action === 'enhance' ? 'enhanced' : 'approved',
        reason: verdict.reason,
    }));
    store.setDecision(eventId, {
        verdict: verdict.action === 'enhance' ? 'enhanced' : 'approved',
        reason: `${verdict.reason}${suggestion} (triaged — nothing was applied; the proposal stays queued for you.)`,
        atMs: Date.now(),
    });
};

// ─── The pass ───────────────────────────────────────────────────────────────

let passInFlight = false;

/** Provider calls one pass may spend. Each item is exactly one streamed call,
 *  so this is the pass's cost ceiling — the same discipline
 *  MAX_AUTO_EVALS_PER_SESSION puts on evals. A backlog is NOT dropped: the
 *  remainder stays queued, is counted, and the next trigger (queue event,
 *  chat nudge, or the boot sweep) resumes it. Deferred quietly would be a
 *  stalled queue with better optics. */
export const MAX_ITEMS_PER_PASS = 12;

/** The hourly ceiling the plan asked for as a session cap (WS-2.4): a pass cap
 *  alone is not a budget, because the debounce + chat nudges can start a fresh
 *  12-call pass indefinitely. A HUMAN pressing Run bypasses it — that is an
 *  instruction, not the model spending itself into a corner.
 *
 *  It is a WINDOW, not a lifetime total, and that distinction is the whole fix.
 *  The old `sessionHandled` was a module counter with no reset, so the 40th
 *  item ever supervised in an app lifetime disabled supervision PERMANENTLY —
 *  a days-long session stopped learning and reported itself as a spent budget.
 *  With `useLearningHeartbeat` now waking the loop every 15 minutes, a lifetime
 *  total would have become a ten-hour fuse. What a cost ceiling is for is
 *  bounding the RATE of spend; how much has been spent since launch bounds
 *  nothing a user can act on. */
export const MAX_ITEMS_PER_HOUR = 40;
export const SUPERVISION_WINDOW_MS = 60 * 60 * 1000;

/** When each supervised item was taken, inside the current window. Bounded by
 *  MAX_ITEMS_PER_HOUR in steady state, so it cannot grow without limit. */
let handledAt: number[] = [];

/** Drop what has aged out, re-anchoring the array so the prune is paid by the
 *  pass that crossed the boundary rather than by every read after it. */
const windowedSpend = (now: number): number[] => {
    const kept = handledAt.filter(t => now - t < SUPERVISION_WINDOW_MS);
    if (kept.length !== handledAt.length) handledAt = kept;
    return kept;
};

const spendInWindow = (): number => windowedSpend(Date.now()).length;

const recordSpend = (): void => {
    const now = Date.now();
    windowedSpend(now);
    handledAt.push(now);
};

/** What the UI shows so the ceiling is a visible state, not a silent stall. */
export const getSupervisionSpend = (): { spent: number; windowCap: number; exhausted: boolean } => {
    const spent = spendInWindow();
    return { spent, windowCap: MAX_ITEMS_PER_HOUR, exhausted: spent >= MAX_ITEMS_PER_HOUR };
};

/** Test seam: the window is module state on purpose — it spans every pass in
 *  one app lifetime — so a suite that needs a deterministic number seeds it
 *  with back-dated entries rather than counting forward from zero. */
export const __setSupervisionSpendForTests = (n: number): void => {
    const now = Date.now();
    handledAt = Array.from({ length: n }, (_, i) => now - i * 1000);
};

/** How many items the supervisor would take if it were unbounded. The four
 *  queues, counted exactly the way the pass walks them — so the UI's "N items
 *  waiting" and the boot sweep answer the same question the pass asks. */
export const countPendingSupervision = (username: string): number =>
    listSkillDrafts(username).filter(d => !readTriage(username, d.id)).length
    + loadForgedTools().filter(t => t.status === 'candidate' && !readTriage(username, t.id)).length
    + listAmendments('pending').filter(a => !readTriage(username, a.id)).length
    + listLearningProposals(username)
        .filter(p => APPLYABLE_PROPOSALS.has(p.kind) && !readTriage(username, p.id)).length;

/** One supervision pass over pending queue items, capped at
 *  {@link MAX_ITEMS_PER_PASS} calls. Never throws, never overlaps itself,
 *  respects the pause toggle unless `manual`. */
export const runSupervisorPass = async (username = getActiveUsername(), opts: { manual?: boolean } = {}): Promise<number> => {
    try {
        if (passInFlight || store.getSnapshot().running) return 0;
        if (!store.isAutoEnabled() && !opts.manual) return 0;
        const config = await resolveSupervisorConfig(username);
        if (!config) {
            store.setModelName('');
            return 0;
        }
        passInFlight = true;
        const controller = new AbortController();
        store.setController(controller);
        store.setRunning(true);
        store.setModelName(formatModelDisplayName(config.selectedModel));
        let handled = 0;
        let capped = false;
        let windowCapped = false;
        /** Stop taking new items once a call budget is spent. An item already
         *  in flight still finishes. */
        const spent = (): boolean => {
            if (handled >= MAX_ITEMS_PER_PASS) { capped = true; return true; }
            if (!opts.manual && spendInWindow() >= MAX_ITEMS_PER_HOUR) { windowCapped = true; return true; }
            return false;
        };
        for (const draft of listSkillDrafts(username)) {
            if (controller.signal.aborted || spent()) break;
            // Already triaged: the model said what it would say, and the draft is
            // still waiting on the human. Re-reading it would spend a call to repeat
            // itself — the one cost auto-triage does not get to pay freely.
            if (readTriage(username, draft.id)) continue;
            await superviseSkillDraft(draft, config, username);
            handled += 1;
            recordSpend();
        }
        for (const tool of loadForgedTools().filter(t => t.status === 'candidate')) {
            if (controller.signal.aborted || spent()) break;
            if (readTriage(username, tool.id)) continue;
            await superviseToolCandidate(tool, config);
            handled += 1;
            recordSpend();
        }
        for (const amendment of listAmendments('pending')) {
            if (controller.signal.aborted || spent()) break;
            if (readTriage(username, amendment.id)) continue;
            await superviseAmendment(amendment, config, username);
            handled += 1;
            recordSpend();
        }
        for (const proposal of listLearningProposals(username).filter(p => APPLYABLE_PROPOSALS.has(p.kind))) {
            if (controller.signal.aborted || spent()) break;
            if (readTriage(username, proposal.id)) continue;
            await superviseLearningProposal(proposal, config, username);
            handled += 1;
            recordSpend();
        }
        const stillWaiting = countPendingSupervision(username);
        store.setPending(stillWaiting);
        if (controller.signal.aborted) {
            store.pushEvent({ phase: 'deciding', text: 'Supervision stopped — remaining items stay for the human.' });
        } else if (windowCapped) {
            store.pushEvent({
                phase: 'deciding',
                text: `Hourly budget spent (${MAX_ITEMS_PER_HOUR} supervised items) — ${stillWaiting} still queued. Press Run to take more now.`,
            });
        } else if (capped) {
            store.pushEvent({
                phase: 'deciding',
                text: `Call budget spent — ${stillWaiting} item(s) still waiting for the next sweep.`,
            });
        }
        store.setRunning(false);
        passInFlight = false;
        return handled;
    } catch (e) {
        console.warn('[SkillSupervisor] pass failed:', e);
        store.setRunning(false);
        store.setPending(countPendingSupervision(username));
        passInFlight = false;
        return 0;
    }
};

// ─── Triggers ───────────────────────────────────────────────────────────────

const LAST_RUN_KEY = (user: string): string => `supervisor_last_run_v1_${user}`;
const EVENT_DEBOUNCE_MS = 10_000;
const SEND_THROTTLE_MS = 90_000;

let debounceTimer = 0;
let listenersInstalled = false;

const due = (username: string, throttleMs: number): boolean => {
    try {
        const last = Number(localStorage.getItem(LAST_RUN_KEY(username)) || '0');
        if (Date.now() - last < throttleMs) return false;
        localStorage.setItem(LAST_RUN_KEY(username), String(Date.now()));
        return true;
    } catch {
        return true;
    }
};

const debouncedRun = (): void => {
    if (debounceTimer) window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
        debounceTimer = 0;
        void runSupervisorPass();
    }, EVENT_DEBOUNCE_MS);
};

/** Idempotently wire the queue events (a draft/tool/amendment/proposal
 *  landing anywhere schedules a pass ~10s later, so supervision feels
 *  immediate without stampeding the provider). */
export const ensureSupervisorListeners = (): void => {
    if (listenersInstalled || typeof window === 'undefined') return;
    listenersInstalled = true;
    for (const evt of ['august-skill-drafts', 'august-learning-queue', 'august:forged-proposal', 'august:memory-amendment']) {
        window.addEventListener(evt, debouncedRun);
    }
};

/** Chat-send nudge: throttled hard so a chatty session can't flood passes.
 *  Also refreshes the "who supervises" model from the current session. */
export const nudgeSupervisor = (config: ProviderConfig | null, username = getActiveUsername()): void => {
    ensureSupervisorListeners();
    if (config) setSessionModel(config);
    if (!due(username, SEND_THROTTLE_MS)) return;
    void runSupervisorPass();
};

/** Manual "Run now" — bypasses the pause + throttle. */
export const runSupervisorNow = (): Promise<number> => runSupervisorPass(getActiveUsername(), { manual: true });

/** The panel's Stop button: aborts the in-flight call; remaining items stay
 *  queued for the next pass. */
export const abortSupervisorRun = (): void => store.abortRun();

/**
 * Reverse a NON-skill supervision verdict (WS-2.3: "override any verdict", not
 * only a skill draft's). Each kind goes back through the same status writer a
 * human button uses, so an override lands where the panel would have put it.
 *
 * Boundary worth stating: a PROPOSAL is only reversible when the model DROPPED
 * it. An applied re-scope already rewrote a skill file, and that edit has its
 * own undo on the skill (retire / delete / un-approve) — re-queueing the
 * proposal would not roll the clause back, so it refuses rather than pretending.
 */
export const overrideVerdict = async (
    eventId: string,
    username = getActiveUsername(),
): Promise<boolean> => {
    const ev = store.getSnapshot().events.find(e => e.id === eventId);
    const decision = ev?.decision;
    if (!ev || !decision || !ev.itemId || decision.overriddenByUser) return false;
    const accepted = decision.verdict === 'approved' || decision.verdict === 'enhanced';
    if (ev.itemKind === 'tool') {
        if (accepted) retireForgedTool(ev.itemId);
        else approveForgedTool(ev.itemId);
    } else if (ev.itemKind === 'amendment') {
        // Recorded + rethrown by the store. A failed override must not report
        // itself as a successful one, and `false` is already what the panel
        // renders as "nothing changed".
        try {
            if (accepted) rejectAmendment(ev.itemId);
            else approveAmendment(ev.itemId);
        } catch {
            return false;
        }
    } else if (ev.itemKind === 'proposal') {
        if (accepted) return false;
        const queued = ev.itemSnapshot as LearningProposal | undefined;
        if (!queued) return false;
        queueLearningProposal(queued, username);
    } else {
        return false;
    }
    store.markOverridden(eventId, accepted ? 'rejected' : 'approved');
    return true;
};

// ─── Overrides (the panel's intervention buttons) ───────────────────────────

/** Reverse an APPROVED/enhanced skill: tombstone the trigger + delete the
 *  candidate file the supervisor just created. */
export const overrideRejectSkill = async (eventId: string, username = getActiveUsername()): Promise<void> => {
    const ev = store.getSnapshot().events.find(e => e.id === eventId);
    const draft = ev?.draftSnapshot as SkillDraft | undefined;
    const decision = ev?.decision;
    if (draft) tombstoneSkillDraftKey(draftTriggerKey(draft.coin, draft.crafted), username);
    if (decision?.createdFileId) await deleteMemoryFile(decision.createdFileId, username);
    store.markOverridden(eventId, 'rejected');
};

/** Reverse a REJECTED skill: ingest the draft snapshot after all.
 *  Returns what the ingest actually did so the caller can say so too — it used
 *  to mark the event overridden unconditionally, so an override that could not
 *  write (no skills folder) still read "approved by you" in the log. */
export const overrideApproveSkill = async (
    eventId: string,
    username = getActiveUsername(),
): Promise<SkillIngestResult | null> => {
    const ev = store.getSnapshot().events.find(e => e.id === eventId);
    const draft = ev?.draftSnapshot as SkillDraft | undefined;
    if (!draft) return null;
    const modelReason = ev?.decision?.reason ? ` The model had said: ${ev.decision.reason}` : '';
    const result = await ingestCraftedSkillFromDraft(draft.crafted, draft.coin, username, `Approved by you over the supervisor's verdict.${modelReason}`, 'human');
    // 'duplicate' counts: the trigger IS live, which is what the human meant by
    // approving it. Anything else wrote nothing, so nothing is claimed.
    if (result.created || result.reason === 'duplicate') {
        store.markOverridden(eventId, 'approved');
        // Record the file THIS override created so a later Reject can remove it.
        // Under auto-triage the supervisor never creates one, so `createdFileId`
        // used to always be set by the supervisor's own approve — the override
        // path had nothing to point at, and "Reject — undo this" was a no-op.
        if (result.created) {
            const created = getMemoryFiles().files.filter(isSkillFile).find(f =>
                (parseSkillMarkdown(f.content)?.ifCondition ?? '').toLowerCase()
                === (draft.crafted.ifCondition ?? '').toLowerCase());
            const decision = ev?.decision;
            if (created && decision) {
                store.setDecision(eventId, {
                    ...decision,
                    verdict: 'approved',
                    overriddenByUser: true,
                    createdFileId: created.id,
                    createdFileName: created.name,
                });
            }
        }
    }
    return result;
};
