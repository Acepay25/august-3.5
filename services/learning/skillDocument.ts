/**
 * A skill file is a document; the prompt can only ever carry a card.
 *
 * The craft now writes a sectioned procedure (`## When to use`, `## Steps`,
 * `## Pitfalls`, `## Verification` …), which is what makes it a skill rather
 * than a rule. But the recall slot is capped — `RECALL_SKILL_BODY_MAX` in
 * `MemoryRetrievalService` is 700 characters, and that budget is zero-sum with
 * every other skill, rule and doctrine line competing for the same stage. A
 * longer document injected naively would either truncate mid-section or push
 * the rest of the packet out, so the two views are separated explicitly:
 *
 *   parseSkillBody()   the sections, for the detail pane and for tests
 *   projectSkillCard() a fixed-shape summary that always fits, for injection
 *
 * The card is built from the parts a seat needs to ACT on the skill — the rule,
 * when not to use it, the first pitfall, how to verify — rather than the first
 * 700 characters of whatever order the prose happened to come in. Truncation is
 * reported, never silent: `clipped` says how much was dropped, so the caller can
 * mark it with `utils/harnessMarks` the way every other withheld text is marked.
 */

export interface SkillSections {
    whenToUse: string[];
    /** That the TRIGGER still holds — not the same claim as `verification`,
     *  which is that the procedure worked. Collapsing them would let the card
     *  answer "Verify:" with a statement about the setup. */
    validate: string[];
    whenNot: string[];
    inputs: string[];
    steps: string[];
    pitfalls: string[];
    verification: string[];
    /** Everything not claimed by a known heading, kept so an unknown section
     *  written by a hand-edited file is never silently lost. */
    other: Array<{ title: string; lines: string[] }>;
}

export interface SkillCard {
    text: string;
    chars: number;
    /** True when the full card did not fit the budget. */
    clipped: boolean;
    droppedChars: number;
}

const HEADINGS: Record<string, keyof Omit<SkillSections, 'other'>> = {
    'when to use': 'whenToUse',
    'how i know it still holds': 'validate',
    'when not to use': 'whenNot',
    'required inputs': 'inputs',
    'inputs': 'inputs',
    'steps': 'steps',
    'pitfalls': 'pitfalls',
    'verification': 'verification',
};

const list = (): Record<keyof Omit<SkillSections, 'other'>, string[]> => ({
    whenToUse: [], validate: [], whenNot: [], inputs: [], steps: [], pitfalls: [], verification: [],
});

/**
 * The bold labels the body has always used, mapped onto the same sections the
 * `##` headings fill.
 *
 * A body written before this module only has the bold lines, and one written
 * now has BOTH (the bold core is a shared vocabulary — see
 * `utils/ifThenSkill.ts` and `syncSkillRuleLine`). Reading both means the card
 * projector works on every skill in a notebook written since the format
 * changed, which is the whole point: an unreadable legacy file is a silent
 * regression, not a migration task.
 */
const BOLD_LABELS: Array<[RegExp, keyof Omit<SkillSections, 'other'>]> = [
    [/^\*\*When:\*\*\s*/i, 'whenToUse'],
    [/^\*\*What I look at:\*\*\s*/i, 'inputs'],
    [/^\*\*How I know it still holds:\*\*\s*/i, 'validate'],
];

const isRuleLine = (line: string): boolean => /^\*\*My rule:\*\*/i.test(line);

/** Split a stored skill body into its sections. Tolerant by design: a legacy
 *  body has no headings at all, and a hand-edited one may invent new ones. */
export const parseSkillBody = (body: string): SkillSections => {
    const out = list();
    const other: SkillSections['other'] = [];
    let current: keyof Omit<SkillSections, 'other'> | 'unknown' | null = null;
    let inStepsBlock = false;

    for (const raw of (body || '').split('\n')) {
        const line = raw.trim();
        if (/^#{1,6}\s+/.test(line)) {
            const title = line.replace(/^#{1,6}\s+/, '').trim().toLowerCase();
            const key = HEADINGS[title];
            inStepsBlock = key === 'steps';
            if (key) { current = key; }
            else { current = 'unknown'; other.push({ title, lines: [] }); }
            continue;
        }
        if (!line) continue;

        // A bold label re-anchors the parse, because the numbered steps follow
        // `**What I do:**` with no heading of their own.
        if (/^\*\*What I do:\*\*/i.test(line)) {
            inStepsBlock = true; current = 'steps';
            const rest = line.replace(/^\*\*What I do:\*\*\s*/i, '').trim();
            if (rest) out.steps.push(rest);
            continue;
        }
        const bold = BOLD_LABELS.find(([re]) => re.test(line));
        if (bold) {
            inStepsBlock = false; current = bold[1];
            out[bold[1]].push(line.replace(bold[0], '').trim());
            continue;
        }
        if (isRuleLine(line)) { inStepsBlock = false; current = null; continue; }

        if (current === null) {
            if (!inStepsBlock) out.whenToUse.push(line);
            continue;
        }
        if (current === 'unknown') { other[other.length - 1].lines.push(line); continue; }
        out[current].push(line);
    }
    return { ...out, other };
};

const stripBullet = (line: string): string => line.replace(/^[-*]\s*/, '').replace(/^\d+\.\s*/, '').trim();

/**
 * The fixed-shape summary a seat is actually given.
 *
 * Order is deliberate: the rule first (it is what the enforcement code checks),
 * then the two fields that stop a seat applying the skill to the wrong setup —
 * when-NOT and the first pitfall — then verification. Budget is spent in that
 * priority, so a clipped card loses the tail, never the trigger.
 */
export const projectSkillCard = (
    body: string,
    opts: { ifCondition?: string; thenAction?: string; budget?: number } = {},
): SkillCard => {
    const budget = opts.budget ?? 700;
    const s = parseSkillBody(body);
    const lines: string[] = [];

    if (opts.ifCondition && opts.thenAction) lines.push(`IF ${opts.ifCondition} THEN ${opts.thenAction}`);
    const not = s.whenNot.map(stripBullet)[0];
    if (not) lines.push(`NOT when: ${not}`);
    const pit = s.pitfalls.map(stripBullet)[0];
    if (pit) lines.push(`Watch: ${pit}`);
    const verify = s.verification.map(stripBullet)[0] ?? s.validate.map(stripBullet)[0];
    if (verify) lines.push(`Verify: ${verify}`);
    const step = s.steps.map(stripBullet)[0];
    if (step) lines.push(`First: ${step}`);

    const full = lines.join('\n');
    if (full.length <= budget) {
        return { text: full, chars: full.length, clipped: false, droppedChars: 0 };
    }
    // Keep whole lines while they fit; the caller marks the omission.
    let kept = '';
    for (const line of lines) {
        const next = kept ? `${kept}\n${line}` : line;
        if (next.length > budget) break;
        kept = next;
    }
    // A budget too small for even the rule line must not return nothing: the
    // trigger is the one part a seat cannot guess. Fall back to the longest
    // prefix of it that fits, so "clipped" means "shorter than I wanted" and
    // never "the card is empty".
    if (!kept && lines.length) kept = lines[0].slice(0, Math.max(0, budget));
    return {
        text: kept,
        chars: kept.length,
        clipped: kept.length < full.length,
        droppedChars: full.length - kept.length,
    };
};
