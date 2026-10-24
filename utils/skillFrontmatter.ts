/**
 * skillFrontmatter — the ONE vocabulary of SKILL.md frontmatter keys.
 *
 * The parser (`SkillMemoryService.parseSkillMarkdown`) and the serializer
 * (`serializeSkill`) both read this list, so a key can never be "known" to one
 * and "unknown" to the other — which is exactly the drift that would silently
 * drop a third-party key on rewrite. Keys the app has semantics for are known;
 * everything else (author, license, `metadata.hermes.*`, …) is captured
 * VERBATIM and re-emitted verbatim, because a rewrite that eats a key the
 * importer's author put there is data loss the next import round-trip turns
 * into a diff the user cannot explain.
 */

/** Every key the app parses or serializes on its own behalf. */
export const KNOWN_SKILL_FRONTMATTER_KEYS: ReadonlySet<string> = new Set([
    // the portable face
    'name', 'description', 'version', 'kind', 'coin', 'timeframe', 'source',
    'direction', 'family', 'regime', 'ifCondition', 'predicate', 'thenAction',
    'strategyFamily', 'signals', 'invalidation', 'horizon', 'sizing', 'prior',
    'audience', 'compatibility',
    // provenance
    'approvedBy', 'approvedAt', 'whyAccepted', 'reason',
    'originBotId', 'originBotName', 'originMessageId',
    // the ledger face
    'status', 'wins', 'losses', 'sample', 'consecutiveLosses', 'recentOutcomes',
    'netR', 'grossR', 'netRKnown', 'netRUnknown', 'rSampled', 'tradeIds',
    'evidenceCount', 'birthEvidence', 'lastEvidenceAt', 'shadow', 'suspendedAt',
    'disabledByUser', 'prediction', 'supersededBy', 'revisedAt',
    // The rest of the ledger face `serializeSkill` writes. Without these, a
    // rewrite reads its OWN output back as third-party keys, appends them
    // verbatim, and writes the ledger field a second time — every rewrite
    // grew another copy of `modified:` and the eval/history fields.
    'manualOnly', 'modified', 'evalVerdict', 'lastEvalAt', 'refinedAt',
    'lastMatchedAt', 'evalStreak', 'controlIds', 'controlWins', 'controlLosses',
    'overriddenIds', 'crossRegimeIds', 'regimeStats', 'claimTestedEvidence',
    'history', 'previousVersion',
]);

/**
 * The raw lines of every UNKNOWN top-level key, verbatim, in file order —
 * including the key line itself and any indented block that belongs to it
 * (that is how `metadata:` + its nested map survive). Comment lines and blank
 * lines are not captured: they are formatting, not data, and re-emitting them
 * could duplicate a decorative rule the app's own writer also draws.
 */
export const captureUnknownFrontmatter = (fm: string): string[] => {
    const lines = fm.split(/\r?\n/);
    const captured: string[] = [];
    let inUnknown: string | null = null;
    for (const line of lines) {
        const top = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):/);
        if (top) {
            inUnknown = KNOWN_SKILL_FRONTMATTER_KEYS.has(top[1]) ? null : top[1];
            if (inUnknown) captured.push(line);
            continue;
        }
        // Indented or list content belongs to whatever key is open.
        if (inUnknown && (/^[ \t]/.test(line) || /^-\s/.test(line))) captured.push(line);
    }
    return captured;
};

/** The spec's name rule: lowercase, digits, hyphens; starts alphanumeric; ≤64. */
export const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export const SKILL_NAME_MAX = 64;
export const SKILL_DESCRIPTION_MAX = 1024;

/**
 * Face validation for import and discovery. Returns one issue per problem, in
 * the caller's display vocabulary — empty array means the face is valid. A
 * skill with issues is SKIPPED with these reasons logged, never silently
 * filtered and never allowed to break discovery of the others.
 */
export const skillFaceIssues = (face: { name: string; description: string; body: string }): string[] => {
    const issues: string[] = [];
    if (!face.name || !face.name.trim()) issues.push('missing required name');
    else if (face.name.length > SKILL_NAME_MAX) issues.push(`name longer than ${SKILL_NAME_MAX} chars`);
    else if (!SKILL_NAME_PATTERN.test(face.name)) issues.push('name must be lowercase letters, digits and hyphens');
    if (!face.description || !face.description.trim()) issues.push('missing required description');
    else if (face.description.length > SKILL_DESCRIPTION_MAX) issues.push(`description longer than ${SKILL_DESCRIPTION_MAX} chars`);
    if (!face.body || !face.body.trim()) issues.push('empty body');
    return issues;
};

/**
 * `platforms:` values this app understands, mapped onto the three runtimes it
 * actually has (browser, Electron desktop, Capacitor mobile). Anything else
 * (freebsd, …) is unmapped — an all-unmapped list states no constraint for a
 * runtime we ship, which is the tolerant reading, not the silent-drop one.
 */
export type SkillRuntime = 'web' | 'desktop' | 'mobile';

export const PLATFORM_OF: Readonly<Record<string, SkillRuntime>> = {
    web: 'web',
    webui: 'web',
    browser: 'web',
    desktop: 'desktop',
    electron: 'desktop',
    macos: 'desktop',
    mac: 'desktop',
    linux: 'desktop',
    windows: 'desktop',
    native: 'mobile',
    android: 'mobile',
    ios: 'mobile',
    mobile: 'mobile',
};

/**
 * Invocation control, enforced: does THIS runtime satisfy the skill's declared
 * compatibility? `platforms` hides a skill on runtimes it does not name;
 * `requiresTools` hides it when the desk does not expose a tool it needs;
 * `requiresEnv` hides it always in a renderer — there is no honest way to
 * verify an environment variable from the app's process, and a constraint
 * that cannot be checked must fail closed, not pass silently. Absent
 * compatibility = no constraint, exactly as before the key existed.
 */
export const skillRunsHere = (
    compat: { platforms?: string[]; requiresTools?: string[]; requiresEnv?: string[] } | undefined,
    runtime: SkillRuntime,
    availableTools: ReadonlySet<string> | readonly string[],
): boolean => {
    if (!compat) return true;
    if (compat.requiresEnv && compat.requiresEnv.length > 0) return false;
    if (compat.platforms?.length) {
        const mapped = compat.platforms.map(p => PLATFORM_OF[(p || '').toLowerCase()]).filter(Boolean);
        // Only entries that map count: [freebsd] is unreadable, not refused.
        if (mapped.length > 0 && !mapped.includes(runtime)) return false;
    }
    if (compat.requiresTools?.length) {
        const have = availableTools instanceof Set ? availableTools : new Set(availableTools);
        if (!compat.requiresTools.every(t => have.has(t))) return false;
    }
    return true;
};

/** Authoring caps: ~200 lines soft (warn, suggest `references/`), 100k chars
 *  hard (refuse). Long material belongs in a bundled file, not the body. */
export const SKILL_BODY_SOFT_LINES = 200;
export const SKILL_BODY_HARD_CHARS = 100_000;

export const skillBodyCaps = (body: string): { lines: number; chars: number; overSoft: boolean; overHard: boolean } => {
    const lines = body.split('\n').length;
    const chars = body.length;
    return { lines, chars, overSoft: lines > SKILL_BODY_SOFT_LINES, overHard: chars > SKILL_BODY_HARD_CHARS };
};

/** A description that tells the model WHEN to use the skill — the trigger —
 *  in the same spirit as the spec's "Use when / Don't use for". Warned on at
 *  authoring, never blocking. */
export const hasUseWhenTrigger = (description: string): boolean =>
    /\b(?:use when|use this when|when|if|whenever|for|during|before|after)\b/i.test(description);

/**
 * Import scan for third-party skill text (item 6): exfiltration and
 * destructive-command patterns a skill body or bundled file must not carry.
 * Returns one finding per hit, human-readable. DESTRUCTIVE findings refuse
 * the import; EXFIL findings refuse too — a procedure that phones home is
 * not a procedure this app runs, and there is no terminal tool to run it on.
 */
export type ScanSeverity = 'destructive' | 'exfil' | 'policy';

const SCAN_PATTERNS: Array<{ re: RegExp; severity: ScanSeverity; what: string }> = [
    { re: /\brm\s+-rf\b|\bmkfs\b|\bdd\s+if=/i, severity: 'destructive', what: 'a destructive filesystem command (rm -rf / mkfs / dd)' },
    { re: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\};\s*:/, severity: 'destructive', what: 'a fork bomb' },
    { re: /\b(?:curl|wget)\b[^\n]*\|\s*(?:ba)?sh/i, severity: 'exfil', what: 'a piped shell download (curl|sh)' },
    { re: /\bbase64\s+(-d|--decode)\b/i, severity: 'exfil', what: 'inline base64 decoding' },
    { re: /\b(?:cat|type)\b[^\n]*(?:\.ssh|id_rsa|credentials|\.env|\.aws)\b/i, severity: 'exfil', what: 'a credential-file read' },
    { re: /\b(?:nc|ncat|netcat)\b[^\n]*\s-e\b/i, severity: 'exfil', what: 'a netcat reverse shell' },
    { re: /\bhttps?:\/\/[^\s]*(?:token|key|secret|password)=[^\s]+/i, severity: 'exfil', what: 'a URL carrying a credential parameter' },
    // A third-party procedure has no business telling the seat to write the
    // trader into its collaboration memory. It is not code execution, but it
    // is an instruction to change future prompts, so it refuses at the door.
    { re: /\b(?:remember|memorize)\b[^\n]{0,80}\b(?:the\s+)?(?:user|trader)\b/i, severity: 'policy', what: 'an instruction to write the user into memory' },
    { re: /\b(?:write|save|store)\b[^\n]{0,40}\b(?:to\s+)?memory\b/i, severity: 'policy', what: 'an instruction to write memory' },
];

export const scanSkillText = (text: string): Array<{ severity: ScanSeverity; what: string }> => {
    const hits: Array<{ severity: ScanSeverity; what: string }> = [];
    for (const { re, severity, what } of SCAN_PATTERNS) {
        if (re.test(text)) hits.push({ severity, what });
    }
    return hits;
};
