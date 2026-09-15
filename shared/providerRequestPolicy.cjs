/**
 * providerRequestPolicy — the SINGLE source of truth for provider wire-request
 * policy, shared by all three transports:
 *
 *   · renderer   services/providers/GenericProviderService.ts (bundled by Vite;
 *                served ESM via the interop plugin in vite.config.ts)
 *   · dev proxy  vite.config.ts middleware (Node — direct import)
 *   · desktop    electron/main.cjs (CommonJS — plain require)
 *
 * Why a dependency-free .cjs: main.cjs cannot import TypeScript, the Vite
 * config runs under Node, and the renderer is bundled. Before this module the
 * wire policy was hand-built three times and HAD DRIFTED (Claude thinking-gate
 * regex, budget formula, messages temperature, LAN-HTTP host rules — see
 * .review/deep-dive-2026-09-15.md §"Providers / transport"). The semantics
 * below are the RENDERER's verified-correct behavior; every transport must
 * call these functions instead of re-deriving rules inline.
 *
 * Rules encoded here:
 *  - Extended-thinking gate + effort-scaled budget for Anthropic messages.
 *  - Messages-format temperature: explicit value or 0.7 default, OMITTED when
 *    thinking is active (Anthropic rejects temperature alongside thinking).
 *  - Gemini thinking params (includeThoughts + 8192 budget, unchanged).
 *  - Provider URL host policy: HTTPS only for remote hosts; plain HTTP is
 *    allowed for loopback, RFC1918 private LAN, and link-local addresses so
 *    keyless local servers (Ollama / LM Studio / llama.cpp) work identically
 *    on web, dev proxy, and the packaged desktop app.
 *  - isLocalBaseUrl — the "keyless = ready" exemption predicate.
 */

'use strict';
/* global URL, module */
// The project's eslint flat config grants Node globals only to
// electron/**/*.cjs; this file runs under Node (main.cjs require), the config
// loader (vite.config.ts), and the browser (via the vite-plugin interop), so
// the two ambient globals it touches are declared inline.

// ─── Extended thinking (Anthropic messages format) ──────────────────────────

/**
 * Thinking-capable Claude model ids. The `thinking` request block is only
 * valid on these — older Claude models 400 on it — so the gate is model-id
 * based (with a manual per-provider override, `thinkingCapable`). Covers the
 * 3.7 / 4 / 4.5 series AND the 5-series ids; the old proxy-side copies of
 * this regex lacked sonnet-5/opus-5, which silently disabled thinking on
 * desktop/dev for the same model that thinks in the browser. Single copy now.
 */
const EXTENDED_THINKING_MODEL_RE = /claude-(?:3-7|3\.7|sonnet-4|opus-4|haiku-4-5|sonnet-5|opus-5|4-5)/i;

/** Chain-of-thought budget as a fraction of max_tokens (kept below it). */
const THINKING_BUDGET_DEFAULT_FRACTION = 0.35;

/** Budget fraction per requested reasoning-effort tier — the messages
 *  transport has no native effort param, so Low/Medium/High/Max must actually
 *  change the thinking budget or the composer knob does nothing on Claude.
 *  'auto' and unknown tiers keep the historical default fraction. */
const THINKING_BUDGET_FRACTIONS = {
    low: 0.15,
    medium: 0.35,
    high: 0.55,
    max: 0.85,
};

/** Anthropic's own minimum is 1024; below that the block is rejected, and a
 *  request whose whole budget is that small is a connection test, not a
 *  reasoning call. */
const MIN_EFFECTIVE_THINKING_TOKENS = 1024;

/** Messages-format default temperature — matches chat_completions/responses
 *  (Anthropic's own API default is 1.0; leaving it unset made the same task
 *  sample at different values per format and polluted calibration data). */
const ANTHROPIC_DEFAULT_TEMPERATURE = 0.7;

/**
 * Whether a model id (or, secondarily, a provider/display name — helps proxy
 * routes whose model id is generic) is Claude-extended-thinking-capable.
 * `capabilityOverride` is the provider's manual `thinkingCapable` flag:
 * true = force thinking on, false = force off, undefined = decide by regex.
 *
 * @param {string} [modelId]
 * @param {string} [displayName]
 * @param {boolean} [capabilityOverride]
 * @returns {boolean}
 */
function isExtendedThinkingModel(modelId, displayName, capabilityOverride) {
    if (capabilityOverride === true) return true;
    if (capabilityOverride === false) return false;
    if (typeof modelId === 'string' && modelId && EXTENDED_THINKING_MODEL_RE.test(modelId)) return true;
    if (typeof displayName === 'string' && displayName && EXTENDED_THINKING_MODEL_RE.test(displayName)) return true;
    return false;
}

/**
 * Anthropic budget_tokens for a call: effort-scaled, clamped so that
 * MIN_EFFECTIVE_THINKING_TOKENS <= budget <= maxTokens - 1 (Anthropic
 * requires budget_tokens < max_tokens). Callers must only invoke this when
 * maxTokens exceeds the floor (see anthropicShouldSendThinking).
 *
 * @param {number} maxTokens
 * @param {string} [effort] 'low' | 'medium' | 'high' | 'max' | other = default
 * @returns {number}
 */
function claudeThinkingBudgetTokens(maxTokens, effort) {
    const fraction = Object.prototype.hasOwnProperty.call(THINKING_BUDGET_FRACTIONS, effort ?? '')
        ? THINKING_BUDGET_FRACTIONS[effort]
        : THINKING_BUDGET_DEFAULT_FRACTION;
    return Math.min(
        maxTokens - 1,
        Math.max(MIN_EFFECTIVE_THINKING_TOKENS, Math.floor(maxTokens * fraction)),
    );
}

/**
 * Whether to request extended thinking on an Anthropic messages call.
 * Gated on: not JSON mode (structured output and extended thinking are
 * mutually exclusive), the composer's explicit 'off' tier, enough headroom
 * for the 1024 <= budget < max_tokens constraint, and model eligibility
 * (regex list or the manual override).
 *
 * @param {{
 *   modelId?: string,
 *   displayName?: string,
 *   capabilityOverride?: boolean,
 *   maxTokens?: number,
 *   jsonMode?: boolean,
 *   reasoningEffort?: string,
 * }} input
 * @returns {boolean}
 */
function anthropicShouldSendThinking(input) {
    const opts = input || {};
    if (opts.jsonMode) return false;
    // The composer's explicit no-think toggle wins over the model gate.
    if (opts.reasoningEffort === 'off') return false;
    const maxTokens = opts.maxTokens === undefined ? 4096 : opts.maxTokens;
    // Connection tests still pass tiny maxTokens; below the floor thinking
    // is pointless (and budget_tokens could not stay under max_tokens).
    if (!(maxTokens > MIN_EFFECTIVE_THINKING_TOKENS)) return false;
    return isExtendedThinkingModel(opts.modelId, opts.displayName, opts.capabilityOverride);
}

/**
 * The two coupled messages-format body fields: temperature and thinking.
 * Returns the fields the transport must apply:
 *   - thinking active  → `{ temperature: undefined, thinking: {...} }`
 *     (Anthropic 400s on temperature while thinking is enabled),
 *   - otherwise        → `{ temperature: explicit ?? 0.7, thinking: undefined }`.
 *
 * @param {{
 *   modelId?: string,
 *   displayName?: string,
 *   capabilityOverride?: boolean,
 *   maxTokens?: number,
 *   temperature?: number,
 *   jsonMode?: boolean,
 *   reasoningEffort?: string,
 * }} input
 * @returns {{ temperature: number | undefined, thinking: { type: 'enabled', budget_tokens: number } | undefined }}
 */
function anthropicThinkingFields(input) {
    const opts = input || {};
    const maxTokens = opts.maxTokens === undefined ? 4096 : opts.maxTokens;
    const temperature = typeof opts.temperature === 'number' ? opts.temperature : ANTHROPIC_DEFAULT_TEMPERATURE;
    if (!anthropicShouldSendThinking({
        modelId: opts.modelId,
        displayName: opts.displayName,
        capabilityOverride: opts.capabilityOverride,
        maxTokens,
        jsonMode: opts.jsonMode,
        reasoningEffort: opts.reasoningEffort,
    })) {
        return { temperature, thinking: undefined };
    }
    return {
        temperature: undefined,
        thinking: { type: 'enabled', budget_tokens: claudeThinkingBudgetTokens(maxTokens, opts.reasoningEffort) },
    };
}

// ─── Gemini thinking ────────────────────────────────────────────────────────

/**
 * generationConfig.thinkingConfig for Google generateContent: chain of
 * thought is requested for gemini-ish models unless JSON mode is on (the
 * 8192 budget is the long-standing value; this encodes the renderer's rule
 * that an empty/unknown model still counts as "gemini-ish").
 *
 * @param {boolean} [jsonMode]
 * @param {string} [model]
 * @returns {{ includeThoughts: boolean, thinkingBudget: number } | undefined}
 */
function geminiThinkingParams(jsonMode, model) {
    if (jsonMode) return undefined;
    const id = String(model || '').toLowerCase();
    return /gemini|thinking/i.test(id || 'gemini')
        ? { includeThoughts: true, thinkingBudget: 8192 }
        : undefined;
}

// ─── Provider URL host policy ───────────────────────────────────────────────

/** Named loopback hosts accepted for plain-HTTP local model servers. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0']);

const isLoopbackIp = (hostname) => /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);
const isPrivateIp = (hostname) =>
    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
    /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(hostname);
const isLinkLocalIp = (hostname) => /^169\.254\.\d{1,3}\.\d{1,3}$/.test(hostname);

/**
 * Loopback / RFC1918 / link-local host test. Local model servers (Ollama,
 * LM Studio, llama.cpp…) are commonly served over plain HTTP on the loopback
 * OR another machine on the LAN — blocking the private ranges made those
 * setups unreachable, and the packaged app used to carry a stricter
 * localhost-only variant of this rule than the web app (the drift this
 * module removes).
 *
 * @param {string} hostname
 * @returns {boolean}
 */
function isPrivateOrLoopbackHost(hostname) {
    const host = String(hostname || '').toLowerCase();
    if (!host) return false;
    return LOCAL_HOSTS.has(host) || isLoopbackIp(host) || isPrivateIp(host) || isLinkLocalIp(host);
}

/**
 * Plain HTTP is allowed ONLY for hosts passing isPrivateOrLoopbackHost;
 * everything remote must be HTTPS.
 *
 * @param {string} hostname
 * @returns {boolean}
 */
function httpAllowedForHost(hostname) {
    return isPrivateOrLoopbackHost(hostname);
}

/**
 * The security core of the provider-URL policy: absolute http(s) URL, HTTPS
 * by default, HTTP only for private/loopback hosts, no embedded credentials.
 * Used for initial request URLs AND — critically — re-validated on every
 * manual redirect hop in the Electron main process (net.fetch defaults to
 * following redirects, which let a configured endpoint 302 the MAIN process
 * to internal/HTTP targets: SSRF). Query strings are NOT checked here:
 * legitimate redirect targets may carry them (initial URLs get the stricter
 * no-query treatment in the transports' own normalization).
 *
 * @param {string} rawUrl
 * @returns {boolean}
 */
function isSafeProviderTargetUrl(rawUrl) {
    let parsed;
    try {
        parsed = new URL(String(rawUrl || '').trim());
    } catch {
        return false;
    }
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isPrivateOrLoopbackHost(parsed.hostname))) {
        return false;
    }
    if (parsed.username || parsed.password) return false;
    return true;
}

/**
 * Whether a provider baseUrl points at a local/LAN model server that needs
 * no API key (Ollama / LM Studio / llama.cpp). Empty keys are accepted for
 * these hosts by the readiness predicates and by desktop discovery.
 * Returns false for unparseable URLs.
 *
 * @param {string} baseUrl
 * @returns {boolean}
 */
function isLocalBaseUrl(baseUrl) {
    try {
        const parsed = new URL(String(baseUrl || '').trim());
        return isPrivateOrLoopbackHost(parsed.hostname);
    } catch {
        return false;
    }
}

const PROVIDER_REQUEST_POLICY = {
    isExtendedThinkingModel,
    claudeThinkingBudgetTokens,
    anthropicShouldSendThinking,
    anthropicThinkingFields,
    geminiThinkingParams,
    isPrivateOrLoopbackHost,
    httpAllowedForHost,
    isSafeProviderTargetUrl,
    isLocalBaseUrl,
    EXTENDED_THINKING_MODEL_RE,
    MIN_EFFECTIVE_THINKING_TOKENS,
    ANTHROPIC_DEFAULT_TEMPERATURE,
    THINKING_BUDGET_FRACTIONS,
};

// CommonJS export guarded so the SAME file also loads in the browser once
// vite.config.ts's interop plugin appends the ESM re-export (the guard keeps
// `module.exports = …` from throwing in an ES-module context where `module`
// is undeclared). electron/main.cjs and vitest consume it as plain CJS.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PROVIDER_REQUEST_POLICY;
}
