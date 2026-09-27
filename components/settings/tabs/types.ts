// Shared props for the lazily-loaded Settings tab bodies (./tabs/*Tab.tsx).
//
// SettingsMenu used to inline every tab body as an IIFE, threading ~70 props
// through one 1,300-line component. Each body is now a component that receives
// a single `tab` props object; the props consumed by MORE than one tab live in
// the base interface below, and each tab's own file extends it with the rest.
// Names are identical to the SettingsMenuProps they forward — this is a move,
// not a rewrite. Two kinds of entries appear here and in the tab interfaces:
// forwarded SettingsMenuProps, and parent-local wiring (state setters and
// derived values like `readyConfigProviders`) that the IIFE bodies used to
// close over — those keep the local names they had.
import type { LoggedTrade } from '../../../types';
import type { ProviderConfig } from '../../../types/provider';
import type { LearnTab } from '../../learn/LearnView';

/** Props consumed by more than one tab body. */
export interface SettingsTabProps {
    /** Stats source — the Journal hub's stats grid and the Profile counters
     *  both read it (the nav badge stays in SettingsMenu). */
    loggedTrades?: LoggedTrade[];
    /** Active profile — prompts, strategies and backups are scoped per
     *  profile, and the Profile card names it. */
    username?: string;
    /** Dynamic provider roster — model picks, the profile counters, lens
     *  assignment and the strategy summarizer all read it. */
    providerConfigs?: ProviderConfig[];
    /** False while provider configs are still loading — avoids the
     *  "No providers configured" empty-state flash. */
    providerConfigsLoaded?: boolean;
    /** Opens the Learn surface — the one home for the queues, the notebook and
     *  memory health. Settings keeps the provider/model switches and links here.
     *  Pass a tab to land somewhere specific. */
    onOpenLearn?: (tab?: LearnTab) => void;
    /** The librarian's ProviderConfig — Models picks it, Memory names it. */
    memoryConfig?: ProviderConfig | null;
    /** Opens the Strategy Studio — the browse/annotate playbook library. */
    onOpenStrategyStudio?: () => void;
}
