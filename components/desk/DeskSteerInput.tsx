/**
 * DeskSteerInput — the inline note input that rides in the floor's
 * foreground rail. When at least one seat is live, the trader can type a
 * note for a specific seat. Enter queues; Esc cancels.
 *
 * The parent supplies the list of live seats and the submit callback; this
 * component is purely the input + seat picker.
 */

import React from 'react';
import { SelectMenu } from '../shared/SelectMenu';

export interface DeskSteerInputProps {
    /** Seats that are currently live (the trader can only steer these). */
    liveSeats: string[];
    onSubmit: (seatName: string, note: string) => void;
    disabled?: boolean;
    'data-testid'?: string;
}

export const DeskSteerInput: React.FC<DeskSteerInputProps> = ({ liveSeats, onSubmit, disabled, 'data-testid': testId }) => {
    const [target, setTarget] = React.useState<string>('');
    const [draft, setDraft] = React.useState('');
    React.useEffect(() => {
        if (!target && liveSeats.length > 0) setTarget(liveSeats[0]);
    }, [liveSeats, target]);

    if (liveSeats.length === 0) return null;

    const submit = (): void => {
        const note = draft.trim();
        if (!note || !target) return;
        onSubmit(target, note);
        setDraft('');
    };

    return (
        <div
            data-testid={testId}
            className="flex items-center gap-2 rounded-md border border-white/15 bg-zinc-950/90 px-2.5 py-1.5"
        >
            <span className="shrink-0 text-ui-xs font-semibold uppercase tracking-widest text-zinc-500">
                Steer
            </span>
            <SelectMenu
                value={target}
                onChange={setTarget}
                options={liveSeats.map(s => ({ value: s, label: s }))}
                disabled={disabled}
                aria-label="Seat to steer"
                className="shrink-0"
                drop="up"
                triggerClassName="rounded border border-white/10 bg-zinc-900 px-1.5 py-0.5 text-ui-dense hover:bg-zinc-800"
            />
            <input
                type="text"
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => {
                    if (e.key === 'Enter') submit();
                    if (e.key === 'Escape') setDraft('');
                }}
                disabled={disabled}
                placeholder="Note for the selected seat (only they see it)"
                className="min-w-0 flex-1 bg-transparent text-ui-dense text-zinc-100 placeholder-zinc-600 focus:outline-none"
            />
            <button
                type="button"
                onClick={submit}
                disabled={!draft.trim() || disabled}
                className="shrink-0 rounded bg-zinc-800 px-2 py-0.5 text-ui-dense font-semibold text-zinc-200 enabled:hover:bg-zinc-700 disabled:text-zinc-600"
            >
                Queue
            </button>
        </div>
    );
};

export default DeskSteerInput;
