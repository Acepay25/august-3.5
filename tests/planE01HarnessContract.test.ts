import { describe, it, expect } from 'vitest';

/**
 * E-01a — the harness contract must reach the LIVE prompts, exactly once.
 *
 * `HARNESS_CONTRACT_PROMPT` carries the confidence ladder ("Avoid = no
 * trade"), the risk rules and clause 5 — the `HARNESS_TURN_MARK` convention,
 * which is the ONLY text that tells a seat which words are the app's and
 * which are the trader's.
 *
 * The desk-tool loop writes harness-authored text into the USER role (tool
 * results, a continue nudge, a clipped payload). A seat that receives that
 * text and has never been told what the mark means cannot obey the split.
 * So the contract has to be in the live system prompt — and exactly once:
 * twice would have the model reconcile two copies, and the analysis path
 * already composes it.
 *
 * This file pins the OBSERVABLE contract (what goes on the wire), not the
 * mechanism — the injection itself lives with the desk-tool transport.
 */

import { HARNESS_CONTRACT_PROMPT } from '../constants/prompts/harnessContract';
import { composePrompt, stripHarnessContract } from '../utils/composePrompt';
import { withDeskToolsSystemPrompt } from '../services/analysis/DeskToolsService';
import { HARNESS_TURN_MARK } from '../utils/harnessMarks';
import type { ChatMessage } from '../services/providers/GenericProviderService';

const countOccurrences = (haystack: string, needle: string): number => {
    let count = 0;
    let at = haystack.indexOf(needle);
    while (at >= 0) {
        count += 1;
        at = haystack.indexOf(needle, at + needle.length);
    }
    return count;
};

const systemText = (messages: ChatMessage[]): string =>
    messages.filter(m => m.role === 'system').map(m => (typeof m.content === 'string' ? m.content : '')).join('\n');

describe('E-01a — the live desk-tool prompt carries the contract exactly once', () => {
    it('a seat that starts with its own mandate gets the contract FIRST, once', () => {
        const out = withDeskToolsSystemPrompt(
            [{ role: 'system', content: 'You are the desk. Answer in prose.' }],
            true,
        );
        const text = systemText(out);
        expect(countOccurrences(text, 'HARNESS CONTRACT')).toBe(1);
        expect(text.indexOf('HARNESS CONTRACT')).toBeLessThan(text.indexOf('You are the desk.'));
    });

    it('a turn with no system message still gets one', () => {
        const out = withDeskToolsSystemPrompt([{ role: 'user', content: 'what is BTC doing' }], true);
        const text = systemText(out);
        expect(countOccurrences(text, 'HARNESS CONTRACT')).toBe(1);
        expect(out[0].role).toBe('system');
    });

    it('a caller that already carries the contract does NOT get a second copy', () => {
        const out = withDeskToolsSystemPrompt(
            [{ role: 'system', content: `${HARNESS_CONTRACT_PROMPT}\n\nYou are the desk.` }],
            true,
        );
        const text = systemText(out);
        expect(countOccurrences(text, 'HARNESS CONTRACT')).toBe(1);
    });

    it('the contract teaches the marker convention the desk loop actually uses', () => {
        // The mark is written by utils/harnessMarks.harnessTurn() and lands in
        // the user role. If the contract did not name it, the seat has no way
        // to tell the app's words from the trader's.
        expect(HARNESS_CONTRACT_PROMPT).toContain(HARNESS_TURN_MARK);
        expect(HARNESS_CONTRACT_PROMPT).toMatch(/not the trader/i);
    });

    it('the contract still carries the confidence ladder and the no-trade rule', () => {
        expect(HARNESS_CONTRACT_PROMPT).toMatch(/Avoid = no trade/i);
        expect(HARNESS_CONTRACT_PROMPT).toMatch(/Neutral/);
        expect(HARNESS_CONTRACT_PROMPT).toMatch(/R:R/);
    });
});

describe('E-01a — composePrompt keeps one contract, whatever the caller passes', () => {
    it('the contract is the first layer and appears once', () => {
        const out = composePrompt([
            { id: 'contract', text: HARNESS_CONTRACT_PROMPT },
            { id: 'job', text: 'Do the work.' },
        ]);
        expect(countOccurrences(out, 'HARNESS CONTRACT')).toBe(1);
        expect(out.startsWith(HARNESS_CONTRACT_PROMPT.trim())).toBe(true);
    });

    it('a job block that already embeds the contract is stripped, not doubled', () => {
        const out = composePrompt([
            { id: 'contract', text: HARNESS_CONTRACT_PROMPT },
            { id: 'job', text: `${HARNESS_CONTRACT_PROMPT}\n\n**JOB:** Do the work.` },
        ]);
        expect(countOccurrences(out, 'HARNESS CONTRACT')).toBe(1);
        expect(out).toContain('**JOB:** Do the work.');
    });

    it('two contract layers collapse to one', () => {
        const out = composePrompt([
            { id: 'contract', text: HARNESS_CONTRACT_PROMPT },
            { id: 'contract', text: HARNESS_CONTRACT_PROMPT },
        ]);
        expect(countOccurrences(out, 'HARNESS CONTRACT')).toBe(1);
    });

    it('stripHarnessContract removes a nested copy and leaves the rest', () => {
        const stripped = stripHarnessContract(`${HARNESS_CONTRACT_PROMPT}\n\n**JOB:** Do the work.`);
        expect(stripped).not.toContain('HARNESS CONTRACT');
        expect(stripped).toContain('**JOB:** Do the work.');
    });
});
