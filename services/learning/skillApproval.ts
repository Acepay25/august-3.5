/**
 * skillApproval — the one place a pending skill draft becomes a live skill.
 *
 * Both approval surfaces (the Coach thread's Save button and the approval
 * inbox) used to run the same six lines inline, and both were wrong in the
 * same way: they DELETED the draft, fired the notebook write with `void`, and
 * toasted "Skill saved" — unconditionally. `ingestCraftedSkill*Unlocked`
 * contains seven bare `return`s that write nothing (no skills folder, a skill
 * already carrying this trigger, an archived twin, an ineligible trade, a
 * rejected trade shape), and `createMemoryFileUnlocked` throws on a name
 * collision. Every one of those left the trader told that a skill existed when
 * none did, with the draft already destroyed so there was no retry.
 *
 * The fix is a read-back, not a new return type threaded through seven exits:
 * ask the library whether this trigger is present AFTER the write, and let
 * that answer — not the call's completion — decide what the UI says. It also
 * covers a future silent return in the ingest path without any change here.
 * This is the repo's standing rule for notebook writes (AGENTS.md): never
 * swallow-and-continue; surface it.
 */

import { ingestCraftedSkill, ingestCraftedSkillFromDraft, listSkills, type SkillIngestResult } from './SkillMemoryService';
import { takeSkillDraft, type SkillDraft } from '../../utils/skillDrafts';
import type { LoggedTrade } from '../../types';

export type SkillApprovalResult =
    /** The library now carries this trigger and the draft was consumed. */
    | { created: true; slug: string }
    /** The trigger was ALREADY a live skill before the write — nothing new was
     *  born, but the draft has served its purpose, so it is consumed. */
    | { created: false; reason: 'duplicate'; slug: string }
    /** The write path declined for a named reason, or threw. The draft is LEFT
     *  IN THE INBOX so the human can fix and retry it, rather than being
     *  destroyed on an assumption. */
    | { created: false; reason: 'not-written' | 'write-failed' | 'no-skills-folder'; error?: string };

/** Case-insensitive trigger match — the same comparison the ingest path uses
 *  to refuse a duplicate, so "already learned" means the same thing on both
 *  sides of the write. */
const findByTrigger = (ifCondition: string): string | null => {
    const want = ifCondition.trim().toLowerCase();
    const hit = listSkills().find(s => (s.meta.ifCondition ?? '').trim().toLowerCase() === want);
    return hit ? hit.file.name : null;
};

/**
 * Approve one draft. `trades` is the journal, used the way the old inline
 * handler used it: a draft that came from a CLOSED trade (a post-mortem craft)
 * ingests through the trade path so it carries that trade's evidence; a
 * verdict- or chat-sourced draft has no trade behind it and takes the draft
 * path.
 */
export const approveSkillDraft = async (
    draft: SkillDraft,
    username: string,
    trades: LoggedTrade[] = [],
): Promise<SkillApprovalResult> => {
    const user = username || 'default';
    const trigger = draft.crafted.ifCondition;
    const alreadyThere = findByTrigger(trigger);

    const trade = trades.find(t => t.id === draft.tradeId);
    let declined: 'no-skills-folder' | null = null;
    try {
        if (trade) await ingestCraftedSkill(trade, draft.crafted, user);
        else {
            const r = await ingestCraftedSkillFromDraft(draft.crafted, draft.coin, user, undefined, 'human');
            // The ingest now says WHY it wrote nothing. The read-back below is
            // still the authority on success, but a named cause beats a generic
            // one in the message the human reads.
            if (r && !r.created && r.reason === 'no-skills-folder') declined = r.reason;
        }
    } catch (e) {
        return { created: false, reason: 'write-failed', error: e instanceof Error ? e.message : String(e) };
    }

    const nowThere = findByTrigger(trigger);
    if (!nowThere) {
        // The write path declined, or declined to say so. Do not consume the
        // draft: the human's only copy of this proposal is the inbox row.
        return { created: false, reason: declined ?? 'not-written' };
    }
    takeSkillDraft(draft.id, username || undefined);
    if (alreadyThere && alreadyThere === nowThere) {
        return { created: false, reason: 'duplicate', slug: nowThere };
    }
    return { created: true, slug: nowThere };
};

/** What an INGEST's named outcome means to the human who just pressed a button
 *  on it. `null` means the write landed — show nothing on success. Kept beside
 *  `skillApprovalToast` so the two surfaces that approve drafts cannot describe
 *  one refusal two different ways. */
export const skillIngestOverrideNote = (
    result: SkillIngestResult,
): { kind: 'error' | 'info'; body: string } | null => {
    if (result.created) return null;
    switch (result.reason) {
        case 'duplicate':
            return { kind: 'info', body: `Already a live skill (${result.slug}) — the trigger was there before you pressed.` };
        case 'no-skills-folder':
            return { kind: 'error', body: 'Not approved — this notebook has no skills folder to write into, so nothing was created.' };
    }
};

/** What the trader is told, derived from what the library actually did. Kept
 *  here rather than in the caller so both approval surfaces — the Coach thread
 *  and the Inbox — cannot drift into disagreeing about the same write. */
export const skillApprovalToast = (
    result: SkillApprovalResult,
    name: string,
): { kind: 'success' | 'info' | 'error'; title: string; body: string } => {
    if (result.created) return { kind: 'success', title: 'Skill saved', body: name };
    if (result.reason === 'duplicate') {
        return { kind: 'info', title: 'Already learned', body: `${name} — this trigger is already a live skill` };
    }
    return {
        kind: 'error',
        title: 'Not saved — still in your inbox',
        body: result.error ?? `${name}: the skill library did not accept this trigger`,
    };
};
