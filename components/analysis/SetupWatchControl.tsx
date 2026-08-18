/**
 * SetupWatchControl — "Watch this setup" button + status pill for an
 * analysis card.
 *
 * Idle: opens an inline trigger-config popover (price above / below / ±% move).
 * Armed: amber pill showing the trigger + cancel button.
 * Triggered: neutral pill — the re-debate was launched.
 *
 * State is owned by the SetupWatchService singleton and read through
 * useSyncExternalStore, so the card stays in sync without threading props
 * through MessageItem / chatContext (which must keep a stable identity).
 */

import React, { useState } from 'react';
import { useSyncExternalStore } from 'react';
import { TradeAnalysis, SetupWatchTriggerType } from '../../types';
import { EyeIcon, CloseIcon, CheckIcon } from '../shared/Icons';
import { PriceAlertService } from '../../services/ui/PriceAlertService';
import { SetupWatchService, describeWatchTrigger } from '../../services/ui/SetupWatchService';
import { parsePrice as canonicalParsePrice } from '../../utils/analysisUtils';
import { useEscapeClose } from '../../hooks/useEscapeClose';
import { useFocusTrap } from '../../hooks/useFocusTrap';

interface SetupWatchControlProps {
    analysis: TradeAnalysis;
    messageId: string;
}

const TRIGGER_TYPES: Array<{ type: SetupWatchTriggerType; label: string; hint: string }> = [
    { type: 'PRICE_ABOVE', label: 'Above', hint: 'Re-debate when price breaks above a level' },
    { type: 'PRICE_BELOW', label: 'Below', hint: 'Re-debate when price drops below a level' },
    { type: 'PCT_MOVE', label: '±% Move', hint: 'Re-debate when price moves a % from now' },
    { type: 'INVALIDATION', label: 'Invalidation', hint: 'Re-debate when the thesis invalidation level is crossed' },
];

const fmtPrice = (n: number | undefined): string => {
    if (n == null || !isFinite(n)) return '—';
    return n >= 1000 ? `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : `$${n.toFixed(2)}`;
};

const SetupWatchControl: React.FC<SetupWatchControlProps> = ({ analysis, messageId }) => {
    const watch = useSyncExternalStore(
        (cb) => SetupWatchService.subscribeChanges(cb),
        () => SetupWatchService.getWatchForMessage(messageId),
    );

    const [open, setOpen] = useState(false);
    const [triggerType, setTriggerType] = useState<SetupWatchTriggerType>('PRICE_ABOVE');
    const [priceLevel, setPriceLevel] = useState('');
    const [percent, setPercent] = useState('2');
    // Escape closes the popover (matches the modal convention).
    useEscapeClose(open, () => setOpen(false));

    const symbol = PriceAlertService.normalizeSymbol(analysis.coinName || 'UNKNOWN');
    const currentPrice = PriceAlertService.getCurrentPrice(symbol);

    const popoverRef = useFocusTrap<HTMLDivElement>(open);

    const openDialog = () => {
        const entry = canonicalParsePrice(analysis.entryPoints?.[0]?.price);
        const inv = canonicalParsePrice(analysis.invalidationCriteria?.[0]?.level || '');
        setTriggerType(inv > 0 ? 'INVALIDATION' : 'PRICE_ABOVE');
        const seed = inv > 0 ? inv : entry > 0 ? entry : (currentPrice ?? 0);
        setPriceLevel(seed > 0 ? String(seed) : '');
        setPercent('2');
        setOpen(true);
    };

    const levelNum = parseFloat(priceLevel);
    const pctNum = parseFloat(percent);
    const isLevelValid = triggerType !== 'PCT_MOVE' && levelNum > 0;
    const isMoveValid = triggerType === 'PCT_MOVE' && pctNum > 0 && currentPrice != null;

    const entryLevel = canonicalParsePrice(analysis.entryPoints?.[0]?.price || '');
    const stopLevel = canonicalParsePrice(analysis.stopLoss || '');

    /** Pick the crossing direction for a level: compare against the live
     *  price when known, else fall back to the setup's direction (a Long
     *  stop sits below, a Long entry above, and vice versa for Shorts). */
    const triggerForLevel = (level: number, isStop: boolean): SetupWatchTriggerType => {
        if (currentPrice != null && currentPrice > 0) {
            return level >= currentPrice ? 'PRICE_ABOVE' : 'PRICE_BELOW';
        }
        if (isStop) return analysis.direction === 'Short' ? 'PRICE_ABOVE' : 'PRICE_BELOW';
        return analysis.direction === 'Short' ? 'PRICE_BELOW' : 'PRICE_ABOVE';
    };

    /** One-tap auto-recheck: arm a watch directly at the plan's entry or
     *  stop level — no popover input needed. */
    const armAtLevel = (level: number, isStop: boolean): void => {
        if (!(level > 0)) return;
        SetupWatchService.createWatch({
            messageId,
            coinName: analysis.coinName || 'UNKNOWN',
            triggerType: triggerForLevel(level, isStop),
            priceLevel: level,
            referencePrice: currentPrice ?? level,
            direction: analysis.direction === 'Long' || analysis.direction === 'Short' ? analysis.direction : undefined,
        });
        setOpen(false);
    };

    const handleCreate = () => {
        if (!isLevelValid && !isMoveValid) return;
        SetupWatchService.createWatch({
            messageId,
            coinName: analysis.coinName || 'UNKNOWN',
            triggerType,
            priceLevel: triggerType === 'PCT_MOVE' ? undefined : levelNum,
            percent: triggerType === 'PCT_MOVE' ? pctNum : undefined,
            referencePrice: currentPrice ?? 0,
            direction: analysis.direction === 'Long' || analysis.direction === 'Short' ? analysis.direction : undefined,
        });
        setOpen(false);
    };

    // ─── Status pills ─────────────────────────────────────────────────────
    if (watch?.status === 'ARMED') {
        return (
            <div className="relative flex items-center gap-1">
                <span
                    className="px-3 py-2 rounded-lg border border-amber-400/30 bg-amber-500/15 text-amber-200 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5"
                    title={`Re-debate when ${describeWatchTrigger(watch)} (armed)`}
                >
                    <EyeIcon className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">{describeWatchTrigger(watch)}</span>
                    <span className="sm:hidden">Armed</span>
                </span>
                <button
                    onClick={() => SetupWatchService.cancelWatch(watch.id)}
                    className="px-2 py-2 rounded-lg border border-white/10 bg-zinc-700/80 text-zinc-400 hover:text-rose-300 hover:border-rose-400/30 transition-colors"
                    title="Cancel re-debate trigger"
                    aria-label="Cancel re-debate trigger"
                >
                    <CloseIcon className="w-3.5 h-3.5" />
                </button>
            </div>
        );
    }
    if (watch?.status === 'TRIGGERED') {
        return (
            <span
                className="px-3 py-2 rounded-lg border border-white/10 bg-zinc-700/60 text-zinc-400 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5"
                title={`Watch fired (${watch.triggerCount}x) — re-debate launched`}
            >
                <CheckIcon className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Re-debate launched</span>
                <span className="sm:hidden">Done</span>
            </span>
        );
    }

    // ─── Idle: Watch button + trigger config popover ──────────────────────
    return (
        <div className="relative">
            <button
                onClick={() => (open ? setOpen(false) : openDialog())}
                className="px-3 py-2 rounded-lg border border-white/10 bg-zinc-700/80 text-zinc-300 transition-colors hover:border-white/25 hover:bg-zinc-700 flex items-center justify-center gap-1.5"
                title="Arm a price trigger to re-run this debate (separate from pinning to the Watch list)"
                aria-expanded={open}
            >
                <EyeIcon className="w-3.5 h-3.5" />
                <span className="hidden sm:inline text-[10px] font-bold uppercase tracking-wider">Re-debate</span>
            </button>
            {open && (
                <div ref={popoverRef} className="absolute right-0 top-full mt-1 z-40 w-72 rounded-lg border border-white/10 bg-zinc-800 shadow-xl p-3 text-left" role="dialog" aria-label="Arm price-triggered re-debate">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-2">
                        Re-debate when…
                    </div>
                    {/* One-tap presets at the plan's own levels */}
                    {(entryLevel > 0 || stopLevel > 0) && (
                        <div className="flex gap-1 mb-2">
                            {entryLevel > 0 && (
                                <button
                                    onClick={() => armAtLevel(entryLevel, false)}
                                    title={`Auto-recheck when price reaches the entry at ${fmtPrice(entryLevel)}`}
                                    className="flex-1 px-2 py-1.5 rounded-md border border-white/10 bg-zinc-700/60 text-[10px] font-bold uppercase tracking-wider text-zinc-300 hover:text-zinc-100 hover:border-white/25 transition-colors"
                                >
                                    At entry {fmtPrice(entryLevel)}
                                </button>
                            )}
                            {stopLevel > 0 && (
                                <button
                                    onClick={() => armAtLevel(stopLevel, true)}
                                    title={`Auto-recheck when price reaches the stop at ${fmtPrice(stopLevel)}`}
                                    className="flex-1 px-2 py-1.5 rounded-md border border-white/10 bg-zinc-700/60 text-[10px] font-bold uppercase tracking-wider text-zinc-300 hover:text-zinc-100 hover:border-white/25 transition-colors"
                                >
                                    At stop {fmtPrice(stopLevel)}
                                </button>
                            )}
                        </div>
                    )}
                    {/* Trigger type selector */}
                    <div className="flex gap-1 mb-2">
                        {TRIGGER_TYPES.map(t => (
                            <button
                                key={t.type}
                                onClick={() => setTriggerType(t.type)}
                                title={t.hint}
                                className={`flex-1 px-2 py-1.5 rounded-md border text-[10px] font-bold uppercase tracking-wider transition-colors ${
                                    triggerType === t.type
                                        ? 'border-white/25 bg-zinc-700 text-zinc-100'
                                        : 'border-white/10 bg-zinc-700/60 text-zinc-400 hover:text-zinc-200'
                                }`}
                            >
                                {t.label}
                            </button>
                        ))}
                    </div>
                    {/* Level / percent input */}
                    {triggerType !== 'PCT_MOVE' ? (
                        <label className="block mb-2">
                            <span className="text-[10px] text-zinc-400 uppercase tracking-wider">Trigger price (USDT)</span>
                            <input
                                type="number"
                                step="any"
                                value={priceLevel}
                                onChange={e => setPriceLevel(e.target.value)}
                                className="mt-1 w-full px-2 py-1.5 rounded-md bg-zinc-900 border border-white/10 text-zinc-200 text-sm focus:outline-none focus:border-amber-400/40"
                                placeholder="e.g. 65000"
                            />
                        </label>
                    ) : (
                        <label className="block mb-2">
                            <span className="text-[10px] text-zinc-400 uppercase tracking-wider">Move % from now</span>
                            <input
                                type="number"
                                step="any"
                                min="0"
                                value={percent}
                                onChange={e => setPercent(e.target.value)}
                                className="mt-1 w-full px-2 py-1.5 rounded-md bg-zinc-900 border border-white/10 text-zinc-200 text-sm focus:outline-none focus:border-amber-400/40"
                                placeholder="e.g. 2"
                            />
                        </label>
                    )}
                    <div className="text-[10px] text-zinc-500 mb-2">
                        Current: {currentPrice != null ? fmtPrice(currentPrice) : 'fetching…'}
                        {triggerType === 'PCT_MOVE' && currentPrice != null && (
                            <span className="block mt-0.5 text-zinc-400">
                                ±{pctNum > 0 ? pctNum.toFixed(1) : '—'}% → {fmtPrice(currentPrice * (1 + (pctNum > 0 ? pctNum : 0) / 100))} / {fmtPrice(currentPrice * (1 - (pctNum > 0 ? pctNum : 0) / 100))}
                            </span>
                        )}
                    </div>
                    <div className="flex gap-1.5">
                        <button
                            onClick={handleCreate}
                            disabled={!isLevelValid && !isMoveValid}
                            className="flex-1 px-3 py-1.5 rounded-md border border-white/20 bg-zinc-700 text-zinc-100 text-[10px] font-bold uppercase tracking-wider hover:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                            Arm trigger
                        </button>
                        <button
                            onClick={() => setOpen(false)}
                            className="px-3 py-1.5 rounded-md border border-white/10 bg-zinc-700/60 text-zinc-400 text-[10px] font-bold uppercase tracking-wider hover:text-zinc-200 transition-colors"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default React.memo(SetupWatchControl);
