
import React, { useState } from 'react';
import ImagePreview from '../shared/ImagePreview';
import { PlusIcon, LoadingIcon, SendIcon, StopIcon } from '../shared/Icons';
import { SelectMenu } from '../shared/SelectMenu';
import { ImageMetadata, AnalystLensConfig, AnalystRole } from '../../types';
import { ProviderConfig } from '../../types/provider';
import { EnsembleModelSelection, ANALYST_ROLE_DEFINITIONS, getLensPromptForRole } from '../../services/ui/AnalystLensService';
import { RegimeProviderStatsMap } from '../../services/learning/SetupMemoryService';
import { MASTER_ANALYSIS_PROMPT } from '../../constants/prompts';
import PromptEditorModal from '../settings/PromptEditorModal';
import TeamModal from './TeamModal';
import TeamRosterMenu from './TeamRosterMenu';
import { LeverageSection } from './LeverageSection';
import ModelPicker from '../shared/ModelPicker';

import { parseComposerIntent } from '../../utils/composerMentions';
import { formatModelDisplayName } from '../../utils/providerUtils';
import { buildTeamRoster, LENS_ROSTER_ROLES } from '../../utils/teamRoster';
import { listSkills, titleFromMeta } from '../../services/learning/SkillMemoryService';
import type { AgentBot } from '../../services/agents/agentRoster';
import { botHandle } from '../../services/agents/botMailbox';

interface ChatInputProps {
    images: ImageMetadata[];
    removeImage: (index: number) => void;
    leverageInput: string;
    handleLeverageChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    handleLeverageBlur: (e: React.FocusEvent<HTMLInputElement>) => void;
    handlePresetLeverage: (value: number) => void;
    fileInputRef: React.RefObject<HTMLInputElement | null>;
    isImageUploadDisabled: boolean;
    handleImageUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
    input: string;
    setInput: (value: string) => void;
    handleSendMessage: () => void;
    handleCancelAnalysis: () => void;
    loadingMessage: string | null;
    isSummarizing: boolean;
    // True while ANY phase of the analysis run is active (incl. the debate,
    // when loadingMessage is null) — drives the Send↔Stop toggle so the user
    // can always cancel, even mid-debate.
    isAnalysisInProgress: boolean;
    steeringNotes?: string[];
    onRemoveSteeringNote?: (index: number) => void;
    isRateLimited: boolean;
    isAnyProviderEnabled: boolean;
    // Ensemble Intelligence Configuration — dynamic provider list
    providers: ProviderConfig[];
    onUpdateProvider?: (id: string, updates: Partial<Omit<ProviderConfig, 'id' | 'isBuiltIn'>>) => Promise<void>;
    // Vision Model Selection
    selectedVisionModel: string;
    setSelectedVisionModel: (modelId: string) => void;
    // Lens Config
    lensConfig: AnalystLensConfig;
    setLensConfig: (config: AnalystLensConfig) => void;
    // Ordinary ensemble model selection (Lenses off): the three models chosen
    // here drive the live cards and the debate.
    ensembleModelSelection: EnsembleModelSelection;
    setEnsembleModelSelection: (selection: EnsembleModelSelection) => void;
    // Custom prompt overrides (prompt editor).
    customEnsemblePrompt: string | null;
    setCustomEnsemblePrompt: (prompt: string | null) => void;
    customLensPrompts: Record<string, string>;
    setCustomLensPrompts: (prompts: Record<string, string>) => void;
    // Ensemble mode: off = casual chat with the selected model (chart
    // upload/analysis disabled); on = full analysis pipeline.
    isEnsembleEnabled: boolean;
    setIsEnsembleEnabled: (v: boolean) => void;
    // Casual-chat model: which model answers when ensemble is off.
    // Stored app-wide (Preferences); falls back to the first ready model.
    selectedChatModel: string;
    setSelectedChatModel: (modelId: string) => void;
    /** Debate moderator — picked in the Team modal alongside the analysts. */
    moderatorProviderId?: string;
    moderatorModel?: string;
    onSetModeratorProvider?: (providerId: string) => void;
    onSetModeratorModel?: (modelId: string) => void;
    /**
     * Regime-matched provider win rates for the CURRENT market regime —
     * feeds the lens auto-assign so routing prefers who wins in THIS
     * regime, not blended all-time.
     */
    regimeProviderStats?: RegimeProviderStatsMap;
    onOpenSettings?: (tab?: string) => void;
    onOpenLiveMarket?: () => void;
    /** Overrides the computed placeholder (e.g. "Message Sales" in a 1:1 thread). */
    placeholderOverride?: string;
    /** True inside a 1:1 agent thread: the Talk-to selector hides (the
     *  thread header names the target) and the placeholder left-aligns. */
    threadMode?: boolean;
    /** Named bots — offered by the Talk-to selector ahead of raw models;
     *  picking one opens that bot's 1:1 thread. */
    bots?: AgentBot[];
    /** Switch to a named bot's 1:1 thread (Talk-to / New bot flow). */
    onSelectBot?: (botId: string) => void;
    /** Open the New Bot dialog (Talk-to's "New bot…" entry). */
    onNewBot?: () => void;
    isAccuracyModeEnabled?: boolean;
    hybridConnectionStatus?: 'disconnected' | 'connecting' | 'connected' | 'error';
    hybridData?: unknown;
    // Fresh-session layout: center the input until the first message exists.
    centered?: boolean;
}

const ChatInputInner: React.FC<ChatInputProps> = ({
    images,
    removeImage,
    leverageInput,
    handleLeverageChange,
    handleLeverageBlur,
    handlePresetLeverage,
    fileInputRef,
    isImageUploadDisabled,
    handleImageUpload,
    input,
    setInput,
    handleSendMessage,
    handleCancelAnalysis,
    loadingMessage,
    isSummarizing,
    isAnalysisInProgress,
    steeringNotes = [],
    onRemoveSteeringNote,
    isRateLimited,
    isAnyProviderEnabled,
    providers,
    onUpdateProvider,
    selectedVisionModel,
    setSelectedVisionModel,
    lensConfig,
    setLensConfig,
    ensembleModelSelection,
    setEnsembleModelSelection,
    customEnsemblePrompt,
    setCustomEnsemblePrompt,
    customLensPrompts,
    setCustomLensPrompts,
    isEnsembleEnabled,
    setIsEnsembleEnabled,
    selectedChatModel,
    regimeProviderStats,
    setSelectedChatModel,
    moderatorProviderId,
    moderatorModel,
    onSetModeratorProvider,
    onSetModeratorModel,
    onOpenSettings,
    onOpenLiveMarket,
    placeholderOverride,
    threadMode = false,
    bots,
    onSelectBot,
    onNewBot,
    isAccuracyModeEnabled = false,
    hybridConnectionStatus,
    hybridData,
    // Fresh-session layout: static centered input until the first message
    // exists, then it docks at the bottom.
    centered = false,
}) => {
    const [isTeamModalOpen, setIsTeamModalOpen] = useState(false);
    const [isTeamMenuOpen, setIsTeamMenuOpen] = useState(false);
    const [mentionOpen, setMentionOpen] = useState(false);
    const [skillMenuOpen, setSkillMenuOpen] = useState(false);

    // ─── Skill autocomplete (/slug) ─────────────────────────────────────────
    // Skills are invoked by slug, but a slug you cannot see is a feature
    // nobody can use. Typing `/` (start of a word) opens a menu of the
    // notebook's skills with their summaries; picking one completes the
    // token. Same interaction grammar as the @mention menu: click to
    // insert, Escape to dismiss.
    const skillTokenMatch = /(?:^|\s)\/([a-z0-9_-]*)$/i.exec(input);
    const skillToken = skillTokenMatch?.[1]?.toLowerCase() ?? null;
    const skillCandidates = React.useMemo(() => {
        if (skillToken === null) return [];
        const q = skillToken;
        return listSkills()
            .filter(({ file, meta }) => {
                const slug = file.name.replace(/\.md$/i, '').toLowerCase();
                return !q || slug.includes(q)
                    || (meta.description ?? '').toLowerCase().includes(q)
                    || titleFromMeta(meta).toLowerCase().includes(q);
            })
            .slice(0, 8)
            .map(({ file, meta }) => ({
                slug: file.name.replace(/\.md$/i, ''),
                title: titleFromMeta(meta),
                description: meta.description ?? '',
                kind: meta.kind,
                status: meta.status,
            }));
    }, [skillToken]);
    const insertSkill = (slug: string): void => {
        setInput(input.replace(/\/([a-z0-9_-]*)$/i, `/${slug} `));
        setSkillMenuOpen(false);
        document.getElementById('chat-composer')?.focus();
    };

    // ─── Composer auto-grow ──────────────────────────────────────────────────
    // rows=1 never grew, and `overflow: hidden` CLIPPED anything past one
    // line — multi-line prompts were invisible to the person typing them.
    // Grow with content up to the max-h cap, then scroll.
    const composerRef = React.useRef<HTMLTextAreaElement | null>(null);
    React.useEffect(() => {
        const el = composerRef.current;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = `${Math.min(el.scrollHeight, 112)}px`;
    }, [input]);
    // @mention autocomplete from the LIVE roster —
    // the `bots` prop (authoritative, subscription-backed), collapsed to
    // the same handles the room engine and the mailbox resolve. The old
    // implementation read a raw localStorage key and truncated names at
    // the first space ("Risk Bot" -> "@Risk"), which no parser matched.
    const botMentionNames = React.useMemo(
        () => (bots ?? []).map(b => `@${botHandle(b.name)}`).slice(0, 12),
        [bots],
    );
    const mentionCandidates = React.useMemo(() => {
        // Bot handles always; ensemble seat chips only mid-debate setup.
        if (!isEnsembleEnabled) return botMentionNames;
        if (botMentionNames.length > 0) return botMentionNames;
        if (lensConfig.enabled) {
            const map: Record<string, string> = {
                [AnalystRole.MACRO_VOLATILITY]: '@Macro',
                [AnalystRole.TECHNICAL_ANALYST]: '@Technical',
                [AnalystRole.RISK_EXECUTION]: '@Risk',
            };
            return LENS_ROSTER_ROLES.map(r => map[r]).filter(Boolean);
        }
        // Team mode: one chip per live seat (2–5 flat floor, 6–10 lens
        // pods), labeled by seat — @Macro/@Technical/@Risk for the first
        // three, then @Seat4…@Seat10. The label is a steer hint, not an id:
        // seat steering matches by analyst name at run time.
        return (ensembleModelSelection || []).slice(0, 10).map((_, i) =>
            ['@Macro', '@Technical', '@Risk'][i] ?? `@Seat${i + 1}`,
        ).filter(Boolean) as string[];
    }, [isEnsembleEnabled, lensConfig.enabled, ensembleModelSelection, botMentionNames]);
    // The keydown effect below reads the composer text only inside
    // handleTrySkill. Mirroring it through a ref keeps `input` out of the
    // deps — otherwise every keystroke tore down and re-registered all
    // three document listeners.
    const composerTextRef = React.useRef('');
    composerTextRef.current = input;
    React.useEffect(() => {
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            if (mentionOpen) { setMentionOpen(false); return; }
            if (skillMenuOpen) { setSkillMenuOpen(false); return; }
            setIsTeamModalOpen(false);
            if (isAnalysisInProgress) handleCancelAnalysis();
        };
        const handleSlash = (event: KeyboardEvent) => {
            if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
            const target = event.target as HTMLElement | null;
            const tag = target?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
            event.preventDefault();
            document.getElementById('chat-composer')?.focus();
        };
        document.addEventListener('keydown', handleEscape);
        document.addEventListener('keydown', handleSlash);
        // "Try in chat" from a skill card — prepend the /slug
        // marker and focus the composer so the user can fire it immediately.
        const handleTrySkill = (event: Event) => {
            const slug = (event as CustomEvent<{ slug?: string }>).detail?.slug;
            if (!slug) return;
            const marker = `/${slug}`;
            const current = composerTextRef.current;
            if (!current.includes(marker)) {
                setInput(`${marker} ${parseComposerIntent(current).rest}`.trim());
            }
            document.getElementById('chat-composer')?.focus();
        };
        document.addEventListener('august:try-skill', handleTrySkill);
        return () => {
            document.removeEventListener('keydown', handleEscape);
            document.removeEventListener('keydown', handleSlash);
            document.removeEventListener('august:try-skill', handleTrySkill);
        };
    }, [isAnalysisInProgress, handleCancelAnalysis, mentionOpen, skillMenuOpen, setInput]);
    React.useEffect(() => {
        if (isAnalysisInProgress) setMentionOpen(false);
        else if (input.includes('@') && mentionCandidates.length > 0) setMentionOpen(true);
        else setMentionOpen(false);
    }, [input, isAnalysisInProgress, mentionCandidates.length]);
    // Skill menu follows the token: typing `/x…` opens it, moving off the
    // token (or clearing) closes it. Escape closes via the handler below.
    React.useEffect(() => {
        if (skillToken === null || skillCandidates.length === 0) setSkillMenuOpen(false);
        else setSkillMenuOpen(true);
    }, [skillToken, skillCandidates.length]);

    // Charts can only be analyzed in ensemble mode.
    const uploadDisabled = isImageUploadDisabled || !isEnsembleEnabled;

    // Send/Stop arbitration: with a draft mid-run the button parks the draft
    // (Send wins); only an EMPTY box mid-run makes it Stop.
    const hasDraft = input.trim().length > 0 || images.length > 0;
    const parkMode = isAnalysisInProgress && hasDraft;
    const stopMode = isAnalysisInProgress && !hasDraft;

    // Casual-chat model dropdown (ensemble off): every model of every ready
    // provider. Falls back to the first ready provider's model when the
    // stored selection is empty or no longer available.
    const chatProviders = providers.filter(p => p.isEnabled && p.apiKey.trim().length > 0);
    const chatModelOptions = chatProviders.flatMap(p => p.models.map(m => ({ providerName: p.name, modelId: m })));
    const effectiveChatModel = selectedChatModel
        || chatProviders[0]?.selectedModel
        || chatProviders[0]?.models[0]
        || '';
    const rosterSlots = React.useMemo(
        () => buildTeamRoster(lensConfig, ensembleModelSelection, providers),
        [providers, ensembleModelSelection, lensConfig],
    );

    // The injection-chip quick actions moved to the header `⋯` menu in
    // Phase 2 (composer simplification). The Settings menu now owns the
    // surfaces: notebook, strategies, lenses, live market.

    // --- PROMPT EDITOR (view / modify each mode's prompt) ---
    type PromptEditorTarget =
        | { kind: 'normal' }
        | { kind: 'lens'; role: AnalystRole; defaultPrompt: string }
        | null;
    const [promptEditor, setPromptEditor] = useState<PromptEditorTarget>(null);

    const openLensPromptEditor = (role: AnalystRole) => {
        const style = (lensConfig.tradingStyle === 'auto' ? 'swing' : lensConfig.tradingStyle) as 'position' | 'swing' | 'scalp';
        setPromptEditor({ kind: 'lens', role, defaultPrompt: getLensPromptForRole(role, style) });
    };

    const promptEditorProps = promptEditor
        ? promptEditor.kind === 'lens'
            ? {
                title: `Lenses · ${ANALYST_ROLE_DEFINITIONS[promptEditor.role].name} Prompt`,
                subtitle: 'Sent to the analyst assigned to this role (custom overrides win)',
                defaultPrompt: promptEditor.defaultPrompt,
                value: customLensPrompts[promptEditor.role] || '',
            }
            : {
                title: 'Normal Mode Prompt',
                subtitle: 'Base prompt every analyst receives in Normal mode (same for all models)',
                defaultPrompt: MASTER_ANALYSIS_PROMPT,
                value: customEnsemblePrompt || '',
            }
        : null;

    return (
        <div className={centered
            ? 'w-full'
            : 'absolute bottom-0 left-0 right-0 px-3 sm:px-4 lg:px-8 pointer-events-none z-20 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] sm:pb-[calc(env(safe-area-inset-bottom)+0.75rem)] lg:pb-4 status-surface'}>
            <div className={centered ? 'w-full' : 'chat-column pointer-events-auto'}>
                {/* Queued sends — parked words typed while a run is live.
                    They render as real message bubbles (faded, with a Queued
                    footer) rather than status chips, so the words visibly
                    landed and stay removable. When the run ends — however it
                    ends — everything parked drains as one follow-up turn. */}
                {isAnalysisInProgress && steeringNotes.length > 0 && (
                    <div className="mb-2 max-h-44 space-y-1.5 overflow-y-auto pr-1">
                        {steeringNotes.map((note, i) => (
                            <div
                                key={`queued-${i}-${note.slice(0, 16)}`}
                                className="rounded-xl border border-white/[0.06] bg-zinc-900/60 px-4 py-3 opacity-60"
                            >
                                <p className="whitespace-pre-wrap break-words text-[15px] leading-6 text-zinc-200">{note}</p>
                                <p className="mt-1 text-[11px] text-zinc-500">
                                    Queued
                                    <span aria-hidden="true"> · </span>
                                    <button
                                        type="button"
                                        onClick={() => onRemoveSteeringNote?.(i)}
                                        className="underline underline-offset-2 hover:text-zinc-300"
                                        aria-label={`Remove queued message: ${note}`}
                                    >
                                        Remove
                                    </button>
                                </p>
                            </div>
                        ))}
                    </div>
                )}

                {/* Main Input Container — pill proportions:
                    ~16px radius, generous ~20px inner padding, solid #262626
                    fill, no border/shadow. */}
                <div className="rounded-2xl bg-zinc-800 p-3 sm:p-5 transition-colors">

                    {/* Image Preview */}
                    <ImagePreview images={images} onRemoveImage={removeImage} />

                    {mentionOpen && mentionCandidates.length > 0 && (
                        <div className="mb-1.5 flex flex-wrap gap-1 rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5">
                            <span className="mr-1 text-[10px] uppercase tracking-widest text-zinc-500">Mention</span>
                            {mentionCandidates.map(tag => (
                                <button
                                    key={tag}
                                    type="button"
                                    className="rounded-md bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-300 hover:bg-zinc-700"
                                    onClick={() => {
                                        const atIdx = input.lastIndexOf('@');
                                        const before = atIdx >= 0 ? input.slice(0, atIdx) : input;
                                        const after = atIdx >= 0 ? input.slice(atIdx).replace(/^@\w*/, '') : '';
                                        setInput(`${before}${tag} ${after}`.replace(/\s+/g, ' ').trimStart());
                                        setMentionOpen(false);
                                        document.getElementById('chat-composer')?.focus();
                                    }}
                                >
                                    {tag}
                                </button>
                            ))}
                            <button type="button" className="ml-auto text-[10px] text-zinc-500 hover:text-zinc-300" onClick={() => setMentionOpen(false)}>Dismiss</button>
                        </div>
                    )}
                    {/* Skill autocomplete — notebook skills, filtered by the
                        /token being typed. Picking one completes the token;
                        the skill's CONTENT rides the run when it sends. */}
                    {skillMenuOpen && skillCandidates.length > 0 && (
                        <div className="mb-1.5 rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5">
                            <span className="mr-1 text-[10px] uppercase tracking-widest text-zinc-500">Skills</span>
                            <div className="mt-1 max-h-52 space-y-0.5 overflow-y-auto">
                                {skillCandidates.map(s => (
                                    <button
                                        key={s.slug}
                                        type="button"
                                        className="flex w-full items-baseline gap-2 rounded px-1.5 py-1 text-left hover:bg-zinc-800"
                                        onClick={() => insertSkill(s.slug)}
                                    >
                                        <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[11px] text-zinc-200">/{s.slug}</span>
                                        <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-400">
                                            {s.title}{s.description ? ` — ${s.description}` : ''}
                                        </span>
                                        <span className="shrink-0 text-[9px] uppercase tracking-wider text-zinc-600">{s.kind} · {s.status}</span>
                                    </button>
                                ))}
                            </div>
                            <button type="button" className="mt-1 text-[10px] text-zinc-500 hover:text-zinc-300" onClick={() => setSkillMenuOpen(false)}>Dismiss</button>
                        </div>
                    )}
                    {/* Main Input Row */}
                    <div className="flex items-end gap-2 px-1">
                        <textarea
                            id="chat-composer"
                            ref={composerRef}
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && (!e.shiftKey || e.ctrlKey || e.metaKey) ? (e.preventDefault(), handleSendMessage()) : undefined}
                            placeholder={placeholderOverride ?? (isAnalysisInProgress ? 'Add a note — it steers this run, or runs next…' : images.length > 0 ? 'Analyze charts...' : isEnsembleEnabled ? 'Describe the setup or upload charts…' : 'How can I help you today?')}
                            className={`flex-1 min-w-0 bg-transparent px-2 py-2 text-[15px] text-white placeholder-zinc-400 outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 min-h-[24px] max-h-28 resize-none leading-6 ${threadMode ? 'placeholder:text-left' : 'placeholder:text-center focus:placeholder:text-left'}`}
                            rows={1}
                            disabled={isRateLimited}
                            style={{ overflowY: 'auto', overflowX: 'hidden' }}
                        />
                    </div>
                    {/* The Templates ▾ row is gone — the composer carries
                        nothing between input and controls.
                        Debate templates still parse from typed text, and skills
                        remain available via /slug in the message itself. */}
                    <input type="file" multiple accept="image/*" ref={fileInputRef} onChange={handleImageUpload} className="hidden" disabled={uploadDisabled} />

                    {/* Bottom Toolbar — + left, model/mic/send right */}
                    <div className="flex items-center justify-between gap-2 px-1 pt-2">
                        {/* Left Side: upload + action pills */}
                        <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2 flex-wrap">
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                className={`h-8 w-8 rounded-full transition-all shrink-0 flex items-center justify-center ${uploadDisabled ? 'text-zinc-600 cursor-not-allowed' : 'text-zinc-400 hover:text-white hover:bg-white/[0.06]'}`}
                                disabled={uploadDisabled}
                                title={isEnsembleEnabled ? 'Upload charts' : 'Open Team to analyze charts'}
                            >
                                <PlusIcon className="h-[18px] w-[18px]" />
                            </button>
                            {/* Talk-to selector — picks the chat target.
                                "Team" routes to the existing ensemble debate;
                                a named bot opens its 1:1 thread; any single
                                provider routes to a casual 1:1 chat with that
                                model (the legacy path — bots supersede it but
                                stay for model-first senders). Hidden inside a
                                1:1 thread: the thread header already names the
                                target, and showing both read as a duplicated
                                selector. We use a real <select> so the
                                keyboard and screen-reader experience is
                                predictable (arrow keys, type-ahead). */}
                            {!threadMode && (
                                <SelectMenu
                                    aria-label="Talk to"
                                    data-testid="talk-to-selector"
                                    prefix="Talk to"
                                    value={isEnsembleEnabled ? '__team__' : (effectiveChatModel || '')}
                                    onChange={v => {
                                        if (v === '__team__') {
                                            setIsEnsembleEnabled(true);
                                        } else if (v.startsWith('bot:')) {
                                            onSelectBot?.(v.slice(4));
                                        } else if (v === '__new_bot__') {
                                            onNewBot?.();
                                        } else {
                                            setIsEnsembleEnabled(false);
                                            setSelectedChatModel(v);
                                        }
                                    }}
                                    options={[
                                        {
                                            options: [
                                                { value: '__team__', label: 'Team', meta: `${rosterSlots.length} seats` },
                                            ],
                                        },
                                        ...((bots ?? []).length > 0 ? [{
                                            label: 'Bots',
                                            options: (bots ?? []).map(bot => ({
                                                value: `bot:${bot.id}`,
                                                label: bot.name,
                                                meta: formatModelDisplayName(bot.modelId),
                                            })),
                                        }] : []),
                                        ...(chatModelOptions.length > 0 ? [{
                                            label: 'Models',
                                            options: chatModelOptions.map(opt => ({
                                                value: opt.modelId,
                                                label: formatModelDisplayName(opt.modelId),
                                                meta: opt.providerName,
                                            })),
                                        }] : []),
                                        ...(onNewBot ? [{
                                            options: [{ value: '__new_bot__', label: '+ New bot…' }],
                                        }] : []),
                                    ]}
                                />
                            )}

                        </div>

                        {/* Right Side: send (+ leverage in Trade mode, model in
                            Chat mode) — the leverage control moved into the
                            Team menu so the composer bar reads
                            + modes … send only. */}
                        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                            {/* Casual chat model — bare selector */}
                            {!isEnsembleEnabled && chatModelOptions.length > 0 && (
                                <ModelPicker
                                    providers={providers}
                                    value={effectiveChatModel}
                                    onChange={setSelectedChatModel}
                                    mode="model-only"
                                />
                            )}
                            {/* Send wins over Stop when both apply (a draft
                                exists mid-run): pressing it parks the draft as
                                a queued message instead of killing the run.
                                Stop is only the button's meaning when the box
                                is empty — and killing the run then drains the
                                queue, so stopping is how a parked correction
                                jumps the line rather than a way to give up. */}
                            <button
                                onClick={() => {
                                    if (stopMode) { handleCancelAnalysis(); return; }
                                    handleSendMessage();
                                    // A completed send owes the caret back:
                                    // click-send leaves focus on a button that
                                    // is about to swap meaning. Enter-send
                                    // never leaves the textarea, so only the
                                    // click path needs this.
                                    document.getElementById('chat-composer')?.focus();
                                }}
                                disabled={isSummarizing || (!isAnalysisInProgress && (!hasDraft || isRateLimited || !isAnyProviderEnabled))}
                                className={`h-8 w-8 rounded-full transition-all flex items-center justify-center shrink-0 disabled:opacity-40 disabled:cursor-not-allowed ${stopMode ? 'status-surface bg-rose-500 hover:bg-rose-400 text-white' : 'bg-zinc-200 text-zinc-900 hover:bg-white shadow-sm'}`}
                                title={stopMode ? 'Stop generating' : parkMode ? 'Queue message' : 'Send'}
                                aria-label={stopMode ? 'Stop generating' : parkMode ? 'Queue message' : 'Send message'}
                            >
                                {isSummarizing ? <LoadingIcon className="h-4 w-4" /> : stopMode ? <StopIcon className="h-3.5 w-3.5" fill="currentColor" /> : <SendIcon className="h-4 w-4" />}
                            </button>
                        </div>
                    </div>

                    {/* Phase 2 composer simplification: the InjectionContextBar
                        chips above the input are gone. The same context lives
                        in the new "view injected" affordance inside the
                        SettingsMenu and in the desk overlay; surfacing it
                        again at the composer was redundant with the model
                        picker and the Team chip. */}
                </div>
            </div>

            {/* Prompt editor modal — view/modify the prompt of the current mode. */}
            <PromptEditorModal
                isOpen={promptEditor !== null}
                title={promptEditorProps?.title ?? ''}
                subtitle={promptEditorProps?.subtitle}
                defaultPrompt={promptEditorProps?.defaultPrompt ?? ''}
                value={promptEditorProps?.value ?? ''}
                onSave={(prompt) => {
                    if (!promptEditor) return;
                    if (promptEditor.kind === 'lens') {
                        const next = { ...customLensPrompts };
                        if (prompt) {
                            next[promptEditor.role] = prompt;
                        } else {
                            delete next[promptEditor.role];
                        }
                        setCustomLensPrompts(next);
                    } else {
                        setCustomEnsemblePrompt(prompt);
                    }
                    setPromptEditor(null);
                }}
                onClose={() => setPromptEditor(null)}
            />

            {/* Team launch modal */}
            <TeamModal
                isOpen={isTeamModalOpen}
                providers={providers}
                isEnsembleEnabled={isEnsembleEnabled}
                setIsEnsembleEnabled={setIsEnsembleEnabled}
                lensConfig={lensConfig}
                setLensConfig={setLensConfig}
                regimeProviderStats={regimeProviderStats}
                ensembleModelSelection={ensembleModelSelection}
                setEnsembleModelSelection={setEnsembleModelSelection}
                moderatorProviderId={moderatorProviderId}
                moderatorModel={moderatorModel}
                onSetModeratorProvider={onSetModeratorProvider}
                onSetModeratorModel={onSetModeratorModel}
                onClose={() => setIsTeamModalOpen(false)}
                onEditLensPrompt={openLensPromptEditor}
                onEditNormalPrompt={() => setPromptEditor({ kind: 'normal' })}
                onOpenSettings={onOpenSettings}
            />
        </div>
    );
};

export const ChatInput = React.memo(ChatInputInner);
