import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * A store whose owner calls `localStorage.setItem` itself never touches
 * `PreferencesService`, and on Capacitor the WebView's localStorage and
 * Capacitor Preferences (SharedPreferences/UserDefaults) are two different
 * places. So for those keys the export read and the restore write have to be
 * aimed at localStorage BY HAND — `getPreferenceObject` cannot see them and
 * `setPreferenceObject` puts them where nothing looks. That aiming is two
 * literal lists in ExportService (`RAW_LOCAL_STORAGE_PREFIXES`, which drives
 * both, plus the restore allow-list), and a list nobody re-checks is a list
 * that rots: six learning stores and two extras were in exactly this state,
 * including the trader's "supervisor OFF" consent, whose default is ON
 * (`supervisorStore.ts:84`) — so a restore silently re-enabled it.
 *
 * This is the re-check. It scans the source for real `localStorage.*Item` call
 * sites, resolves the key each one writes through its local constant, and fails
 * when that namespace is on neither allow-list — exactly the "ships a backup
 * entry the app then refuses to take back" state.
 *
 * Deliberately a SCAN, not a runtime trace: jsdom mounts components and cannot
 * see a store no test happens to exercise, and the drift is a fact about the
 * source (which registration did I forget?), not about a code path.
 *
 * It resolves the shapes these writers actually use — a literal, a module
 * constant, a `const key = (u) => \`ns_${u}\`` builder, a nested
 * `${PREFIX}_${u}`, `PREF_KEYS.X` — and stops where a human would: a key whose
 * NAMESPACE ITSELF is a parameter (`${prefix}_${user}`, agentRoster's shared
 * reader) is judged by whether the file that builds it declares an allow-listed
 * namespace, which it must, to be readable at all.
 */

// ExportService pulls the Capacitor plugins at import load; stub them so this
// suite exercises the two matchers without touching a native bridge. The
// assertions run against the PRODUCTION matchers, never a copy of the lists —
// a second copy in a test is exactly the thing that drifts.
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock('@capacitor/preferences', () => ({
    Preferences: { get: vi.fn(), set: vi.fn(), remove: vi.fn(), keys: vi.fn() },
}));
vi.mock('@capacitor/share', () => ({ Share: { share: vi.fn(), canShare: vi.fn() } }));
vi.mock('@capacitor/filesystem', () => ({
    Filesystem: { writeFile: vi.fn() }, Directory: {}, Encoding: {},
}));

import { isRawLocalStorageKey, isRestorablePreferenceKey } from '../services/infrastructure/ExportService';

/** The abstraction itself: its localStorage IS Preferences' web fallback. */
const ABSTRACTION_OWNERS = new Set([
    'services/infrastructure/PreferencesService.ts',
    'services/infrastructure/ExportService.ts',
]);

const SOURCE_ROOTS = ['services', 'utils', 'hooks', 'components', 'contexts', 'schemas', 'constants', 'shared'];
const SOURCE_FILES = ['App.tsx', 'index.tsx'];

const walk = (dir: string): string[] => {
    if (!statSync(dir, { throwIfNoEntry: false })) return [];
    return readdirSync(dir).flatMap(name => {
        const full = join(dir, name).replace(/\\/g, '/');
        return statSync(full).isDirectory() ? walk(full) : [full];
    });
};

const SOURCES = [...SOURCE_ROOTS.flatMap(walk), ...SOURCE_FILES]
    .filter(p => /\.tsx?$/.test(p))
    .filter(p => !/\.(test|spec)\./.test(p))
    .filter(p => !ABSTRACTION_OWNERS.has(p));

/**
 * Namespaces deliberately NOT on an allow-list, each with the reason it is
 * allowed to be absent. They live here rather than in ExportService on
 * purpose: the WebView origin quota is shared, and shadow-copying a value that
 * is UI furniture spends eviction-prone bytes on a copy nothing reads.
 *
 * A NEW store is not exempt by default — it has to be argued into this table.
 */
const DELIBERATELY_UNBACKED = new Map<string, string>([
    // Already documented at ExportService's restore allow-list: stored as PLAIN
    // strings, so the export sweep's JSON read can never carry them, and
    // allowing them would open a write-path whose value the readers ignore.
    ['august_surface_v1', 'plain string (which surface is showing), not JSON — the sweep cannot read it'],
    ['august_update_notes_seen_v1', 'plain string: "the release-notes modal was dismissed"'],
    ['august_trade_mode_v1', 'plain string ("ai" | "grid" | …) — view state, not a record'],
    ['trade_dock_width_v1', 'plain string pixel width — view state'],
    ['learn_tab_v1', 'plain string: which Learn tab is open — view state'],
    ['agents_rail_collapsed_v1', 'plain string "1"/"0" — view state'],
    ['august_model_picker_free_only_v1', 'plain string "1"/"0" — device-local model-picker filter'],
    ['agent_pins_v1', 'per-user pinned agents — UI layout, rebuildable from the roster'],
    ['skills_grid_pins_v1', 'pinned strategies on the Skills grid — UI layout, rebuilt from the catalog'],
    // JSON, and arguably real data. NOT backed up today; listed so the gap is
    // visible and re-decidable instead of invisible. Not this change's call.
    ['approval_rules_v1', 'NOT backed up: the inbox rules gate every auto-apply — worth a decision'],
    ['trade_session_model_v1', 'NOT backed up: per-session chart model overlay; sibling trade_session_drawings_v1_ IS allow-listed'],
]);

/** Same scoping the service uses: exact, `<ns>_<user>`, or `<ns>:<user>`. */
const underNamespace = (shape: string, ns: string): boolean =>
    shape === ns || shape.startsWith(`${ns}_`) || shape.startsWith(`${ns}:`);

const isBackedUp = (shape: string): boolean => isRawLocalStorageKey(shape) || isRestorablePreferenceKey(shape);

/**
 * The gap this file was written to catch, and did not.
 *
 * `isBackedUp` ORs the two lists, and for a store whose owner ONLY ever talks to
 * `localStorage` that is wrong: `skill_drafts_v1` and `learning_proposals_v1`
 * were on the RESTORE allow-list but absent from `RAW_LOCAL_STORAGE_PREFIXES`,
 * so every check passed while the export sweep read a Preferences copy that
 * nothing writes — and the restore mirror put it back where nothing reads.
 * ExportService says it plainly: a key missing from the raw list "does not
 * merely fail to restore, it exports the wrong bytes".
 *
 * The discriminator is whether the OWNER ever touches Preferences. A store that
 * goes through `PreferencesService` is right to be restore-listed only — its
 * localStorage key is that service's web fallback, not a second home. A store
 * that never mentions it has exactly one home, and that home has to be declared.
 */
const PREFERENCES_TOUCH = /PreferencesService|getPreference(?:Object|Array)?\(|setPreference(?:Object|Array)?\(/;
const ownerUsesPreferences = (path: string): boolean => PREFERENCES_TOUCH.test(readFileSync(path, 'utf8'));

/** Only a WRITE claims ownership. A lone `getItem` of someone else's key must
 *  not be held to the raw list by the file that happens to read it. */
const isWriteSite = (site: CallSite): boolean => site.method !== 'get';

/**
 * The backlog the rule below exposes, NOT an endorsement.
 *
 * Enforcing "a localStorage-only owner must be on the raw list" surfaced 18
 * namespaces in the same hole `skill_drafts_v1` was in — all but unbacked on
 * mobile, or backed as a copy nothing reads. `skill_drafts_v1` and
 * `learning_proposals_v1` were registered because Step A named them; the rest
 * need an owner's decision rather than a sweeping `RAW_LOCAL_STORAGE_PREFIXES`
 * widening, because the WebView origin quota is SHARED and AGENTS.md forbids
 * shadow-copying a value nothing reads to feel safe.
 *
 * TRADING DATA — should almost certainly be registered (decide first):
 *   desk_tools_forged_v1 (user/model-authored HTTPS tools),
 *   trade_drawings_v1_*, trade_chat_sessions_v1_*, trade_chat_active_v1_*,
 *   trade_level_arms_v1_*, trade_level_hits_v1_*, trade_watches_v1_*,
 *   trading_checklist_v1, harness_settings_v1, trade_tf_bar_v1_*
 * FURNITURE / TELEMETRY — plausibly right to stay unbacked:
 *   last_active_user (a plain string pointer), desk_idle_motion_v1_*,
 *   desk_role_overrides_v1_*, desk_room_layout_v1_*_*, thinking_leak_bin_v1,
 *   lastPromiseError, lastGlobalError, lastCrashError
 *
 * A NEW store cannot be added here by reflex: it has to say which of the two it
 * is, and the test below fails if an entry gets registered for real.
 */
const AWAITING_BACKUP_DECISION = new Map<string, string>([
    ['desk_idle_motion_v1', 'furniture: reduced-motion preference'],
    ['desk_role_overrides_v1', 'furniture: per-room role overrides'],
    ['desk_room_layout_v1', 'furniture: room layout'],
    ['last_active_user', 'a plain string pointer, not a record'],
    // Registered in step 9 (2026-10-05): `trade_watches_v1`,
    // `trade_level_arms_v1`, `trade_level_hits_v1`, `trade_drawings_v1`,
    // `trade_session_drawings_v1`, `desk_tools_forged_v1`, `trading_checklist_v1`,
    // `trade_tf_bar_v1`, `trade_chat_sessions_v1` (images stripped at export) and
    // `harness_settings_v1` — which is NOT Preferences-owned as this file assumed:
    // `utils/harnessSettings.ts:79` writes localStorage directly, and an export
    // with an empty Preferences store proved it was absent from every backup.
    // `trade_tool_payloads_v1` too — the real tool output behind an expanded
    // transcript row (`services/trade/toolPayloadStore.ts`), written straight
    // through localStorage once per tool call.
    ['trade_chat_active_v1', 'TRADING POINTER, still unbacked on purpose: chatStore.ts:160 writes a PLAIN string (a session id), which the sweep cannot JSON.parse, so it exports nothing — and mirroring a parsed value back would write `"s-1"` where the owner reads `s-1`. Needs a raw-string envelope in the backup format, not a prefix entry.'],
    ['thinking_leak_bin_v1', 'telemetry: withheld reasoning bin'],
    ['lastPromiseError', 'crash breadcrumb'],
    ['lastGlobalError', 'crash breadcrumb'],
    ['lastCrashError', 'crash breadcrumb'],
]);

const awaitsDecision = (shape: string): boolean =>
    [...AWAITING_BACKUP_DECISION.keys()].some(ns => underNamespace(shape, ns));
const isExempt = (shape: string): boolean => [...DELIBERATELY_UNBACKED.keys()].some(ns => underNamespace(shape, ns));

interface CallSite {
    path: string;
    line: number;
    /** Resolved key shape: literal text with unresolvable parts as `*`. */
    shape: string;
    /** The source expression, for the failure message. */
    expr: string;
    /** Which localStorage call it is — only a WRITE claims a store's home. */
    method: 'get' | 'set' | 'remove';
}

/** PREF_KEYS is read out of the source rather than imported: importing
 *  PreferencesService for a constant is a whole Capacitor mock to maintain. */
const PREF_KEYS: Record<string, string> = (() => {
    const src = readFileSync('services/infrastructure/PreferencesService.ts', 'utf8');
    const start = src.indexOf('export const PREF_KEYS');
    const out: Record<string, string> = {};
    for (const m of src.slice(start).matchAll(/^\s{4}([A-Z0-9_]+):\s*'([^']+)'/gm)) out[m[1]] = m[2];
    return out;
})();

/** Every string-initialised constant in a file: the key constants the call
 *  sites are written against, and the namespaces a dynamic key is built from.
 *  Two forms, because both are idiomatic here — `const KEY = 'ns_v1'` and
 *  `const key = (u: string): string => \`ns_v1_${u}\`` (often wrapped onto the
 *  next line by the return type). */
const constantsOf = (src: string): Map<string, string> => {
    const out = new Map<string, string>();
    for (const m of src.matchAll(/(?:^|\n)\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]*)?=\s*'([^']*)'/g)) {
        out.set(m[1], m[2]);
    }
    // `[^;`']` so the initializer's own quoted defaults (`|| 'default'`) cannot
    // end the search early, and a `const CLASS = 'text-ui-xs …'` style string
    // can never be mistaken for a key.
    for (const m of src.matchAll(/(?:^|\n)\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*[^;`']{0,200}?`([^`]*)`/g)) {
        if (!out.has(m[1])) out.set(m[1], m[2]);
    }
    for (const m of src.matchAll(/(?:^|\n)\s*([A-Z][A-Z0-9_]*)\s*=\s*'([^']*)'/g)) {
        if (!out.has(m[1])) out.set(m[1], m[2]);
    }
    return out;
};

/** Replace a template's `${…}` with the constant's text, or `*` when it is an
 *  expression this scan does not evaluate (a username, a `.trim()` chain). */
const expandTemplate = (tpl: string, consts: Map<string, string>): string => {
    let out = tpl;
    // Two passes, so a constant that is itself a template resolves too.
    for (let pass = 0; pass < 2; pass++) {
        out = out.replace(/\$\{([^}]*)\}/g, (_full, expr: string) => {
            const id = expr.trim().match(/^([A-Za-z_$][\w$.]*)$/)?.[1];
            if (!id) return '*';
            if (id.startsWith('PREF_KEYS.')) return PREF_KEYS[id.slice('PREF_KEYS.'.length)] ?? '*';
            const value = consts.get(id);
            return value === undefined ? '*' : value;
        });
    }
    return out;
};

const unquote = (value: string): string => value.replace(/^`|`$/g, '');

/**
 * The first argument of a call, parentheses and template substitutions
 * balanced. A plain `[^)]*` capture stops at the `)` of `AUTO_KEY(user)` and
 * silently loses the call site, which is most of them.
 */
const firstArgument = (src: string, open: number): string => {
    let depth = 0;
    let inTemplate = false;
    let i = open + 1;
    for (; i < src.length; i++) {
        const c = src[i];
        if (inTemplate) {
            if (c === '\\') { i++; continue; }
            if (c === '`') inTemplate = false;
            continue;
        }
        if (c === '`') { inTemplate = true; continue; }
        if (c === '(' || c === '{') { depth++; continue; }
        if (c === ')' || c === '}') {
            if (depth === 0) break;
            depth--;
            continue;
        }
        if (c === ',' && depth === 0) break;
    }
    return src.slice(open + 1, i).trim();
};

/** Constants declared in exactly ONE scanned file, by their exported name.
 *  The last resort for a key constant that lives in another module
 *  (`PIN_STORAGE_KEY` in StrategyStudio). Restricted to `export const` +
 *  unique-by-name, because a global map of unexported names would collide on
 *  `KEY` / `STORAGE_KEY` and resolve to whichever file the walk saw last. */
const UNIQUE_EXPORTS = ((): Map<string, string> => {
    const seen = new Map<string, { value: string; files: number }>();
    for (const path of SOURCES) {
        const src = readFileSync(path, 'utf8');
        for (const [name, value] of constantsOf(src)) {
            if (!new RegExp(`(?:^|\\n)\\s*export\\s+const\\s+${name}\\b`).test(src)) continue;
            const hit = seen.get(name);
            if (hit) hit.files += 1;
            else seen.set(name, { value, files: 1 });
        }
    }
    const out = new Map<string, string>();
    for (const [name, hit] of seen) if (hit.files === 1) out.set(name, hit.value);
    return out;
})();

/** Best-effort resolution of a `localStorage.*Item` first argument. Returns
 *  `'*'` for a key this scan genuinely cannot follow (the name is a parameter),
 *  so the caller can judge it by the file instead of dropping it silently. */
const resolveKey = (expr: string, consts: Map<string, string>): string => {
    const trimmed = expr.trim();

    const literal = trimmed.match(/^'([^']*)'$/);
    if (literal) return literal[1];

    if (trimmed.startsWith('`') && trimmed.endsWith('`')) {
        return expandTemplate(unquote(trimmed), consts);
    }

    const pref = trimmed.match(/^PREF_KEYS\.([A-Z0-9_]+)$/);
    if (pref) return PREF_KEYS[pref[1]] ?? '*';

    const direct = consts.get(trimmed) ?? UNIQUE_EXPORTS.get(trimmed);
    if (direct !== undefined) return expandTemplate(unquote(direct), consts);

    // `storageKey(user)` and `${storageKey(user)}` → the builder's template.
    const call = trimmed.match(/^(?:\$\{)?([A-Za-z_$][\w$]*)\([^)]*\)(?:\})?$/);
    if (call) {
        const builder = consts.get(call[1]);
        if (builder !== undefined) return expandTemplate(unquote(builder), consts);
    }

    return '*';
};

const CALL_SITE = /(?:window\.|globalThis\.)?localStorage\.(?:getItem|setItem|removeItem)\(/g;

const scan = (): CallSite[] => SOURCES.flatMap(path => {
    const src = readFileSync(path, 'utf8');
    const consts = constantsOf(src);
    const found: CallSite[] = [];
    for (const m of src.matchAll(CALL_SITE)) {
        const expr = firstArgument(src, m.index + m[0].length - 1);
        found.push({
            path,
            line: src.slice(0, m.index).split('\n').length,
            shape: resolveKey(expr, consts),
            expr,
            method: m[0].includes('.setItem(') ? 'set' : m[0].includes('.removeItem(') ? 'remove' : 'get',
        });
    }
    return found;
});

const describesAnAllowListedNamespace = (path: string): boolean => {
    const consts = constantsOf(readFileSync(path, 'utf8'));
    return [...consts.values()].some(v => isBackedUp(unquote(v)));
};

describe('every raw-localStorage store is registered in ExportService', () => {
    const sites = scan();

    it('finds the call sites at all (a scan that resolved nothing proves nothing)', () => {
        // Floors, not exact counts: they catch a broken walker or matcher
        // without failing every time a store is added or removed.
        expect(sites.length).toBeGreaterThan(40);
        expect(new Set(sites.map(s => s.shape)).size).toBeGreaterThan(20);
        // …and the list is not a no-op: the matches below are non-empty.
        expect(sites.filter(s => isBackedUp(s.shape)).length).toBeGreaterThan(20);
        // PREF_KEYS is parsed out of the source with an indentation-sensitive
        // regex; if that ever stops matching, every `PREF_KEYS.X` call site
        // would degrade to `*` and the scan would quietly pass.
        // Floor was 30; six definition-only keys (PROVIDER_PAIR_STATS,
        // INVALIDATION_RULES, POST_MORTEM_INSIGHTS, LEARNING_WRITE_APPROVAL,
        // LEARNING_PENDING_RULES, PRICE_ALERTS) were deleted — nothing in the
        // app ever wrote them, and they were in the export sweep purely because
        // they were listed here. 24 keeps the guard real without pinning it to
        // the exact size of a table whose job is to shrink.
        expect(Object.keys(PREF_KEYS).length).toBeGreaterThan(24);
    });

    it('registers every key whose owner writes localStorage directly', () => {
        const offenders = sites
            .filter(s => !isBackedUp(s.shape) && !isExempt(s.shape))
            // A key whose NAMESPACE is a parameter cannot be resolved here;
            // its file has to declare an allow-listed namespace to be readable.
            .filter(s => !(s.shape.startsWith('*') && describesAnAllowListedNamespace(s.path)))
            .map(s => `${s.path}:${s.line}  ${s.expr}  →  ${s.shape}`);
        expect(offenders).toEqual([]);
    });

    it('puts a store whose only home is localStorage on the RAW list', () => {
        // The half the test above cannot see: passing `isBackedUp` on the
        // restore list alone still exports the wrong bytes.
        const offenders = sites
            .filter(isWriteSite)
            .filter(s => !isRawLocalStorageKey(s.shape))
            .filter(s => !isExempt(s.shape))
            .filter(s => !awaitsDecision(s.shape))
            .filter(s => !ownerUsesPreferences(s.path))
            .filter(s => !(s.shape.startsWith('*') && describesAnAllowListedNamespace(s.path)))
            .map(s => `${s.path}:${s.line}  ${s.expr}  →  ${s.shape}`);
        expect(offenders).toEqual([]);
    });

    it('is still watching: the new rule has real call sites behind it', () => {
        // Guard the guard. If every write site became exempt, or the
        // Preferences test started matching every file, the rule above would
        // pass vacuously — the exact failure mode this whole file exists for.
        const writes = sites.filter(isWriteSite);
        expect(writes.length).toBeGreaterThan(10);
        expect(writes.filter(s => isRawLocalStorageKey(s.shape)).length).toBeGreaterThan(5);
        // The backlog is doing real work: without it the rule above would be
        // enforcing nothing, and it must shrink rather than grow. Step 9 registered
        // nine trading namespaces, so this asserts BOTH directions — it came down
        // from the 17 this file recorded, and it is still a real list, not an empty
        // one kept to make the rule above pass vacuously.
        const backlogNamespaces = new Set(sites
            .filter(isWriteSite)
            .filter(s => !isRawLocalStorageKey(s.shape) && !isExempt(s.shape) && awaitsDecision(s.shape))
            .map(s => s.shape));
        expect(backlogNamespaces.size).toBeGreaterThan(5);
        expect(backlogNamespaces.size).toBeLessThan(17);
    });

    it('drops a backlog entry once the namespace is actually registered', () => {
        // Stops the list rotting into a second set of exemptions nobody revisits.
        expect([...AWAITING_BACKUP_DECISION.keys()].filter(isRawLocalStorageKey)).toEqual([]);
    });

    it('admits a key off both lists only with a stated reason', () => {
        // Guards the escape hatch: an exemption with no justification is
        // indistinguishable from a store nobody looked at.
        expect([...DELIBERATELY_UNBACKED.values()].filter(v => v.trim().length < 8)).toEqual([]);
    });

    it('does not exempt a namespace the app actually backs up', () => {
        // An exemption for a key that IS allow-listed means the table went
        // stale when someone added the prefix — remove it, do not keep it.
        expect([...DELIBERATELY_UNBACKED.keys()].filter(isBackedUp)).toEqual([]);
    });
});
