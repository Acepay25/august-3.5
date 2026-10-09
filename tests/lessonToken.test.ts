/**
 * lessonToken — the explicit "this is durable" declaration, and the widened
 * label gate that stands behind it.
 *
 * The gate exists because a bot reply is prose: `extractLessonFromPostMortem`'s
 * prose fallback turned refusals and disclaimers into permanent lessons
 * re-injected into every future turn. These cases pin both halves of the fix —
 * the declaration a bot makes on purpose, and the label spellings that earn
 * prose mining — and, above all, the things that must NOT be memorized.
 */

import { describe, it, expect } from 'vitest';
import {
    LESSON_TOKEN_EXAMPLE,
    LESSON_TOKEN_SENTINEL,
    hasLessonLabel,
    parseLessonToken,
    stripLessonLabel,
    stripLessonToken,
} from '../utils/lessonToken';

describe('parseLessonToken (the explicit declaration)', () => {
    it('reads the line between the prefix and the sentinel', () => {
        expect(parseLessonToken('Funding looks hot.\nLESSON: wait for the 15m reclaim <-- LEARN'))
            .toBe('wait for the 15m reclaim');
    });

    it('accepts a declaration in any case, with dash or en-dash for a separator', () => {
        expect(parseLessonToken('lesson - never front-run the reclaim <-- LEARN'))
            .toBe('never front-run the reclaim');
        expect(parseLessonToken('**Lesson:** the sweep was not a reversal <-- learn**'))
            .toBe('the sweep was not a reversal');
    });

    it('refuses a bare LESSON: line — that is prose, not a declaration', () => {
        // The sentinel is the token. Accepting the prefix alone made the
        // parser steal the reply's prose "Lesson:" line on nothing more than
        // the word, and the declaration it was meant to honor lost to it.
        expect(parseLessonToken('LESSON: size down into the first test of supply')).toBeNull();
        expect(parseLessonToken('Lesson: wait for the reclaim close.')).toBeNull();
    });

    it('reads through markdown noise a model wraps the line in', () => {
        expect(parseLessonToken('- **Lesson:** the sweep was not a reversal <-- LEARN'))
            .toBe('the sweep was not a reversal');
        expect(parseLessonToken('> LESSON: chop pays mean reversion <-- LEARN'))
            .toBe('chop pays mean reversion');
    });

    it('takes the FIRST declaration when a reply declares twice', () => {
        expect(parseLessonToken('LESSON: first thing <-- LEARN\nLESSON: second thing <-- LEARN'))
            .toBe('first thing');
    });

    it('returns null for a reply that declares nothing', () => {
        expect(parseLessonToken('BTC is ranging. Nothing to add.')).toBeNull();
        expect(parseLessonToken('LESSON: <-- LEARN')).toBeNull(); // sentinel, no body
        expect(parseLessonToken('')).toBeNull();
    });

    it('keeps the prompt example parseable — teaching and reading cannot drift', () => {
        expect(parseLessonToken(LESSON_TOKEN_EXAMPLE)).toBe('wait for the 15m reclaim before adding');
        expect(LESSON_TOKEN_EXAMPLE.startsWith('LESSON:')).toBe(true);
        expect(LESSON_TOKEN_EXAMPLE.endsWith(LESSON_TOKEN_SENTINEL)).toBe(true);
    });
});

describe('hasLessonLabel (the widened gate)', () => {
    it('accepts every spelling the old pattern missed', () => {
        // These four all FAILED on /(?:lesson|takeaway|learning|correction|next
        // time)\s*[:-–]/ — "lessons learned" needs the plural+learned form, and
        // "what I learned" needs the subject prefix.
        expect(hasLessonLabel('Lessons learned: chop pays mean reversion.')).toBe(true);
        expect(hasLessonLabel('What I learned: wait for the reclaim.')).toBe(true);
        expect(hasLessonLabel('I learned - do not front-run it.')).toBe(true);
        expect(hasLessonLabel('Key takeaway: the sweep was not a reversal.')).toBe(true);
    });

    it('still accepts the spellings it always did', () => {
        for (const line of [
            'Lesson: wait for the reclaim.',
            'Key lesson: size down.',
            'Takeaway: chop is a different book.',
            'Learning: the hybrid read was stale.',
            'Correction: my stop was too tight.',
            'Next time: check funding first.',
        ]) expect(hasLessonLabel(line)).toBe(true);
    });

    it('still refuses a reply that only labels nothing — punctuation is the gate', () => {
        for (const line of [
            'I can’t help with that.',
            'I have no price data here.',
            'I learned nothing from this trade',
            'BTC looks heavy. No lesson today.',
            '',
        ]) expect(hasLessonLabel(line)).toBe(false);
    });
});

describe('stripLessonLabel (the label comes off either way)', () => {
    it('removes a leading label the miner could not recognize', () => {
        // `extractLessonFromPostMortem` captures the body only for the
        // spellings its own pattern lists, so these would be stored WITH the
        // label attached.
        expect(stripLessonLabel('Lessons learned: wait for the reclaim close.'))
            .toBe('wait for the reclaim close.');
        expect(stripLessonLabel('What I learned: do not front-run a failed sweep.'))
            .toBe('do not front-run a failed sweep.');
        expect(stripLessonLabel('Key takeaway: chop is a different book.'))
            .toBe('chop is a different book.');
    });

    it('leaves an already-bare lesson untouched', () => {
        expect(stripLessonLabel('wait for the reclaim close')).toBe('wait for the reclaim close');
        expect(stripLessonLabel('  size down  ')).toBe('size down');
    });

    it('does not eat a sentence that merely starts with the word', () => {
        // No separator, so no label.
        expect(stripLessonLabel('Lessons are for the trader, not the market'))
            .toBe('Lessons are for the trader, not the market');
    });
});

describe('stripLessonToken (transcript hygiene)', () => {
    it('removes the declaration line and keeps the prose', () => {
        expect(stripLessonToken('Funding looks hot.\nLESSON: wait for the reclaim <-- LEARN'))
            .toBe('Funding looks hot.');
    });

    it('keeps a reply that is ONLY the declaration — no empty bubble', () => {
        expect(stripLessonToken('LESSON: wait for the reclaim <-- LEARN'))
            .toBe('LESSON: wait for the reclaim <-- LEARN');
    });

    it('leaves ordinary replies untouched', () => {
        expect(stripLessonToken('Long, size 0.5R.')).toBe('Long, size 0.5R.');
    });

    it('a prose Lesson: line STAYS visible — it is not protocol', () => {
        // The reader refuses a bare `Lesson:` (no sentinel), so the stripper
        // must refuse to hide it too. Before this, that line was deleted from
        // the room bubble while `lessonFromBotTurn` still mined it into
        // memory.md — the lesson was memorized invisibly.
        const prose = 'Verdict: avoid the short.\nLesson: the sweep had no follow-through.';
        expect(stripLessonToken(prose)).toBe(prose);
        expect(parseLessonToken(prose)).toBeNull();
    });

    it('hides only what the reader would treat as a declaration', () => {
        const mixed = 'Funding looks hot.\nLesson: prose, keep this.\nLESSON: wait for the reclaim <-- LEARN';
        expect(stripLessonToken(mixed))
            .toBe('Funding looks hot.\nLesson: prose, keep this.');
    });
});
