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
    ingestCraftedSkillFromDraft, isSkillFile,
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
    if (verdict.action === 'reject') {
        takeSkillDraft(draft.id, username);
        tombstoneSkillDraftKey(draftTriggerKey(draft.coin, draft.crafted), username);
        store.setDecision(eventId, {
            verdict: 'rejected',
            reason: verdict.reason,
            atMs: Date.now(),
        });
        return;
    }
    // approve / enhance → the same ingest the human "Save as skill" runs.
    const enhanced = verdict.action === 'enhance' ? verdict.enhanced : undefined;
    const finalCrafted = {
        ...draft.crafted,
        ...(enhanced?.name ? { name: enhanced.name } : {}),
        ...(enhanced?.kind ? { kind: enhanced.kind } : {}),
        ...(enhanced?.when ? { when: enhanced.when } : {}),
        ...(enhanced?.ifCondition ? { ifCondition: enhanced.ifCondition } : {}),
        ...(enhanced?.thenAction ? { thenAction: enhanced.thenAction } : {}),
        ...(enhanced?.description ? { description: enhanced.description } : {}),
        ...(enhanced?.prediction ? { prediction: sanitizePrediction(enhanced.prediction) ?? draft.crafted.prediction } : {}),
    };
    takeSkillDraft(draft.id, username);
    // The verdict reason rides INTO the skill file: the event log is
    // session-scoped, so this is the only thing that will still say WHY the
    // model accepted this rule after a reload.
    await ingestCraftedSkillFromDraft(finalCrafted, draft.coin, username, verdict.reason, 'supervisor');
    // Record WHICH file the ingest created/updated so the panel's
    // override-reject can remove it.
    const created = getMemoryFiles().files.filter(isSkillFile).find(f => {
        const meta = parseSkillMarkdown(f.content);
        return meta?.ifCondition?.toLowerCase() === finalCrafted.ifCondition.toLowerCase();
    });
    store.setDecision(eventId, {
        verdict: verdict.action === 'enhance' ? 'enhanced' : 'approved',
        reason: verdict.reason,
        atMs: Date.now(),
        createdFileId: created?.id,
        createdFileName: created?.name,
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
    if (verdict.action === 'reject') retireForgedTool(tool.id);
    else approveForgedTool(tool.id);
    store.setDecision(eventId, {
        verdict: verdict.action === 'reject' ? 'rejected' : verdict.action === 'enhance' ? 'enhanced' : 'approved',
        reason: verdict.reason,
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
    if (verdict.action === 'reject') {
        rejectAmendment(amendment.id);
    } else {
        const resolved = approveAmendment(amendment.id);
        const file = getMemoryFiles().files.find(f => f.id === amendment.fileId);
        if (resolved && file) {
            const next = amendment.kind === 'supersede'
                ? `${file.content}\n\n## Correction (${resolved.resolvedAt})\n\n${amendment.proposedContent}`
                : amendment.proposedContent;
            await updateMemoryFile(amendment.fileId, { content: next }, username);
        }
    }
    store.setDecision(eventId, {
        verdict: verdict.action === 'reject' ? 'rejected' : verdict.action === 'enhance' ? 'enhanced' : 'approved',
        reason: verdict.reason,
        atMs: Date.now(),
    });
};

const APPLYABLE_PROPOSALS = new Set(['displacement', 'revival', 'demote', 'rescope', 'contradiction']);

/** Deterministic applyability — displacement/revival/demote have exact
 *  actuation paths; rescope/contradiction need a model-authored rewrite. */
const MECHANICAL_PROPOSALS = new Set(['displacement', 'revival', 'demote']);

/**
 * Apply a model-authored rescope/contradiction rewrite to the affected skill.
 * Fail-closed: the enhanced clause must survive the same IF/THEN bar as a
 * fresh draft (validateIfThen discipline — min lengths, non-generic). Returns
 * false when anything is missing so the proposal STAYS queued for the human.
 */
const applyProposalRewrite = async (
    proposal: ReturnType<typeof listLearningProposals>[number],
    verdict: SupervisorVerdict,
    username: string,
): Promise<boolean> => {
    const slug = proposal.skillSlug || '';
    if (!slug) return false;
    const target = listSkills().find(({ file }) => file.name.replace(/\.md$/i, '') === slug);
    if (!target) return false;
    const enhanced = verdict.enhanced;
    if (!enhanced?.ifCondition || !enhanced?.thenAction) return false;
    // The same bar a draft must clear: vague rewrites never auto-apply.
    const { validateIfThen } = await import('./draftGates');
    const fail = validateIfThen({ ifCondition: enhanced.ifCondition, thenAction: enhanced.thenAction });
    if (fail) return false;
    const meta = { ...target.meta, ifCondition: enhanced.ifCondition, thenAction: enhanced.thenAction };
    if (enhanced.description) meta.description = enhanced.description;
    if (enhanced.prediction) {
        const p = sanitizePrediction(enhanced.prediction);
        if (p) meta.prediction = p;
    }
    meta.modifiedAt = new Date().toISOString();
    const { serializeSkill, titleFromMeta, setSkillStatus } = await import('./SkillMemoryService');
    const content = serializeSkill(meta, titleFromMeta(meta));
    await updateMemoryFile(target.file.id, { content }, username);
    // A rewrite re-opens the question: a confirmed skill whose trigger moved
    // drops back to candidate so the evidence ladder re-proves the new claim.
    if (target.meta.status === 'confirmed') await setSkillStatus(target.file.id, 'candidate', username);
    return true;
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
    const verdict = await streamVerdict(eventId, verdictPrompt(
        JSON.stringify({ kind: proposal.kind, text: proposal.text, skill: proposal.skillSlug, payload: proposal.payload }, null, 1),
        {
            graveyard: '(n/a — judge whether the proposed ladder move is justified by the evidence quoted in the proposal)',
            memory: buildProfileMemoryIndex(username) || '(none)',
            extra: (affected ? `AFFECTED SKILL: ${affected.file.name} · ${affected.meta.status} · ${affected.meta.wins}W/${affected.meta.losses}L — IF ${(affected.meta.ifCondition || '').slice(0, 120)}` : '(affected skill not found)')
                + (needsRewrite
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
        dismissLearningProposal(proposal.id, username);
        store.setDecision(eventId, { verdict: 'rejected', reason: verdict.reason, atMs: Date.now() });
        return;
    }
    const payload = (proposal.payload ?? {}) as Record<string, unknown>;
    let ok = false;
    if (MECHANICAL_PROPOSALS.has(proposal.kind)) {
        const { applyDisplacementProposal, applyRevivalProposal, applyDemoteProposal } = await import('./SkillMemoryService');
        if (proposal.kind === 'displacement') ok = await applyDisplacementProposal(String(payload.displacedSlug || proposal.skillSlug || ''), username);
        else if (proposal.kind === 'revival') ok = await applyRevivalProposal(proposal.skillSlug || '', username);
        else if (proposal.kind === 'demote') ok = await applyDemoteProposal(proposal.skillSlug || '', username);
    } else {
        // rescope / contradiction: only an "enhance" verdict carries the
        // rewritten clause these kinds need; a bare approve is meaningless
        // (nothing to apply), so it stays queued for the human.
        ok = verdict.action === 'enhance' && await applyProposalRewrite(proposal, verdict, username);
    }
    if (ok) dismissLearningProposal(proposal.id, username);
    store.setDecision(eventId, {
        verdict: ok ? (verdict.action === 'enhance' ? 'enhanced' : 'approved') : 'skipped',
        reason: ok ? verdict.reason : 'The change could not be applied — the proposal stays for the human.',
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

/** The session ceiling the plan asked for (WS-2.4), mirroring
 *  MAX_AUTO_EVALS_PER_SESSION: a pass cap alone is not a budget, because the
 *  debounce + chat nudges can start a fresh 12-call pass indefinitely. A
 *  HUMAN pressing Run bypasses this ceiling — that is an instruction, not the
 *  model spending itself into a corner. */
export const MAX_ITEMS_PER_SESSION = 40;
let sessionHandled = 0;

/** What the UI shows so the ceiling is a visible state, not a silent stall. */
export const getSupervisionSpend = (): { spent: number; sessionCap: number; exhausted: boolean } => ({
    spent: sessionHandled,
    sessionCap: MAX_ITEMS_PER_SESSION,
    exhausted: sessionHandled >= MAX_ITEMS_PER_SESSION,
});

/** Test seam: the counter is module state on purpose — it spans every pass in
 *  one app lifetime — so a suite that needs a deterministic number sets it. */
export const __setSupervisionSpendForTests = (n: number): void => { sessionHandled = n; };

/** How many items the supervisor would take if it were unbounded. The four
 *  queues, counted exactly the way the pass walks them — so the UI's "N items
 *  waiting" and the boot sweep answer the same question the pass asks. */
export const countPendingSupervision = (username: string): number =>
    listSkillDrafts(username).length
    + loadForgedTools().filter(t => t.status === 'candidate').length
    + listAmendments('pending').length
    + listLearningProposals(username).filter(p => APPLYABLE_PROPOSALS.has(p.kind)).length;

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
        let sessionCapped = false;
        /** Stop taking new items once a call budget is spent. An item already
         *  in flight still finishes. */
        const spent = (): boolean => {
            if (handled >= MAX_ITEMS_PER_PASS) { capped = true; return true; }
            if (!opts.manual && sessionHandled >= MAX_ITEMS_PER_SESSION) { sessionCapped = true; return true; }
            return false;
        };
        for (const draft of listSkillDrafts(username)) {
            if (controller.signal.aborted || spent()) break;
            await superviseSkillDraft(draft, config, username);
            handled += 1;
            sessionHandled += 1;
        }
        for (const tool of loadForgedTools().filter(t => t.status === 'candidate')) {
            if (controller.signal.aborted || spent()) break;
            await superviseToolCandidate(tool, config);
            handled += 1;
            sessionHandled += 1;
        }
        for (const amendment of listAmendments('pending')) {
            if (controller.signal.aborted || spent()) break;
            await superviseAmendment(amendment, config, username);
            handled += 1;
            sessionHandled += 1;
        }
        for (const proposal of listLearningProposals(username).filter(p => APPLYABLE_PROPOSALS.has(p.kind))) {
            if (controller.signal.aborted || spent()) break;
            await superviseLearningProposal(proposal, config, username);
            handled += 1;
            sessionHandled += 1;
        }
        const stillWaiting = countPendingSupervision(username);
        store.setPending(stillWaiting);
        if (controller.signal.aborted) {
            store.pushEvent({ phase: 'deciding', text: 'Supervision stopped — remaining items stay for the human.' });
        } else if (sessionCapped) {
            store.pushEvent({
                phase: 'deciding',
                text: `Session budget spent (${MAX_ITEMS_PER_SESSION} supervised items) — ${stillWaiting} still queued. Press Run to take more now.`,
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
        if (accepted) rejectAmendment(ev.itemId);
        else approveAmendment(ev.itemId);
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

/** Reverse a REJECTED skill: ingest the draft snapshot after all. */
export const overrideApproveSkill = async (eventId: string, username = getActiveUsername()): Promise<void> => {
    const ev = store.getSnapshot().events.find(e => e.id === eventId);
    const draft = ev?.draftSnapshot as SkillDraft | undefined;
    if (!draft) return;
    const modelReason = ev?.decision?.reason ? ` The model had said: ${ev.decision.reason}` : '';
    await ingestCraftedSkillFromDraft(draft.crafted, draft.coin, username, `Approved by you over the supervisor's verdict.${modelReason}`, 'human');
    store.markOverridden(eventId, 'approved');
};
