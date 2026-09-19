/**
 * useSupervisorBootstrap — App-level install of the skill supervisor.
 *
 * The supervisor's queue-event listeners used to be installed by
 * TradeChatPanel on dock mount: a session that never opened the Trade
 * surface never supervised, and queued drafts/proposals silently stalled.
 * The listeners are idempotent, so installing them here (once per app boot)
 * removes the surface-mount dependency; the dock's own call stays as a
 * harmless no-op.
 *
 * Also runs the STARTUP SWEEP: on boot and on every user switch, if any
 * approval queue is non-empty, schedule one pass. runSupervisorPass
 * self-guards (pause toggle, in-flight overlap, missing provider), so this
 * is a nudge, not a stampede.
 */

import { useEffect } from 'react';
import {
    countPendingSupervision,
    ensureSupervisorListeners,
    runSupervisorPass,
} from '../services/learning/skillSupervisor';
import * as supStore from '../services/learning/supervisorStore';

export const useSupervisorBootstrap = (activeUsername: string | null): void => {
    useEffect(() => {
        ensureSupervisorListeners();
    }, []);

    useEffect(() => {
        if (!activeUsername) return;
        // Seed the backlog count immediately: the "N items waiting" state must
        // be true from the first render, not only once a pass has run.
        supStore.setPending(countPendingSupervision(activeUsername));
        if (countPendingSupervision(activeUsername) === 0) return;
        // Debounced like the queue events: the app is still booting, and a
        // pass mid-boot would race the notebook init. 12s is the event
        // debounce (10s) plus slack.
        const timer = window.setTimeout(() => {
            void runSupervisorPass(activeUsername);
        }, 12_000);
        return () => window.clearTimeout(timer);
    }, [activeUsername]);
};
