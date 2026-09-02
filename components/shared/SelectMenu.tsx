/**
 * SelectMenu — the reference-styled dropdown (Hermes/Zed vocabulary):
 * a bare trigger (label + chevron, no boxed chrome) opening a flat list
 * of rows — 13px text, py-2 px-3, selection by background fill (no border,
 * no accent color), a check glyph on the current row, optional right-aligned
 * muted meta, and optional section dividers. Keyboard: arrows move the
 * active row, Enter/Space selects, Escape closes, focus wraps.
 *
 * Replaces native <select> elements whose popup chrome (OS-white option
 * lists, ─── separator hacks) breaks the dark theme.
 */

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckIcon, ChevronDownIcon } from './Icons';

export interface SelectOption {
    value: string;
    label: string;
    /** Right-aligned muted text (e.g. "3 seats", model name). */
    meta?: string;
    disabled?: boolean;
}

export interface SelectSection {
    /** Divider label rendered above these options. */
    label?: string;
    options: SelectOption[];
}

interface SelectMenuProps {
    value: string;
    onChange: (value: string) => void;
    /** Flat options or grouped sections. */
    options: SelectOption[] | SelectSection[];
    /** Trigger shows this when no option matches the value. */
    placeholder?: string;
    /** Muted label rendered inside the trigger, before the value (e.g. "Talk to"). */
    prefix?: string;
    'aria-label'?: string;
    'data-testid'?: string;
    /** Open upward (for triggers near the viewport bottom). Default: auto. */
    drop?: 'auto' | 'up' | 'down';
    className?: string;
    disabled?: boolean;
    /** Replace the pill trigger styling (e.g. a boxed full-width control
     *  inside a form). Pass the classes that should style the trigger. */
    triggerClassName?: string;
}

const isSections = (
    opts: SelectOption[] | SelectSection[],
): opts is SelectSection[] =>
    opts.length > 0 && Array.isArray((opts[0] as SelectSection).options);

const VIEWPORT_MARGIN = 8;
const GAP = 4;

const SelectMenuInner: React.FC<SelectMenuProps> = ({
    value,
    onChange,
    options,
    placeholder = 'Select…',
    prefix,
    'aria-label': ariaLabel,
    'data-testid': testId,
    drop = 'auto',
    className = '',
    disabled = false,
    triggerClassName,
}) => {
    const sections: SelectSection[] = isSections(options) ? options : [{ options }];
    const flat = sections.flatMap(s => s.options);
    const current = flat.find(o => o.value === value);

    const [open, setOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(0);
    const [anchor, setAnchor] = useState<DOMRect | null>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    const close = useCallback(() => {
        setOpen(false);
        setAnchor(null);
    }, []);

    const toggle = (): void => {
        if (disabled) return;
        if (!open && triggerRef.current) {
            setAnchor(triggerRef.current.getBoundingClientRect());
            const idx = flat.findIndex(o => o.value === value && !o.disabled);
            setActiveIndex(Math.max(0, idx));
        }
        setOpen(v => !v);
    };

    const choose = (opt: SelectOption): void => {
        if (opt.disabled) return;
        onChange(opt.value);
        close();
    };

    // Outside click + Escape.
    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent): void => {
            const t = e.target as Node;
            if (triggerRef.current?.contains(t) || listRef.current?.contains(t)) return;
            close();
        };
        const onKey = (e: KeyboardEvent): void => {
            if (e.key === 'Escape') close();
        };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [open, close]);

    // Keyboard navigation while open.
    const onKeyDown = (e: React.KeyboardEvent): void => {
        if (!open) {
            if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggle();
            }
            return;
        }
        const move = (delta: number): void => {
            let next = activeIndex;
            for (let i = 0; i < flat.length; i++) {
                next = (next + delta + flat.length) % flat.length;
                if (!flat[next].disabled) break;
            }
            setActiveIndex(next);
        };
        if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
        else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            const opt = flat[activeIndex];
            if (opt) choose(opt);
        }
    };

    // Keep the active row in view (jsdom has no scrollIntoView).
    useLayoutEffect(() => {
        if (!open) return;
        const el = listRef.current?.querySelector('[data-active="1"]');
        el?.scrollIntoView?.({ block: 'nearest' });
    }, [open, activeIndex]);

    // Position: below by default, flip above when the viewport is short.
    const pos = (() => {
        if (!anchor) return undefined;
        const estH = Math.min(320, flat.length * 36 + 16);
        const spaceBelow = window.innerHeight - anchor.bottom - GAP - VIEWPORT_MARGIN;
        const spaceAbove = anchor.top - GAP - VIEWPORT_MARGIN;
        const up = drop === 'up' || (drop === 'auto' && spaceBelow < Math.min(estH, 160) && spaceAbove > spaceBelow);
        return up
            ? { bottom: window.innerHeight - anchor.top + GAP, maxHeight: Math.max(120, spaceAbove) }
            : { top: anchor.bottom + GAP, maxHeight: Math.max(120, spaceBelow) };
    })();

    let runningIndex = -1;

    return (
        <div className={`relative inline-block ${className}`}>
            <button
                ref={triggerRef}
                type="button"
                aria-label={ariaLabel}
                aria-haspopup="listbox"
                aria-expanded={open}
                data-testid={testId}
                disabled={disabled}
                onClick={toggle}
                onKeyDown={onKeyDown}
                className={triggerClassName
                    ? `flex items-center gap-1.5 text-zinc-200 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${triggerClassName} ${open ? 'border-zinc-600' : ''}`
                    : `flex items-center gap-1.5 rounded-full bg-zinc-800/80 text-zinc-200 transition-colors hover:bg-zinc-700/80 disabled:cursor-not-allowed disabled:opacity-40 ${
                        open ? 'bg-zinc-700/80' : ''
                    }`}
            >
                {prefix && (
                    <span className="pl-2.5 text-[10px] uppercase tracking-widest text-zinc-500">{prefix}</span>
                )}
                <span className={`min-w-0 flex-1 truncate text-left text-[12px] font-semibold ${triggerClassName ? '' : prefix ? 'px-1.5 py-1' : 'px-2.5 py-1'}`}>
                    {current?.label ?? placeholder}
                </span>
                <ChevronDownIcon className={`${triggerClassName ? '' : 'mr-2'} h-3 w-3 shrink-0 text-zinc-500 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>

            {open && pos && createPortal(
                <div
                    ref={listRef}
                    role="listbox"
                    onMouseDownCapture={e => e.stopPropagation()}
                    onPointerDownCapture={e => e.stopPropagation()}
                    className="fixed z-[100] min-w-[220px] max-w-[340px] overflow-y-auto overscroll-contain rounded-xl border border-white/10 bg-zinc-900 py-1 shadow-2xl animate-fade-in custom-scrollbar"
                    style={{ left: Math.min(anchor?.left ?? 0, window.innerWidth - 348), ...pos }}
                >
                    {sections.map((section, si) => (
                        <React.Fragment key={si}>
                            {section.label && (
                                <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
                                    {section.label}
                                </p>
                            )}
                            {section.options.map(opt => {
                                runningIndex += 1;
                                const idx = runningIndex;
                                const isCurrent = opt.value === value;
                                const isActive = idx === activeIndex;
                                return (
                                    <button
                                        key={`${si}-${opt.value}-${idx}`}
                                        type="button"
                                        role="option"
                                        aria-selected={isCurrent}
                                        data-active={isActive ? '1' : '0'}
                                        data-option={opt.value}
                                        disabled={opt.disabled}
                                        onMouseEnter={() => !opt.disabled && setActiveIndex(idx)}
                                        onClick={() => choose(opt)}
                                        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] transition-colors ${
                                            opt.disabled
                                                ? 'cursor-not-allowed text-zinc-600'
                                                : isActive
                                                    ? 'bg-zinc-800 text-white'
                                                    : 'text-zinc-300 hover:bg-zinc-800 hover:text-white'
                                        }`}
                                    >
                                        <span className="min-w-0 flex-1 truncate">{opt.label}</span>
                                        {opt.meta && (
                                            <span className="shrink-0 text-[11px] text-zinc-500">{opt.meta}</span>
                                        )}
                                        {isCurrent && <CheckIcon className="h-3 w-3 shrink-0 text-zinc-200" />}
                                    </button>
                                );
                            })}
                        </React.Fragment>
                    ))}
                </div>,
                document.body,
            )}
        </div>
    );
};

export const SelectMenu = React.memo(SelectMenuInner);
export default SelectMenu;
