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
 * The boot SWEEP is gone (contract change, 2026-10-05). It scheduled a pass 12 s
 * after every launch and every user switch, which combined with `autoEnabled`
 * defaulting to true meant a book draft was judged and landed roughly ten
 * seconds after boot. The supervisor now TRIAGES rather than applies, so that
 * fire was spending the trader's money to produce a note nobody asked for; it is
 * removed rather than debounced. Queue events still schedule a pass (debounced)
 * and the panel's "Run now" is explicit — a pass happens when something changes
 * or when you ask for one, not merely because the app opened.
 */

import { useEffect } from 'react';
import {
    countPendingSupervision,
    ensureSupervisorListeners,
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
    }, [activeUsername]);
};