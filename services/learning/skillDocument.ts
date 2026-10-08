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
    /** The ticket fields a strategy skill carries: entry / stop / target /
     *  size / invalidation / requires. Projected into the card, because the
     *  body slice that used to be clipped sometimes showed these and a card
     *  that never does would be a quieter regression. */
    plan: string[];
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
    'the plan': 'plan',
    'my plan': 'plan',
    'when not to use': 'whenNot',
    'required inputs': 'inputs',
    'inputs': 'inputs',
    'steps': 'steps',
    'pitfalls': 'pitfalls',
    'verification': 'verification',
};

const list = (): Record<keyof Omit<SkillSections, 'other'>, string[]> => ({
    whenToUse: [], validate: [], whenNot: [], inputs: [], steps: [], pitfalls: [], verification: [], plan: [],
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
    [/^\*\*My plan:\*\*\s*/i, 'plan'],
];

/** Labels that OPEN the procedure block. `**What I do:**` is the one the craft
 *  writes (it is shared vocabulary with `syncSkillRuleLine` and the enforcement
 *  reader); `**Procedure:**` / `**Steps:**` are the ones a hand-edited or
 *  imported skill uses. A body whose procedure line is not recognised here does
 *  not lose its heading status — it falls through to `whenToUse` and the card
 *  projects the trigger instead of the steps, which is a silent mis-shape
 *  rather than a parse error. */
const STEPS_LABELS: RegExp[] = [/^\*\*What I do:\*\*\s*/i, /^\*\*Procedure:\*\*\s*/i, /^\*\*Steps:\*\*\s*/i];

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
        const steps = STEPS_LABELS.find(re => re.test(line));
        if (steps) {
            inStepsBlock = true; current = 'steps';
            const rest = line.replace(steps, '').trim();
            if (rest) out.steps.push(rest);
            continue;
        }
        const bold = BOLD_LABELS.find(([re]) => re.test(line));
        if (bold) {
            inStepsBlock = false; current = bold[1];
            const rest = line.replace(bold[0], '').trim();
            // A label on its own line (`**My plan:**`) opens the section; pushing
            // the empty remainder would put a blank line in the card.
            if (rest) out[bold[1]].push(rest);
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
 * then the trigger as the file writes it (the substituted `${SYMBOL}`/
 * `${REGIME}` text lives there and nowhere else), then the two fields that stop
 * a seat applying the skill to the wrong setup — when-NOT and the first
 * pitfall — then verification, the ticket fields, the numbered procedure, and
 * finally everything the parser could not classify. Budget is spent in that
 * priority, so a clipped card loses the tail, never the trigger.
 *
 * A body that already fits is served UNCHANGED. The card exists to decide what
 * to drop when the budget bites; re-shaping a skill that needs no trimming
 * would trade text the trader wrote for labels this module invented, and any
 * section it fails to recognise would vanish. Small skills are the common case,
 * so that guard is the difference between a projector and a filter.
 */
export const projectSkillCard = (
    body: string,
    opts: { ifCondition?: string; thenAction?: string; budget?: number } = {},
): SkillCard => {
    const budget = opts.budget ?? 700;
    const whole = (body || '').trim();
    if (whole.length <= budget) {
        return { text: whole, chars: whole.length, clipped: false, droppedChars: 0 };
    }

    const s = parseSkillBody(whole);
    const lines: string[] = [];

    if (opts.ifCondition && opts.thenAction) lines.push(`IF ${opts.ifCondition} THEN ${opts.thenAction}`);
    const when = s.whenToUse.map(stripBullet)[0];
    if (when) lines.push(`When: ${when}`);
    const not = s.whenNot.map(stripBullet)[0];
    if (not) lines.push(`NOT when: ${not}`);
    const pit = s.pitfalls.map(stripBullet)[0];
    if (pit) lines.push(`Watch: ${pit}`);
    const verify = s.verification.map(stripBullet)[0] ?? s.validate.map(stripBullet)[0];
    if (verify) lines.push(`Verify: ${verify}`);
    // The procedure itself, last-but-one: it is the longest part and the one a
    // seat can ask again for, whereas the trigger and the exclusions are what
    // it cannot reconstruct. Whole steps only — a half-line step is worse than
    // none, because "wait for the 1h close" truncated to "wait for the" reads
    // as an instruction rather than as a loss.
    // The ticket fields, when the skill is a strategy rather than a rule.
    s.plan.forEach(line => lines.push(stripBullet(line)));
    if (s.steps.length) {
        lines.push('Procedure:');
        s.steps.forEach((st, i) => lines.push(`${i + 1}. ${stripBullet(st)}`));
    }
    // The rest of the file, in document order. Nothing the trader wrote is
    // dropped for the crime of using an unrecognised heading.
    s.inputs.forEach(line => lines.push(stripBullet(line)));
    s.other.forEach(sec => {
        if (!sec.lines.length) return;
        lines.push(`${sec.title}:`);
        sec.lines.forEach(line => lines.push(stripBullet(line)));
    });

    const full = lines.join('\n');
    if (full.length <= budget) {
        return { text: full, chars: full.length, clipped: false, droppedChars: 0 };
    }
    // Keep whole lines while they fit. A line too long for what is left is
    // skipped, not fatal: one over-long prose paragraph in the middle of a
    // document must not hide the numbered procedure below it, which is the part
    // a seat cannot reconstruct. The clip note counts it as dropped.
    //
    // The rule line is the exception — it leads, and if even it cannot fit the
    // budget is spent on its longest prefix and nothing else is attempted.
    // "Clipped" must never mean "the trigger is missing".
    let kept = '';
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const next = kept ? `${kept}\n${line}` : line;
        if (next.length > budget) {
            if (kept) continue;
            return {
                text: line.slice(0, Math.max(0, budget)),
                chars: Math.min(line.length, Math.max(0, budget)),
                clipped: true,
                droppedChars: full.length - Math.min(line.length, Math.max(0, budget)),
            };
        }
        kept = next;
    }
    // A `Procedure:` label whose every step was skipped would read as an
    // instruction that was never given.
    if (s.steps.length && !/\d+\.\s/.test(kept)) {
        kept = kept.split('\n').filter(l => l !== 'Procedure:').join('\n');
    }
    return {
        text: kept,
        chars: kept.length,
        clipped: kept.length < full.length,
        droppedChars: full.length - kept.length,
    };
};
