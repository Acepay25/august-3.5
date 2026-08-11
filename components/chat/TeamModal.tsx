import React, { useMemo } from 'react';
import { ProviderConfig } from '../../types';
import { AnalystLensConfig, AnalystRole } from '../../types';
import { EnsembleModelSelection } from '../../services/ui/AnalystLensService';
import GlobalLearningService from '../../services/learning/GlobalLearningService';
import { ANALYST_ROLE_DEFINITIONS } from '../../services/ui/AnalystLensService';
import { CloseIcon } from '../shared/Icons';

interface TeamModalProps {
    isOpen: boolean;
    providers: ProviderConfig[];
    isEnsembleEnabled: boolean;
    setIsEnsembleEnabled: (v: boolean) => void;
    lensConfig: AnalystLensConfig;
    setLensConfig: (config: AnalystLensConfig) => void;
    ensembleModelSelection: EnsembleModelSelection;
    setEnsembleModelSelection: (selection: EnsembleModelSelection) => void;
    onClose: () => void;
}

const LENS_ROLES: { role: AnalystRole; label: string; focus: string }[] = [
    { role: AnalystRole.MACRO_VOLATILITY, label: 'Macro & Volatility', focus: 'HTF trend, volatility regimes, liquidity zones, ATR' },
    { role: AnalystRole.TECHNICAL_ANALYST, label: 'Technical Analyst', focus: 'Chart patterns, structure, levels, momentum' },
    { role: AnalystRole.RISK_EXECUTION, label: 'Risk & Execution', focus: 'R:R, position sizing, entry/SL/TP execution risk' },
];

const STYLES = ['auto', 'position', 'swing', 'scalp'] as const;

/**
 * "Team" launch modal — one canonical place to pick the 3 analysts + lens
 * mode + trading style before sending. Replaces the nested dropdown flow:
 * visible roster, inline validation, auto-assign, save-as-default.
 */
const TeamModal: React.FC<TeamModalProps> = ({
    isOpen, providers, isEnsembleEnabled, setIsEnsembleEnabled,
    lensConfig, setLensConfig, ensembleModelSelection, setEnsembleModelSelection,
    onClose,
}) => {
    const readyProviders = useMemo(
        () => providers.filter(p => p.isEnabled && p.apiKey.trim().length > 0),
        [providers]
    );
    const modelOptions = useMemo(
        () => readyProviders.flatMap(p => p.models.map(m => ({ value: `${p.id}::${m}`, label: `${p.name} · ${m}` }))),
        [readyProviders]
    );

    if (!isOpen) return null;

    const mode = lensConfig.enabled ? 'lenses' : 'normal';

    const setMode = (next: 'normal' | 'lenses') => {
        if (next === 'lenses' && lensConfig.assignments.length === 0) {
            // Auto-assign: prefer the BEST-CALIBRATED ready providers (the
            // user's own per-provider win rates) — routing reflects what
            // actually works, not just "first three providers".
            let providerOrder = [...readyProviders];
            try {
                const byProvider = GlobalLearningService.getCalibration()?.granular?.byProvider;
                if (byProvider) {
                    providerOrder = [...readyProviders].sort((a, b) => {
                        const wa = byProvider[a.id]?.total >= 3 ? byProvider[a.id].wins / byProvider[a.id].total : -1;
                        const wb = byProvider[b.id]?.total >= 3 ? byProvider[b.id].wins / byProvider[b.id].total : -1;
                        return wb - wa;
                    });
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

    const selectCls = 'w-full bg-zinc-900 border border-white/10 rounded-lg px-2.5 py-2 text-xs text-zinc-200 focus:outline-none focus:border-cyan-400/40';
    const labelCls = 'text-[10px] font-bold uppercase tracking-widest text-zinc-500 block mb-1';

    return (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/70 p-4 animate-fade-in" onClick={onClose}>
            <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-zinc-950 shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 bg-zinc-900">
                    <div>
                        <p className="text-sm font-bold text-white">Analyst Team</p>
                        <p className="text-[10px] text-zinc-500">Choose who analyzes your charts before you send.</p>
                    </div>
                    <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-zinc-500 hover:text-zinc-200 transition-colors" aria-label="Close team modal">
                        <CloseIcon className="w-4 h-4" />
                    </button>
                </div>

                <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto custom-scrollbar">
                    {/* Mode segmented */}
                    <div className="flex gap-1.5">
                        {(['normal', 'lenses'] as const).map(m => (
                            <button
                                key={m}
                                type="button"
                                onClick={() => setMode(m)}
                                className={`flex-1 px-3 py-2 rounded-lg border text-[10px] font-bold uppercase tracking-widest transition-all ${mode === m ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-300' : 'bg-zinc-900 border-white/10 text-zinc-500 hover:text-zinc-300'}`}
                            >
                                {m === 'lenses' ? 'Lenses (personas)' : 'Normal (experts)'}
                            </button>
                        ))}
                    </div>

                    {mode === 'lenses' ? (
                        <>
                            {/* Role cards */}
                            {LENS_ROLES.map((r, idx) => (
                                <div key={r.role} className="rounded-xl border border-white/5 bg-zinc-900/60 p-3">
                                    <div className="flex items-center justify-between mb-1.5">
                                        <div className="flex items-center gap-2">
                                            <span className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-black text-zinc-900" style={{ background: ['#8aabd8', '#34d399', '#fb7185'][idx] }}>
                                                {r.label.charAt(0)}
                                            </span>
                                            <span className="text-xs font-bold text-zinc-200">{r.label}</span>
                                        </div>
                                        <span className="text-[9px] text-zinc-600 text-right max-w-[45%]">{r.focus}</span>
                                    </div>
                                    <select className={selectCls} value={roleValue(r.role)} onChange={e => setRole(r.role, e.target.value)}>
                                        <option value="">Select model…</option>
                                        {modelOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                    </select>
                                </div>
                            ))}

                            {/* Trading style */}
                            <div>
                                <span className={labelCls}>Trading style</span>
                                <div className="flex gap-1.5">
                                    {STYLES.map(s => (
                                        <button
                                            key={s}
                                            type="button"
                                            onClick={() => setLensConfig({ ...lensConfig, enabled: true, tradingStyle: s })}
                                            className={`flex-1 px-2 py-1.5 rounded-lg border text-[9px] font-bold uppercase tracking-widest transition-all ${(lensConfig.tradingStyle ?? 'swing') === s ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-300' : 'bg-zinc-900 border-white/10 text-zinc-500 hover:text-zinc-300'}`}
                                        >
                                            {s}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </>
                    ) : (
                        /* Normal mode: 3 expert slots */
                        <div className="space-y-2">
                            {[0, 1, 2].map(slot => (
                                <div key={slot}>
                                    <span className={labelCls}>Expert {slot + 1}</span>
                                    <select className={selectCls} value={normalSlotValue(slot)} onChange={e => setNormalSlot(slot, e.target.value)}>
                                        <option value="">Select model…</option>
                                        {modelOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                    </select>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Moderator note */}
                    <div className="rounded-xl border border-white/5 bg-zinc-900/40 px-3 py-2.5 text-[10px] text-zinc-500 leading-relaxed">
                        <span className="text-zinc-400 font-bold uppercase tracking-widest">Moderator</span> — set in <span className="text-cyan-300">Settings → AI setup</span>. When unset, the app picks a provider that is not one of your analysts.
                    </div>
                </div>

                {/* Footer */}
                <div className="px-4 py-3 border-t border-white/5 bg-zinc-900 flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-[10px] text-zinc-500">
                        {mode === 'lenses'
                            ? `Lenses ${lensConfig.assignments.filter(a => a.assignedProvider).length}/3 roles assigned`
                            : `${ensembleModelSelection.filter(e => e?.providerId).length}/3 experts picked`}
                    </span>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={() => setMode('lenses')}
                            className="px-3 py-1.5 rounded-lg border border-white/10 text-[10px] font-bold uppercase tracking-widest text-zinc-300 hover:bg-zinc-800 transition-colors"
                        >
                            Auto-assign
                        </button>
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-[10px] font-bold uppercase tracking-widest text-white transition-colors"
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
