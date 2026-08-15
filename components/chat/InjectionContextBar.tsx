import React, { useMemo } from 'react';
import { NotebookPen, BookOpen, BrainCircuit, Target, Activity, Waves } from 'lucide-react';
import { ProviderConfig } from '../../types/provider';
import { getMemoryFilesStats } from '../../services/learning/MemoryFilesService';
import { getStrategyDocs } from '../../services/infrastructure/StrategyService';

export type InjectionChipKind = 'notebook' | 'strategies' | 'team' | 'accuracy' | 'hybrid' | 'regime';

interface InjectionContextBarProps {
    providers: ProviderConfig[];
    isEnsembleEnabled: boolean;
    isAccuracyModeEnabled: boolean;
    hybridConnectionStatus?: 'disconnected' | 'connecting' | 'connected' | 'error';
    /** Current hybrid packet — provides the live regime chip. */
    hybridData?: any;
    onChip?: (kind: InjectionChipKind) => void;
}

/**
 * "What the model sees" — a compact chip row above the composer showing every
 * context source injected into the next analysis: notebook files (Trader
 * Notebook), uploaded strategy books, hybrid market data + the CURRENT regime,
 * and the active modes. The composer Team chip shows the analyst roster.
 */
const InjectionContextBar: React.FC<InjectionContextBarProps> = ({
    providers,
    isEnsembleEnabled,
    isAccuracyModeEnabled,
    hybridConnectionStatus,
    hybridData,
    onChip,
}) => {
    const chips = useMemo(() => {
        const list: { kind: InjectionChipKind; label: string; title: string; active: boolean; Icon: React.ComponentType<{ className?: string }> }[] = [];

        const notebook = getMemoryFilesStats();
        if (notebook.enabledCount > 0) {
            list.push({
                kind: 'notebook',
                label: `Notebook ${notebook.enabledCount} · ${(notebook.charCount / 1000).toFixed(1)}k`,
                title: 'Trader Notebook — the markdown memory files injected into every analysis',
                active: true,
                Icon: NotebookPen,
            });
        }

        const strategies = getStrategyDocs().filter(d => d.enabled && d.summary.trim()).length;
        if (strategies > 0) {
            list.push({
                kind: 'strategies',
                label: `Strategies ${strategies}`,
                title: 'Uploaded strategy books injected into the analysis',
                active: true,
                Icon: BookOpen,
            });
        }

        if (isEnsembleEnabled) {
            list.push({ kind: 'team', label: 'Team', title: 'Analyst team is on', active: true, Icon: BrainCircuit });
        }
        if (isAccuracyModeEnabled) {
            list.push({ kind: 'accuracy', label: 'Accuracy', title: 'Accuracy Mode is on', active: true, Icon: Target });
        }

        const hybrid = hybridConnectionStatus === 'connected';
        if (hybrid) {
            list.push({ kind: 'hybrid', label: 'Hybrid live', title: 'Real-time market data is injected (15m/1h/4h/1d)', active: true, Icon: Activity });
        } else if (hybridConnectionStatus === 'connecting') {
            list.push({ kind: 'hybrid', label: 'Hybrid…', title: 'Connecting to live market data', active: false, Icon: Activity });
        }

        const regime = hybridData?.regime?.regime;
        if (hybrid && typeof regime === 'string' && regime) {
            list.push({
                kind: 'regime',
                label: `regime ${regime.replace(/_/g, ' ')}`,
                title: 'Current market regime — drives the regime-matched model weighting',
                active: true,
                Icon: Waves,
            });
        }

        return list;
    }, [providers, isEnsembleEnabled, isAccuracyModeEnabled, hybridConnectionStatus, hybridData]);

    if (chips.length === 0) return null;

    return (
        <div className="flex flex-wrap items-center justify-end gap-1.5" aria-label="Analysis context">
            {chips.map(chip => {
                const Icon = chip.Icon;
                const className = `inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[9px] font-bold tracking-wide transition-colors ${
                    chip.active
                        ? 'border-white/10 bg-zinc-900/80 text-zinc-400 hover:text-zinc-200'
                        : 'border-white/5 bg-zinc-950 text-zinc-600'
                }`;
                return (
                    <button
                        key={chip.label}
                        type="button"
                        title={chip.title}
                        className={className}
                        onClick={() => onChip?.(chip.kind)}
                    >
                        <Icon className="h-3 w-3" />
                        {chip.label}
                    </button>
                );
            })}
        </div>
    );
};

export default React.memo(InjectionContextBar);
