/**
 * TeamDialog — create or edit a Team: the trader's own configuration of
 * the harness. Seats are any provider models (2–10 — 6+ seats run as
 * LENS PODS), each with an optional debate persona: a built-in role
 * (inherits that role's curated prompt, editable via instructions) or
 * the general-analyst default. Plus an optional moderator chair.
 * Activating a team points the whole pipeline at exactly these seats.
 */

import React from 'react';
import { Plus, X, MessageSquareText } from 'lucide-react';
import { SelectMenu } from '../shared/SelectMenu';
import { formatModelDisplayName } from '../../utils/providerUtils';
import { TEAM_MAX_SEATS, TEAM_MIN_SEATS } from '../../utils/teamRoster';
import { AgentTeam, AgentTeamSeat } from '../../services/agents/agentRoster';
import { ProviderConfig } from '../../types/provider';
import { AnalystRole } from '../../types/enums';
import { ANALYST_ROLE_DEFINITIONS } from '../../services/ui/AnalystLensService';
import { builtInPromptForRole } from '../../services/agents/seatPersonas';

/** Role options for a seat persona dropdown (UNASSIGNED = general default). */
const SEAT_ROLE_OPTIONS: { value: AnalystRole; label: string }[] = [
    { value: AnalystRole.UNASSIGNED, label: 'General analyst (default)' },
    { value: AnalystRole.MACRO_VOLATILITY, label: ANALYST_ROLE_DEFINITIONS[AnalystRole.MACRO_VOLATILITY].shortName },
    { value: AnalystRole.TECHNICAL_ANALYST, label: ANALYST_ROLE_DEFINITIONS[AnalystRole.TECHNICAL_ANALYST].shortName },
    { value: AnalystRole.RISK_EXECUTION, label: ANALYST_ROLE_DEFINITIONS[AnalystRole.RISK_EXECUTION].shortName },
];

export interface TeamDialogProps {
    open: boolean;
    onClose: () => void;
    /** Create a new team (no id/createdAt yet). */
    onCreate: (team: Omit<AgentTeam, 'id' | 'createdAt'>) => void;
    /** Save edits to an existing team (present in edit mode). */
    onUpdate?: (id: string, patch: Partial<Omit<AgentTeam, 'id'>>) => void;
    /** When present the dialog edits this team instead of creating one. */
    initial?: AgentTeam | null;
    providers: ProviderConfig[];
}

const readyProviders = (providers: ProviderConfig[]): ProviderConfig[] =>
    providers.filter(p => p.isEnabled && p.apiKey.trim().length > 0);

export const TeamDialog: React.FC<TeamDialogProps> = ({ open, onClose, onCreate, onUpdate, initial, providers }) => {
    const ready = React.useMemo(() => readyProviders(providers), [providers]);
    const [name, setName] = React.useState('');
    const [seats, setSeats] = React.useState<AgentTeamSeat[]>([]);
    const [hasModerator, setHasModerator] = React.useState(false);
    const [moderator, setModerator] = React.useState<AgentTeamSeat | null>(null);
    /** Which seat's instructions textarea is open (null = none). */
    const [editingPromptSeat, setEditingPromptSeat] = React.useState<number | null>(null);

    React.useEffect(() => {
        if (!open) return;
        setEditingPromptSeat(null);
        if (initial) {
            setName(initial.name ?? '');
            setSeats(initial.seats.map(s => ({ ...s })));
            setHasModerator(Boolean(initial.moderator));
            setModerator(initial.moderator ? { ...initial.moderator } : null);
        } else {
            setName('');
            // Seed two usable seats from ready providers (first provider
            // fills both when only one is ready).
            const seedSeat = (i: number): AgentTeamSeat => {
                const p = ready[Math.min(i, Math.max(ready.length - 1, 0))];
                return { providerId: p?.id ?? '', modelId: p?.selectedModel || p?.models[0] || '' };
            };
            setSeats([seedSeat(0), seedSeat(1)]);
            setHasModerator(false);
            setModerator(ready[0] ? { providerId: ready[0].id, modelId: ready[0].selectedModel || ready[0].models[0] || '' } : null);
        }
    }, [open, initial]);

    if (!open) return null;

    const validSeats = seats.filter(s => s.providerId && s.modelId);
    const canSubmit = validSeats.length >= TEAM_MIN_SEATS
        && (!hasModerator || (moderator?.providerId && moderator.modelId));

    const patchSeat = (index: number, patch: Partial<AgentTeamSeat>): void =>
        setSeats(prev => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));

    const submit = (): void => {
        if (!canSubmit) return;
        const payload = {
            name: name.trim() || undefined,
            // Persist only meaningful persona fields — an untouched role
            // selector and a blank instructions box must not write noise.
            seats: validSeats.map(s => ({
                providerId: s.providerId,
                modelId: s.modelId,
                role: s.role && s.role !== AnalystRole.UNASSIGNED ? s.role : undefined,
                customPrompt: (s.customPrompt ?? '').trim() || undefined,
            })),
            moderator: hasModerator && moderator?.providerId && moderator.modelId
                ? { providerId: moderator.providerId, modelId: moderator.modelId }
                : undefined,
        };
        if (initial && onUpdate) onUpdate(initial.id, payload);
        else onCreate(payload);
        onClose();
    };

    const providerOptions = (selectedId: string): ProviderConfig[] => {
        // Keep the current selection visible even if the provider went offline.
        const chosen = providers.find(p => p.id === selectedId);
        return chosen && !ready.includes(chosen) ? [chosen, ...ready] : ready;
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-label={initial ? 'Edit Team' : 'New Team'}>
            <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/10 bg-zinc-950 p-6 shadow-2xl" data-testid="team-dialog">
                <div className="flex items-start justify-between">
                    <div>
                        <h2 className="text-lg font-semibold text-zinc-100">{initial ? 'Edit Team' : 'New Team'}</h2>
                        <p className="mt-1 text-[12px] leading-snug text-zinc-500">
                            A team is the harness configuration: activating it points the debate — hybrid
                            intelligence, trade log, the whole pipeline — at exactly these seats.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close team dialog"
                        className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                    >
                        ✕
                    </button>
                </div>

                <div className="mt-5">
                    <label htmlFor="team-name" className="mb-1 block text-[12px] font-semibold text-zinc-300">Name</label>
                    <input
                        id="team-name"
                        value={name}
                        onChange={e => setName(e.target.value)}
                        placeholder="Alpha Desk"
                        data-testid="team-name"
                        className="w-full rounded-lg border border-white/10 bg-zinc-900 px-3 py-2 text-[13px] text-zinc-100 placeholder-zinc-600 outline-none focus:border-white/30"
                    />
                </div>

                {/* Analyst seats */}
                <div className="mt-5">
                    <div className="mb-1 flex items-baseline justify-between">
                        <p className="text-[12px] font-semibold text-zinc-300">Analyst seats</p>
                        <span className="text-[11px] text-zinc-600">{seats.length}/{TEAM_MAX_SEATS} · min {TEAM_MIN_SEATS}</span>
                    </div>
                    <div className="space-y-2">
                        {seats.map((seat, i) => (
                            <div key={i} className="rounded-lg border border-white/5 bg-zinc-900/40 p-2" data-testid={`team-seat-${i}`}>
                            <div className="flex items-center gap-2">
                                <span className="w-5 shrink-0 text-center text-[11px] font-bold text-zinc-500">{i + 1}</span>
                                <SelectMenu
                                    aria-label={`Seat ${i + 1} provider`}
                                    data-testid={`team-seat-provider-${i}`}
                                    value={seat.providerId}
                                    onChange={v => {
                                        const p = providers.find(x => x.id === v);
                                        patchSeat(i, { providerId: v, modelId: p?.selectedModel || p?.models[0] || '' });
                                    }}
                                    options={providerOptions(seat.providerId).map(p => ({ value: p.id, label: p.name }))}
                                    triggerClassName="min-w-0 flex-1 rounded-lg border border-white/10 bg-zinc-900 px-2 py-2 text-[12px] hover:bg-zinc-800"
                                />
                                <SelectMenu
                                    aria-label={`Seat ${i + 1} model`}
                                    data-testid={`team-seat-model-${i}`}
                                    value={seat.modelId}
                                    onChange={v => patchSeat(i, { modelId: v })}
                                    options={(providers.find(p => p.id === seat.providerId)?.models ?? [seat.modelId]).map(m => ({ value: m, label: formatModelDisplayName(m) }))}
                                    triggerClassName="min-w-0 flex-1 rounded-lg border border-white/10 bg-zinc-900 px-2 py-2 text-[12px] hover:bg-zinc-800"
                                />
                                <button
                                    type="button"
                                    onClick={() => setSeats(prev => prev.filter((_, idx) => idx !== i))}
                                    disabled={seats.length <= TEAM_MIN_SEATS}
                                    aria-label={`Remove seat ${i + 1}`}
                                    data-testid={`team-seat-remove-${i}`}
                                    className="shrink-0 rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-30"
                                >
                                    <X className="h-3.5 w-3.5" />
                                </button>
                            </div>
                            <div className="mt-2 flex items-center gap-2 pl-7">
                                <SelectMenu
                                    aria-label={`Seat ${i + 1} role`}
                                    data-testid={`team-seat-role-${i}`}
                                    value={seat.role ?? AnalystRole.UNASSIGNED}
                                    onChange={v => patchSeat(i, { role: v === AnalystRole.UNASSIGNED ? undefined : (v as AnalystRole) })}
                                    options={SEAT_ROLE_OPTIONS.map(r => ({ value: r.value, label: r.label }))}
                                    triggerClassName="w-40 shrink-0 rounded-lg border border-white/10 bg-zinc-900 px-2 py-1.5 text-[11px] hover:bg-zinc-800"
                                />
                                <button
                                    type="button"
                                    onClick={() => setEditingPromptSeat(editingPromptSeat === i ? null : i)}
                                    aria-label={`Seat ${i + 1} instructions`}
                                    aria-expanded={editingPromptSeat === i}
                                    data-testid={`team-seat-instructions-${i}`}
                                    title={seat.customPrompt ? 'Trader instructions (active)' : 'Add trader instructions for this seat'}
                                    className={`rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 ${seat.customPrompt ? 'text-zinc-300' : ''}`}
                                >
                                    <MessageSquareText className="h-3.5 w-3.5" />
                                </button>
                                {seat.role && seat.role !== AnalystRole.UNASSIGNED && (
                                    <button
                                        type="button"
                                        onClick={() => patchSeat(i, { customPrompt: builtInPromptForRole(seat.role) })}
                                        data-testid={`team-seat-inherit-${i}`}
                                        title="Copy the built-in role prompt into the instructions box — edit it freely; the seat runs role + instructions"
                                        className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
                                    >
                                        Inherit
                                    </button>
                                )}
                                <span className="min-w-0 truncate text-[11px] text-zinc-600">
                                    {seat.role && seat.role !== AnalystRole.UNASSIGNED
                                        ? ANALYST_ROLE_DEFINITIONS[seat.role].focus
                                        : 'Analyzes the market across all dimensions; web + tools on'}
                                </span>
                            </div>
                            {editingPromptSeat === i && (
                                <textarea
                                    value={seat.customPrompt ?? ''}
                                    onChange={e => patchSeat(i, { customPrompt: e.target.value })}
                                    placeholder={seat.role && seat.role !== AnalystRole.UNASSIGNED
                                        ? 'Refine this role — e.g. "focus on funding-rate extremes and liquidity sweeps"'
                                        : 'Leave empty for the general-analyst default (full market analysis, web + tools)'}
                                    rows={3}
                                    data-testid={`team-seat-prompt-${i}`}
                                    className="mt-2 w-full resize-y rounded-lg border border-white/10 bg-zinc-900 px-3 py-2 text-[12px] leading-relaxed text-zinc-100 placeholder-zinc-600 outline-none focus:border-white/30"
                                />
                            )}
                            </div>
                        ))}
                    </div>
                    <button
                        type="button"
                        onClick={() => {
                            const p = ready[0];
                            setSeats(prev => [...prev, { providerId: p?.id ?? '', modelId: p?.selectedModel || p?.models[0] || '' }]);
                        }}
                        disabled={seats.length >= TEAM_MAX_SEATS}
                        data-testid="add-team-seat"
                        className="mt-2 flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-[12px] font-medium text-zinc-300 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        <Plus className="h-3.5 w-3.5" /> Add seat
                    </button>
                </div>

                {/* Optional moderator chair */}
                <div className="mt-5 rounded-lg border border-white/10 bg-zinc-900/50 p-3">
                    <label className="flex items-center gap-2 text-[12px] font-semibold text-zinc-300">
                        <input
                            type="checkbox"
                            checked={hasModerator}
                            onChange={e => setHasModerator(e.target.checked)}
                            data-testid="team-moderator-toggle"
                            className="accent-zinc-500"
                        />
                        Chair the debate with a moderator
                    </label>
                    {hasModerator && moderator && (
                        <div className="mt-2 flex items-center gap-2">
                            <SelectMenu
                                aria-label="Moderator provider"
                                data-testid="team-moderator-provider"
                                value={moderator.providerId}
                                onChange={v => {
                                    const p = providers.find(x => x.id === v);
                                    setModerator({ providerId: v, modelId: p?.selectedModel || p?.models[0] || '' });
                                }}
                                options={providerOptions(moderator.providerId).map(p => ({ value: p.id, label: p.name }))}
                                triggerClassName="min-w-0 flex-1 rounded-lg border border-white/10 bg-zinc-900 px-2 py-2 text-[12px] hover:bg-zinc-800"
                            />
                            <SelectMenu
                                aria-label="Moderator model"
                                data-testid="team-moderator-model"
                                value={moderator.modelId}
                                onChange={v => setModerator({ ...moderator, modelId: v })}
                                options={(providers.find(p => p.id === moderator.providerId)?.models ?? [moderator.modelId]).map(m => ({ value: m, label: formatModelDisplayName(m) }))}
                                triggerClassName="min-w-0 flex-1 rounded-lg border border-white/10 bg-zinc-900 px-2 py-2 text-[12px] hover:bg-zinc-800"
                            />
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
                        onClick={submit}
                        disabled={!canSubmit}
                        data-testid="save-team"
                        className="rounded-lg bg-zinc-200 px-4 py-2 text-[13px] font-bold text-zinc-900 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        {initial ? 'Save Team' : 'Create Team'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default TeamDialog;
