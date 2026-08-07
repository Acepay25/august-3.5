import React, { useState, useCallback, useEffect } from 'react';
import { PriceAlertService, PriceAlert } from '../../services/ui/PriceAlertService';
import { TrashIcon, LoadingIcon } from '../shared/Icons';
import { useConfirmDialog } from '../shared/ConfirmDialog';

interface AlertManagerProps {
  /** Called when the user toggles/removes an alert — lets callers refresh in-place state. */
  onChanged?: () => void;
}

/**
 * Price-alert management. Alerts are created from the analysis card
 * ("Set alerts") and LiveMarket, but were never listable/editable — this
 * panel surfaces PriceAlertService.getAllAlerts with toggle + delete.
 */
export const AlertManager: React.FC<AlertManagerProps> = ({ onChanged }) => {
  const { confirm, ConfirmDialogComponent } = useConfirmDialog();
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setIsLoading(true);
    try {
      setAlerts(PriceAlertService.getAllAlerts());
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // Ensure persisted alerts are loaded before listing.
    PriceAlertService.init()
      .catch(err => console.warn('[AlertManager] Init failed:', err))
      .finally(refresh);
  }, [refresh]);

  const handleToggle = (id: string) => {
    setBusyId(id);
    try {
      PriceAlertService.toggleAlert(id);
      refresh();
      onChanged?.();
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!await confirm({ title: 'Remove Alert', message: 'Remove this price alert?', destructive: true })) return;
    setBusyId(id);
    try {
      PriceAlertService.removeAlert(id);
      refresh();
      onChanged?.();
    } finally {
      setBusyId(null);
    }
  };

  const formatLevels = (alert: PriceAlert) => {
    const parts: string[] = [];
    if (alert.entryPrice > 0) parts.push(`Entry ${alert.entryPrice.toLocaleString()}`);
    if (alert.stopLoss > 0) parts.push(`SL ${alert.stopLoss.toLocaleString()}`);
    alert.takeProfits.forEach((tp, i) => parts.push(`TP${i + 1} ${tp.toLocaleString()}`));
    return parts.join(' · ') || 'No levels';
  };

  return (
    <>
    <div className="space-y-4">
      <div>
        <h4 className="text-sm font-bold text-white">Price Alerts</h4>
        <p className="text-xs text-zinc-500 mt-0.5">
          Alerts fire while the app is open (price crosses entry / stop / take-profit within the threshold).
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-4 text-zinc-500 text-xs">
          <LoadingIcon className="w-4 h-4" />
          Loading alerts…
        </div>
      ) : alerts.length === 0 ? (
        <div className="py-4 text-center">
          <p className="text-sm text-zinc-500">No price alerts</p>
          <p className="text-xs text-zinc-600 mt-1">Use "Set alerts" on any analysis card to create one.</p>
        </div>
      ) : (
        <div className="divide-y divide-white/5 border border-white/5 rounded-xl overflow-hidden">
          {alerts.map(alert => (
            <div key={alert.id} className="flex items-center gap-3 px-4 py-3 bg-zinc-900/60 hover:bg-zinc-900 transition-colors">
              <button
                onClick={() => handleToggle(alert.id)}
                disabled={busyId === alert.id}
                role="switch"
                aria-checked={alert.enabled}
                aria-label={`${alert.enabled ? 'Disable' : 'Enable'} alert for ${alert.symbol}`}
                className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${alert.enabled ? 'bg-emerald-500/80' : 'bg-zinc-700'}`}
              >
                <span className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all" style={{ left: alert.enabled ? '18px' : '2px' }} />
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-zinc-200">
                  {alert.symbol} <span className="text-zinc-500">· {alert.direction}</span>
                  <span className={`ml-2 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${alert.enabled ? 'bg-emerald-500/10 text-emerald-400' : 'bg-zinc-800 text-zinc-500'}`}>
                    {alert.enabled ? 'Active' : 'Paused'}
                  </span>
                </p>
                <p className="text-[10px] text-zinc-500 mt-0.5 truncate">{formatLevels(alert)}</p>
              </div>
              <button
                onClick={() => handleDelete(alert.id)}
                disabled={busyId === alert.id}
                className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-rose-400 transition-colors shrink-0"
                aria-label={`Delete alert for ${alert.symbol}`}
                title="Delete"
              >
                <TrashIcon className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
    {ConfirmDialogComponent}
    </>
  );
};

export default AlertManager;
