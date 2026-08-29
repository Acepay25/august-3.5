/**
 * useAgentGroups — runs a group thread: one prompt fans out to every
 * member bot SERIALLY (Hermes caps turns; we do one pass per send),
 * each reply streaming into its own message attributed by
 * modelsUsed[providerId] = modelId, with @name directs and @everyone.
 *
 * The caller supplies message append/patch functions (App's
 * updateMessages) and the provider configs; the hook exposes the
 * activity entries ("X is working…", "✓ X replied", "○ X passed")
 * and the currently working bot id for the roster's active-now chip.
 */

import { useCallback, useRef, useState } from 'react';
import { MessageRole } from '../types/enums';
import { Message } from '../types/message';
import { ProviderConfig } from '../types/provider';
import { streamQuickResponse } from '../services/providers/GenericAnalysisService';
import { AgentBot } from '../services/agents/agentRoster';

export interface GroupActivityEntry {
    id: string;
    kind: 'sent' | 'working' | 'replied' | 'passed';
    botName?: string;
    at: number;
    detail?: string;
}

const isProviderReady = (p: ProviderConfig): boolean =>
    p.isEnabled && p.apiKey.trim().length > 0 && p.models.length > 0;

export interface UseAgentGroupsResult {
    workingBotId: string | null;
    isRunning: boolean;
    activity: GroupActivityEntry[];
    runGroupThread: (group: { memberIds: string[] }, prompt: string, bots: AgentBot[]) => Promise<void>;
}

export const useAgentGroups = ({
    providerConfigs,
    appendMessage,
    patchMessage,
}: {
    providerConfigs: ProviderConfig[];
    appendMessage: (msg: Message) => void;
    patchMessage: (id: string, patch: Partial<Message>) => void;
}): UseAgentGroupsResult => {
    const [workingBotId, setWorkingBotId] = useState<string | null>(null);
    const [isRunning, setIsRunning] = useState(false);
    const [activity, setActivity] = useState<GroupActivityEntry[]>([]);
    const runNonce = useRef(0);

    const pushActivity = useCallback((entry: Omit<GroupActivityEntry, 'id' | 'at'>) => {
        setActivity(prev => [...prev, { ...entry, id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, at: Date.now() }]);
    }, []);

    const runGroupThread = useCallback(async (group: { memberIds: string[] }, prompt: string, bots: AgentBot[]): Promise<void> => {
        const trimmed = prompt.trim();
        if (!trimmed || group.memberIds.length === 0) return;
        const nonce = ++runNonce.current;

        // @direct: "@hermes look at this" → only that bot; "@everyone" → all.
        const direct = /@([a-z0-9_-]+)/i.exec(trimmed);
        const everyone = /@everyone\b/i.test(trimmed);
        let members = group.memberIds
            .map(id => bots.find(b => b.id === id))
            .filter((b): b is AgentBot => Boolean(b));
        if (direct && !everyone) {
            const target = members.find(m => m.name.toLowerCase().replace(/\s+/g, '') === direct[1].toLowerCase());
            if (target) members = [target];
        }

        // The prompt lands once as the thread opener.
        appendMessage({
            id: `usr-${Date.now()}`,
            role: MessageRole.USER,
            text: trimmed,
            createdAt: new Date().toISOString(),
        });
        pushActivity({ kind: 'sent' });
        setIsRunning(true);

        try {
            for (const bot of members) {
                if (runNonce.current !== nonce) return;
                const provider = providerConfigs.find(p => p.id === bot.providerId);
                if (!provider || !isProviderReady(provider) || !provider.models.includes(bot.modelId)) {
                    pushActivity({ kind: 'passed', botName: bot.name, detail: 'provider offline' });
                    continue;
                }

                setWorkingBotId(bot.id);
                pushActivity({ kind: 'working', botName: bot.name });

                const config = { ...provider, selectedModel: bot.modelId };
                const replyId = `grp-${Date.now()}-${bot.id}`;
                appendMessage({
                    id: replyId,
                    role: MessageRole.AI,
                    text: '',
                    createdAt: new Date().toISOString(),
                    modelsUsed: { [provider.id]: bot.modelId },
                    isStreaming: true,
                });

                let visible = '';
                let lastFlush = 0;
                try {
                    const responseText = await streamQuickResponse(
                        config,
                        trimmed,
                        [],
                        undefined,
                        undefined,
                        undefined,
                        delta => {
                            visible += delta;
                            const now = Date.now();
                            if (now - lastFlush > 120) {
                                lastFlush = now;
                                patchMessage(replyId, { text: visible });
                            }
                        },
                    );
                    if (runNonce.current !== nonce) return;
                    patchMessage(replyId, { text: responseText || visible, isStreaming: false });
                    pushActivity({ kind: 'replied', botName: bot.name });
                } catch (error) {
                    if (runNonce.current !== nonce) return;
                    patchMessage(replyId, {
                        text: visible || `(${bot.name} could not reply — provider error)`,
                        isStreaming: false,
                    });
                    pushActivity({ kind: 'passed', botName: bot.name, detail: 'error' });
                }
            }
        } finally {
            if (runNonce.current === nonce) {
                setWorkingBotId(null);
                setIsRunning(false);
            }
        }
    }, [providerConfigs, appendMessage, patchMessage, pushActivity]);

    return { workingBotId, isRunning, activity, runGroupThread };
};

export default useAgentGroups;
