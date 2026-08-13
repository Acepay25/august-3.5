import React, { useMemo } from 'react';
import { ProviderConfig } from '../../types/provider';
import { AnalystRole } from '../../types/enums';
import { AnalystLensConfig } from '../../types/lens';
import { EnsembleModelSelection } from '../../services/ui/AnalystLensService';
import GlobalLearningService from '../../services/learning/GlobalLearningService';
import { RegimeProviderStatsMap } from '../../services/learning/SetupMemoryService';
import { ANALYST_ROLE_DEFINITIONS } from '../../services/ui/AnalystLensService';
import { CloseIcon, EditIcon } from '../shared/Icons';
import ModelPicker from '../shared/ModelPicker';

interface TeamModalProps {
    isOpen: boolean;
    providers: ProviderConfig[];
    isEnsembleEnabled: boolean;
    setIsEnsembleEnabled: (v: boolean) => void;
    lensConfig: AnalystLensConfig;
    setLensConfig: (config: AnalystLensConfig) => void;
    ensembleModelSelection: EnsembleModelSelection;
    setEnsembleModelSelection: (selection: EnsembleModelSelection) => void;
    /** Debate moderator — same picker shape as each analyst (provider::model). */
    moderatorProviderId?: string;
    moderatorModel?: string;
    onSetModeratorProvider?: (providerId: string) => void;
    onSetModeratorModel?: (modelId: string) => void;
    /**
     * Regime-matched provider win rates (providerId → {wr, n}) for the
     * CURRENT market regime. Auto-assign prefers these — a blended all-time
     * number would defeat the regime mechanism. Empty/absent → fall back to
     * overall calibration.
     */
    regimeProviderStats?: RegimeProviderStatsMap;
    onClose: () => void;
    onEditLensPrompt?: (role: AnalystRole) => void;
    onEditNormalPrompt?: () => void;
}

const LENS_ROLES: { role: AnalystRole; label: string; focus: string; initial: string }[] = [
    { role: AnalystRole.MACRO_VOLATILITY, label: 'Macro & Volatility', focus: 'HTF trend, volatility, liquidity, ATR', initial: 'M' },
    { role: AnalystRole.TECHNICAL_ANALYST, label: 'Technical', focus: 'Patterns, structure, levels, momentum', initial: 'T' },
    { role: AnalystRole.RISK_EXECUTION, label: 'Risk & Execution', focus: 'R:R, sizing, entry / SL / TP risk', initial: 'R' },
];

const STYLES = ['auto', 'position', 'swing', 'scalp'] as const;

/**
 * Canonical place to pick the 3 analysts + lens mode + trading style
 * before sending. Opened from the composer Team chip.
 */
const TeamModal: React.FC<TeamModalProps> = ({
    isOpen, providers, setIsEnsembleEnabled,
    lensConfig, setLensConfig, ensembleModelSelection, setEnsembleModelSelection,
    moderatorProviderId = '',
    moderatorModel = '',
    onSetModeratorProvider,
    onSetModeratorModel,
    regimeProviderStats,
    onClose,
    onEditLensPrompt,
    onEditNormalPrompt,
}) => {
    const readyProviders = useMemo(
        () => providers.filter(p => p.isEnabled && p.apiKey.trim().length > 0),
        [providers]
    );

    if (!isOpen) return null;

    const mode = lensConfig.enabled ? 'lenses' : 'normal';

    const setMode = (next: 'normal' | 'lenses') => {
        if (next === 'lenses' && lensConfig.assignments.length === 0) {
            let providerOrder = [...readyProviders];
            try {
                if (regimeProviderStats && regimeProviderStats.size > 0) {
                    providerOrder = [...readyProviders].sort((a, b) =>
                        (regimeProviderStats.get(b.id)?.wr ?? -1) - (regimeProviderStats.get(a.id)?.wr ?? -1)
                    );
                } else {
                    const byProvider = GlobalLearningService.getCalibration()?.granular?.byProvider;
                    if (byProvider) {
                        providerOrder = [...readyProviders].sort((a, b) => {
                            const wa = byProvider[a.id]?.total >= 3 ? byProvider[a.id].wins / byProvider[a.id].total : -1;
                            const wb = byProvider[b.id]?.total >= 3 ? byProvider[b.id].wins / byProvider[b.id].total : -1;
                            return wb - wa;
                        });
                    }
                }
            } catch { /* calibration read is best-effort */ }
            const distinct = [...new Map(providerOrder.map(p => [p.id, p])).values()].slice(0, 3);
            if (distinct.length > 0) {
                const assignments = LENS_ROLES.map((r, i) => ({
                    role: r.role,
                    assignedProvider: distinct[i % distinct.length]?.id ?? null,
                    assignedModel: distinct[i % distinct.length]?.models[0] ?? undefined,
                }));
                setLensConfig({ ...lensConfig, enabled: true, assignments: assignments as AnalystLensConfig['assignments'] });
                setIsEnsembleEnabled(true);
                return;
            }
        }
        setLensConfig({ ...lensConfig, enabled: next === 'lenses' });
        if (next === 'lenses') setIsEnsembleEnabled(true);
    };

    const setRole = (role: AnalystRole, value: string) => {
        const sep = value.indexOf('::');
        const assignedProvider = sep >= 0 ? value.slice(0, sep) : value;
        const assignedModel = sep >= 0 ? value.slice(sep + 2) : undefined;
        const assignments = lensConfig.assignments.map(a =>
            a.role === role ? { role, assignedProvider: assignedProvider || null, assignedModel } : a
        );
        if (!assignments.some(a => a.role === role)) assignments.push({ role, assignedProvider: assignedProvider || null, assignedModel });
        setLensConfig({ ...lensConfig, enabled: true, assignments });
    };

    const setNormalSlot = (slot: number, value: string) => {
        const sep = value.indexOf('::');
        const providerId = sep >= 0 ? value.slice(0, sep) : '';
        const model = sep >= 0 ? value.slice(sep + 2) : '';
        const next = [...ensembleModelSelection];
        next[slot] = { providerId, model };
        setEnsembleModelSelection(next);
    };

    const roleValue = (role: AnalystRole): string => {
        const a = lensConfig.assignments.find(x => x.role === role);
        if (!a?.assignedProvider) return '';
        const p = readyProviders.find(x => x.id === a.assignedProvider);
        const m = a.assignedModel || p?.models[0] || '';
        return m ? `${a.assignedProvider}::${m}` : '';
    };

    const normalSlotValue = (slot: number): string => {
        const e = ensembleModelSelection[slot];
        if (!e?.providerId || !e.model) return '';
        return `${e.providerId}::${e.model}`;
    };

    const assignedCount = mode === 'lenses'
        ? lensConfig.assignments.filter(a => a.assignedProvider).length
        : ensembleModelSelection.filter(e => e?.providerId).length;
    const moderatorValue = moderatorProviderId && moderatorModel
        ? `${moderatorProviderId}::${moderatorModel}`
        : moderatorProviderId || '';
    const setModerator = (value: string) => {
        const sep = value.indexOf('::');
        if (sep >= 0) {
            onSetModeratorProvider?.(value.slice(0, sep));
            onSetModeratorModel?.(value.slice(sep + 2));
        } else {
            onSetModeratorProvider?.(value);
            const selected = readyProviders.find(p => p.id === value);
            if (selected && selected.models.length > 0) {
                onSetModeratorModel?.(selected.selectedModel || selected.models[0]);
            }
        }
    };

    return (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/70 p-4 animate-fade-in pointer-events-auto" onClick={onClose}>
            <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-white/10 bg-zinc-950 shadow-2xl" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between border-b border-white/5 bg-zinc-900 px-4 py-3">
                    <div>
                        <p className="text-sm font-medium text-white">Analyst team</p>
                        <p className="mt-0.5 text-[11px] text-zinc-500">Choose who analyzes your charts before you send.</p>
                    </div>
                    <button onClick={onClose} className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-white/10 hover:text-zinc-200" aria-label="Close team modal">
                        <CloseIcon className="h-4 w-4" />
                    </button>
                </div>

                <div className="custom-scrollbar max-h-[70vh] space-y-4 overflow-y-auto p-4">
                    <div className="flex rounded-lg border border-white/10 bg-zinc-900 p-0.5">
                        {(['normal', 'lenses'] as const).map(m => (
                            <button
                                key={m}
                                type="button"
                                onClick={() => setMode(m)}
                                className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${mode === m ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}
                            >
                                {m === 'lenses' ? 'Lenses' : 'Normal'}
                            </button>
                        ))}
                    </div>

                    {mode === 'lenses' ? (
                        <>
                            {LENS_ROLES.map(r => (
                                <div key={r.role} className="rounded-xl border border-white/5 bg-zinc-900/60 p-3">
                                    <div className="mb-2 flex items-center justify-between gap-2">
                                        <div className="flex min-w-0 items-center gap-2">
                                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/10 bg-zinc-800 text-[10px] font-semibold text-zinc-300">
                                                {r.initial}
                                            </span>
                                            <div className="min-w-0">
                                                <div className="text-xs font-medium text-zinc-200">{r.label}</div>
                                                <div className="truncate text-[11px] text-zinc-600">{r.focus}</div>
                                            </div>
                                        </div>
                                        {onEditLensPrompt && (
                                            <button
                                                type="button"
                                                onClick={() => onEditLensPrompt(r.role)}
                                                className="shrink-0 rounded-md p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
                                                title={`Edit ${ANALYST_ROLE_DEFINITIONS[r.role].shortName} prompt`}
                                            >
                                                <EditIcon className="h-3.5 w-3.5" />
                                            </button>
                                        )}
                                    </div>
                                    <ModelPicker
                                        providers={providers}
                                        value={roleValue(r.role)}
                                        onChange={(v) => setRole(r.role, v)}
                                        mode="provider-model"
                                    />
                                </div>
                            ))}

                            <div>
                                <span className="mb-1.5 block text-[11px] text-zinc-500">Trading style</span>
                                <div className="flex gap-1">
                                    {STYLES.map(s => (
                                        <button
                                            key={s}
                                            type="button"
                                            onClick={() => setLensConfig({ ...lensConfig, enabled: true, tradingStyle: s })}
                                            className={`flex-1 rounded-md px-2 py-1.5 text-[11px] capitalize transition-colors ${(lensConfig.tradingStyle ?? 'swing') === s ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300'}`}
                                        >
                                            {s}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <span className="text-[11px] text-zinc-500">Same prompt for every expert</span>
                                {onEditNormalPrompt && (
                                    <button
                                        type="button"
                                        onClick={onEditNormalPrompt}
                                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
                                    >
                                        <EditIcon className="h-3 w-3" />
                                        Prompt
                                    </button>
                                )}
                            </div>
                            {[0, 1, 2].map(slot => (
                                <div key={slot}>
                                    <span className="mb-1 block text-[11px] text-zinc-500">Expert {slot + 1}</span>
                                    <ModelPicker
                                        providers={providers}
                                        value={normalSlotValue(slot)}
                                        onChange={(v) => setNormalSlot(slot, v)}
                                        mode="provider-model"
                                    />
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="rounded-xl border border-cyan-400/15 bg-zinc-900/60 p-3">
                        <div className="mb-2 flex items-center gap-2">
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-cyan-400/30 bg-cyan-500/10 text-[10px] font-semibold text-cyan-300">
                                S
                            </span>
                            <div className="min-w-0">
                                <div className="text-xs font-medium text-zinc-200">Moderator</div>
                                <div className="truncate text-[11px] text-zinc-600">Synthesizes the debate and writes the final verdict</div>
                            </div>
                        </div>
                        <ModelPicker
                            providers={providers}
                            value={moderatorValue}
                            onChange={setModerator}
                            mode="provider-model"
                        />
                    </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/5 bg-zinc-900 px-4 py-3">
                    <span className="text-[11px] text-zinc-500">
                        {assignedCount}/3 {mode === 'lenses' ? 'roles' : 'experts'}{moderatorValue ? ' · moderator set' : ' · pick a moderator'}
                    </span>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={() => setMode('lenses')}
                            className="rounded-lg border border-white/10 px-3 py-1.5 text-[11px] font-medium text-zinc-300 transition-colors hover:bg-zinc-800"
                        >
                            Auto-assign
                        </button>
                        <button
                            type="button"
                            onClick={onClose}
                            className="rounded-lg bg-cyan-600 px-3 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-cyan-500"
                        >
                            Done
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default React.memo(TeamModal);
