/**
 * TeamRosterMenu — the composer's Team dropdown (Trade mode).
 *
 * Cascading menu: a Lenses/Normal switch on top, one row per
 * seat (lens roles or Expert 1–3, plus the moderator). Hovering a seat opens
 * a provider/model flyout — providers first, models materialize when a
 * provider is hovered — the same interaction as ModelPicker, so picking a
 * seat's model never leaves the dropdown (replaces the old "Customize
 * team…" modal entry point).
 */

import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ProviderConfig } from '../../types/provider';
import { AnalystLensConfig, AnalystRole } from '../../types';
import {
    ANALYST_ROLE_DEFINITIONS,
    EnsembleModelSelection,
    autoAssignLenses,
} from '../../services/ui/AnalystLensService';
import { RegimeProviderStatsMap } from '../../services/learning/SetupMemoryService';
import {
    formatModelDisplayName,
    isFreeModelId,
    sortModelsFreeFirst,
    readFreeOnlyPref,
    writeFreeOnlyPref,
} from '../../utils/providerUtils';
import { CheckIcon, ChevronRightIcon } from '../shared/Icons';

interface TeamRosterMenuProps {
    providers: ProviderConfig[];
    lensConfig: AnalystLensConfig;
    setLensConfig: (config: AnalystLensConfig) => void;
    ensembleModelSelection: EnsembleModelSelection;
    setEnsembleModelSelection: (selection: EnsembleModelSelection) => void;
    moderatorProviderId?: string;
    moderatorModel?: string;
    onSetModeratorProvider?: (providerId: string) => void;
    onSetModeratorModel?: (modelId: string) => void;
    /** Regime-matched provider win rates — feeds lens auto-assign. */
    regimeProviderStats?: RegimeProviderStatsMap;
    /** Optional leverage section pinned to the menu bottom —
     *  the control moved here out of the composer bar. */
    leverageSection?: React.ReactNode;
    onClose: () => void;
}

interface SeatRow {
    key: string;
    label: string;
    sublabel: string;
    /** Lens role for lens seats (undefined for expert seats / moderator). */
    role?: AnalystRole;
    /** Expert slot index (undefined for lens seats / moderator). */
    slot?: number;
    isModerator?: boolean;
    providerId: string | null;
    modelId: string;
    assigned: boolean;
}

interface FlyoutPos {
    top: number;
    left: number;
    maxHeight: number;
}

const VIEWPORT_MARGIN = 8;
const FLYOUT_GAP = 6;
const FLYOUT_MAX_H = 320;
const FLYOUT_MIN_H = 140;
const FLYOUT_W_EST = 352;

const computeFlyoutPosition = (rect: DOMRect, w: number, h: number): FlyoutPos => {
    const viewportH = window.innerHeight;
    const viewportW = window.innerWidth;
    const maxHeight = Math.min(FLYOUT_MAX_H, Math.max(FLYOUT_MIN_H, viewportH - 2 * VIEWPORT_MARGIN));
    const usedH = Math.min(Math.max(h, FLYOUT_MIN_H), maxHeight);
    // Prefer opening to the right of the seat row; flip left when cramped.
    let left = rect.right + FLYOUT_GAP;
    if (left + w > viewportW - VIEWPORT_MARGIN) {
        left = Math.max(VIEWPORT_MARGIN, rect.left - w - FLYOUT_GAP);
    }
    const top = Math.min(Math.max(VIEWPORT_MARGIN, rect.top - 2), viewportH - usedH - VIEWPORT_MARGIN);
    return { top, left, maxHeight };
};

const TeamRosterMenu: React.FC<TeamRosterMenuProps> = ({
    providers,
    lensConfig,
    setLensConfig,
    ensembleModelSelection,
    setEnsembleModelSelection,
    moderatorProviderId = '',
    moderatorModel = '',
    onSetModeratorProvider,
    onSetModeratorModel,
    regimeProviderStats,
    leverageSection,
    onClose,
}) => {
    const readyProviders = useMemo(
        () => providers.filter(p => p.isEnabled && p.apiKey.trim().length > 0),
        [providers]
    );
    const mode = lensConfig.enabled ? 'lenses' : 'normal';
    const [freeOnly, setFreeOnly] = useState(readFreeOnlyPref);
    const [hoveredSeat, setHoveredSeat] = useState<SeatRow | null>(null);
    const [hoveredProviderId, setHoveredProviderId] = useState<string | null>(null);
    const [seatRect, setSeatRect] = useState<DOMRect | null>(null);
    const [flyoutPos, setFlyoutPos] = useState<FlyoutPos | null>(null);
    const flyoutRef = useRef<HTMLDivElement>(null);

    const providerName = (id: string | null): string =>
        readyProviders.find(p => p.id === id)?.name ?? (id ? id : '');

    const seats = useMemo<SeatRow[]>(() => {
        if (mode === 'lenses') {
            const roles: AnalystRole[] = [
                AnalystRole.MACRO_VOLATILITY,
                AnalystRole.TECHNICAL_ANALYST,
                AnalystRole.RISK_EXECUTION,
            ];
            return roles.map(role => {
                const def = ANALYST_ROLE_DEFINITIONS[role];
                const assignment = lensConfig.assignments?.find(item => item.role === role);
                const provider = readyProviders.find(item => item.id === assignment?.assignedProvider);
                const modelId = assignment?.assignedModel || provider?.models[0] || '';
                return {
                    key: `lens:${role}`,
                    label: def.shortName,
                    sublabel: def.focus,
                    role,
                    providerId: provider ? provider.id : null,
                    modelId,
                    assigned: Boolean(provider && modelId),
                };
            });
        }
        return ([0, 1, 2] as const).map(slot => {
            const entry = ensembleModelSelection?.[slot];
            const provider = readyProviders.find(item => item.id === entry?.providerId);
            const modelId = provider && entry?.model ? entry.model : (provider?.models[0] ?? '');
            return {
                key: `expert:${slot}`,
                label: `Expert ${slot + 1}`,
                sublabel: 'Debate seat',
                slot,
                providerId: provider ? provider.id : null,
                modelId,
                assigned: Boolean(provider && modelId),
            };
        });
    }, [mode, lensConfig, ensembleModelSelection, readyProviders]);

    const moderatorSeat = useMemo<SeatRow>(() => {
        const provider = readyProviders.find(p => p.id === moderatorProviderId);
        const modelId = moderatorModel || provider?.models[0] || '';
        return {
            key: 'moderator',
            label: 'Moderator',
            sublabel: 'Synthesizes the debate and writes the verdict',
            isModerator: true,
            providerId: provider ? provider.id : null,
            modelId,
            assigned: Boolean(provider && modelId),
        };
    }, [readyProviders, moderatorProviderId, moderatorModel]);

    // provider::model pairs held by OTHER seats — those combos are greyed out
    // in the flyout so duplicates can't be picked (mirrors the pipeline's
    // distinct-seat guard).
    const takenIdentities = useMemo(() => {
        const ids = new Set<string>();
        for (const seat of [...seats, moderatorSeat]) {
            if (hoveredSeat && seat.key === hoveredSeat.key) continue;
            if (seat.assigned && seat.providerId) ids.add(`${seat.providerId}::${seat.modelId}`);
        }
        return ids;
    }, [seats, moderatorSeat, hoveredSeat]);

    const handleSeatHover = (seat: SeatRow, rect: DOMRect) => {
        if (hoveredSeat?.key === seat.key) return;
        setHoveredSeat(seat);
        setHoveredProviderId(null);
        setSeatRect(rect);
        setFlyoutPos(computeFlyoutPosition(rect, FLYOUT_W_EST, FLYOUT_MAX_H));
    };

    // Refine the flyout position with its real size before paint (the
    // estimate ignores the models column, which only renders on hover).
    useLayoutEffect(() => {
        if (!hoveredSeat || !seatRect || !flyoutRef.current) return;
        const w = flyoutRef.current.offsetWidth;
        const h = flyoutRef.current.offsetHeight;
        setFlyoutPos(prev => {
            const next = computeFlyoutPosition(seatRect, w, h);
            return prev && prev.top === next.top && prev.left === next.left && prev.maxHeight === next.maxHeight
                ? prev
                : next;
        });
    }, [hoveredSeat, seatRect, hoveredProviderId, freeOnly]);

    // Close on Escape (mount-scoped — the menu only exists while open).
    React.useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onClose]);

    const setMode = (next: 'normal' | 'lenses') => {
        if (next === mode) return;
        setHoveredSeat(null);
        setHoveredProviderId(null);
        if (next === 'lenses' && (lensConfig.assignments ?? []).length === 0) {
            // Seed an empty roster only — a populated one keeps the user's
            // manual picks (matches the Team modal entry point).
            const auto = autoAssignLenses(lensConfig, readyProviders, regimeProviderStats);
            if (auto) {
                setLensConfig(auto);
                return;
            }
        }
        setLensConfig({ ...lensConfig, enabled: next === 'lenses' });
    };

    const assignSeat = (seat: SeatRow, providerId: string, modelId: string) => {
        if (seat.isModerator) {
            onSetModeratorProvider?.(providerId);
            onSetModeratorModel?.(modelId);
        } else if (seat.role !== undefined) {
            const assignments = (lensConfig.assignments ?? []).map(a =>
                a.role === seat.role ? { role: seat.role, assignedProvider: providerId, assignedModel: modelId } : a
            );
            if (!assignments.some(a => a.role === seat.role)) {
                assignments.push({ role: seat.role, assignedProvider: providerId, assignedModel: modelId });
            }
            setLensConfig({ ...lensConfig, enabled: true, assignments });
        } else if (seat.slot !== undefined) {
            const next = [...(ensembleModelSelection || [])];
            next[seat.slot] = { providerId, model: modelId };
            setEnsembleModelSelection(next);
        }
        onClose();
    };

    const hoveredModels = hoveredProviderId
        ? readyProviders.find(p => p.id === hoveredProviderId)?.models ?? []
        : [];
    const catalogModels = freeOnly ? hoveredModels.filter(isFreeModelId) : hoveredModels;
    const currentModelId = hoveredSeat?.providerId === hoveredProviderId ? hoveredSeat?.modelId ?? '' : '';
    const visibleModels = sortModelsFreeFirst(
        currentModelId && !catalogModels.includes(currentModelId)
            ? [currentModelId, ...catalogModels]
            : catalogModels,
    );

    const handleFreeOnlyToggle = (next: boolean) => {
        setFreeOnly(next);
        writeFreeOnlyPref(next);
    };

    const seatSubtitle = (seat: SeatRow): string => {
        if (!seat.assigned || !seat.providerId) return 'Unassigned';
        const name = providerName(seat.providerId);
        return modelLabel(seat.modelId) ? `${name} · ${modelLabel(seat.modelId)}` : name;
    };
    const modelLabel = (modelId: string): string => formatModelDisplayName(modelId) || modelId;

    const renderSeatRow = (seat: SeatRow) => {
        const isHovered = hoveredSeat?.key === seat.key;
        return (
            <div
                key={seat.key}
                role="button"
                tabIndex={0}
                onMouseEnter={e => handleSeatHover(seat, e.currentTarget.getBoundingClientRect())}
                onClick={e => handleSeatHover(seat, e.currentTarget.getBoundingClientRect())}
                // Keyboard parity — Enter/Space open the flyout.
                onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleSeatHover(seat, e.currentTarget.getBoundingClientRect());
                    }
                }}
                className={`flex w-full cursor-default items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left transition-colors focus-visible:ring-2 focus-visible:ring-zinc-500 ${
                    isHovered ? 'bg-zinc-800 text-white' : 'text-zinc-300 hover:bg-zinc-800 hover:text-white'
                }`}
            >
                <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium">{seat.label}</p>
                    <p className={`truncate text-[11px] ${seat.assigned ? 'text-zinc-500' : 'italic text-zinc-600'}`}>
                        {seatSubtitle(seat)}
                    </p>
                </div>
                <ChevronRightIcon className="h-3 w-3 shrink-0 text-zinc-600" />
            </div>
        );
    };

    return (
        <>
            <div className="fixed inset-0 z-30" onClick={onClose} aria-hidden="true" />
            <div className="absolute bottom-full left-0 z-40 mb-2 w-64 rounded-xl border border-white/10 bg-zinc-900 p-1.5 shadow-2xl animate-fade-in">
                {/* Lenses | Normal — same switch the Team side-sheet had */}
                <div className="mb-1 flex rounded-lg border border-white/10 bg-zinc-950 p-0.5">
                    {(['normal', 'lenses'] as const).map(m => (
                        <button
                            key={m}
                            type="button"
                            onClick={() => setMode(m)}
                            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                                mode === m ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
                            }`}
                        >
                            {m === 'lenses' ? 'Lenses' : 'Normal'}
                        </button>
                    ))}
                </div>

                {readyProviders.length === 0 ? (
                    <p className="px-2.5 py-3 text-[11px] text-zinc-500">
                        No providers ready — add an API key in Settings → AI Models.
                    </p>
                ) : (
                    <>
                        {seats.map(renderSeatRow)}
                        {renderSeatRow(moderatorSeat)}
                    </>
                )}

                {/* Leverage lives here now (moved out of the
                    composer bar for reference parity). */}
                {leverageSection}
            </div>

            {/* Seat picker flyout — portaled so `fixed` positioning survives
                the composer's transforms. Providers column always visible
                once a seat is hovered; models appear on provider hover. */}
            {hoveredSeat && flyoutPos && readyProviders.length > 0 && createPortal(
                <div
                    ref={flyoutRef}
                    onMouseDownCapture={e => e.stopPropagation()}
                    onPointerDownCapture={e => e.stopPropagation()}
                    className="fixed z-[100] flex flex-col rounded-xl border border-white/10 bg-zinc-900 shadow-2xl overflow-hidden animate-fade-in"
                    style={{ top: flyoutPos.top, left: flyoutPos.left, maxHeight: flyoutPos.maxHeight }}
                >
                    <label className="flex shrink-0 cursor-pointer items-center gap-2 border-b border-zinc-800 px-3 py-1.5 text-[11px] text-zinc-400 hover:text-zinc-200">
                        <input
                            type="checkbox"
                            checked={freeOnly}
                            onChange={e => handleFreeOnlyToggle(e.target.checked)}
                            className="rounded border-zinc-600 bg-zinc-800 text-cyan-500 focus:ring-cyan-500/40"
                        />
                        Free models only
                    </label>
                    <div
                        className="flex min-h-0 flex-1 overflow-hidden"
                        style={{ maxHeight: Math.max(FLYOUT_MIN_H, flyoutPos.maxHeight - 34) }}
                    >
                        <div className="w-36 min-h-0 overflow-y-auto border-r border-zinc-800 py-1 custom-scrollbar overscroll-contain">
                            {readyProviders.map(provider => {
                                const isActive = provider.id === hoveredProviderId;
                                const isCurrentProvider = hoveredSeat.providerId === provider.id;
                                return (
                                    <button
                                        key={provider.id}
                                        onMouseEnter={() => setHoveredProviderId(provider.id)}
                                        onClick={() => setHoveredProviderId(provider.id)}
                                        className={`flex w-full items-center justify-between px-3 py-2 text-[13px] transition-colors ${
                                            isActive
                                                ? 'bg-zinc-800 text-white'
                                                : isCurrentProvider
                                                    ? 'text-white'
                                                    : 'text-zinc-300 hover:bg-zinc-800 hover:text-white'
                                        }`}
                                    >
                                        <span className="truncate">{provider.name}</span>
                                        <ChevronRightIcon className="h-3 w-3 shrink-0 text-zinc-600" />
                                    </button>
                                );
                            })}
                        </div>
                        {hoveredProviderId && (
                            <div className="w-48 min-h-0 overflow-y-auto py-1 custom-scrollbar overscroll-contain">
                                {visibleModels.length === 0 ? (
                                    <div className="px-3 py-4 text-center text-xs italic text-zinc-600">
                                        {freeOnly && hoveredModels.length > 0
                                            ? 'No free models in this provider'
                                            : 'No models available'}
                                    </div>
                                ) : (
                                    visibleModels.map(model => {
                                        const taken = takenIdentities.has(`${hoveredProviderId}::${model}`);
                                        const isCurrent = hoveredSeat.providerId === hoveredProviderId && model === hoveredSeat.modelId;
                                        return (
                                            <button
                                                key={model}
                                                onClick={() => !taken && assignSeat(hoveredSeat, hoveredProviderId, model)}
                                                disabled={taken}
                                                title={taken ? 'Already used by another seat' : model}
                                                className={`flex w-full items-center justify-between px-3 py-2 text-[13px] transition-colors ${
                                                    taken
                                                        ? 'cursor-not-allowed text-zinc-600'
                                                        : isCurrent
                                                            ? 'bg-zinc-800 text-white'
                                                            : 'text-zinc-300 hover:bg-zinc-800 hover:text-white'
                                                }`}
                                            >
                                                <span className="truncate">{modelLabel(model)}</span>
                                                {isCurrent && <CheckIcon className="h-3 w-3 shrink-0 text-zinc-100" />}
                                            </button>
                                        );
                                    })
                                )}
                            </div>
                        )}
                    </div>
                </div>,
                document.body
            )}
        </>
    );
};

export default React.memo(TeamRosterMenu);
