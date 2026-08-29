/**
 * reasoningControls — the debate harness's reasoning-effort control plane.
 *
 * Translates ONE harness-level intent ("think hard / think fast") into the
 * per-provider wire knobs every API family actually honors. The repo has NO
 * hardcoded provider doctrine: any model can run on any seat, so translation
 * keys on CAPABILITY CLASSES (how a request is shaped), never on provider
 * identity — a provider id may appear in a `detection` hint only as the
 * evidence that a route was verified against.
 *
 * Wire laws (opengrok F-roads, verified 2026-08-28/29):
 *  - xAI chat_completions: `reasoning_effort` = 'low' | 'medium' | 'high' |
 *    'xhigh' (don't send on grok-4-fast or the request 400s — fail closed).
 *  - GLM chat_completions (z-ai): `thinking: { type: 'enabled' | 'disabled' }`
 *    and a literal-string `thinking_effort` ("max" is a real value, not a
 *    typo) — `thinking.type: 'disabled'` is how a thinking-default model is
 *    told to stop burning budget on 60-word clarifications.
 *  - DeepSeek chat_completions: `thinking` is top-level JSON with the same
 *    enabled/disabled shape, plus `reasoning_effort`; long thinking bodies
 *    need a raised max_tokens floor.
 *  - Anthropic messages: thinking is SHIM-OWNED — the request body's
 *    `thinking.budget_tokens` is assembled by GenericProviderService
 *    (see shouldRequestExtendedThinking), never here. Effort only raises
 *    the requested budget; the shim applies the Anthropic constraint
 *    (1024 <= budget_tokens < max_tokens).
 *  - OpenAI responses: `reasoning: { effort }` = 'low' | 'medium' | 'high'.
 *  - Google generateContent: no effort knob — fail closed (no body change).
 *
 * Fail-closed doctrine: an unknown provider/model combination produces NO
 * body change and an audit label saying why — a 200-accepted-but-ignored
 * knob is indistinguishable from a no-op at the provider, so every applied
 * route is also logged for P5's runStats audit and P6's behavior probes.
 */

import type { ProviderConfig } from '../../types/provider';
import type { ChatMessage, ChatRequestOptions } from './GenericProviderService';

// ─── Effort tiers ──────────────────────────────────────────────────────────

/** Harness-level reasoning effort. 'auto' = no override (legacy behavior). */
export type ReasoningEffort = 'low' | 'medium' | 'high' | 'max' | 'auto';

/** Role→effort schedule (P2). Openings reason hard; quick answers don't. */
export const EFFORT_BY_TASK = {
    /** Analyst opening statements — the heavy reasoning phase. */
    analysis: 'high',
    /** Rebuttal rounds — keep depth, the seat must argue its case. */
    rebuttal: 'high',
    /** Moderator final verdict — the run's single most important output. */
    moderatorVerdict: 'max',
    /** Clarification answers — 60-100 words; thinking-default models must
     *  not spend a full thinking budget on them. */
    clarification: 'low',
    /** Casual chat / bot 1:1 replies. */
    chat: 'low',
    /** Post-mortem reports — structured, but not exploratory. */
    postMortem: 'medium',
    /** Vision/OCR structured extraction. */
    ocr: 'low',
} as const;

export type EffortTask = keyof typeof EFFORT_BY_TASK;

/** The effort a task maps to, with 'auto' passthrough for unknown tasks. */
export const effortForTask = (task: EffortTask | string | undefined): ReasoningEffort =>
    (task && task in EFFORT_BY_TASK ? EFFORT_BY_TASK[task as EffortTask] : 'auto');

// ─── Capability-class detection ────────────────────────────────────────────

export interface WireCapabilities {
    /** xAI reasoning_effort route (low/medium/high/xhigh). */
    xaiEffort: boolean;
    /** GLM/z-ai thinking object (enabled/disabled) + literal effort values. */
    glmThinking: boolean;
    /** DeepSeek top-level thinking + reasoning_effort. */
    deepseekThinking: boolean;
    /** Anthropic messages shim-owned thinking (budget_tokens). */
    anthropicThinking: boolean;
    /** OpenAI responses reasoning.effort. */
    responsesEffort: boolean;
}

/**
 * Capability-class detection. Detection by host/model string is EVIDENCE
 * PROVENANCE for which routes were verified — the returned flags are the
 * scope everything downstream keys on (a same-shape model from another
 * vendor that accepts the same body still gets the same treatment).
 */
export const detectWireCapabilities = (
    config: Pick<ProviderConfig, 'baseUrl' | 'apiFormat' | 'selectedModel'>,
): WireCapabilities => {
    const host = `${config.baseUrl || ''}`.toLowerCase();
    const model = `${config.selectedModel || ''}`.toLowerCase();
    const isChat = config.apiFormat === 'chat_completions';
    return {
        // grok-4-fast rejects reasoning_effort; the rest of the family honors it.
        // Match both "xai" and the literal host "x.ai" spellings.
        xaiEffort: isChat && /x\.?ai|grok/.test(host + model) && !/fast/.test(model),
        glmThinking: isChat && /z-ai|zhipu|bigmodel|glm/.test(host + model),
        deepseekThinking: isChat && /deepseek/.test(host + model),
        anthropicThinking: config.apiFormat === 'messages',
        responsesEffort: config.apiFormat === 'responses',
    };
};

// ─── Translation ────────────────────────────────────────────────────────────

/** One audit line per call — what the wire actually received and why. */
export interface WireAuditEntry {
    /** Which capability route was applied ('none' = fail-closed no-op). */
    route: 'xai-effort' | 'glm-thinking' | 'deepseek-thinking' | 'anthropic-thinking' | 'responses-effort' | 'none';
    /** The harness effort tier that drove the translation. */
    effort: ReasoningEffort;
    /** Machine-readable outcome — the P5 runStats / P6 probe substrate. */
    applied: boolean;
    /** Human-readable reason (surfaced in the DebateRunLog budget lines). */
    reason: string;
}

export interface ReasoningBodyPatch {
    /** Fields to merge into the request body (empty = fail-closed no-op). */
    patch: Record<string, unknown>;
    audit: WireAuditEntry;
}

/**
 * Wire-route pin consult (P7 read path). Populated by harnessLessons at
 * module init via registerWireRoutePins — reasoningControls CANNOT import
 * harnessLessons (harnessLessons imports buildReasoningPatch from here;
 * a static cycle would dead-lock module init). A pinned route fails closed
 * regardless of what the detection strings claim: a recorded wire lesson
 * is behavioral evidence that outranks name-based detection.
 */
type WireRoutePinChecker = (route: WireAuditEntry['route'], providerId: string) => boolean;
let wireRoutePinChecker: WireRoutePinChecker | null = null;
export const registerWireRoutePins = (checker: WireRoutePinChecker): void => {
    wireRoutePinChecker = checker;
};
const isRoutePinned = (route: WireAuditEntry['route'], providerId: string): boolean =>
    wireRoutePinChecker?.(route, providerId) ?? false;

/** Map harness tiers onto xAI's 4-level scale. */
const XAI_EFFORT_MAP: Record<ReasoningEffort, 'low' | 'medium' | 'high' | 'xhigh' | null> = {
    low: 'low',
    medium: 'medium',
    high: 'high',
    max: 'xhigh',
    // 'auto' sends nothing — preserve the provider default.
    auto: null,
};

/** GLM's literal string scale (docs use 'max' as a real value). */
const GLM_EFFORT_MAP: Record<ReasoningEffort, string | null> = {
    low: 'low',
    medium: 'medium',
    high: 'high',
    max: 'max',
    auto: null,
};

const DEEPSEEK_EFFORT_MAP: Record<ReasoningEffort, string | null> = {
    low: 'low',
    medium: 'medium',
    high: 'high',
    max: 'high',
    auto: null,
};

/**
 * Translate one effort tier into body fields for ONE capability class route.
 * Returns an empty patch (with the audit reason) when the route does not
 * apply — callers merge at most one route, checked in capability order.
 *
 * The effort parameter must be a REAL tier when translation is wanted;
 * pass 'auto' to explicitly request no body change.
 */
export const buildReasoningPatch = (
    config: Pick<ProviderConfig, 'id' | 'baseUrl' | 'apiFormat' | 'selectedModel'>,
    effort: ReasoningEffort,
): ReasoningBodyPatch => {
    const caps = detectWireCapabilities(config);
    if (caps.xaiEffort) {
        const value = XAI_EFFORT_MAP[effort];
        if (isRoutePinned('xai-effort', config.id)) {
            return { patch: {}, audit: { route: 'none', effort, applied: false, reason: 'xai route pinned off by a harness wire lesson (re-probe to clear)' } };
        }
        if (value) {
            return {
                patch: { reasoning_effort: value },
                audit: { route: 'xai-effort', effort, applied: true, reason: `reasoning_effort=${value}` },
            };
        }
        return { patch: {}, audit: { route: 'none', effort, applied: false, reason: 'xai route: effort=auto sends no knob' } };
    }
    if (caps.glmThinking) {
        if (isRoutePinned('glm-thinking', config.id)) {
            return { patch: {}, audit: { route: 'none', effort, applied: false, reason: 'glm route pinned off by a harness wire lesson (re-probe to clear)' } };
        }
        if (effort === 'auto') {
            return { patch: {}, audit: { route: 'none', effort, applied: false, reason: 'glm route: effort=auto sends no knob' } };
        }
        const enabled = effort !== 'low';
        const patch: Record<string, unknown> = { thinking: { type: enabled ? 'enabled' : 'disabled' } };
        const effortValue = GLM_EFFORT_MAP[effort];
        if (enabled && effortValue) patch.thinking_effort = effortValue;
        return {
            patch,
            audit: {
                route: 'glm-thinking',
                effort,
                applied: true,
                reason: enabled ? `thinking enabled (effort ${effortValue})` : 'thinking disabled (fast answer)',
            },
        };
    }
    if (caps.deepseekThinking) {
        if (isRoutePinned('deepseek-thinking', config.id)) {
            return { patch: {}, audit: { route: 'none', effort, applied: false, reason: 'deepseek route pinned off by a harness wire lesson (re-probe to clear)' } };
        }
        if (effort === 'auto') {
            return { patch: {}, audit: { route: 'none', effort, applied: false, reason: 'deepseek route: effort=auto sends no knob' } };
        }
        const enabled = effort !== 'low';
        const patch: Record<string, unknown> = { thinking: { type: enabled ? 'enabled' : 'disabled' } };
        const effortValue = DEEPSEEK_EFFORT_MAP[effort];
        if (enabled && effortValue) patch.reasoning_effort = effortValue;
        return {
            patch,
            audit: {
                route: 'deepseek-thinking',
                effort,
                applied: true,
                reason: enabled ? `thinking enabled (effort ${effortValue})` : 'thinking disabled (fast answer)',
            },
        };
    }
    if (caps.anthropicThinking) {
        // The messages body's thinking block is shim-owned (budget_tokens
        // assembly lives in GenericProviderService). Effort only signals the
        // intended tier; the shim decides eligibility. Report the intent so
        // the audit line explains a no-think rebuttal (budget below floor).
        return {
            patch: {},
            audit: {
                route: 'anthropic-thinking',
                effort,
                applied: false,
                reason: `shim-owned: effort=${effort} honored by thinking gate (budget_tokens route)`,
            },
        };
    }
    if (caps.responsesEffort) {
        if (isRoutePinned('responses-effort', config.id)) {
            return { patch: {}, audit: { route: 'none', effort, applied: false, reason: 'responses route pinned off by a harness wire lesson (re-probe to clear)' } };
        }
        const value = effort === 'max' ? 'high' : (effort as 'low' | 'medium' | 'high');
        if (effort !== 'auto') {
            return {
                patch: { reasoning: { effort: value } },
                audit: { route: 'responses-effort', effort, applied: true, reason: `reasoning.effort=${value}` },
            };
        }
        return { patch: {}, audit: { route: 'none', effort, applied: false, reason: 'responses route: effort=auto sends no knob' } };
    }
    return { patch: {}, audit: { route: 'none', effort, applied: false, reason: 'no verified reasoning route for this wire shape (fail closed)' } };
};

// ─── ChatRequestOptions surface ─────────────────────────────────────────────

declare module './GenericProviderService' {
    interface ChatRequestOptions {
        /** Harness reasoning tier for this call (P1/P2). 'auto' = legacy. */
        reasoningEffort?: ReasoningEffort;
        /** Audit sink — receives the applied-wire label per call (P5). */
        onWireAudit?: (entry: WireAuditEntry) => void;
    }
}

/**
 * Apply the reasoning patch to a chat-completions params object in place.
 * Returns the audit entry either way (P5 labels every call, applied or not).
 */
export const applyReasoningToChatParams = (
    config: Pick<ProviderConfig, 'id' | 'baseUrl' | 'apiFormat' | 'selectedModel'>,
    params: Record<string, unknown>,
    options?: Pick<ChatRequestOptions, 'reasoningEffort' | 'onWireAudit'>,
): WireAuditEntry => {
    const effort = options?.reasoningEffort ?? 'auto';
    const { patch, audit } = buildReasoningPatch(config, effort);
    for (const [key, value] of Object.entries(patch)) params[key] = value;
    options?.onWireAudit?.(audit);
    return audit;
};
