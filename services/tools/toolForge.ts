/**
 * ToolForge — model-authored desk tools, run through the same lifecycle
 * as skills: models PROPOSE, the harness HARDENS, evidence DECIDES,
 * and the user approves the one thing that needs a human — outbound
 * network access.
 *
 * A forged tool is a DECLARATIVE HTTP RECIPE, never executable code:
 *   { urlTemplate, method, headers, paramMapping, extractPath, ttlMs }
 * The model picks an endpoint + shape; the harness owns fetch, size caps,
 * timeouts, and the cache. No eval, no sandbox, no code from a model.
 */

import type { DeskToolDefinition, DeskToolCall, DeskToolResult } from '../analysis/DeskToolsService';

/** ToolForge request — what a model submits. */
export interface ToolForgeProposal {
    name: string;
    description: string;
    /** JSON-schema properties the model may pass (string/number/boolean). */
    parameters: Record<string, 'string' | 'number' | 'boolean'>;
    /** URL template with {param} slots, e.g. https://api.x.com/v1/{symbol}/depth */
    urlTemplate: string;
    method?: 'GET' | 'POST';
    /** Static headers (values must not embed {param} slots — keep secrets out of models). */
    headers?: Record<string, string>;
    /** How proposal parameters map onto URL template slots / query string. */
    paramMapping?: Record<string, string>;
    /** JSONPath-ish dot path to extract before returning (e.g. 'data.result'). */
    extractPath?: string;
    /** Cache TTL override (ms). Clamped to [5s, 10min]. */
    ttlMs?: number;
}

/** A forged tool as stored (keyed `custom_<slug>`). */
export interface ForgedTool {
    id: string;
    proposal: ToolForgeProposal;
    /** candidate → confirmed → retired. Only CONFIRMED tools are offered. */
    status: 'candidate' | 'confirmed' | 'retired';
    uses: number;
    /** Calls that returned usable content (ok + non-empty). */
    successes: number;
    createdAt: string;
    updatedAt: string;
    /** Provenance: which provider/model proposed it. */
    proposedBy?: string;
}

const KEY = 'desk_tools_forged_v1';
const FORGE_ALLOWED_METHODS = ['GET', 'POST'] as const;
/** URL length + response budget guards. */
const MAX_URL_LENGTH = 600;
const MAX_RESPONSE_CHARS = 2400;
const MIN_TTL_MS = 5_000;
const MAX_TTL_MS = 600_000;
const DEFAULT_TTL_MS = 30_000;

const slugify = (s: string): string =>
    s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);

const nowIso = (): string => new Date().toISOString();

// ── Validation / hardening (deterministic, no model output trusted) ──

export interface ForgeValidation { ok: boolean; errors: string[] }

/** Validate a proposal against the forge's hard rules. */
export const validateProposal = (p: ToolForgeProposal): ForgeValidation => {
    const errors: string[] = [];
    const nameOk = slugify(p.name || '');
    if (!nameOk) errors.push('name is required');
    if (!(p.description ?? '').trim()) errors.push('description is required');
    if (!p.urlTemplate || !/^https:\/\//i.test(p.urlTemplate.trim())) {
        errors.push('urlTemplate must be an https:// URL template');
    }
    if ((p.urlTemplate ?? '').length > MAX_URL_LENGTH) errors.push(`urlTemplate exceeds ${MAX_URL_LENGTH} chars`);
    try {
        const u = new URL(p.urlTemplate);
        // SSRF guard: no credentials, no private/localhost hosts.
        if (u.username || u.password) errors.push('urlTemplate must not embed credentials');
        if (u.port === '22' || /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|::1)/.test(u.hostname)) {
            errors.push('urlTemplate must point at a public host');
        }
    } catch { errors.push('urlTemplate is not a valid URL'); }
    const method = (p.method ?? 'GET').toUpperCase();
    if (!FORGE_ALLOWED_METHODS.includes(method as 'GET' | 'POST')) errors.push('method must be GET or POST');
    for (const [k, v] of Object.entries(p.headers ?? {})) {
        if (/\{[a-zA-Z]+\}/.test(v)) errors.push(`header "${k}" must not embed {param} slots`);
        if (/cookie|authorization/i.test(k) === false && /bearer|secret|token/i.test(v)) {
            // Non-auth headers carrying token-looking values are a leak vector.
            errors.push(`header "${k}" looks like it carries a secret`);
        }
    }
    for (const v of Object.values(p.parameters ?? {})) {
        if (!['string', 'number', 'boolean'].includes(v)) errors.push('parameters must be string/number/boolean types');
    }
    return { ok: errors.length === 0, errors };
};

/** Expand `{param}` slots in a template; unknown slots resolve to ''. */
const expandTemplate = (template: string, args: Record<string, unknown>): string =>
    template.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (_, key) => {
        const v = args[key];
        return v === undefined || v === null ? '' : encodeURIComponent(String(v));
    });

/** Extract a dot path from parsed JSON ('data.result.0.price'). */
const extractDotPath = (data: unknown, path?: string): unknown => {
    if (!path) return data;
    return path.split('.').reduce<unknown>((acc, seg) => {
        if (acc === null || acc === undefined) return undefined;
        if (Array.isArray(acc)) return acc[Number(seg)];
        if (typeof acc === 'object') return (acc as Record<string, unknown>)[seg];
        return undefined;
    }, data);
};

/** Build the DeskToolDefinition a provider sees (OpenAI function shape). */
export const forgedToolDefinition = (t: ForgedTool): DeskToolDefinition => ({
    type: 'function',
    function: {
        name: t.id,
        description: t.proposal.description.slice(0, 400),
        parameters: {
            type: 'object',
            properties: Object.fromEntries(
                Object.entries(t.proposal.parameters ?? {}).map(([k, typ]) => [k, { type: typ }]),
            ),
            required: Object.keys(t.proposal.parameters ?? {}),
            additionalProperties: false,
        },
    },
});

/** All confirmed forged tools as definitions (merged into the desk set). */
export const confirmedForgedToolDefinitions = (tools?: ForgedTool[]): DeskToolDefinition[] =>
    (tools ?? loadForgedTools()).filter(t => t.status === 'confirmed').map(forgedToolDefinition);

// ── Execution (the harness runs the recipe; never the model) ──

/**
 * Execute a forged-tool call. Returns null when `name` is not a forged
 * tool (the desk executor falls through to the built-ins).
 */
export const executeForgedTool = async (
    name: string,
    call: DeskToolCall,
    signal?: AbortSignal,
    tools?: ForgedTool[],
): Promise<DeskToolResult | null> => {
    if (!name.startsWith('custom_')) return null;
    const tool = (tools ?? loadForgedTools()).find(t => t.id === name);
    if (!tool || tool.status !== 'confirmed') {
        return { toolCallId: call.id, name, ok: false, content: `${name} is not an approved tool` };
    }
    // Per-call cache keyed like the desk cache (name + JSON args) with the
    // tool's own TTL — forged recipes hit slower third-party APIs.
    const cacheKey = `forged:${name}:${JSON.stringify(call.arguments ?? {})}`;
    const cached = forgedCache.get(cacheKey);
    const ttl = Math.min(MAX_TTL_MS, Math.max(MIN_TTL_MS, tool.proposal.ttlMs ?? DEFAULT_TTL_MS));
    if (cached && Date.now() - cached.at < ttl) {
        return { toolCallId: call.id, name, ok: true, content: cached.content };
    }
    try {
        const method = (tool.proposal.method ?? 'GET').toUpperCase();
        const url = expandTemplate(tool.proposal.urlTemplate, call.arguments ?? {});
        const queryEntries = Object.entries(tool.proposal.paramMapping ?? {})
            .map(([param, slot]) => [slot, (call.arguments ?? {})[param]] as const)
            .filter(([, v]) => v !== undefined && v !== null && v !== '');
        const qs = queryEntries.length
            ? `?${queryEntries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&')}`
            : '';
        const res = await fetch(`${url}${qs}`, {
            method,
            headers: { Accept: 'application/json', ...(tool.proposal.headers ?? {}) },
            signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = (await res.text()).slice(0, MAX_RESPONSE_CHARS * 4);
        let content: string;
        try {
            const parsed: unknown = JSON.parse(text);
            const extracted = extractDotPath(parsed, tool.proposal.extractPath);
            // A missing extractPath must not fail the call — fall back to
            // the full payload (JSON.stringify(undefined) is undefined,
            // which would otherwise crash .slice below).
            if (extracted === undefined) {
                content = typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2);
            } else {
                content = typeof extracted === 'string' ? extracted : JSON.stringify(extracted, null, 2);
            }
        } catch {
            content = text;
        }
        content = content.slice(0, MAX_RESPONSE_CHARS);
        if (!content.trim()) throw new Error('empty response');
        forgedCache.set(cacheKey, { at: Date.now(), content });
        recordForgedUse(name, true);
        return { toolCallId: call.id, name, ok: true, content };
    } catch (err) {
        recordForgedUse(name, false);
        return {
            toolCallId: call.id,
            name,
            ok: false,
            content: `${name} failed: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
};

const forgedCache = new Map<string, { at: number; content: string }>();

/** Clear the forged-tool result cache (tests, settings changes). */
export const clearForgedToolCache = (): void => { forgedCache.clear(); };

// ── Persistence + lifecycle (same store pattern as the roster) ──

const load = (): ForgedTool[] => {
    if (typeof window === 'undefined' || !window.localStorage) return [];
    try {
        const raw = window.localStorage.getItem(KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? (parsed as ForgedTool[]) : [];
    } catch { return []; }
};

const save = (items: ForgedTool[]): void => {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try { window.localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* quota — ignore */ }
};

export const loadForgedTools = (): ForgedTool[] => load();

/** Proposals can arrive mid-session — App listens and toasts. */
export const FORGED_PROPOSAL_EVENT = 'august:forged-proposal';

/**
 * Propose: validate + store as a CANDIDATE. Throws on invalid proposals —
 * the caller surfaces the errors; nothing invalid is ever stored.
 */
export const proposeForgedTool = (proposal: ToolForgeProposal, proposedBy?: string): ForgedTool => {
    const v = validateProposal(proposal);
    if (!v.ok) throw new Error(`Invalid tool proposal: ${v.errors.join('; ')}`);
    const id = `custom_${slugify(proposal.name)}`;
    const items = load().filter(t => t.id !== id);
    const tool: ForgedTool = {
        id,
        proposal,
        status: 'candidate',
        uses: 0,
        successes: 0,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        proposedBy,
    };
    save([...items, tool]);
    try {
        window.dispatchEvent(new CustomEvent(FORGED_PROPOSAL_EVENT, { detail: { id: tool.id, name: proposal.name } }));
    } catch { /* non-DOM envs — ignore */ }
    return tool;
};

/** The human gate: only a user action moves candidate → confirmed. */
export const approveForgedTool = (id: string): ForgedTool | undefined => {
    const items = load();
    const t = items.find(x => x.id === id);
    if (!t) return undefined;
    t.status = 'confirmed';
    t.updatedAt = nowIso();
    save(items);
    return t;
};

export const retireForgedTool = (id: string): ForgedTool | undefined => {
    const items = load();
    const t = items.find(x => x.id === id);
    if (!t) return undefined;
    t.status = 'retired';
    t.updatedAt = nowIso();
    save(items);
    return t;
};

export const deleteForgedTool = (id: string): void => save(load().filter(t => t.id !== id));

export const recordForgedUse = (id: string, ok: boolean): void => {
    const items = load();
    const t = items.find(x => x.id === id);
    if (!t) return;
    t.uses += 1;
    if (ok) t.successes += 1;
    t.updatedAt = nowIso();
    save(items);
};

/** Promotion evidence — reuse the skill shape: uses + success rate. */
export const forgedToolStats = (id: string): { uses: number; successRate: number } => {
    const t = load().find(x => x.id === id);
    return { uses: t?.uses ?? 0, successRate: t && t.uses > 0 ? t.successes / t.uses : 0 };
};
