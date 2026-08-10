import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ProviderConfig } from '../../types/provider';
import { getFirstReadyProvider, isProviderReady } from '../../utils/providerUtils';
import { extractPdfText } from '../../services/infrastructure/pdfTextExtractor';
import { summarizeStrategiesPdf } from '../../services/learning/strategySummarizer';
import { ocrPdfPages } from '../../services/learning/pdfOcrService';
import {
    initStrategyDocs,
    getStrategyDocs,
    saveStrategyDoc,
    updateStrategyDoc,
    deleteStrategyDoc,
    StrategyDoc,
} from '../../services/infrastructure/StrategyService';
import { useToastActions } from '../shared/Toast';
import { useConfirmDialog } from '../shared/ConfirmDialog';
import { ToggleSwitch } from '../shared/ToggleSwitch';
import { ChevronDownIcon, LoadingIcon, TrashIcon, UploadIcon, RefreshIcon, BookmarkIcon } from '../shared/Icons';

interface StrategiesManagerProps {
    /** Active user — strategy docs are stored per-user. */
    username?: string;
    /** Configured providers — the first ready one summarizes the PDF. */
    providerConfigs?: ProviderConfig[];
    /** Resolved global vision model — transcribes scanned (image-only) pages. */
    visionConfig?: ProviderConfig | null;
    /** Master switch: inject enabled docs into analysis prompts. */
    isStrategiesEnabled?: boolean;
    setIsStrategiesEnabled?: (enabled: boolean) => void;
}

const uid = (): string => `strategy_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

/**
 * Settings → Strategies: upload PDF books/manuals, have a model summarize
 * them into concise actionable strategies, then inject the enabled ones into
 * every analysis + debate prompt (analysts and moderator alike), so the
 * ensemble trades the way a human would following the book.
 */
const StrategiesManager: React.FC<StrategiesManagerProps> = ({
    username,
    providerConfigs = [],
    visionConfig = null,
    isStrategiesEnabled = false,
    setIsStrategiesEnabled,
}) => {
    const toast = useToastActions();
    const { confirm, ConfirmDialogComponent } = useConfirmDialog();
    const [docs, setDocs] = useState<StrategyDoc[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isProcessing, setIsProcessing] = useState(false);
    const [processingLabel, setProcessingLabel] = useState('');
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [draft, setDraft] = useState<string>('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    const activeUser = username || 'default';
    const readyProvider = getFirstReadyProvider(providerConfigs);
    // Scanned pages are transcribed by the global vision model; fall back to
    // any ready provider when no vision model resolves.
    const ocrProvider = visionConfig && isProviderReady(visionConfig) ? visionConfig : readyProvider;

    // Refresh the sync cache on mount / user switch, then snapshot the docs.
    useEffect(() => {
        let cancelled = false;
        setIsLoading(true);
        initStrategyDocs(activeUser).then(() => {
            if (cancelled) return;
            setDocs(getStrategyDocs());
            setIsLoading(false);
        });
        return () => { cancelled = true; };
    }, [activeUser]);

    const refresh = useCallback(() => setDocs(getStrategyDocs()), []);

    const handleFileChosen = useCallback(async (file: File) => {
        if (!file || !file.name.toLowerCase().endsWith('.pdf')) {
            toast.error('Not a PDF', 'Please choose a .pdf file to upload.');
            return;
        }
        if (!readyProvider) {
            toast.warning('No AI provider ready', 'Configure and enable a provider (Settings → AI setup) before summarizing a book.');
            return;
        }
        setIsProcessing(true);
        setProcessingLabel(`Reading ${file.name}…`);
        try {
            const buffer = await file.arrayBuffer();
            const extracted = await extractPdfText(buffer);

            // Scanned (image-only) pages have no text layer — transcribe them
            // with the vision model so the whole book can be summarized.
            let fullText = extracted.text;
            if (extracted.pagesNeedingOcr.length > 0) {
                if (!ocrProvider) {
                    toast.warning('Scanned pages need a vision model',
                        'This PDF has image-only pages. Pick a Vision Model in Settings → AI setup → Vision Model, then re-upload.');
                    return;
                }
                setProcessingLabel(`Reading ${extracted.pagesNeedingOcr.length} image-only page(s) with ${ocrProvider.name}…`);
                const ocrText = await ocrPdfPages(
                    extracted.pagesNeedingOcr,
                    ocrProvider,
                    undefined,
                    (done, total) => setProcessingLabel(`Reading image-only pages with ${ocrProvider.name} (${done}/${total})…`)
                );
                fullText = (fullText + '\n' + ocrText).trim();
            }

            if (fullText.length === 0) {
                toast.error('No text found', 'This PDF produced no readable text. Try re-uploading a text-based PDF.');
                return;
            }
            setProcessingLabel(`Summarizing ${file.name} (${extracted.pageCount} pages, ${fullText.length.toLocaleString()} chars)…`);
            const summary = await summarizeStrategiesPdf(fullText, file.name, readyProvider);
            const doc: StrategyDoc = {
                id: uid(),
                sourceName: file.name,
                pageCount: extracted.pageCount,
                charCount: fullText.length,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                summary,
                enabled: true,
            };
            await saveStrategyDoc(doc, activeUser);
            refresh();
            setExpandedId(doc.id);
            setDraft(doc.summary);
            toast.success('Strategies added', `"${file.name}" summarized — edit it below and enable the master switch.`);
        } catch (e: any) {
            const isAbort = e?.name === 'AbortError' || e?.code === 'ABORT_ERR';
            if (isAbort) return;
            console.error('[StrategiesManager] Upload failed:', e);
            toast.error('Could not process PDF', e instanceof Error ? e.message : 'Unknown error');
        } finally {
            setIsProcessing(false);
            setProcessingLabel('');
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    }, [readyProvider, activeUser, refresh, toast]);

    const openEditor = useCallback((doc: StrategyDoc) => {
        setExpandedId(expandedId === doc.id ? null : doc.id);
        setDraft(doc.summary);
    }, [expandedId]);

    const handleSaveEdit = useCallback(async (doc: StrategyDoc) => {
        await updateStrategyDoc(doc.id, { summary: draft }, activeUser);
        refresh();
        toast.success('Strategies saved', `Edits to "${doc.sourceName}" apply to the next analysis.`);
    }, [activeUser, draft, refresh, toast]);

    const handleToggleDoc = useCallback(async (doc: StrategyDoc) => {
        await updateStrategyDoc(doc.id, { enabled: !doc.enabled }, activeUser);
        refresh();
    }, [activeUser, refresh]);

    const handleResummarize = useCallback(async (doc: StrategyDoc) => {
        if (!readyProvider) {
            toast.warning('No AI provider ready', 'Configure and enable a provider before re-summarizing.');
            return;
        }
        setIsProcessing(true);
        setProcessingLabel(`Re-summarizing ${doc.sourceName}…`);
        try {
            const summary = await summarizeStrategiesPdf(doc.summary, doc.sourceName, readyProvider);
            await updateStrategyDoc(doc.id, { summary }, activeUser);
            refresh();
            setDraft(summary);
            toast.success('Re-summarized', `"${doc.sourceName}" updated.`);
        } catch (e) {
            console.error('[StrategiesManager] Re-summarize failed:', e);
            toast.error('Re-summarize failed', e instanceof Error ? e.message : 'Unknown error');
        } finally {
            setIsProcessing(false);
            setProcessingLabel('');
        }
    }, [readyProvider, activeUser, refresh, toast]);

    const handleDelete = useCallback(async (doc: StrategyDoc) => {
        const ok = await confirm({
            title: 'Delete this strategy book?',
            message: `"${doc.sourceName}" and its summary will be removed. Analyses will stop seeing these strategies.`,
            confirmLabel: 'Delete',
            destructive: true,
        });
        if (!ok) return;
        await deleteStrategyDoc(doc.id, activeUser);
        refresh();
        if (expandedId === doc.id) setExpandedId(null);
        toast.success('Deleted', `"${doc.sourceName}" removed.`);
    }, [activeUser, confirm, expandedId, refresh, toast]);

    return (
        <div className="h-full flex flex-col min-h-0">
            {/* Header */}
            <div className="px-6 py-4 border-b border-zinc-800/80 shrink-0 space-y-3">
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <h3 className="text-sm font-bold text-white tracking-tight">Strategies</h3>
                        <p className="text-[11px] text-zinc-500 mt-0.5">
                            Upload trading books (PDF) — a model summarizes them into strategies every analyst and the moderator follow.
                        </p>
                    </div>
                    {setIsStrategiesEnabled && (
                        <div className="shrink-0 flex items-center gap-2.5 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2">
                            <div className="text-right">
                                <p className="text-[10px] font-bold text-zinc-300 uppercase tracking-widest">Inject into analysis</p>
                                <p className="text-[9px] text-zinc-600">{isStrategiesEnabled ? 'On — enabled books are used' : 'Off'}</p>
                            </div>
                            <ToggleSwitch checked={isStrategiesEnabled} onChange={() => setIsStrategiesEnabled(!isStrategiesEnabled)} label="Toggle strategy injection" />
                        </div>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isProcessing}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 text-white text-[10px] font-bold uppercase tracking-widest transition-colors"
                    >
                        <UploadIcon className="w-3.5 h-3.5" />
                        {isProcessing ? 'Working…' : 'Upload PDF book'}
                    </button>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".pdf,application/pdf"
                        className="hidden"
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileChosen(f); }}
                        aria-label="Upload a PDF book"
                    />
                    {isProcessing && (
                        <span className="inline-flex items-center gap-1.5 text-[10px] text-zinc-400">
                            <LoadingIcon className="w-3.5 h-3.5 animate-spin" />
                            {processingLabel}
                        </span>
                    )}
                    {!readyProvider && !isProcessing && (
                        <span className="text-[10px] text-amber-400/90">No ready AI provider — uploads will summarize once one is enabled.</span>
                    )}
                </div>
            </div>

            {/* Docs list */}
            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-4 sm:p-5 space-y-2.5">
                {isLoading ? (
                    <div className="flex justify-center py-10"><LoadingIcon className="w-6 h-6 text-zinc-500" /></div>
                ) : docs.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/40 px-6 py-12 text-center">
                        <BookmarkIcon className="w-8 h-8 text-zinc-700 mx-auto mb-3" />
                        <p className="text-xs font-bold text-zinc-400">No strategy books yet</p>
                        <p className="text-[11px] text-zinc-600 mt-1 max-w-sm mx-auto leading-relaxed">
                            Upload a trading PDF and it will be summarized into strategies here. Enable it and the ensemble
                            (analysts + moderator) will follow it like a human trader following the book.
                        </p>
                    </div>
                ) : docs.map(doc => {
                    const isExpanded = expandedId === doc.id;
                    return (
                        <div key={doc.id} className={`rounded-xl border transition-colors ${isExpanded ? 'border-cyan-500/30 bg-zinc-900' : 'border-white/5 bg-zinc-900/60 hover:border-white/10'}`}>
                            <button
                                type="button"
                                onClick={() => openEditor(doc)}
                                aria-expanded={isExpanded}
                                className="w-full text-left px-4 py-3 flex items-start justify-between gap-3 group"
                            >
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="text-xs font-bold text-zinc-200 group-hover:text-white transition-colors">{doc.sourceName}</span>
                                        <span className={`px-1.5 py-0.5 rounded border text-[9px] font-bold uppercase tracking-widest ${doc.enabled ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-zinc-800 border-white/10 text-zinc-500'}`}>
                                            {doc.enabled ? 'Enabled' : 'Disabled'}
                                        </span>
                                    </div>
                                    <p className="text-[11px] text-zinc-500 mt-1 leading-relaxed line-clamp-2">{doc.summary}</p>
                                    <p className="text-[10px] text-zinc-600 mt-1 font-mono">
                                        {doc.pageCount} pages · {doc.charCount.toLocaleString()} chars · {new Date(doc.updatedAt).toLocaleDateString()}
                                    </p>
                                </div>
                                <ChevronDownIcon className={`w-4 h-4 text-zinc-600 shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                            </button>

                            {isExpanded && (
                                <div className="px-4 pb-4 pt-0 space-y-2.5">
                                    <textarea
                                        value={draft}
                                        onChange={(e) => setDraft(e.target.value)}
                                        spellCheck={false}
                                        className="w-full h-64 resize-y bg-zinc-950 border border-zinc-800 rounded-lg p-3 font-mono text-[11px] leading-relaxed text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-cyan-500/40 transition-colors whitespace-pre"
                                        placeholder="AI summary — edit freely; your text is what the models see."
                                        aria-label={`Edit strategies from ${doc.sourceName}`}
                                    />
                                    <div className="flex items-center justify-between gap-2 flex-wrap">
                                        <div className="flex items-center gap-2">
                                            <button
                                                type="button"
                                                onClick={() => handleSaveEdit(doc)}
                                                className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-700 text-white text-[10px] font-bold uppercase tracking-widest transition-colors"
                                            >
                                                Save
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleToggleDoc(doc)}
                                                className="px-3 py-1.5 rounded-lg border border-white/10 text-zinc-400 hover:text-zinc-200 hover:border-white/20 text-[10px] font-bold uppercase tracking-widest transition-colors"
                                            >
                                                {doc.enabled ? 'Disable' : 'Enable'}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleResummarize(doc)}
                                                disabled={isProcessing}
                                                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-white/10 text-zinc-400 hover:text-zinc-200 hover:border-white/20 disabled:opacity-50 text-[10px] font-bold uppercase tracking-widest transition-colors"
                                            >
                                                <RefreshIcon className="w-3 h-3" />
                                                Re-summarize
                                            </button>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => handleDelete(doc)}
                                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 text-[10px] font-bold uppercase tracking-widest transition-colors"
                                        >
                                            <TrashIcon className="w-3 h-3" />
                                            Delete
                                        </button>
                                    </div>
                                    <p className="text-[10px] text-zinc-600">
                                        {doc.enabled
                                            ? 'Enabled — this summary is injected into every analysis and debate prompt.'
                                            : 'Disabled — the models do not see this summary.'}
                                    </p>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
            {ConfirmDialogComponent}
        </div>
    );
};

export default React.memo(StrategiesManager);
