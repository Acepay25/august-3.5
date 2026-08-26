/**
 * ModelPicker — cascading flyout for selecting provider + model.
 *
 * Replaces native <select> dropdowns with a two-column hover-flyout:
 * Left: provider list → Right: model list for hovered provider.
 */

import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ProviderConfig } from '../../types/provider';
import {
    formatModelDisplayName,
    isFreeModelId,
    sortModelsFreeFirst,
    readFreeOnlyPref,
    writeFreeOnlyPref,
} from '../../utils/providerUtils';
import { ChevronRightIcon, ChevronDownIcon, CheckIcon } from './Icons';

/** Viewport rect of the trigger at open time (kept so the flyout can be
 *  re-positioned with the flyout's real size before the first paint). */
interface AnchorRect {
    top: number;
    bottom: number;
    left: number;
    right: number;
}

interface FlyoutPos {
    top: number;
    left: number;
    maxHeight: number;
}

const VIEWPORT_MARGIN = 8;
const FLYOUT_GAP = 4;
const FLYOUT_MAX_H = 360;
const FLYOUT_MIN_H = 140;

/** Calculate flyout position from the trigger rect + the flyout's ACTUAL
 *  width/height, staying within the viewport. Caps height so long model
 *  lists scroll instead of clipping off-screen. */
function computeFlyoutPosition(anchor: AnchorRect, flyoutW: number, flyoutH: number): FlyoutPos {
    const viewportH = window.innerHeight;
    const viewportW = window.innerWidth;
    const spaceBelow = viewportH - anchor.bottom - FLYOUT_GAP - VIEWPORT_MARGIN;
    const spaceAbove = anchor.top - FLYOUT_GAP - VIEWPORT_MARGIN;
    const openBelow = spaceBelow >= spaceAbove;
    const available = Math.max(FLYOUT_MIN_H, openBelow ? spaceBelow : spaceAbove);
    const maxHeight = Math.min(FLYOUT_MAX_H, available);
    const usedH = Math.min(Math.max(flyoutH, FLYOUT_MIN_H), maxHeight);

    const top = openBelow
        ? anchor.bottom + FLYOUT_GAP
        : Math.max(VIEWPORT_MARGIN, anchor.top - FLYOUT_GAP - usedH);

    let left = anchor.left;
    if (left + flyoutW > viewportW - VIEWPORT_MARGIN) {
        left = Math.max(VIEWPORT_MARGIN, viewportW - flyoutW - VIEWPORT_MARGIN);
    }

    return { top, left, maxHeight };
}

// "Free models only" preference lives in utils/providerUtils.ts — shared with
// the team roster menu so the toggle follows the user across flyouts.

export type ModelPickerMode = 'provider-model' | 'model-only' | 'provider-only';

interface ModelPickerProps {
    /** All configured providers. */
    providers: ProviderConfig[];
    /** Current value. Format depends on mode:
     *  - provider-model: "providerId::modelId" or "providerId"
     *  - model-only: "modelId"
     *  - provider-only: "providerId"
     */
    value: string;
    /** Called when user selects. Same format as value. */
    onChange: (value: string) => void;
    /** What to select. Default: 'provider-model'. */
    mode?: ModelPickerMode;
    /** Values to disable (grey out, not clickable). Used for deduplication. */
    disabledValues?: Set<string>;
    /** Show "Manage models" link at bottom. */
    onManageModels?: () => void;
    /** Trigger button label. If omitted, shows current selection text. */
    placeholder?: string;
    /** Extra CSS classes for the trigger button. */
    className?: string;
    /** Small variant for inline use. */
    compact?: boolean;
}

/** Filter to only ready providers (enabled + API key). */
const getReadyProviders = (providers: ProviderConfig[]): ProviderConfig[] =>
    providers.filter(p => p.isEnabled && p.apiKey.trim().length > 0);

const ModelPicker: React.FC<ModelPickerProps> = ({
    providers,
    value,
    onChange,
    mode = 'provider-model',
    disabledValues,
    onManageModels,
    placeholder = 'Select model',
    className = '',
    compact = false,
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [freeOnly, setFreeOnly] = useState(readFreeOnlyPref);
    const [hoveredProvider, setHoveredProvider] = useState<string | null>(null);
    const [anchor, setAnchor] = useState<AnchorRect | null>(null);
    const [flyoutPos, setFlyoutPos] = useState<FlyoutPos | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const flyoutRef = useRef<HTMLDivElement>(null);

    const readyProviders = getReadyProviders(providers);

    // Parse current value to extract providerId and modelId
    const parseValue = useCallback(() => {
        if (mode === 'provider-model') {
            const parts = value.split('::');
            return { providerId: parts[0] || null, modelId: parts[1] || null };
        }
        if (mode === 'provider-only') {
            return { providerId: value || null, modelId: null };
        }
        // model-only — find which provider has this model
        for (const p of readyProviders) {
            if (p.models.includes(value)) {
                return { providerId: p.id, modelId: value };
            }
        }
        return { providerId: null, modelId: value || null };
    }, [value, mode, readyProviders]);

    const { providerId: currentProviderId, modelId: currentModelId } = parseValue();

    // Get display text for trigger button
    const getDisplayText = useCallback(() => {
        if (!value) return placeholder;
        if (mode === 'provider-only') {
            const p = readyProviders.find(p => p.id === value);
            return p?.name || value;
        }
        if (mode === 'model-only') {
            for (const p of readyProviders) {
                if (p.models.includes(value)) {
                    return `${p.name} · ${formatModelDisplayName(value)}`;
                }
            }
            return formatModelDisplayName(value) || value;
        }
        // provider-model
        if (currentProviderId && currentModelId) {
            const p = readyProviders.find(p => p.id === currentProviderId);
            return `${p?.name || currentProviderId} · ${formatModelDisplayName(currentModelId)}`;
        }
        if (currentProviderId) {
            const p = readyProviders.find(p => p.id === currentProviderId);
            return p?.name || currentProviderId;
        }
        return placeholder;
    }, [value, mode, currentProviderId, currentModelId, readyProviders, placeholder]);

    // Close on click outside
    useEffect(() => {
        if (!isOpen) return;
        const handleClickOutside = (e: MouseEvent) => {
            // The flyout is portaled to document.body, so clicks inside it are
            // outside the container — check both refs.
            const target = e.target as Node;
            const insideContainer = containerRef.current?.contains(target) ?? false;
            const insideFlyout = flyoutRef.current?.contains(target) ?? false;
            if (!insideContainer && !insideFlyout) {
                setIsOpen(false);
                setHoveredProvider(null);
                setAnchor(null);
                setFlyoutPos(null);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    // Close on Escape
    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setIsOpen(false);
                setHoveredProvider(null);
                setAnchor(null);
                setFlyoutPos(null);
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen]);

    // Close on page scroll/resize — the flyout is fixed to the viewport and
    // would otherwise detach from the trigger. Scrolls inside the flyout's
    // own scrollable model list are ignored.
    useEffect(() => {
        if (!isOpen) return;
        const close = (e: Event) => {
            const t = e.target as Node | null;
            if (t && flyoutRef.current && flyoutRef.current.contains(t)) return;
            setIsOpen(false);
            setHoveredProvider(null);
            setAnchor(null);
            setFlyoutPos(null);
        };
        window.addEventListener('scroll', close, true);
        window.addEventListener('resize', close);
        return () => {
            window.removeEventListener('scroll', close, true);
            window.removeEventListener('resize', close);
        };
    }, [isOpen]);

    // Correct the position with the flyout's real size. Runs before paint,
    // so the first-paint estimate (320x360) is replaced seamlessly — the
    // flyout width differs per mode (provider-only 192px, model-only 224px,
    // provider-model 416px), so the estimate alone would misalign near the
    // viewport edges.
    useLayoutEffect(() => {
        if (!isOpen || !anchor || !flyoutRef.current) return;
        const w = flyoutRef.current.offsetWidth;
        const h = flyoutRef.current.offsetHeight;
        setFlyoutPos(prev => {
            const next = computeFlyoutPosition(anchor, w, h);
            return prev
                && prev.top === next.top
                && prev.left === next.left
                && prev.maxHeight === next.maxHeight
                ? prev
                : next;
        });
    }, [isOpen, anchor, hoveredProvider, freeOnly]);

    const handleSelectProvider = useCallback((providerId: string) => {
        if (mode === 'provider-only') {
            onChange(providerId);
            setIsOpen(false);
            setHoveredProvider(null);
            setAnchor(null);
            setFlyoutPos(null);
            return;
        }
        // For provider-model and model-only, just hover to show models
        setHoveredProvider(providerId);
    }, [mode, onChange]);

    const handleSelectModel = useCallback((providerId: string, modelId: string) => {
        if (mode === 'provider-model') {
            onChange(`${providerId}::${modelId}`);
        } else {
            onChange(modelId);
        }
        setIsOpen(false);
        setHoveredProvider(null);
        setAnchor(null);
        setFlyoutPos(null);
    }, [mode, onChange]);

    const isDisabled = useCallback((val: string): boolean => {
        return disabledValues?.has(val) ?? false;
    }, [disabledValues]);

    const hoveredModels = hoveredProvider
        ? readyProviders.find(p => p.id === hoveredProvider)?.models ?? []
        : [];
    const catalogModels = mode !== 'provider-only' && freeOnly
        ? hoveredModels.filter(isFreeModelId)
        : hoveredModels;
    const visibleModels = sortModelsFreeFirst(
        hoveredProvider === currentProviderId && currentModelId && !catalogModels.includes(currentModelId)
            ? [currentModelId, ...catalogModels]
            : catalogModels,
    );

    const handleFreeOnlyToggle = useCallback((next: boolean) => {
        setFreeOnly(next);
        writeFreeOnlyPref(next);
    }, []);

    const handleToggle = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
        if (!isOpen) {
            // Snapshot the trigger rect; the exact flyout size is measured
            // in a layout effect once rendered.
            const r = e.currentTarget.getBoundingClientRect();
            const a = { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
            setAnchor(a);
            setFlyoutPos(computeFlyoutPosition(a, 320, 360));
            // Providers-first: no provider pre-hovered, so the flyout opens as
            // a single provider column and models appear only on hover.
            setHoveredProvider(null);
        }
        setIsOpen(!isOpen);
    }, [isOpen]);

    return (
        <div ref={containerRef} className={`relative inline-block ${className}`}>
            {/* Trigger button — bare model name + chevron,
                no boxed chrome. */}
            <button
                onClick={handleToggle}
                className={`flex items-center gap-1.5 rounded-lg text-zinc-200 transition-colors hover:bg-zinc-800 hover:text-white ${
                    compact ? 'px-2 py-1 text-[11px]' : 'px-2.5 py-1.5 text-sm font-medium'
                }`}
            >
                <span className="truncate max-w-[180px]">{getDisplayText()}</span>
                <ChevronDownIcon className={`h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* Flyout — portaled to document.body so `fixed` positioning is
                relative to the viewport. Any transformed/backdrop-filtered
                ancestor (modals with animate-fade-in, backdrop-blur popovers)
                would otherwise become the containing block and misalign the
                flyout from the trigger.
                mousedown/pointerdown stopPropagation: hosts (e.g. ChatInput's
                lens popover) close on any document-level "outside" mousedown —
                since the flyout now lives in body, those would fire for every
                click inside the flyout and tear the host UI down mid-pick. */}
            {isOpen && flyoutPos && createPortal(
                <div
                    ref={flyoutRef}
                    onMouseDownCapture={(e) => e.stopPropagation()}
                    onPointerDownCapture={(e) => e.stopPropagation()}
                    className={`fixed z-[100] flex flex-col bg-zinc-900 border border-white/10 rounded-xl shadow-2xl overflow-hidden animate-fade-in ${
                        mode !== 'provider-only' && hoveredProvider ? 'min-w-[320px]' : 'min-w-[192px]'
                    }`}
                    style={{ top: flyoutPos.top, left: flyoutPos.left, maxHeight: flyoutPos.maxHeight }}
                >
                    {mode !== 'provider-only' && (
                        <label className="flex shrink-0 cursor-pointer items-center gap-2 border-b border-zinc-800 px-3 py-1.5 text-[11px] text-zinc-400 hover:text-zinc-200">
                            <input
                                type="checkbox"
                                checked={freeOnly}
                                onChange={(e) => handleFreeOnlyToggle(e.target.checked)}
                                className="rounded border-zinc-600 bg-zinc-800 text-cyan-500 focus:ring-cyan-500/40"
                            />
                            Free models only
                        </label>
                    )}
                    <div
                        className="flex min-h-0 flex-1 overflow-hidden"
                        style={{ maxHeight: Math.max(FLYOUT_MIN_H, flyoutPos.maxHeight - (mode !== 'provider-only' ? 34 : 0)) }}
                    >
                    {/* Provider list */}
                    <div
                        className="w-48 min-h-0 overflow-y-auto border-r border-zinc-800 py-1 custom-scrollbar overscroll-contain"
                    >
                        {readyProviders.length === 0 ? (
                            <div className="px-3 py-4 text-xs text-zinc-600 italic text-center">
                                No providers configured
                            </div>
                        ) : (
                            readyProviders.map(provider => {
                                const isActive = provider.id === hoveredProvider;
                                const isCurrentProvider = provider.id === currentProviderId;
                                return (
                                    <button
                                        key={provider.id}
                                        onClick={() => handleSelectProvider(provider.id)}
                                        onMouseEnter={() => mode !== 'provider-only' && setHoveredProvider(provider.id)}
                                        className={`w-full flex items-center justify-between px-3 py-2 text-[13px] transition-colors ${
                                            isActive
                                                ? 'bg-zinc-800 text-white'
                                                : isCurrentProvider
                                                    ? 'text-white'
                                                    : 'text-zinc-300 hover:bg-zinc-800 hover:text-white'
                                        }`}
                                    >
                                        <span className="truncate">{provider.name}</span>
                                        {mode !== 'provider-only' && (
                                            <ChevronRightIcon className="w-3 h-3 text-zinc-600 shrink-0" />
                                        )}
                                        {mode === 'provider-only' && isCurrentProvider && (
                                            <CheckIcon className="w-3 h-3 text-zinc-100 shrink-0" />
                                        )}
                                    </button>
                                );
                            })
                        )}
                    </div>

                    {/* Model list — materializes only while a provider is
                        hovered, so the flyout reads providers-first (the model
                        column "appears" next to the list on hover). */}
                    {mode !== 'provider-only' && hoveredProvider && (
                        <div
                            className="w-56 min-h-0 overflow-y-auto py-1 custom-scrollbar overscroll-contain"
                        >
                            {visibleModels.length === 0 ? (
                                <div className="px-3 py-4 text-xs text-zinc-600 italic text-center">
                                    {freeOnly && hoveredModels.length > 0
                                        ? 'No free models in this provider'
                                        : 'No models available'}
                                </div>
                            ) : (
                                visibleModels.map(model => {
                                    const fullValue = mode === 'provider-model' ? `${hoveredProvider}::${model}` : model;
                                    const isCurrent = mode === 'provider-model'
                                        ? hoveredProvider === currentProviderId && model === currentModelId
                                        : model === currentModelId;
                                    const disabled = isDisabled(fullValue);
                                    return (
                                        <button
                                            key={model}
                                            onClick={() => !disabled && handleSelectModel(hoveredProvider, model)}
                                            disabled={disabled}
                                            className={`w-full flex items-center justify-between px-3 py-2 text-[13px] transition-colors ${
                                                disabled
                                                    ? 'text-zinc-600 cursor-not-allowed'
                                                    : isCurrent
                                                        ? 'text-white bg-zinc-800'
                                                        : 'text-zinc-300 hover:bg-zinc-800 hover:text-white'
                                            }`}
                                        >
                                            <span className="truncate" title={model}>{formatModelDisplayName(model)}</span>
                                            {isCurrent && (
                                                <CheckIcon className="w-3 h-3 text-zinc-100 shrink-0" />
                                            )}
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
        </div>
    );
};

export default React.memo(ModelPicker);
