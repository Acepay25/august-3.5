import { useCallback, useEffect, useState } from 'react';
import {
    getBots, getGroups, saveBot, saveGroup, updateBot, updateGroup, removeBot, removeGroup, subscribeAgentRoster,
    findBotById, groupDisplayName,
    type AgentBot, type AgentGroup,
} from '../services/agents/agentRoster';
import { type ThreadSelection, markThreadOpened, loadThreadOpenedMap, saveThreadOpenedMap } from '../utils/agentThreads';
import { AnalystRole } from '../types/enums';
import type { ConfirmOptions } from '../components/shared/ConfirmDialog';

export interface UseAgentThreadsArgs {
    activeUsername: string | null;
    /** Opening a bot thread flips the composer to that bot's model with
     *  ensemble off; opening a group re-arms the ensemble. */
    setSelectedChatModel: (modelId: string) => void;
    setIsEnsembleEnabled: React.Dispatch<React.SetStateAction<boolean>>;
    confirmDialog: (opts: ConfirmOptions) => Promise<boolean>;
}

export interface UseAgentThreadsResult {
    activeThread: ThreadSelection;
    setActiveThread: React.Dispatch<React.SetStateAction<ThreadSelection>>;
    /** Per-thread last-opened timestamps (unread badges). */
    threadOpenedMap: Record<string, string>;
    bots: AgentBot[];
    groups: AgentGroup[];
    isNewBotOpen: boolean;
    setIsNewBotOpen: React.Dispatch<React.SetStateAction<boolean>>;
    isNewGroupOpen: boolean;
    setIsNewGroupOpen: React.Dispatch<React.SetStateAction<boolean>>;
    /** When set, the New Group dialog EDITS this room: create becomes
     *  update-membership. Null = plain create. */
    groupEditTarget: AgentGroup | null;
    setGroupEditTarget: React.Dispatch<React.SetStateAction<AgentGroup | null>>;
    selectBotThread: (botId: string) => void;
    selectGroupThread: (groupId: string) => void;
    createBot: (draft: Omit<AgentBot, 'id' | 'createdAt'>) => void;
    createGroup: (memberIds: string[], memberRoles?: Record<string, AnalystRole>) => void;
    updateGroupMembers: (groupId: string, memberIds: string[], memberRoles?: Record<string, AnalystRole>) => void;
    deleteBot: (botId: string) => void;
    deleteGroup: (groupId: string) => void;
}

/**
 * Chat-mode agent roster: named bots + group rooms, the active thread
 * selection, unread-badge bookkeeping, and roster CRUD (with the
 * delete-confirmation dialogs). State mirrors the persisted roster through
 * a pub/sub subscription, so any surface that saves a bot/group refreshes
 * every open surface without a reload.
 */
export const useAgentThreads = (args: UseAgentThreadsArgs): UseAgentThreadsResult => {
    const { activeUsername, setSelectedChatModel, setIsEnsembleEnabled, confirmDialog } = args;

    // Boot surface = the main ensemble transcript ('team'). The chat-mode
    // rework briefly defaulted to the Coach inbox, which orphaned the
    // conversation: you booted into drafts-and-proposals while your actual
    // trading session sat one click away. Coach is a roster row, not a
    // landing page.
    const [activeThread, setActiveThread] = useState<ThreadSelection>({ kind: 'team' });
    // Unread badges: per-thread last-opened timestamps, keyed
    // by bot.id / group.id. Focusing a thread marks it opened (effect below).
    const [threadOpenedMap, setThreadOpenedMap] = useState<Record<string, string>>(
        () => loadThreadOpenedMap(activeUsername ?? ''));
    const [bots, setBots] = useState<AgentBot[]>(() => getBots());
    const [groups, setGroups] = useState<AgentGroup[]>(() => getGroups());
    useEffect(() => subscribeAgentRoster(() => {
        setBots(getBots());
        setGroups(getGroups());
    }), []);
    const [isNewBotOpen, setIsNewBotOpen] = useState(false);
    const [isNewGroupOpen, setIsNewGroupOpen] = useState(false);
    // When set, the New Group dialog EDITS this room: create
    // becomes update-membership. Null = plain create.
    const [groupEditTarget, setGroupEditTarget] = useState<AgentGroup | null>(null);

    // Opening a bot thread flips the composer target to that bot's model
    // with ensemble off — the thread then shows exactly what a send does.
    const selectBotThread = useCallback((botId: string) => {
        setActiveThread({ kind: 'bot', botId });
        const bot = findBotById(bots, botId);
        if (bot?.modelId) {
            setSelectedChatModel(bot.modelId);
            setIsEnsembleEnabled(false);
        }
    }, [bots, setSelectedChatModel, setIsEnsembleEnabled]);

    // Opening a GROUP re-arms the ensemble (Team/group merge): a group is
    // the debate room — a send runs the full pipeline (debate + hybrid
    // intelligence + trade log + learning memory) with the room's members
    // as the ensemble. A bot visit flips ensemble off for casual 1:1s;
    // returning to a group re-arms it.
    const selectGroupThread = useCallback((groupId: string) => {
        setActiveThread({ kind: 'group', groupId });
        setIsEnsembleEnabled(true);
    }, [setIsEnsembleEnabled]);

    // Unread badges: focusing a bot/group thread marks it opened
    // (markThreadOpened + persist). Team/coach have no badge key.
    useEffect(() => {
        if ((activeThread.kind !== 'bot' && activeThread.kind !== 'group') || !activeUsername) return;
        const key = activeThread.kind === 'bot' ? activeThread.botId : activeThread.groupId;
        setThreadOpenedMap(prev => {
            const next = markThreadOpened(prev, key);
            saveThreadOpenedMap(activeUsername, next);
            return next;
        });
    }, [activeThread, activeUsername]);

    // User switch: reload that user's opened-map so badges are per-account.
    useEffect(() => {
        setThreadOpenedMap(loadThreadOpenedMap(activeUsername ?? ''));
    }, [activeUsername]);

    const createBot = useCallback((draft: Omit<AgentBot, 'id' | 'createdAt'>) => {
        const bot: AgentBot = { ...draft, id: `bot-${Date.now()}`, createdAt: new Date().toISOString() };
        saveBot(bot);
        // Select directly with the bot object: `bots` state is still stale
        // here (the roster subscriber hasn't re-rendered yet), so
        // selectBotThread would miss the lookup and skip the model flip.
        setActiveThread({ kind: 'bot', botId: bot.id });
        if (bot.modelId) {
            setSelectedChatModel(bot.modelId);
            setIsEnsembleEnabled(false);
        }
    }, [setSelectedChatModel, setIsEnsembleEnabled]);

    const createGroup = useCallback((memberIds: string[], memberRoles: Record<string, AnalystRole> = {}) => {
        const group: AgentGroup = { id: `grp-${Date.now()}`, memberIds, createdAt: new Date().toISOString() };
        // Group Settings role picks ride the bots themselves (the persona
        // follows the bot into every room turn and the ensemble pipeline).
        // UNASSIGNED is stored as absent — an explicit "General" pick must
        // behave exactly like a bot that never had a role.
        for (const [botId, role] of Object.entries(memberRoles)) {
            updateBot(botId, { role: role === AnalystRole.UNASSIGNED ? undefined : role });
        }
        saveGroup(group);
        setActiveThread({ kind: 'group', groupId: group.id });
    }, []);

    // the group header gear reuses the New Group dialog as an editor —
    // the Create button becomes Save (update-membership + member roles)
    // instead.
    const updateGroupMembers = useCallback((groupId: string, memberIds: string[], memberRoles: Record<string, AnalystRole> = {}) => {
        for (const [botId, role] of Object.entries(memberRoles)) {
            updateBot(botId, { role: role === AnalystRole.UNASSIGNED ? undefined : role });
        }
        updateGroup(groupId, { memberIds });
    }, []);

    // Deleting a bot pulls it from its groups (agentRoster.removeBot);
    // deleting a group only drops the room. If the deleted surface is
    // open, fall back to Team. The bot's messages stay in the
    // conversation history — they just lose their byline.
    const deleteBot = useCallback((botId: string) => {
        const bot = findBotById(bots, botId);
        void confirmDialog({
            title: `Delete ${bot?.name ?? 'bot'}?`,
            message: 'The bot is removed from the roster and from any groups it belongs to. Its messages stay in your conversations.',
            destructive: true,
        }).then(ok => {
            if (!ok) return;
            removeBot(botId);
            if (activeThread.kind === 'bot' && activeThread.botId === botId) {
                setActiveThread({ kind: 'team' });
            }
        });
    }, [bots, activeThread, confirmDialog]);

    const deleteGroup = useCallback((groupId: string) => {
        const group = groups.find(g => g.id === groupId);
        void confirmDialog({
            title: `Delete ${groupDisplayName(group ?? { id: groupId, memberIds: [], createdAt: '' }, bots)}?`,
            message: 'The group room is removed. Member bots and their messages are untouched.',
            destructive: true,
        }).then(ok => {
            if (!ok) return;
            removeGroup(groupId);
            if (activeThread.kind === 'group' && activeThread.groupId === groupId) {
                setActiveThread({ kind: 'team' });
            }
        });
    }, [groups, bots, activeThread, confirmDialog]);

    return {
        activeThread, setActiveThread,
        threadOpenedMap,
        bots, groups,
        isNewBotOpen, setIsNewBotOpen,
        isNewGroupOpen, setIsNewGroupOpen,
        groupEditTarget, setGroupEditTarget,
        selectBotThread, selectGroupThread,
        createBot, createGroup, updateGroupMembers,
        deleteBot, deleteGroup,
    };
};
