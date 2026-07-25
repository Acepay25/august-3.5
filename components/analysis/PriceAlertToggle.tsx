
import React, { useState } from 'react';
import { TradeAnalysis } from '../../types';
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
            className={`px-3 py-2 rounded-lg transition-all flex items-center justify-center gap-1 ${alertEnabled ? 'text-amber-400 bg-amber-500/20 border border-amber-500/30' : 'text-zinc-300 bg-zinc-700 hover:bg-zinc-600'}`}
            title={alertEnabled ? 'Alerts ON' : 'Enable Price Alerts'}
        >
            {alertEnabled ? '🔔' : '🔕'}
        </button>
    );
};

export default React.memo(PriceAlertToggle);
