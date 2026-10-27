/**
 * Pipeline stage module — RAF-throttled casual-chat stream updates.
 *
 * This file carried five writers (debate round, provisional verdict, ensemble
 * progress, casual chat, opening-phase thinking). Four died with the ensemble
 * engine: `useAnalysisPipeline` destructures only `throttledCasualStream`, and
 * nothing in the app produces the debate rounds the others existed for. What is
 * left shares one primitive (`useRafThrottle`) and one dependency
 * (`updateMessages`).
 */

import { useCallback } from 'react';
import { stripLeakedScratchpad } from '../../utils/thinkingSplit';
import type { Message } from '../../types';
import { useRafThrottle } from '../useRafThrottle';

type UpdateMessagesFn = (updater: (prev: Message[]) => Message[], conversationId?: string | null) => void;

export interface StreamThrottlersDeps {
    updateMessages: UpdateMessagesFn;
}

/**
 * Casual-chat streaming writer: patches the live reply bubble's `text` /
 * `isStreaming` / `thoughtProcesses` fields. The latest accumulated text +
 * reasoning win per frame; `flush()` commits the settled state synchronously.
 */
export function applyCasualStreamUpdate(
    prev: Message[],
    messageId: string,
    text: string,
    thinking: string,
    providerId: string,
    streaming: boolean,
): Message[] {
    const messageIndex = prev.findIndex(m => m.id === messageId);
    if (messageIndex === -1) return prev;
    const current = prev[messageIndex];
    /* Peel the "Here's a thinking process / Analyze User Input" dump out of the
       LIVE bubble instead of only out of the settled one. The casual wire asks
       for the low thinking tier, and on the gateways that switch thinking off
       at that tier the model writes its plan into the content channel — so the
       trader watched the plan stream past and only the finished message was
       clean. The plan is not thrown away: it lands in the thinking field, which
       is the disclosure it belongs in. */
    const peeled = stripLeakedScratchpad(text);
    const mergedThinking = [thinking, peeled.leaked].filter(Boolean).join('\n\n');
    const next = {
        ...current,
        text: peeled.visible,
        isStreaming: streaming,
        thoughtProcesses: mergedThinking ? { [providerId]: mergedThinking } : current.thoughtProcesses,
    };
    const newMessages = [...prev];
    newMessages[messageIndex] = next;
    return newMessages;
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export interface StreamThrottlers {
    throttledCasualStream: ReturnType<typeof useRafThrottle<(...args: any[]) => void>>;
}

/**
 * The one RAF-throttled writer the pipeline still uses. `useRafThrottle` keeps
 * the throttler identity stable across renders.
 */
export function useStreamThrottlers(deps: StreamThrottlersDeps): StreamThrottlers {
    const { updateMessages } = deps;

    // Keyed by conversation + row: two live streams in two threads each keep
    // their own pending paint (docs/AUDIT.md L-7).
    const throttledCasualStream = useRafThrottle(useCallback((
        conversationId: string | null,
        messageId: string,
        text: string,
        thinking: string,
        providerId: string,
        streaming: boolean,
    ) => {
        updateMessages(prev => applyCasualStreamUpdate(prev, messageId, text, thinking, providerId, streaming), conversationId);
    }, [updateMessages]), (conversationId, messageId) => `${conversationId ?? ''}|${messageId}`);

    return { throttledCasualStream };
}
