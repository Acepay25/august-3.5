/**
 * The status half of the shell's title bar: whether the journal saved, whether
 * the network is up, the live post-mortem pulse, and the one opener for the
 * Activity drawer.
 *
 * It is a component rather than markup inside `shared/Header` because the Chat
 * surface has its own title bar (the mode pill and the conversation's name live
 * there), and the shell is moving so that bar is the ONLY bar on that surface —
 * Claude's sidebar runs the full height of the window and its title bar belongs
 * to the content column. Two surfaces needed these controls, so they got one
 * owner instead of a copy that could drift.
 */
import React from 'react';
import { LoadingIcon, CheckIcon, EyeIcon, CloudOffIcon, AlertTriangleIcon } from '../shared/Icons';

interface StatusClusterProps {
    saveStatus: 'SAVED' | 'SAVING' | 'ERROR';
    isOnline?: boolean;
    isPostMortemInProgress?: boolean;
    /** Opens the live post-mortem overlay — the pulse is the entry, not a toy. */
    onOpenLivePostMortem?: () => void;
    /** Opens the Activity drawer: background jobs, skill audits, automations. */
    onOpenActivity?: () => void;
    /** Whether that drawer is standing open. The button is an OPENER, not a
     *  toggle — with the drawer out, pressing it again correctly does nothing —
     *  so the state has to be readable or every gate that judges "did this
     *  press move anything" calls it dead. */
    activityOpen?: boolean;
}

const StatusCluster: React.FC<StatusClusterProps> = ({
    saveStatus,
    isOnline = true,
    isPostMortemInProgress = false,
    onOpenLivePostMortem,
    onOpenActivity,
    activityOpen = false,
}) => (
    <div className="flex items-center gap-2">
        {saveStatus === 'SAVING' && (
            <span role="status" aria-label="Saving">
                <LoadingIcon className="h-4 w-4 text-zinc-500" aria-hidden="true" />
            </span>
        )}
        {saveStatus === 'SAVED' && (
            <span role="status" aria-label="Saved">
                <CheckIcon className="h-4 w-4 text-emerald-500" aria-hidden="true" />
            </span>
        )}
        {!isOnline && (
            <span role="status" aria-label="Offline">
                <CloudOffIcon className="h-4 w-4 text-amber-500" aria-hidden="true" />
            </span>
        )}
        {saveStatus === 'ERROR' && (
            <span role="status" aria-label="Save failed">
                <AlertTriangleIcon className="h-4 w-4 text-rose-500" aria-hidden="true" />
            </span>
        )}

        {/* Approvals is NOT here — the Activity drawer owns that queue (WS-5.2),
            and this tray used to repeat it under a second name. Activity is the
            drawer's only opener and sits outside the desktop-only styling: touch
            never had a path to the job queue, and the rail's automations section
            landed in this drawer (stage 3). Pinned signals moved to the Trade
            surface's market row — a trading tool, not global chrome. */}
        {onOpenActivity && (
            <div className="inline-flex items-center rounded-bubble border border-white/[0.08] bg-zinc-800/60 p-0.5 shadow-sm">
                <button
                    type="button"
                    data-testid="header-activity"
                    onClick={onOpenActivity}
                    aria-expanded={activityOpen}
                    aria-controls="activity-drawer"
                    className="inline-flex items-center rounded-control px-2.5 py-1 text-ui-dense font-semibold text-zinc-400 transition-colors hover:bg-zinc-700/60 hover:text-zinc-100"
                    title="Activity — background jobs, skill audits, automations"
                    aria-label="Activity"
                >
                    <span>Activity</span>
                </button>
            </div>
        )}

        {isPostMortemInProgress && (
            <button
                type="button"
                onClick={onOpenLivePostMortem}
                className="rounded-control bg-zinc-800 p-2.5 text-zinc-300 animate-pulse"
                title="Live Post-Mortem"
                aria-label="View live post-mortem progress"
            >
                <EyeIcon />
            </button>
        )}
    </div>
);

export default StatusCluster;
