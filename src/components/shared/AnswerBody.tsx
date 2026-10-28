/**
 * AnswerBody — the ONE place that decides how a model's answer reads.
 *
 * The reference's answer is not a block of plain text. It is a SERIF prose
 * column: the model's own markdown rendered (bold for the level it names, a
 * real table for the numbers, a list for the plan), set in a reading face
 * rather than the interface's. August rendered the answer in the UI sans, so
 * the one surface in the app that is READ rather than operated looked like
 * another panel.
 *
 * This component is the ONE home for that decision, and both conversation
 * surfaces mount it: a second home for the answer's voice is how the two
 * drifted apart in the first place. The trader's own message keeps the UI
 * sans — in the reference the human's bubble is interface, not prose.
 */
import React from 'react';
import { FadingText } from './chatChips';

export interface AnswerBodyProps {
    /** The answer text, as the model wrote it. */
    text: string;
    /** The answer is still arriving. */
    streaming?: boolean;
    /** Extra classes for the wrapper. */
    className?: string;
}

const AnswerBody: React.FC<AnswerBodyProps> = ({ text, streaming, className }) => (
    <FadingText
        text={text}
        streaming={!!streaming}
        // The answer is the one surface in the app that is READ rather than
        // operated, so it has its own type ROLE — `font-reading`. The face
        // behind that role is the UI stack: the owner ruled (2026-10-22) that
        // no serif ships, so the distinction the role carries is the chrome
        // around it (the chips, the work card, the composer), not a family.
        // Code blocks keep their own monospace, and the table keeps its
        // tabular figures.
        className={`font-reading text-zinc-200 ${className ?? ''}`}
    />
);

export default React.memo(AnswerBody);
