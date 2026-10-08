/**
 * The status bar — 28px under the surface, holding what the app knows about
 * *itself*: which model answers, how full the context window is, whether the
 * supervisor is deciding on its own, and how much of the screen is showing.
 *
 * This is the reference apps' one structural idea our shell lacked. Claude
 * makes transcript depth a mode (Normal / Thinking / Verbose); Hermes puts a
 * context meter, cache rate and tokens/sec in a persistent bottom bar and lets
 * you edit which items appear. Both keep telemetry OUT of the working area, and
 * that is the whole argument for a bar: before it, the same facts lived in five
 * Learn panels and a strip of market stats beside the chart, competing with the
 * things you act on.
 *
 * So the bar is a readout, and only ONE control writes: the density group. The
 * supervisor and the model are shown as they are and click through to the place
 * that owns the setting — a second toggle for one setting is exactly what this
 * app just removed from the approval queues.
 */

import React, { useEffect, useState } from 'react';
import { getHarnessSettings, saveHarnessSettings, subscribeHarnessSettings } from '../../utils/harnessSettings';

export type ViewDensity = 'focus' | 'detail';

/** The bar's own subscription to the shared setting, so a density change made
 *  anywhere — here, a keyboard shortcut, Settings — repaints everywhere. */
export const useViewDensity = (): { density: ViewDensity; setDensity: (d: ViewDensity) => void } => {
    const [density, setDensity] = useState<ViewDensity>(() => getHarnessSettings().viewDensity);
    useEffect(() => subscribeHarnessSettings(next => setDensity(next.viewDensity)), []);
    const set = (next: ViewDensity): void => { saveHarnessSettings({ viewDensity: next }); };
    return { density, setDensity: set };
};

interface StatusBarProps {
    /** Human-readable model answer for this session, e.g. "kilo · step-3.7". */
    modelLabel: string | null;
    /** Percent of the active model's window the open thread occupies, or null
     *  when there is no thread to measure. A gap reads as a gap. */
    contextPercent: number | null;
    /** The window the percentage is taken against, so the number is not magic. */
    contextWindowTokens: number | null;
    supervisorAuto: boolean;
    pendingApprovals: number;
    onOpenApprovals: () => void;
    onOpenModels: () => void;
    onOpenHealth: () => void;
}

const Readout: React.FC<{ label: string; value: string; onClick?: () => void; testId: string }> = ({
    label, value, onClick, testId,
}) => (onClick ? (
    <button
        type="button"
        onClick={onClick}
        data-testid={testId}
        title={`${value} — opens ${label}`}
        className="inline-flex min-h-6 items-baseline gap-1 rounded px-1.5 text-ui-dense text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
    >
        <span className="text-zinc-600">{label}</span>
        <span className="font-mono text-zinc-300">{value}</span>
    </button>
) : (
    <span className="inline-flex min-h-6 items-baseline gap-1 px-1.5 text-ui-dense" data-testid={testId}>
        <span className="text-zinc-600">{label}</span>
        <span className="font-mono text-zinc-300">{value}</span>
    </span>
));

const DensityButton: React.FC<{
    active: boolean; label: string; hint: string; testId: string; onPress: () => void;
}> = ({ active, label, hint, testId, onPress }) => (
    <button
        type="button"
        onClick={onPress}
        aria-pressed={active}
        data-testid={testId}
        title={hint}
        className={`inline-flex min-h-6 items-center rounded px-2 text-ui-dense font-semibold transition-colors ${
            active
                ? 'bg-zinc-200 text-zinc-900'
                : 'border border-white/10 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
        }`}
    >
        {label}
    </button>
);

const StatusBar: React.FC<StatusBarProps> = ({
    modelLabel, contextPercent, contextWindowTokens, supervisorAuto,
    pendingApprovals, onOpenApprovals, onOpenModels, onOpenHealth,
}) => {
    const { density, setDensity } = useViewDensity();

    return (
        <footer
            className="flex h-7 shrink-0 items-center gap-1 border-t border-zinc-800/80 bg-zinc-950 px-3 text-ui-dense"
            data-testid="status-bar"
            aria-label="Session status"
        >
            {pendingApprovals > 0 ? (
                <button
                    type="button"
                    onClick={onOpenApprovals}
                    data-testid="status-approvals"
                    className="inline-flex min-h-6 items-center gap-1.5 rounded bg-amber-500 px-2 font-mono text-ui-2xs font-bold text-zinc-950 transition-colors hover:bg-amber-400"
                >
                    {pendingApprovals > 99 ? '99+' : pendingApprovals} waiting
                </button>
            ) : (
                <span className="text-ui-2xs text-zinc-700" data-testid="status-approvals-empty">
                    nothing waiting
                </span>
            )}

            <span className="mx-1 h-3.5 w-px bg-zinc-800" aria-hidden="true" />

            {modelLabel
                ? <Readout testId="status-model" label="model" value={modelLabel} onClick={onOpenModels} />
                : <span className="px-1.5 text-ui-dense text-zinc-700" data-testid="status-model">no model ready</span>}
            {contextPercent !== null && contextWindowTokens
                ? (
                    <Readout
                        testId="status-context"
                        label="context"
                        value={`${contextPercent}% of ${contextWindowTokens.toLocaleString()} tk`}
                    />
                )
                : null}
            <Readout
                testId="status-supervisor"
                label="supervisor"
                value={supervisorAuto ? 'auto' : 'paused'}
                onClick={onOpenHealth}
            />

            <span className="ml-auto inline-flex items-center gap-1" role="group" aria-label="Screen density">
                <span className="mr-1 text-ui-2xs uppercase tracking-widest text-zinc-700" aria-hidden="true">
                    view
                </span>
                <DensityButton
                    testId="status-density-focus"
                    active={density === 'focus'}
                    label="Focus"
                    onPress={() => setDensity('focus')}
                    hint="Chart, conversation and decisions only. Telemetry rests on Learn → Health."
                />
                <DensityButton
                    testId="status-density-detail"
                    active={density === 'detail'}
                    label="Detail"
                    onPress={() => setDensity('detail')}
                    hint="Also show the market stats beside the chart and the loop's telemetry panels."
                />
            </span>
        </footer>
    );
};

export default React.memo(StatusBar);
