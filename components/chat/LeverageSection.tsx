/**
 * LeverageSection (ROUND-39 UI) — the composer's leverage control relocated
 * into the Team menu so the composer bar reads like the reference (+ modes …
 * send). Same presets + custom input as the old inline dropdown, restyled to
 * the Claude-dark tokens. Controlled entirely by props: state stays in
 * ChatInput/App, so this is a pure controlled section.
 */
import React from 'react';

interface LeverageSectionProps {
    value: string;
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onBlur: (e: React.FocusEvent<HTMLInputElement>) => void;
    onPreset: (value: number) => void;
}

const PRESETS = [25, 50, 75, 100, 125] as const;

export const LeverageSection: React.FC<LeverageSectionProps> = ({ value, onChange, onBlur, onPreset }) => (
    <div className="border-t border-white/[0.06] px-2 pt-1.5 pb-1">
        <div className="flex items-center justify-between px-1.5 pb-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Leverage</span>
            <span className="font-mono text-[11px] text-zinc-300">{value}x</span>
        </div>
        <div className="flex items-center gap-1 px-0.5">
            {PRESETS.map(preset => (
                <button
                    key={preset}
                    type="button"
                    onClick={() => onPreset(preset)}
                    aria-label={`Set leverage to ${preset}x`}
                    className={`flex-1 rounded-md py-1 text-[11px] font-mono transition-colors ${
                        parseInt(value) === preset
                            ? 'bg-zinc-700 text-zinc-100'
                            : 'bg-zinc-950/60 text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200'
                    }`}
                >
                    {preset}
                </button>
            ))}
            <input
                type="number"
                value={value}
                onChange={onChange}
                onBlur={onBlur}
                className="w-14 rounded-md bg-zinc-950/60 border border-transparent px-1.5 py-1 text-[11px] font-mono text-zinc-200 focus:border-white/10 focus:outline-none transition-colors"
                aria-label="Custom leverage"
                min="1"
                max="125"
                placeholder="Custom"
            />
        </div>
    </div>
);
