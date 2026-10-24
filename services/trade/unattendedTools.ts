/**
 * The tool set a DETACHED skill evaluation may call.
 *
 * The scheduled-automation feature is deleted (owner request, 2026-10-24), so
 * the skill evaluator is the one remaining unattended caller. Its job is to
 * judge a skill, not to act: it gets the Chat surface's read set minus every
 * tool that edits the trader's notebook and minus the two tools that change
 * the journal (present_trade draws/arms a watch; decline_trade records a skip).
 *
 * Derived from CHAT_SURFACE_TOOLS rather than restated, so a lookup added there
 * reaches the evaluator automatically. The deny list stays the one owner of
 * "not without a human".
 */
import { CHAT_SURFACE_TOOLS } from './chatSurfaceTurn';

export const UNATTENDED_DENY = [
    'write_memory_note', 'amend_memory', 'remember', 'forget',
    'propose_skill', 'revise_skill', 'propose_strategy', 'forge_tool',
];

export const DETACHED_EVAL_TOOLS: string[] = CHAT_SURFACE_TOOLS.filter(
    tool => !UNATTENDED_DENY.includes(tool) && tool !== 'present_trade' && tool !== 'decline_trade',
);
