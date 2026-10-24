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
 * `platforms:` values this app understands, mapped onto the two runtimes it
 * actually has. Anything else (freebsd, …) leaves the list unmapped — the
 * caller treats an all-unknown list as "no constraint stated for a platform
 * we ship", which is the tolerant reading, not the silent-drop one.
 */
export const PLATFORM_OF: Readonly<Record<string, 'web' | 'native'>> = {
    web: 'web',
    webui: 'web',
    browser: 'web',
    native: 'native',
    desktop: 'native',
    electron: 'native',
    macos: 'native',
    mac: 'native',
    linux: 'native',
    windows: 'native',
    android: 'native',
    ios: 'native',
    mobile: 'native',
};
