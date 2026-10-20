/**
 * effortScale — the thinking-tier ladder, owned once.
 *
 * Six stops, snapped. `ReasoningEffort` is a six-value union, not a continuum,
 * so nothing here may interpolate between them: a control that reads as a
 * slider still writes one of these ids. `auto` is a real choice, not a hidden
 * default — it means "whatever this task defaults to"
 * (`effortForTask('tradingDecision')` for the two homes that can present a
 * plan), and it is the fallback when a stored value is not on the ladder.
 *
 * The ladder moved out of `EffortChip` when the composer's model control and
 * its thinking tier merged into one panel (`docs/plan/model-menu-redesign.md`,
 * ruling D-D): a trigger that prints `Provider · Model · High` and a slider
 * that edits the tier must not each carry their own label table, or the two
 * halves of one sentence drift.
 */
import type { ReasoningEffort } from '../../services/providers/reasoningControls';

export type EffortChoice = ReasoningEffort | 'auto';

export const EFFORT_CHOICES: { id: EffortChoice; label: string }[] = [
    { id: 'off', label: 'Off' },
    { id: 'auto', label: 'Auto' },
    { id: 'low', label: 'Low' },
    { id: 'medium', label: 'Medium' },
    { id: 'high', label: 'High' },
    { id: 'max', label: 'Max' },
];

/** The trigger and the open menu show the same read for the same id — one
 *  lookup keeps them from drifting. */
export const effortChoiceOf = (id: EffortChoice): typeof EFFORT_CHOICES[number] =>
    EFFORT_CHOICES.find(c => c.id === id) ?? EFFORT_CHOICES[1];

/** The slider's `aria-valuenow` is an INDEX; `aria-valuetext` is the label.
 *  Exposing the number alone would read "4" to a screen reader where the
 *  trader sees "High". */
export const effortIndexOf = (id: EffortChoice): number => {
    const i = EFFORT_CHOICES.findIndex(c => c.id === id);
    return i < 0 ? 1 : i;
};

export const effortAtIndex = (i: number): EffortChoice =>
    EFFORT_CHOICES[Math.min(Math.max(i, 0), EFFORT_CHOICES.length - 1)].id;
