/**
 * NewBotDialog — the Hermes "New Bot" dialog, copied: big avatar
 * preview, face picker (Auto + the 10 built-in faces, our pixel
 * avatars on a second tab), Randomize with a "face follows the name"
 * hint, Name / Title / Description fields, and the provider+model
 * this bot thinks with. Create adds the bot to the roster.
 */

import React from 'react';
import { BotFace, BUILTIN_FACES, randomFace, type BotFaceSpec } from './BotFace';
import { PixelAvatarFigure } from './BotAvatar';
import type { AgentBot } from '../../services/agents/agentRoster';
import { ProviderConfig } from '../../types/provider';
import { formatModelDisplayName } from '../../utils/providerUtils';
import { ROLE_ACCENTS } from '../desk/pixelAvatars';

export interface NewBotDialogProps {
    open: boolean;
    onClose: () => void;
    onCreate: (bot: Omit<AgentBot, 'id' | 'createdAt'>) => void;
    providers: ProviderConfig[];
}

const PIXEL_ROLE_CHOICES = (Object.keys(ROLE_ACCENTS) as Array<keyof typeof ROLE_ACCENTS>)
    .filter(r => r !== 'unknown' && r !== 'postmortem');

/** Default the dialog to the first ready provider (enabled + keyed). */
const firstReadyProviderId = (providers: ProviderConfig[]): string =>
    providers.find(p => p.isEnabled && p.apiKey.trim().length > 0)?.id ?? providers[0]?.id ?? '';

export const NewBotDialog: React.FC<NewBotDialogProps> = ({ open, onClose, onCreate, providers }) => {
    const [name, setName] = React.useState('');
    const [title, setTitle] = React.useState('');
    const [description, setDescription] = React.useState('');
    const [tab, setTab] = React.useState<'faces' | 'pixel'>('faces');
    const [face, setFace] = React.useState<BotFaceSpec | 'auto'>('auto');
    const [pixelRole, setPixelRole] = React.useState<(typeof PIXEL_ROLE_CHOICES)[number]>('macro');
    const [providerId, setProviderId] = React.useState<string>(() => firstReadyProviderId(providers));
    const [modelId, setModelId] = React.useState<string>('');
    const [advancedOpen, setAdvancedOpen] = React.useState(false);

    const provider = providers.find(p => p.id === providerId) ?? providers[0];
    // Fall back to the provider's selected model (then its first) until
    // the trader picks one explicitly.
    const effectiveModel = modelId && provider?.models.includes(modelId)
        ? modelId
        : provider?.selectedModel || provider?.models[0] || '';

    React.useEffect(() => {
        if (open) {
            setName(''); setTitle(''); setDescription('');
            setFace('auto'); setTab('faces');
            setProviderId(firstReadyProviderId(providers));
            setModelId('');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    if (!open) return null;

    const readyProviders = providers.filter(p => p.isEnabled && p.apiKey.trim().length > 0);
    const canCreate = name.trim().length > 0 && provider && effectiveModel.length > 0;

    const create = (): void => {
        if (!canCreate || !provider) return;
        onCreate({
            name: name.trim(),
            title: title.trim() || undefined,
            description: description.trim() || undefined,
            providerId: provider.id,
            modelId: effectiveModel,
            avatar: tab === 'pixel'
                ? { kind: 'pixel', role: pixelRole }
                : face === 'auto' ? { kind: 'auto' } : { kind: 'face', spec: face },
        });
        onClose();
    };

    const previewName = name.trim() || 'New Bot';

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-label="New Bot">
            <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/10 bg-zinc-950 p-6 shadow-2xl" data-testid="new-bot-dialog">
                <div className="flex items-start justify-between">
                    <div>
                        <h2 className="text-lg font-semibold text-zinc-100">New Bot</h2>
                        <p className="mt-1 text-[12px] leading-snug text-zinc-500">
                            A named teammate with its own model and chat. It answers in your roster like Hermes&apos; bots do.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close new bot dialog"
                        className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                    >
                        ✕
                    </button>
                </div>

                {/* Avatar preview */}
                <div className="mt-5 flex justify-center">
                    {tab === 'pixel'
                        ? <PixelAvatarFigure role={pixelRole} size={72} />
                        : <BotFace face={face} name={previewName} size={72} />}
                </div>

                {/* Avatar tabs */}
                <div className="mt-4 flex justify-center gap-1">
                    {([['faces', 'Faces'], ['pixel', 'Pixel']] as const).map(([key, label]) => (
                        <button
                            key={key}
                            type="button"
                            onClick={() => setTab(key)}
                            data-testid={`avatar-tab-${key}`}
                            className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors ${
                                tab === key ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
                            }`}
                        >
                            {label}
                        </button>
                    ))}
                </div>

                {/* Face grid — Auto + the 10 built-ins */}
                {tab === 'faces' ? (
                    <div className="mt-4">
                        <div className="grid grid-cols-6 justify-items-center gap-2">
                            <button
                                type="button"
                                onClick={() => setFace('auto')}
                                data-testid="face-auto"
                                aria-label="Auto face (follows the name)"
                                className={`flex h-11 w-11 items-center justify-center rounded-lg border text-[10px] font-semibold uppercase tracking-wide ${
                                    face === 'auto' ? 'border-zinc-400 bg-zinc-800 text-zinc-200' : 'border-white/10 text-zinc-500 hover:border-white/25'
                                }`}
                            >
                                Auto
                            </button>
                            {BUILTIN_FACES.map((spec, i) => (
                                <button
                                    key={`${spec.shape}-${spec.hue}`}
                                    type="button"
                                    onClick={() => setFace(spec)}
                                    data-testid={`face-${i}`}
                                    aria-label={`Face ${i + 1}`}
                                    className={`flex h-11 w-11 items-center justify-center rounded-lg border ${
                                        face !== 'auto' && face.shape === spec.shape && face.hue === spec.hue
                                            ? 'border-zinc-400 bg-zinc-800'
                                            : 'border-transparent hover:border-white/25'
                                    }`}
                                >
                                    <BotFace face={spec} name={previewName} size={34} />
                                </button>
                            ))}
                        </div>
                        <div className="mt-3 flex items-center justify-center gap-4">
                            <button
                                type="button"
                                onClick={() => setFace(randomFace())}
                                className="flex items-center gap-1.5 text-[12px] font-medium text-zinc-300 hover:text-zinc-100"
                            >
                                ⟳ Randomize
                            </button>
                        </div>
                        <p className="mt-1 text-center text-[11px] text-zinc-600">
                            {face === 'auto' ? 'Face follows the name.' : 'Pinned face.'}
                        </p>
                    </div>
                ) : (
                    <div className="mt-4">
                        <div className="grid grid-cols-7 justify-items-center gap-2">
                            {PIXEL_ROLE_CHOICES.map(role => (
                                <button
                                    key={role}
                                    type="button"
                                    onClick={() => setPixelRole(role)}
                                    data-testid={`pixel-${role}`}
                                    aria-label={`Pixel ${role}`}
                                    className={`flex h-11 w-11 items-center justify-center rounded-lg border ${
                                        pixelRole === role ? 'border-zinc-400 bg-zinc-800' : 'border-transparent hover:border-white/25'
                                    }`}
                                >
                                    <PixelAvatarFigure role={role} size={34} />
                                </button>
                            ))}
                        </div>
                        <p className="mt-3 text-center text-[11px] text-zinc-600">Our pixel seats, role-colored.</p>
                    </div>
                )}

                {/* Fields */}
                <div className="mt-5 space-y-3">
                    <div>
                        <label htmlFor="bot-name" className="mb-1 block text-[12px] font-semibold text-zinc-300">Name</label>
                        <input
                            id="bot-name"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            placeholder="inbox-triage"
                            data-testid="bot-name"
                            className="w-full rounded-lg border border-white/10 bg-zinc-900 px-3 py-2 text-[13px] text-zinc-100 placeholder-zinc-600 outline-none focus:border-white/30"
                        />
                    </div>
                    <div>
                        <label htmlFor="bot-title" className="mb-1 block text-[12px] font-semibold text-zinc-300">Title</label>
                        <input
                            id="bot-title"
                            value={title}
                            onChange={e => setTitle(e.target.value)}
                            placeholder="Inbox Triage"
                            className="w-full rounded-lg border border-white/10 bg-zinc-900 px-3 py-2 text-[13px] text-zinc-100 placeholder-zinc-600 outline-none focus:border-white/30"
                        />
                    </div>
                    <div>
                        <label htmlFor="bot-desc" className="mb-1 block text-[12px] font-semibold text-zinc-300">Description</label>
                        <textarea
                            id="bot-desc"
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                            placeholder="What should this Bot help with?"
                            rows={2}
                            className="w-full resize-none rounded-lg border border-white/10 bg-zinc-900 px-3 py-2 text-[13px] text-zinc-100 placeholder-zinc-600 outline-none focus:border-white/30"
                        />
                    </div>

                    {/* Advanced — provider + model this bot thinks with */}
                    <button
                        type="button"
                        onClick={() => setAdvancedOpen(v => !v)}
                        aria-expanded={advancedOpen}
                        className="flex items-center gap-1.5 text-[12px] font-semibold text-zinc-400 hover:text-zinc-200"
                    >
                        {advancedOpen ? '▾' : '▸'} Advanced
                    </button>
                    {advancedOpen && (
                        <div className="space-y-3 rounded-lg border border-white/10 bg-zinc-900/50 p-3">
                            <div>
                                <label htmlFor="bot-provider" className="mb-1 block text-[11px] font-semibold uppercase tracking-widest text-zinc-500">Provider</label>
                                <select
                                    id="bot-provider"
                                    value={providerId}
                                    onChange={e => setProviderId(e.target.value)}
                                    data-testid="bot-provider"
                                    className="w-full rounded-lg border border-white/10 bg-zinc-900 px-3 py-2 text-[13px] text-zinc-100 outline-none"
                                >
                                    {readyProviders.map(p => (
                                        <option key={p.id} value={p.id}>{p.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label htmlFor="bot-model" className="mb-1 block text-[11px] font-semibold uppercase tracking-widest text-zinc-500">Model</label>
                                <select
                                    id="bot-model"
                                    value={effectiveModel}
                                    onChange={e => setModelId(e.target.value)}
                                    data-testid="bot-model"
                                    className="w-full rounded-lg border border-white/10 bg-zinc-900 px-3 py-2 text-[13px] text-zinc-100 outline-none"
                                >
                                    {(provider?.models ?? []).map(m => (
                                        <option key={m} value={m}>{formatModelDisplayName(m)}</option>
                                    ))}
                                </select>
                            </div>
                            <p className="text-[11px] leading-snug text-zinc-600">
                                The bot thinks with this model. Give two bots different models to keep their chats separate.
                            </p>
                        </div>
                    )}
                </div>

                <div className="mt-6 flex items-center justify-end gap-2">
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-lg px-4 py-2 text-[13px] font-semibold text-zinc-400 hover:text-zinc-200"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={create}
                        disabled={!canCreate}
                        data-testid="create-bot"
                        className="rounded-lg bg-zinc-200 px-4 py-2 text-[13px] font-bold text-zinc-900 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        Create Bot
                    </button>
                </div>
            </div>
        </div>
    );
};

export default NewBotDialog;
