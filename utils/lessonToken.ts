/**
 * lessonToken — the grammar a bot uses to say "this part is durable".
 *
 * A bot turn's reply is prose, and prose is where the memory-poisoning bug
 * lived: `extractLessonFromPostMortem` was fed raw chat replies, its prose
 * fallback turned any 20-char sentence into a permanent lesson, and that
 * lesson was re-injected into the bot's every future turn. The fix was a
 * GATE — a reply must LABEL a lesson before one is mined (`hasLessonLabel`)
 * — but a label is still prose-inference: "Lesson:" in the middle of an
 * explanation says nothing about where the lesson ends, and a bot with
 * something genuinely durable to say had no way to say "exactly this, and
 * nothing else".
 *
 * This module owns the explicit spelling, and it is ONE definition shared by
 * everyone: the two protocol sections that TEACH it (the 1:1 teammate DM in
 * `services/agents/botMailbox.ts` and the group room in
 * `services/agents/groupRounds.ts`) and the reader that mines it
 *(`services/agents/botLearning.ts`). A prompt that taught bytes the parser
 * does not accept would be a declaration nobody can read — the same outcome
 * as no declaration at all, with the added cost of a bot believing it was
 * heard.
 *
 *   LESSON: <one line> <-- LEARN
 *
 * The closing sentinel is the token. It is REQUIRED when parsing, which is
 * the whole point: a bare `Lesson: …` line is prose, and a parser that
 * accepted it as a declaration stole the reply's prose lesson from the miner
 * on nothing more than the prefix. The sentinel is what makes the line
 * unambiguous, and a model that drops it still earns prose mining — the label
 * gate (`hasLessonLabel`) is the net for that, not the token.
 *
 * Precedence is deliberate and load-bearing: an explicit declaration beats
 * prose mining. A reply that declares a token AND contains a longer
 * "Lesson:" line gets the declaration, because the bot said which one it
 * means. A declaration too short to be a lesson is not an invitation to fall
 * back to the prose around it.
 */

/** The token's prefix. Uppercase so it cannot be mistaken for prose. */
export const LESSON_TOKEN_PREFIX = 'LESSON:';

/** The token's closing marker — what makes it a declaration rather than a
 *  sentence that happens to start with "Lesson". */
export const LESSON_TOKEN_SENTINEL = '<-- LEARN';

/** One complete, copy-pasteable example for the protocol sections. The
 *  prompts render this rather than restating the grammar, so teaching and
 *  parsing cannot drift apart. */
export const LESSON_TOKEN_EXAMPLE = `${LESSON_TOKEN_PREFIX} wait for the 15m reclaim before adding ${LESSON_TOKEN_SENTINEL}`;

/** Markdown noise a model wraps around an otherwise clean token line. */
const stripLineNoise = (raw: string): string => raw
    .replace(/^\s*[-*>+\d.)\s]+/, '')
    .replace(/\*\*|__|`/g, '')
    .trim();

/**
 * ONE pattern for "this line is a declaration", used by the reader AND the
 * transcript stripper. They used to be two patterns: the reader required the
 * sentinel while the stripper hid any `Lesson:` line, so a reply that labelled
 * its lesson in prose had that line vanish from the room bubble while the
 * miner still wrote it into memory.md — the trader could not see what had been
 * memorized, and the module's own comment claimed protocol bytes only. A line
 * is protocol to BOTH or it is prose to BOTH.
 */
const LESSON_TOKEN_LINE_RE = /^lesson\s*[:\-–]\s*(.+?)\s*<--\s*learn\s*$/i;

/**
 * The declared lesson line, or null when the reply declares none.
 *
 * Only a sentinel-closed line counts — see the module header for why a bare
 * `Lesson:` is prose. Returns the text between the prefix and the sentinel,
 * trimmed and unwrapped. Does NOT judge length: the caller's minimum applies
 * once, to whichever line won.
 */
export const parseLessonToken = (reply: string): string | null => {
    if (!reply) return null;
    for (const rawLine of reply.split('\n')) {
        const line = stripLineNoise(rawLine);
        const match = line.match(LESSON_TOKEN_LINE_RE);
        if (!match) continue;
        const body = match[1].trim();
        if (body) return body;
    }
    return null;
};

/**
 * The widened gate: does this reply LABEL a lesson anywhere?
 *
 * Punctuation after the label word is still required — that requirement is
 * what keeps the gate a gate. Every form added here is a spelling a model
 * actually produces and the previous pattern missed, not a loosening of the
 * idea:
 *
 *   lesson / key lesson / lessons / lessons learned / key takeaway /
 *   takeaway / learning / correction / next time / what I learned / I learned
 *
 * Note what is still refused: a refusal ("I can't help with that"), a
 * disclaimer, and "I learned nothing from this" — no label word followed by
 * a separator, so nothing is mined.
 */
const LESSON_LABEL_RE = /(?:key\s+|what\s+(?:i|we)\s+|i\s+)?(?:lessons?\s+learned|lesson|takeaway|learning|learned|correction|next\s+time)\s*[:\-–]/i;

/** True when the reply labels a lesson somewhere (any spelling above). */
export const hasLessonLabel = (reply: string): boolean =>
    Boolean(reply) && LESSON_LABEL_RE.test(reply);

/** The same vocabulary at line start, for stripping a label the miner could
 *  not recognize. `extractLessonFromPostMortem` captures the body only for
 *  the spellings IT knows; a reply labelled "Lessons learned:" clears that
 *  function's gate but not its alternation, so it would be stored with the
 *  label still on it. The label words live here once — the gate that admits a
 *  reply and the stripper that cleans it cannot disagree about what a label
 *  looks like. */
const LEADING_LABEL_RE = /^(?:key\s+|what\s+(?:i|we)\s+|i\s+)?(?:lessons?\s+learned|lesson|takeaway|learning|learned|correction|next\s+time)\s*[:\-–]\s*/i;

/** A mined line with its leading label removed, when it had one. A line that
 *  is already a bare lesson is returned untouched. */
export const stripLessonLabel = (line: string): string =>
    line.trim().replace(LEADING_LABEL_RE, '').trim();

/** The protocol sentence that teaches the token. Rendered into the 1:1
 *  teammate section and the room section verbatim. */
export const lessonTokenInstruction =
    `To save a durable lesson into your own notes, end your reply with one line: \`${LESSON_TOKEN_EXAMPLE}\` — one line only, everything else you say is conversation.`;

/** A line that IS a token declaration is `LESSON_TOKEN_LINE_RE` — the same
 *  pattern the parser reads, defined once above so the two cannot disagree. */

/**
 * The token line removed, for a transcript that must not show protocol
 * bytes — the same reason the room strips `[[dm:@…]]` markers from its
 * bubbles. A prose `Lesson:` line is NOT protocol, so it stays visible: the
 * miner may still read it, and hiding what was memorized is worse than
 * showing the label. The reply is not otherwise damaged: the learner reads the
 * raw text, and a reply that is ONLY a declaration keeps it, because hiding
 * the one line a turn existed to say would leave an empty bubble.
 */
export const stripLessonToken = (text: string): string => {
    const kept = text.split('\n').filter(line => !LESSON_TOKEN_LINE_RE.test(stripLineNoise(line)));
    const out = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return out || text.trim();
};
