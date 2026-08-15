import React, { useEffect, useRef, useState } from 'react';
import { Message, TradeAnalysis, TradeOutcome, TradingStyle } from '../../types';
import { LoadingIcon, ShareIcon } from '../shared/Icons';
import { TradeShareService } from '../../services/ui/TradeShareService';
import { exportTextAsFile } from '../../services/infrastructure/ExportService';
import { buildAnalysisReportHtml, buildAnalysisReportJson, buildAnalysisReportMarkdown } from '../../utils/analysisReport';

interface ShareMenuProps {
    analysis: TradeAnalysis;
    outcome?: TradeOutcome;
    tradingStyle?: Exclude<TradingStyle, 'auto'>;
    message?: Pick<Message, 'analysis' | 'debateTurns' | 'debateRunLog'> & { text?: string };
}

const ShareMenu: React.FC<ShareMenuProps> = ({
    analysis,
    outcome,
    tradingStyle,
    message,
}) => {
    const [isSharing, setIsSharing] = useState(false);
    const [shareSuccess, setShareSuccess] = useState<string | null>(null);
    const [open, setOpen] = useState(false);
    const shareResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => () => {
        if (shareResetTimer.current) clearTimeout(shareResetTimer.current);
    }, []);

    const flash = (label: string): void => {
        setShareSuccess(label);
        if (shareResetTimer.current) clearTimeout(shareResetTimer.current);
        shareResetTimer.current = setTimeout(() => setShareSuccess(null), 2000);
    };

    const handleShareImage = async (): Promise<void> => {
        setIsSharing(true);
        try {
            const blob = await TradeShareService.generateTradeCard(analysis, outcome, {}, tradingStyle);
            const coinName = (analysis.coinName || 'trade').replace(/[^a-zA-Z0-9]/g, '');
            const filename = coinName + '-' + (analysis.direction || 'trade') + '.png';
            const saved = await TradeShareService.downloadAsImage(blob, filename);
            if (saved) flash('Saved!');
            else flash((await TradeShareService.copyToClipboard(blob)) ? 'Copied!' : 'Failed');
        } catch (e) {
            console.error('Share error:', e);
            flash('Error');
        }
        setIsSharing(false);
        setOpen(false);
    };

    const handleReport = async (kind: 'md' | 'json' | 'html'): Promise<void> => {
        const payload = message || { analysis };
        const coin = (analysis.coinName || 'trade').replace(/[^a-zA-Z0-9]/g, '');
        const body = kind === 'json'
            ? JSON.stringify(buildAnalysisReportJson(payload), null, 2)
            : kind === 'html'
                ? buildAnalysisReportHtml(payload)
                : buildAnalysisReportMarkdown(payload);
        const ext = kind === 'json' ? 'json' : kind === 'html' ? 'html' : 'md';
        const result = await exportTextAsFile(body, `${coin}-analysis.${ext}`);
        flash(result.success ? 'Exported' : 'Failed');
        setOpen(false);
    };

    return (
        <div className="relative">
            <button
                type="button"
                onClick={() => setOpen(v => !v)}
                disabled={isSharing}
                className="px-3 py-2 rounded-lg border border-white/10 bg-zinc-900 text-zinc-200 hover:border-white/20 hover:bg-zinc-800 transition-colors flex items-center justify-center gap-1.5"
                title="Share analysis"
            >
                {isSharing ? <LoadingIcon className="w-4 h-4" /> : <ShareIcon className="w-4 h-4" />}
                <span className="hidden sm:inline text-[10px] font-bold uppercase tracking-wider">Share</span>
            </button>
            {shareSuccess && (
                <span className="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 bg-zinc-800 text-zinc-100 text-[10px] rounded whitespace-nowrap">
                    {shareSuccess}
                </span>
            )}
            {open && (
                <div className="relative z-20 mt-1 min-w-[140px] rounded-lg border border-white/10 bg-zinc-950 py-1 shadow-xl">
                    <button type="button" className="block w-full px-3 py-1.5 text-left text-[11px] text-zinc-300 hover:bg-zinc-800" onClick={() => void handleShareImage()}>Image card</button>
                    <button type="button" className="block w-full px-3 py-1.5 text-left text-[11px] text-zinc-300 hover:bg-zinc-800" onClick={() => void handleReport('md')}>Markdown</button>
                    <button type="button" className="block w-full px-3 py-1.5 text-left text-[11px] text-zinc-300 hover:bg-zinc-800" onClick={() => void handleReport('json')}>JSON</button>
                    <button type="button" className="block w-full px-3 py-1.5 text-left text-[11px] text-zinc-300 hover:bg-zinc-800" onClick={() => void handleReport('html')}>HTML</button>
                </div>
            )}
        </div>
    );
};

export default React.memo(ShareMenu);
