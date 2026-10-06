// TAB: Profile — who is signed in and what their desk holds (SettingsMenu
// "TAB 1").
//
// Moved verbatim from the inline IIFE body. `setActiveTab` is the parent's tab
// state setter passed under its local name, so the cross-tab links ("Open"
// journal, "Backups & usage") keep navigating unchanged.
import React from 'react';
import { ArrowUpRight, Database, HardDrive, User, Users } from '../../shared/Icons';
import { APP_NAME, APP_VERSION } from '../../../constants/version';
import { useAutoUpdate } from '../../../hooks/useAutoUpdate';
import { SettingsGroup, SettingsPageHeader, SettingsRow } from './shared';
import type { SettingsTab } from '../SettingsMenu';
import type { SettingsTabProps } from './types';

export interface ProfileTabProps extends SettingsTabProps {
    onSwitchUser?: () => void;
    onExportData?: () => Promise<void> | void;
    setActiveTab: (tab: SettingsTab) => void;
}



/** The Settings-side updater entry (stage-2 Phase-4's "check for updates"
 *  row): a quiet text button beside the version line. The rail's account row
 *  owns the updater's day-to-day states; this is the discoverable check. */
const CheckForUpdatesRow: React.FC = () => {
    const { isElectron, updateStatus, checkForUpdates } = useAutoUpdate();
    const [busy, setBusy] = React.useState(false);
    if (!isElectron) return null;
    const phase = updateStatus?.status ?? 'idle';
    const label = phase === 'checking' ? 'Checking…' : 'Check for updates';
    return (
        <button
            type="button"
            data-testid="profile-check-updates"
            disabled={busy || phase === 'checking' || phase === 'downloading' || phase === 'installing'}
            onClick={() => { setBusy(true); void checkForUpdates().finally(() => setBusy(false)); }}
            className="rounded border border-white/10 px-1.5 py-0.5 text-ui-2xs text-zinc-400 transition-colors hover:border-white/25 hover:text-zinc-200 disabled:opacity-50"
        >
            {label}
        </button>
    );
};

const ProfileTab: React.FC<{ tab: ProfileTabProps }> = ({ tab: props }) => {
    const { username, providerConfigs, providerConfigsLoaded, onSwitchUser, onExportData, setActiveTab } = props;
    const trades = props.loggedTrades ?? [];
    const wins = trades.filter(t => t.outcome === 'WIN').length;
    const losses = trades.filter(t => t.outcome === 'LOSS').length;
    const decided = wins + losses;
    const readyProviders = (providerConfigs ?? []).filter(c => c.isEnabled && c.apiKey.trim().length > 0).length;
    const initial = (username || '?').trim().charAt(0).toUpperCase();
    return (
        <div className="space-y-5 animate-fade-in">
            <SettingsPageHeader
                title="Profile"
                description="The active trader profile — its journal, memory and backups are separate from every other profile on this device."
            />

            <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-white/[0.07] bg-zinc-900/50 p-5">
                <span aria-hidden="true" className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-white/10 bg-zinc-800 text-xl font-semibold text-zinc-100">
                    {initial}
                </span>
                <div className="min-w-0 flex-1">
                    <div className="truncate text-base font-semibold text-zinc-100">{username || 'Trader'}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-ui-dense text-zinc-500">
                        <span>
                            {APP_NAME} v{APP_VERSION}
                            {providerConfigsLoaded
                                ? ` · ${readyProviders} ${readyProviders === 1 ? 'provider' : 'providers'} connected`
                                : ' · loading providers…'}
                        </span>
                        <CheckForUpdatesRow />
                    </div>
                </div>
                {onSwitchUser && (
                    <button
                        type="button"
                        onClick={onSwitchUser}
                        className="inline-flex items-center gap-1.5 rounded-control border border-white/10 bg-zinc-800 px-3 py-1.5 text-ui-dense font-semibold text-zinc-200 transition-colors hover:border-white/20 hover:bg-zinc-700 hover:text-zinc-100"
                    >
                        <Users className="h-3.5 w-3.5" aria-hidden="true" />
                        Switch profile
                    </button>
                )}
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                    { label: 'Trades logged', value: String(trades.length), tone: 'text-zinc-100' },
                    { label: 'Win rate', value: decided > 0 ? `${Math.round((wins / decided) * 100)}%` : '—', tone: decided > 0 && wins >= losses ? 'text-emerald-400' : decided > 0 ? 'text-rose-400' : 'text-zinc-100' },
                    { label: 'Wins / Losses', value: `${wins}/${losses}`, tone: 'text-zinc-100' },
                    { label: 'Open / Pending', value: String(trades.length - decided), tone: trades.length - decided > 0 ? 'text-amber-400' : 'text-zinc-100' },
                ].map(stat => (
                    <div key={stat.label} className="rounded-xl border border-white/[0.06] bg-zinc-800/40 px-3.5 py-3">
                        <div className="text-ui-xs font-semibold uppercase tracking-wider text-zinc-500">{stat.label}</div>
                        <div className={`mt-1 font-mono text-xl font-bold tabular-nums ${stat.tone}`}>{stat.value}</div>
                    </div>
                ))}
            </div>

            <SettingsGroup title="Account">
                <SettingsRow
                    icon={<User className="h-4 w-4" />}
                    title="Trading journal"
                    description="Trade log, pattern memory, model performance and reasoning history."
                    control={
                        <button
                            type="button"
                            onClick={() => setActiveTab('journal')}
                            className="inline-flex items-center gap-1 rounded-control border border-white/10 bg-zinc-800 px-2.5 py-1.5 text-ui-dense font-semibold text-zinc-300 transition-colors hover:border-white/20 hover:text-zinc-100"
                        >
                            Open <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                        </button>
                    }
                />
                {onExportData && (
                    <SettingsRow
                        icon={<Database className="h-4 w-4" />}
                        title="Export this profile"
                        description="Download trades, analyses and memory as a JSON archive."
                        control={
                            <button
                                type="button"
                                onClick={() => void onExportData()}
                                className="inline-flex items-center gap-1 rounded-control border border-white/10 bg-zinc-800 px-2.5 py-1.5 text-ui-dense font-semibold text-zinc-300 transition-colors hover:border-white/20 hover:text-zinc-100"
                            >
                                Export
                            </button>
                        }
                    />
                )}
                <SettingsRow
                    icon={<HardDrive className="h-4 w-4" />}
                    title="Backups & usage"
                    description="Auto-backups run every 30 minutes while a profile is open."
                    control={
                        <button
                            type="button"
                            onClick={() => setActiveTab('actions')}
                            className="inline-flex items-center gap-1 rounded-control border border-white/10 bg-zinc-800 px-2.5 py-1.5 text-ui-dense font-semibold text-zinc-300 transition-colors hover:border-white/20 hover:text-zinc-100"
                        >
                            Open <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                        </button>
                    }
                />
            </SettingsGroup>
        </div>
    );
};

export default ProfileTab;
