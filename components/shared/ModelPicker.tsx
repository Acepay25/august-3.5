/**
 * ModelPicker — cascading flyout for selecting provider + model.
 *
 * Replaces native <select> dropdowns with a two-column hover-flyout:
 * Left: provider list → Right: model list for hovered provider.
 */

import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ProviderConfig } from '../../types/provider';
import { ChevronRightIcon, CheckIcon } from './Icons';

/** Viewport rect of the trigger at open time (kept so the flyout can be
 *  re-positioned with the flyout's real size before the first paint). */
interface AnchorRect {
    top: number;
    bottom: number;
    left: number;
    right: number;
}

/** Calculate flyout position from the trigger rect + the flyout's ACTUAL
 *  width/height, staying within the viewport. */
function computeFlyoutPosition(anchor: AnchorRect, flyoutW: number, flyoutH: number): { top: number; left: number } {
    const viewportH = window.innerHeight;
    const viewportW = window.innerWidth;

    // Default: below trigger, aligned to trigger's left edge
    let top = anchor.bottom + 4;
    let left = anchor.left;

    // If not enough space below, show above
    if (top + flyoutH > viewportH - 8) {
        top = Math.max(8, anchor.top - flyoutH - 4);
    }

    // If flyout would go off the right edge, align its right edge to viewport
    if (left + flyoutW > viewportW - 8) {
        left = Math.max(8, viewportW - flyoutW - 8);
    }

    return { top, left };
}

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
    const [hoveredProvider, setHoveredProvider] = useState<string | null>(null);
    const [anchor, setAnchor] = useState<AnchorRect | null>(null);
    const [flyoutPos, setFlyoutPos] = useState<{ top: number; left: number } | null>(null);
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
                    return `${p.name}/${value}`;
                }
            }
            return value;
        }
        // provider-model
        if (currentProviderId && currentModelId) {
            const p = readyProviders.find(p => p.id === currentProviderId);
            return `${p?.name || currentProviderId}/${currentModelId}`;
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
            return prev && prev.top === next.top && prev.left === next.left ? prev : next;
        });
    }, [isOpen, anchor]);

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

    const handleToggle = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
        if (!isOpen) {
            // Snapshot the trigger rect; the exact flyout size is measured
            // in a layout effect once rendered.
            const r = e.currentTarget.getBoundingClientRect();
            const a = { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
            setAnchor(a);
            setFlyoutPos(computeFlyoutPosition(a, 320, 360));
        }
        setIsOpen(!isOpen);
    }, [isOpen]);

    return (
        <div ref={containerRef} className={`relative inline-block ${className}`}>
            {/* Trigger button */}
            <button
                onClick={handleToggle}
                className={`flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800 text-white transition-colors hover:bg-zinc-700 ${
                    compact ? 'px-2 py-1 text-[11px]' : 'px-3 py-1.5 text-xs'
                }`}
            >
                <span className="truncate max-w-[180px]">{getDisplayText()}</span>
                <ChevronRightIcon className={`w-3 h-3 text-zinc-500 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
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
                    className="fixed z-[100] flex bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden animate-fade-in min-w-[320px]"
                    style={flyoutPos}
                >
                    {/* Provider list */}
                    <div className="w-48 border-r border-zinc-800 py-1 max-h-[360px] overflow-y-auto custom-scrollbar">
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
                                        className={`w-full flex items-center justify-between px-3 py-2 text-xs transition-colors ${
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
                                            <CheckIcon className="w-3 h-3 text-cyan-400 shrink-0" />
                                        )}
                                    </button>
                                );
                            })
                        )}
                    </div>

                    {/* Model list (shown on hover) */}
                    {mode !== 'provider-only' && (
                        <div className="w-56 py-1 max-h-[360px] overflow-y-auto custom-scrollbar">
                            {hoveredProvider ? (
                                hoveredModels.length === 0 ? (
                                    <div className="px-3 py-4 text-xs text-zinc-600 italic text-center">
                                        No models available
                                    </div>
                                ) : (
                                    hoveredModels.map(model => {
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
                                                className={`w-full flex items-center justify-between px-3 py-2 text-xs transition-colors ${
                                                    disabled
                                                        ? 'text-zinc-600 cursor-not-allowed'
                                                        : isCurrent
                                                            ? 'text-white bg-zinc-800'
                                                            : 'text-zinc-300 hover:bg-zinc-800 hover:text-white'
                                                }`}
                                            >
                                                <span className="truncate">{model}</span>
                                                {isCurrent && (
                                                    <CheckIcon className="w-3 h-3 text-cyan-400 shrink-0" />
                                                )}
                                            </button>
                                        );
                                    })
                                )
                            ) : (
                                <div className="px-3 py-4 text-xs text-zinc-600 italic text-center">
                                    Hover a provider to see models
                                </div>
                            )}
                        </div>
                    )}
                </div>,
                document.body
            )}
        </div>
    );
};

export default React.memo(ModelPicker);
