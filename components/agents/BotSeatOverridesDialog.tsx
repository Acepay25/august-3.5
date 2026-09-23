/**
 * BotSeatOverridesDialog — the debate-seat overrides for one roster bot.
 *
 * These three fields do not live on the roster bot. The pipeline resolves a
 * debate seat to its BotRegistry record by provider + model
 * (hooks/useAnalysisPipeline.ts:2443-2451) and only that record carries them
 * into the run: systemPromptOverride + personality shape the seat's prompt
 * (services/providers/ensembleService.ts:2113-2114) and enabledTools is the
 * allowlist of desk tools that seat may call (ensembleService.ts:2231).
 *
 * A roster bot already IS a provider + model pair, so its row is the honest
 * place to edit them — this dialog finds the matching record and writes back
 * to it. It never creates one: an unmatched bot has no seat to override.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { BotRegistry } from '../../services/bots/BotRegistry';
import { DESK_TOOL_DEFINITIONS } from '../../services/analysis/DeskToolsService';
import type { HermesBot } from '../../types/bot';
import type { AgentBot } from '../../services/agents/agentRoster';
import { useEscapeClose } from '../../hooks/useEscapeClose';

const ALL_TOOLS = DESK_TOOL_DEFINITIONS.map(d => d.function.name);

/** The seat the pipeline would match, or undefined for a bot no debate runs. */
const seatFor = (bots: HermesBot[], bot: AgentBot): HermesBot | undefined =>
    bots.find(b => b.providerId === bot.providerId && b.model === bot.modelId);

const FIELD = 'w-full resize-y rounded-lg border border-white/10 bg-zinc-900 px-3 py-2 text-ui-sm leading-relaxed text-zinc-100 placeholder-zinc-600 outline-none focus:border-white/30';
const LABEL = 'mb-1 block text-ui-dense font-semibold uppercase tracking-widest text-zinc-500';

const BotSeatOverridesDialog: React.FC<{ open: boolean; bot: AgentBot | null; onClose: () => void }> = ({ open, bot, onClose }) => {
    const [seat, setSeat] = useState<HermesBot | null>(null);
    const [prompt, setPrompt] = useState('');
    const [personality, setPersonality] = useState('');
    const [tools, setTools] = useState<string[]>([]);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        if (!open || !bot) return;
        let cancelled = false;
        setLoaded(false);
        void (async () => {
            const match = seatFor(await BotRegistry.list(), bot);
            if (cancelled) return;
            setSeat(match ?? null);
            setPrompt(match?.systemPromptOverride ?? '');
            setPersonality(match?.personality ?? '');
            setTools(match?.enabledTools ?? []);
            setLoaded(true);
        })();
        return () => { cancelled = true; };
    }, [open, bot]);

    useEscapeClose(open, onClose);

    const save = useCallback(async (): Promise<void> => {
        if (!bot || !seat) return;
        await BotRegistry.upsert({
            ...seat,
            systemPromptOverride: prompt.trim() || undefined,
            personality: personality.trim() || undefined,
            // Empty means "let the role's default stand" — BotRegistry.normalize
            // refills a blank allowlist by role, so clearing everything here
            // would silently re-grant the defaults rather than revoke them.
            enabledTools: tools.length > 0 ? tools : seat.enabledTools,
            updatedAt: Date.now(),
        });
        onClose();
    }, [bot, seat, prompt, personality, tools, onClose]);

    if (!open || !bot) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-label={`Debate overrides for ${bot.name}`}>
            <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/10 bg-zinc-950 p-6 shadow-2xl" data-testid="bot-seat-overrides">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <h2 className="text-lg font-semibold text-zinc-100">Debate overrides</h2>
                        <p className="mt-1 text-ui-sm leading-snug text-zinc-500">
                            {bot.name} · {bot.providerId} / {bot.modelId} — how this bot behaves as an
                            analyst seat. Chats and rooms ignore these three fields.
                        </p>
                    </div>
                    <button type="button" onClick={onClose} aria-label="Close debate overrides"
                        className="shrink-0 rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200">
                        <X className="h-4 w-4" />
                    </button>
                </div>

                {!loaded && <p className="mt-6 text-ui-sm text-zinc-600">Loading…</p>}

                {loaded && !seat && (
                    <p className="mt-6 rounded-lg border border-white/10 bg-zinc-900/60 p-3 text-ui-sm leading-relaxed text-zinc-400">
                        No debate seat runs {bot.providerId} / {bot.modelId}, so there is nothing to
                        override. Put this model on your Team first.
                    </p>
                )}

                {loaded && seat && (
                    <div className="mt-5 space-y-4">
                        <div>
                            <span className={LABEL}>System prompt override</span>
                            <textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={4}
                                placeholder={seat.role ? `Empty — this seat runs the ${seat.role} mandate` : 'Empty — the general-analyst default runs'}
                                data-testid="override-prompt" className={FIELD} />
                        </div>
                        <div>
                            <span className={LABEL}>Personality</span>
                            <textarea value={personality} onChange={e => setPersonality(e.target.value)} rows={2}
                                placeholder="e.g. terse, argues from invalidation levels, refuses ungrounded entries"
                                data-testid="override-personality" className={FIELD} />
                        </div>
                        <div>
                            <span className={LABEL}>Desk tools this seat may call</span>
                            <div className="flex flex-wrap gap-1">
                                {ALL_TOOLS.map(t => {
                                    const on = tools.includes(t);
                                    return (
                                        <button key={t} type="button" aria-pressed={on} data-testid={`override-tool-${t}`}
                                            onClick={() => setTools(prev => on ? prev.filter(x => x !== t) : [...prev, t])}
                                            className={`rounded px-1.5 py-0.5 text-ui-xs transition-colors ${
                                                on ? 'bg-zinc-700 text-zinc-100' : 'border border-white/10 text-zinc-500 hover:text-zinc-300'
                                            }`}>
                                            {t}
                                        </button>
                                    );
                                })}
                            </div>
                            <p className="mt-1 text-ui-dense leading-snug text-zinc-600">
                                {tools.length === 0
                                    ? 'Nothing picked keeps the role default — an empty allowlist does not revoke tools.'
                                    : `${tools.length} of ${ALL_TOOLS.length} available.`}
                            </p>
                        </div>
                    </div>
                )}

                <div className="mt-6 flex items-center justify-end gap-2">
                    <button type="button" onClick={onClose}
                        className="rounded-lg px-4 py-2 text-ui-caption font-semibold text-zinc-400 hover:text-zinc-200">
                        Cancel
                    </button>
                    <button type="button" onClick={() => void save()} disabled={!seat}
                        data-testid="save-seat-overrides"
                        className="rounded-lg bg-zinc-200 px-4 py-2 text-ui-caption font-bold text-zinc-900 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40">
                        Save
                    </button>
                </div>
            </div>
        </div>
    );
};

export default React.memo(BotSeatOverridesDialog);
