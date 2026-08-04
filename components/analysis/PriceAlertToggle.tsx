
import React, { useState } from 'react';
import { TradeAnalysis } from '../../types';
import { BellIcon } from '../shared/Icons';
import { PriceAlertService } from '../../services/ui/PriceAlertService';

interface PriceAlertToggleProps {
    analysis: TradeAnalysis;
    messageId: string;
}

/**
 * Price alert toggle button. Creates or removes a price alert for the trade.
 * Holds its own alertEnabled state, initialized from any existing alert.
 */
const PriceAlertToggle: React.FC<PriceAlertToggleProps> = ({
    analysis,
    messageId
}) => {
    const [alertEnabled, setAlertEnabled] = useState(() => {
        const existingAlert = PriceAlertService.getAlertForTrade(messageId);
        return existingAlert?.enabled ?? false;
    });

    const handleToggle = () => {
        if (alertEnabled) {
            const alert = PriceAlertService.getAlertForTrade(messageId);
            if (alert) PriceAlertService.removeAlert(alert.id);
            setAlertEnabled(false);
        } else {
            PriceAlertService.createAlert(messageId, analysis, 0.5);
            setAlertEnabled(true);
        }
    };

    return (
        <button
            onClick={handleToggle}
            className={`px-3 py-2 rounded-lg border transition-all flex items-center justify-center gap-1.5 ${alertEnabled ? 'border-amber-400/30 bg-amber-500/15 text-amber-200' : 'border-white/10 bg-zinc-700/80 text-zinc-300 hover:border-amber-400/25 hover:bg-amber-500/10 hover:text-amber-200'}`}
            title={alertEnabled ? 'Alerts ON' : 'Enable Price Alerts'}
            aria-pressed={alertEnabled}
        >
            <BellIcon className="w-4 h-4" />
            <span className="hidden sm:inline text-[10px] font-bold uppercase tracking-wider">{alertEnabled ? 'Alerts on' : 'Alert'}</span>
        </button>
    );
};

export default React.memo(PriceAlertToggle);
