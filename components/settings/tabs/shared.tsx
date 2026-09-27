// ─── Shared UI Helpers ────────────────────────────────────────────────────────
// The reference settings layout is: grouped sidebar → page header → cards of
// hairline rows, each row an icon tile, a title + description, and the control
// pushed to the right edge. These helpers are that shape; every tab composes
// them instead of hand-rolling the same row again. Moved verbatim from
// SettingsMenu.tsx when the tab bodies became lazily-loaded components under
// this directory — importing them from SettingsMenu would send every tab chunk
// back around to its parent module.
import React from 'react';

const SettingsGroup: React.FC<{
    title?: string;
    description?: string;
    children: React.ReactNode;
}> = ({ title, description, children }) => (
    <section className="space-y-1.5">
        {title && (
            <div className="px-1">
                <h4 className="text-ui-dense font-semibold uppercase tracking-[0.08em] text-zinc-500">{title}</h4>
                {description && <p className="mt-0.5 text-ui-dense leading-relaxed text-zinc-600">{description}</p>}
            </div>
        )}
        <div className="divide-y divide-white/[0.05] overflow-hidden rounded-2xl border border-white/[0.07] bg-zinc-900/50">
            {children}
        </div>
    </section>
);

const SettingsRow: React.FC<{
    icon?: React.ReactNode;
    title: string;
    description?: React.ReactNode;
    control?: React.ReactNode;
    /** For a control that needs the row's full width (an editor, not a
     *  switch) — it drops below the label instead of squeezing the text. */
    stacked?: boolean;
}> = ({ icon, title, description, control, stacked = false }) => (
    <div className={`flex gap-4 p-4 transition-colors hover:bg-white/[0.015] ${
        stacked ? 'flex-col items-start' : 'items-center justify-between'
    }`}>
        <div className="flex min-w-0 flex-1 items-start gap-3.5">
            {icon && (
                <span aria-hidden="true" className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-white/[0.06] bg-white/[0.04] text-zinc-400">
                    {icon}
                </span>
            )}
            <div className="min-w-0">
                <div className="text-ui-caption font-semibold leading-5 text-zinc-200">{title}</div>
                {description && (
                    <div className="mt-0.5 text-ui-dense leading-relaxed text-zinc-500">{description}</div>
                )}
            </div>
        </div>
        {control && <div className={stacked ? 'w-full' : 'shrink-0'}>{control}</div>}
    </div>
);

const SettingsPageHeader: React.FC<{ title: string; description?: string }> = ({ title, description }) => (
    <header className="border-b border-white/[0.06] pb-3.5">
        <h3 className="text-lg font-semibold tracking-tight text-zinc-100">{title}</h3>
        {description && <p className="mt-1 text-xs leading-relaxed text-zinc-500">{description}</p>}
    </header>
);

/** Two-choice setting that belongs INSIDE a row rather than as two full-width
 *  cards — the reference keeps the control on the row's right edge. */
const SegmentedControl: React.FC<{
    value: string;
    options: Array<{ id: string; label: string; title?: string }>;
    onChange: (id: string) => void;
    ariaLabel: string;
}> = ({ value, options, onChange, ariaLabel }) => (
    <div role="radiogroup" aria-label={ariaLabel}
        className="flex items-center gap-0.5 rounded-full border border-white/[0.07] bg-zinc-800/70 p-0.5">
        {options.map(o => (
            <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={value === o.id}
                title={o.title}
                onClick={() => onChange(o.id)}
                className={`rounded-full px-2.5 py-1 text-ui-dense font-semibold transition-colors duration-150 ease-[var(--ease-snappy)] ${
                    value === o.id ? 'bg-zinc-700 text-zinc-100 ring-1 ring-white/[0.07]' : 'text-zinc-500 hover:text-zinc-300'
                }`}
            >
                {o.label}
            </button>
        ))}
    </div>
);

export { SettingsGroup, SettingsRow, SettingsPageHeader, SegmentedControl };
