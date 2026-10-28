/**
 * The collapsed rail's expand affordance. Present only while the rail is hidden:
 * at 0px there is nothing on the left edge to click, so giving the column back
 * has to live in the title bar.
 *
 * It also carries the update-status dot — the DSH pattern the shell already uses,
 * where the one quiet status carrier stays visible in the resting view. Like
 * [[StatusCluster]] it is a component rather than markup inside `shared/Header`
 * because the Agents surface's own title bar needs it too, and that surface no
 * longer renders the band above the sidebar.
 */
import React from 'react';
import { PanelLeftOpen } from '../shared/Icons';
import { useUpdateStatusDot } from '../shared/UpdateButton';

interface NavExpandButtonProps {
    onExpand: () => void;
}

const NavExpandButton: React.FC<NavExpandButtonProps> = ({ onExpand }) => {
    const navUpdateDot = useUpdateStatusDot();
    return (
        <button
            type="button"
            data-testid="nav-rail-toggle-header"
            onClick={onExpand}
            aria-label="Expand navigation"
            aria-controls="nav-rail-panel"
            className="relative -ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-control text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-zinc-100 focus-visible:ring-2 focus-visible:ring-zinc-400"
        >
            <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
            {navUpdateDot && (
                <span data-testid="nav-update-dot-header" className="absolute -right-0.5 -top-0.5">
                    {navUpdateDot}
                </span>
            )}
        </button>
    );
};

export default NavExpandButton;
