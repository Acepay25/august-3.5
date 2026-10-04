/**
 * NavRail — the persistent left navigation, replacing the header's hamburger
 * drawer (D2).
 *
 * Why this exists: the surfaces used to be reachable only by opening a menu,
 * which made "where am I" and "how do I leave" two questions instead of none.
 * All four references in the design spec — and the app this one is copied from
 * — keep navigation on screen and collapse it to a rail rather than hiding it.
 *
 * Two widths, one tree. 56px collapsed, 280px expanded, toggled with
 * Ctrl/Cmd+B and auto-collapsed below 1024px. Nothing is conditionally
 * rendered on width except the conversation history: the surface rows, the
 * approvals entry and the account row stay mounted in both states, so a
 * surface can never be reachable at one width and not the other. Collapsing
 * changes what is *readable*, not what exists.
 *
 * The brand gradient is reserved: the active-surface bar and the account-row
 * status dot are the only places it appears outside the wordmark.
 */

import React from 'react';
import { PanelLeftClose, PanelLeftOpen, Settings, BotIcon } from '../shared/Icons';
import Tip from '../ui/Tip';
import SurfaceMenuList, { type NavBadge } from './SurfaceMenuList';
import { SidebarContent } from '../shared/Sidebar';
import { UpdateButton, useUpdateStatusDot } from '../shared/UpdateButton';
import { useAutoUpdate } from '../../hooks/useAutoUpdate';

import type { AppSurface } from '../../hooks/useSurface';
import type { Conversation } from '../../types';
import type { AutomationConfig } from '../../types/automation';

export const NAV_RAIL_COLLAPSED_PX = 56;
export const NAV_RAIL_EXPANDED_PX = 280;
/** Below this the rail is a rail whatever the user last chose — there is no
 *  room for a 280px panel beside a trade chart, and Electron's floor is
 *  minWidth 800. */
export const NAV_RAIL_AUTO_COLLAPSE_PX = 1024;

interface NavRailProps {
    expanded: boolean;
    onToggleExpanded: () => void;

    activeUsername: string | null;
    surface: AppSurface;
    onSelectSurface: (surface: AppSurface) => void;
    badges?: Partial<Record<AppSurface, NavBadge>>;
    onOpenApprovals?: () => void;
    approvalsCount?: number;
    onSwitchUser?: () => void;

    conversations: Conversation[];
    activeConversationId: string | null;
    hasVisionData: boolean;
    isFreshSession: boolean;
    onNewConversation: () => void;
    onLoadConversation: (id: string) => void;
    onDeleteConversation: (id: string) => void;
    onDeleteConversations?: (ids: string[]) => Promise<boolean> | boolean;
    onOpenLiveMarket: () => void;
    onOpenVisionData: () => void;
    onOpenWatchList?: () => void;
    onOpenSettings: () => void;
    automations: AutomationConfig[];
    onOpenAutomation: (id: string | null) => void;
    onCreateAutomation?: () => void;
}

/** The account row: who you are, where Settings lives, and how the updater is
 *  doing. Update status belongs on a quiet persistent surface rather than only
 *  in the full-screen overlay — the overlay is for downloading and ready, and
 *  nothing currently tells you that a check finished and found nothing. */
const AccountRow: React.FC<{
    expanded: boolean;
    activeUsername: string | null;
    onOpenSettings: () => void;
}> = ({ expanded, activeUsername, onOpenSettings }) => {
    const { isElectron } = useAutoUpdate();
    const updateDot = useUpdateStatusDot();

    if (!expanded) {
        return (
            <div className="flex flex-col items-center gap-1 px-1.5 pb-2 pt-1.5">
                {isElectron && updateDot && <span data-testid="nav-update-dot">{updateDot}</span>}
                <Tip label="Settings" shortcut="Ctrl+,">
                    <button
                        type="button"
                        data-testid="nav-settings"
                        onClick={onOpenSettings}
                        aria-label="Settings"
                        className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-zinc-100 focus-visible:ring-2 focus-visible:ring-zinc-400"
                    >
                        <Settings className="h-4 w-4" />
                    </button>
                </Tip>
            </div>
        );
    }

    return (
        <div
            data-testid="nav-account"
            className="flex shrink-0 items-center gap-2 border-t border-white/[0.06] px-3 py-2.5"
        >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-zinc-400">
                <BotIcon className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
                <div className="truncate text-ui-caption text-zinc-300">{activeUsername || 'No profile'}</div>
                <div className="truncate text-ui-2xs text-zinc-600">Signed in</div>
            </div>
            <Tip label="Settings" shortcut="Ctrl+,">
                <button
                    type="button"
                    data-testid="nav-settings"
                    onClick={onOpenSettings}
                    aria-label="Settings"
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-zinc-100 focus-visible:ring-2 focus-visible:ring-zinc-400"
                >
                    <Settings className="h-4 w-4" />
                </button>
            </Tip>
        </div>
    );
};

const NavRail: React.FC<NavRailProps> = ({
    expanded,
    onToggleExpanded,
    activeUsername,
    surface,
    onSelectSurface,
    badges,
    onOpenApprovals,
    approvalsCount,
    onSwitchUser,
    conversations,
    activeConversationId,
    hasVisionData,
    isFreshSession,
    onNewConversation,
    onLoadConversation,
    onDeleteConversation,
    onDeleteConversations,
    onOpenLiveMarket,
    onOpenVisionData,
    onOpenWatchList,
    onOpenSettings,
    automations,
    onOpenAutomation,
    onCreateAutomation,
}) => {
    const width = expanded ? NAV_RAIL_EXPANDED_PX : NAV_RAIL_COLLAPSED_PX;

    return (
        <aside
            data-testid="nav-rail"
            data-expanded={expanded ? 'true' : 'false'}
            aria-label="Navigation"
            style={{ width }}
            /* Only `width` animates. Naming the property is the whole rule
               here: an unnamed transition would also animate the conversation
               list re-laying-out on every frame of the collapse, which is the
               geometry animation WS-5.4 bans. */
            className="z-drawer flex shrink-0 flex-col border-r border-white/[0.06] bg-zinc-900 transition-[width] duration-[150ms] ease-[var(--ease-snappy)] max-lg:w-14"
        >
            {/* Expand/collapse. In the expanded panel the chevron points at the
                edge it will move toward; in the rail it carries the brand dot so
                the rail is visibly the same component, just narrower. */}
            <div className={`flex shrink-0 items-center ${expanded ? 'justify-end px-2 pt-2.5' : 'justify-center pt-2.5'}`}>
                <button
                    type="button"
                    data-testid="nav-rail-toggle"
                    onClick={onToggleExpanded}
                    aria-expanded={expanded}
                    aria-label={expanded ? 'Collapse navigation' : 'Expand navigation'}
                    aria-controls="nav-rail-panel"
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-100 focus-visible:ring-2 focus-visible:ring-zinc-400"
                >
                    {expanded ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
                </button>
            </div>

            <div id="nav-rail-panel" className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden">
                <SurfaceMenuList
                    surface={surface}
                    badges={badges}
                    approvalsCount={approvalsCount}
                    onOpenApprovals={onOpenApprovals}
                    onSwitchUser={onSwitchUser}
                    onSelect={onSelectSurface}
                    collapsed={!expanded}
                />

                {/* Conversation history and the automations list need a label
                    column to mean anything, so they only mount with the panel.
                    The surfaces above deliberately do not. */}
                {expanded && (
                    <>
                        <div className="mx-2 border-t border-white/[0.06]" />
                        <SidebarContent
                            activeUsername={activeUsername}
                            conversations={conversations}
                            activeConversationId={activeConversationId}
                            hasVisionData={hasVisionData}
                            isFreshSession={isFreshSession}
                            onNewConversation={onNewConversation}
                            onLoadConversation={onLoadConversation}
                            onDeleteConversation={onDeleteConversation}
                            onDeleteConversations={onDeleteConversations}
                            onOpenLiveMarket={onOpenLiveMarket}
                            onOpenVisionData={onOpenVisionData}
                            onOpenWatchList={onOpenWatchList}
                            onOpenSettings={onOpenSettings}
                            automations={automations}
                            onOpenAutomation={onOpenAutomation}
                            onCreateAutomation={onCreateAutomation}
                        />
                    </>
                )}
            </div>

            <div className="mt-auto">
                {expanded && (
                    <div className="px-3 pb-2 pt-1">
                        <UpdateButton />
                    </div>
                )}
                <AccountRow expanded={expanded} activeUsername={activeUsername} onOpenSettings={onOpenSettings} />
            </div>
        </aside>
    );
};

export default React.memo(NavRail);