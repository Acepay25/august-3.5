
import React, { useState } from 'react';
import { TradeAnalysis, TradeOutcome, TradingStyle } from '../../types';
import { LoadingIcon } from '../shared/Icons';
import { TradeShareService } from '../../services/ui/TradeShareService';

interface ShareMenuProps {
    analysis: TradeAnalysis;
    messageId: string;
    outcome?: TradeOutcome;
    tradingStyle?: Exclude<TradingStyle, 'auto'>;
}

/**
 * Share trade card button. Generates a trade card image, attempts to save it
 * to the gallery, and falls back to copying the image to the clipboard.
 */
const ShareMenu: React.FC<ShareMenuProps> = ({
    analysis,
    outcome,
    tradingStyle
}) => {
    const [isSharing, setIsSharing] = useState(false);
    const [shareSuccess, setShareSuccess] = useState<string | null>(null);

    const handleShare = async () => {
        setIsSharing(true);
        setShareSuccess(null);
        try {
            const blob = await TradeShareService.generateTradeCard(analysis, outcome, {}, tradingStyle);
            const coinName = (analysis.coinName || 'trade').replace(/[^a-zA-Z0-9]/g, '');
            const filename = coinName + '-' + (analysis.direction || 'trade') + '.png';

            // Try GallerySaver first (saves to gallery on Android)
            const saved = await TradeShareService.downloadAsImage(blob, filename);
            if (saved) {
                setShareSuccess('Saved!');
            } else {
                // Fallback to clipboard
                const copied = await TradeShareService.copyToClipboard(blob);
                if (copied) {
                    setShareSuccess('Copied!');
                } else {
                    setShareSuccess('Failed');
                }
            }
        } catch (e) {
            console.error('Share error:', e);
            setShareSuccess('Error');
        }
        setIsSharing(false);
        setTimeout(() => setShareSuccess(null), 2000);
    };

    return (
        <button
            onClick={handleShare}
            disabled={isSharing}
            className="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded-lg transition-colors flex items-center justify-center gap-1 relative"
            title="Share Trade Card"
        >
            {isSharing ? <LoadingIcon className="w-4 h-4" /> : ''}
            {shareSuccess && (
                <span className="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 bg-emerald-600 text-white text-[10px] rounded whitespace-nowrap">
                    {shareSuccess}
                </span>
            )}
        </button>
    );
};

export default React.memo(ShareMenu);
