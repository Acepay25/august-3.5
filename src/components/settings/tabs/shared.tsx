// ─── Shared UI Helpers ────────────────────────────────────────────────────────
// One settings page language, the one the reference uses (and Settings → Memory
// established as the measured baseline): an 18px title inset 60px from the pane
// top, a full-width column, and borderless lists — a hairline rule above each
// group, 14px headings, 49px rows on hairlines. No kicker, no page rule, no
// boxed cards. Every tab composes these helpers instead of hand-rolling the
// same row; a tab that hand-rolls its own header is how one page kept a 28px
// title with a "Workspace settings" kicker while the next had none.
import React from 'react';

const SettingsGroup: React.FC<{
    title?: string;
    description?: string;
    children: React.ReactNode;
}> = ({ title, description, children }) => (
    <section className="border-t border-white/[0.06] pt-4">
        {title && (
            <div>
                <h4 className="text-ui-sm font-medium text-zinc-200">{title}</h4>
                {description && <p className="mt-1 text-ui-sm leading-relaxed text-zinc-500">{description}</p>}
            </div>
        )}
        <div className="mt-2.5 divide-y divide-white/[0.05]">
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
    <div className={`flex gap-4 py-3.5 transition-colors hover:bg-white/[0.02] ${
        stacked ? 'flex-col items-start' : 'items-start justify-between'
    }`}>
        <div className="flex min-w-0 flex-1 items-start gap-3">
            {icon && <span aria-hidden="true" className="mt-0.5 shrink-0 text-zinc-500">{icon}</span>}
            <div className="min-w-0">
                <div className="text-ui-sm font-medium text-zinc-100">{title}</div>
                {description && (
                    <div className="mt-1 text-ui-sm leading-relaxed text-zinc-500">{description}</div>
                )}
            </div>
        </div>
        {control && <div className={stacked ? 'w-full' : 'shrink-0'}>{control}</div>}
    </div>
);

const SettingsPageHeader: React.FC<{ title: string; description?: string }> = ({ title, description }) => (
    <header className="pt-7">
        <h3 className="text-ui-lg font-semibold tracking-[-0.01em] text-zinc-100">{title}</h3>
        {description && <p className="mt-2 max-w-2xl text-ui-sm leading-relaxed text-zinc-500">{description}</p>}
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
