import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Brain, Loader2 } from 'lucide-react';
import { getProviderReasoningStats, getAllThinkingForExport, getThinkingByTrade, getThinkingTrades, getAllThinkingRecordsByUser } from '../../services/infrastructure/ThinkingStoreService';
import { ThinkingRecordStats, ThinkingTradeSummary, ThinkingRecord, AnalystLens } from '../../types/thinking';
import { ThinkingRecordCard } from '../journal/ThinkingRecordCard';
import { ANALYST_LENS_LABEL, ANALYST_LENS_ORDER, isModeratorThinking, resolveAnalystLens } from '../../utils/thinkingLens';
import { ChevronRightIcon, ChevronLeftIcon, FolderIcon, FileTextIcon, ExportIcon } from '../shared/Icons';

interface ReasoningDashboardProps {
  username: string;
  /** Deep link: auto-select this analysis run when the dashboard opens. */
  initialTradeId?: string;
  /** Called after the deep-linked trade has been consumed. */
  onInitialTradeConsumed?: () => void;
  onClose?: () => void;
  onDocumentOpenChange?: (open: boolean) => void;
}

const formatUpdated = (iso: string): string => {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
  if (date.toDateString() === now.toDateString()) return `Updated today at ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return `Updated yesterday at ${time}`;
  return `Updated ${date.toLocaleDateString()}`;
};

const tradeFileName = (records: ThinkingRecord[], tradeId: string): string => {
  for (const record of records) {
    if (!record.analysisJson) continue;
    try {
      const parsed = JSON.parse(record.analysisJson) as { coinName?: string };
      if (parsed.coinName) return `${String(parsed.coinName).replace(/[/\\]/g, '')}.md`;
    } catch {
      /* ignore */
    }
  }
  const short = tradeId.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 16) || 'analysis';
  return `${short}.md`;
};

/**
 * Journal → Reasoning: same folder → file → document drill-down as Memory.
 */
export const ReasoningDashboard: React.FC<ReasoningDashboardProps> = ({
  username,
  initialTradeId,
  onInitialTradeConsumed,
  onDocumentOpenChange,
}) => {
  const [stats, setStats] = useState<ThinkingRecordStats[]>([]);
  const [trades, setTrades] = useState<ThinkingTradeSummary[]>([]);
  const [allRecords, setAllRecords] = useState<ThinkingRecord[]>([]);
  const [selectedLens, setSelectedLens] = useState<AnalystLens | null>(null);
  const [selectedTradeId, setSelectedTradeId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const lastConsumedInitialTradeId = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [statsData, tradesData, allThinking] = await Promise.all([
          getProviderReasoningStats(username),
          getThinkingTrades(username),
          getAllThinkingRecordsByUser(username),
        ]);
        if (cancelled) return;
        setStats(statsData);
        setTrades(tradesData);
        setAllRecords(allThinking);
        setIsLoading(false);
      } catch (err) {
        console.warn('[ReasoningDashboard] Failed to load reasoning data:', err);
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [username]);

  useEffect(() => {
    if (!initialTradeId || lastConsumedInitialTradeId.current === initialTradeId) return;
    lastConsumedInitialTradeId.current = initialTradeId;
    let cancelled = false;
    (async () => {
      try {
        const deepRecords = await getThinkingByTrade(initialTradeId, username);
        if (cancelled) return;
        setSelectedTradeId(initialTradeId);
        const first = deepRecords.find(r => !isModeratorThinking(r));
        if (first) setSelectedLens(resolveAnalystLens(first));
        onInitialTradeConsumed?.();
      } catch (err) {
        console.warn('[ReasoningDashboard] Failed to load deep-linked reasoning:', err);
        if (!cancelled) onInitialTradeConsumed?.();
      }
    })();
    return () => { cancelled = true; };
  }, [initialTradeId, onInitialTradeConsumed, username]);

  useEffect(() => {
    onDocumentOpenChange?.(!!selectedTradeId);
    return () => onDocumentOpenChange?.(false);
  }, [selectedTradeId, onDocumentOpenChange]);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const recordsToExport = await getAllThinkingForExport(username);
      const jsonl = recordsToExport
        .map(r => JSON.stringify({
          provider: r.provider,
          model: r.modelName,
          role: r.role,
          reasoning: r.reasoning,
          finalOutput: r.finalOutput,
          rawReasoning: r.rawReasoning,
          messageId: r.messageId,
          analysis: r.analysis,
          analystLens: r.analystLens,
          confidence: r.confidence,
          probability: r.probability,
          outcome: r.outcome,
          tradeId: r.tradeId,
          createdAt: r.createdAt,
        }))
        .join('\n');

      const blob = new Blob([jsonl], { type: 'application/jsonl' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `august-reasoning-${new Date().toISOString().slice(0, 10)}.jsonl`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('[ReasoningDashboard] Export failed:', err);
    } finally {
      setIsExporting(false);
    }
  };

  const totalRecords = stats.reduce((sum, s) => sum + s.total, 0);

  const lensMeta = useMemo(() => {
    const meta: Record<AnalystLens, { count: number; latest: string }> = {
      macro: { count: 0, latest: '' },
      technical: { count: 0, latest: '' },
      risk: { count: 0, latest: '' },
      normal: { count: 0, latest: '' },
    };
    for (const record of allRecords) {
      if (isModeratorThinking(record)) continue;
      const lens = resolveAnalystLens(record);
      meta[lens].count += 1;
      if (record.createdAt > meta[lens].latest) meta[lens].latest = record.createdAt;
    }
    return meta;
  }, [allRecords]);

  const lensGroups = useMemo(() => {
    if (!selectedLens) return [];
    const groups = new Map<string, ThinkingRecord[]>();
    for (const record of allRecords) {
      if (isModeratorThinking(record)) continue;
      if (resolveAnalystLens(record) !== selectedLens) continue;
      const list = groups.get(record.tradeId) || [];
      list.push(record);
      groups.set(record.tradeId, list);
    }
    return [...groups.entries()]
      .map(([tradeId, recs]) => {
        const summary = trades.find(t => t.tradeId === tradeId);
        const createdAt = recs.reduce((latest, r) => (r.createdAt > latest ? r.createdAt : latest), recs[0]?.createdAt || '');
        return { tradeId, records: recs, createdAt, outcome: summary?.outcome };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [allRecords, selectedLens, trades]);

  const selectedGroup = selectedTradeId
    ? lensGroups.find(g => g.tradeId === selectedTradeId) ?? null
    : null;

  const rowClass = 'w-full flex items-center gap-3.5 px-4 py-3.5 border-b border-zinc-800 last:border-b-0 hover:bg-zinc-800/80 transition-colors text-left';
  const iconBoxClass = 'w-9 h-9 rounded-lg bg-zinc-800 border border-zinc-700/80 flex items-center justify-center shrink-0';

  return (
    <div className="flex flex-col h-full min-h-0 px-8 pb-8">
      <div className="w-full max-w-4xl mx-auto flex flex-col flex-1 min-h-0">
        {!selectedTradeId && !selectedLens && (
          <div className="flex items-start justify-between gap-4 shrink-0 mb-8">
            <p className="text-sm text-zinc-500 leading-relaxed">
              Stored chain-of-thought by analyst role. {totalRecords} records
              {stats.length > 0 ? ` · ${stats.length} models` : ''}.
            </p>
            <button
              onClick={() => { void handleExport(); }}
              disabled={isExporting || totalRecords === 0}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
              aria-label="Export reasoning data as JSONL"
            >
              {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExportIcon className="w-4 h-4" />}
              {isExporting ? 'Exporting…' : 'Export JSONL'}
            </button>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
          </div>
        ) : selectedGroup ? (
          <div className="flex-1 min-h-0 flex flex-col">
            <button
              type="button"
              onClick={() => setSelectedTradeId(null)}
              className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-100 transition-colors mb-6 self-start"
            >
              <ChevronLeftIcon className="w-4 h-4" /> Back
            </button>
            <h4 className="text-lg font-medium text-zinc-100 tracking-tight font-mono mb-2">
              {tradeFileName(selectedGroup.records, selectedGroup.tradeId)}
            </h4>
            <p className="text-sm text-zinc-500 mb-8">
              {selectedLens ? ANALYST_LENS_LABEL[selectedLens] : 'Thinking'}
              {' · '}{formatUpdated(selectedGroup.createdAt)}
              {selectedGroup.outcome ? ` · ${selectedGroup.outcome}` : ''}
            </p>
            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar space-y-3">
              {selectedGroup.records.map(record => (
                <ThinkingRecordCard key={record.id} record={record} />
              ))}
            </div>
          </div>
        ) : selectedLens ? (
          <div className="flex-1 min-h-0 flex flex-col">
            <button
              type="button"
              onClick={() => setSelectedLens(null)}
              className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-100 transition-colors mb-6 self-start"
            >
              <ChevronLeftIcon className="w-4 h-4" /> Back
            </button>
            <h4 className="text-lg font-medium text-zinc-100 tracking-tight mb-8">
              {ANALYST_LENS_LABEL[selectedLens]}
            </h4>
            <div className="flex-1 min-h-0 rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden">
              {lensGroups.length === 0 ? (
                <p className="text-sm text-zinc-500 text-center py-16">
                  No {ANALYST_LENS_LABEL[selectedLens].toLowerCase()} thinking stored yet.
                </p>
              ) : (
                <div className="overflow-y-auto custom-scrollbar h-full">
                  {lensGroups.map(group => (
                    <button
                      key={group.tradeId}
                      type="button"
                      onClick={() => setSelectedTradeId(group.tradeId)}
                      className={rowClass}
                    >
                      <span className={iconBoxClass}>
                        <FileTextIcon className="w-4 h-4 text-zinc-400" />
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block font-mono text-sm text-zinc-100 truncate">
                          {tradeFileName(group.records, group.tradeId)}
                        </span>
                        <span className="block text-xs text-zinc-500 mt-0.5 truncate">
                          {group.records.length} {group.records.length === 1 ? 'record' : 'records'} · {formatUpdated(group.createdAt)}
                        </span>
                      </span>
                      {group.outcome && (
                        <span className={`status-surface px-2 py-0.5 rounded-full text-[10px] border shrink-0 ${
                          group.outcome === 'WIN' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                          : group.outcome === 'LOSS' ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                          : 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20'
                        }`}>
                          {group.outcome}
                        </span>
                      )}
                      <ChevronRightIcon className="w-4 h-4 text-zinc-600 shrink-0" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : allRecords.length === 0 ? (
          <div className="flex-1 rounded-xl border border-zinc-800 bg-zinc-900 flex flex-col items-center justify-center py-16">
            <Brain className="w-10 h-10 text-zinc-700 mb-3" />
            <p className="text-sm text-zinc-500">No reasoning records yet</p>
            <p className="text-xs text-zinc-600 mt-1">Run an analysis to capture thinking here.</p>
          </div>
        ) : (
          <div className="flex-1 min-h-0 rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden">
            <div className="overflow-y-auto custom-scrollbar h-full">
              {ANALYST_LENS_ORDER.map(lens => {
                const meta = lensMeta[lens];
                return (
                  <button
                    key={lens}
                    type="button"
                    onClick={() => setSelectedLens(lens)}
                    className={rowClass}
                  >
                    <span className={iconBoxClass}>
                      <FolderIcon className="w-4 h-4 text-zinc-400" />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium text-zinc-100 truncate">
                        {ANALYST_LENS_LABEL[lens]}
                      </span>
                      <span className="block text-xs text-zinc-500 mt-0.5 truncate">
                        {meta.count} {meta.count === 1 ? 'record' : 'records'}
                        {meta.latest ? ` · ${formatUpdated(meta.latest)}` : ''}
                      </span>
                    </span>
                    <ChevronRightIcon className="w-4 h-4 text-zinc-600 shrink-0" />
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ReasoningDashboard;
