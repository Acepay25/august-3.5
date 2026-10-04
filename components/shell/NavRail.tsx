/**
 * NavRail — the persistent left navigation (D2, amended 2026-10-04: the
 * collapsed state is FULLY hidden).
 *
 * Why this exists: the surfaces used to be reachable only by opening a menu,
 * which made "where am I" and "how do I leave" two questions instead of none.
 * The references keep navigation collapsible rather than behind a hamburger —
 * but the user's ruling after living with the 56px strip is that the resting
 * state shows NOTHING on the left, not a column of icons. So collapse now
 * takes the column to 0px, and the expand affordance moves to the header
 * (the DSH pattern: the hidden sidebar's expand button carries the update
 * dot). Expanding brings back the full 280px panel. Ctrl/Cmd+B toggles either
 * way; below 1024px the rail is hidden whatever the user last chose.
 *
 * One tree, hidden rather than unmounted. The rows keep rendering inside the
 * collapsed box — inert, invisible, 0px wide — the same hide-vs-close contract
 * the Chart AI dock follows: collapsing changes what is *readable*, not what
 * exists, so the tree's state survives the round trip and expansion reveals
 * the same nodes, not a rebuild.
 *
 * The brand gradient is reserved: the active-surface bar and the account-row
 * status dot are the only places it appears outside the wordmark.
 */

import React from 'react';
import { PanelLeftClose, Settings, BotIcon } from '../shared/Icons';
import Tip from '../ui/Tip';
import SurfaceMenuList, { type NavBadge } from './SurfaceMenuList';
import { SidebarContent } from '../shared/Sidebar';
import { UpdateButton, useUpdateStatusDot } from '../shared/UpdateButton';
import { useAutoUpdate } from '../../hooks/useAutoUpdate';

import type { AppSurface } from '../../hooks/useSurface';
import type { Conversation } from '../../types';
import type { AutomationConfig } from '../../types/automation';

/** The collapsed column is 0px: the rail leaves the layout entirely and its
 *  expand affordance lives in the header (nav-rail-toggle-header). */
export const NAV_RAIL_COLLAPSED_PX = 0;
export const NAV_RAIL_EXPANDED_PX = 280;
/** Below this the rail is hidden whatever the user last chose — there is no
 *  room for a 280px panel beside a trade chart, and Electron's floor is
 *  minWidth 800. The choice is applied at render time, not written back, so
 *  widening the window restores what the user actually picked. */
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
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-xs font-bold uppercase text-zinc-300">
                {/* The person's initial, not a bot glyph — this row is the one
                    place the rail says who is signed in (the references all use
                    an initials block here). */}
                {activeUsername ? activeUsername.charAt(0) : <BotIcon className="h-4 w-4 text-zinc-500" />}
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
            aria-hidden={!expanded || undefined}
            inert={expanded ? undefined : true}
            style={{ width }}
            /* Only `width` animates. Naming the property is the whole rule
               here: an unnamed transition would also animate the conversation
               list re-laying-out on every frame of the collapse, which is the
               geometry animation WS-5.4 bans. Collapsed adds `invisible` (it
               flips at once, so the shrink happens offstage) and `inert`, the
               dock's hide-vs-close pair: a zero-width box whose rows stayed
               focusable would eat Tab presses against nothing. */
            className={`z-drawer flex shrink-0 flex-col overflow-hidden bg-zinc-900 transition-[width] duration-[150ms] ease-[var(--ease-snappy)] ${
                /* The border belongs to the expanded state only: a 0px box
                   that kept even a transparent hairline would still measure
                   1px and leave a stray edge on the page ground. */
                expanded ? 'border-r border-white/[0.06]' : 'invisible'
            }`}
        >
            {/* Collapse. Only exists in the expanded state — the collapsed
                rail's expand affordance is the header's button, which is what
                makes the resting view free of left-edge chrome. */}
            <div className="flex shrink-0 items-center justify-end px-2 pt-2.5">
                <button
                    type="button"
                    data-testid="nav-rail-toggle"
                    onClick={onToggleExpanded}
                    aria-expanded={expanded}
                    aria-label="Collapse navigation"
                    aria-controls="nav-rail-panel"
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-100 focus-visible:ring-2 focus-visible:ring-zinc-400"
                >
                    <PanelLeftClose className="h-4 w-4" />
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