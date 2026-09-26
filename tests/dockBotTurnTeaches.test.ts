/**
 * A bot talked to in Chart AI has to learn from the exchange.
 *
 * THE BUG. `recordBotTurnOutcome` writes the turn's lesson into that bot's own
 * `memory.md` and feeds a closed bot-authored trade into the shared
 * skills/evidence path. Four call sites invoke it — the mailbox (a bot DM in the
 * Chat surface), the group rooms, the automation bot routines, and… nothing in
 * the Chart AI dock. `TradeChatPanel` referenced it zero times.
 *
 * So a bot's memory was whichever surface you happened to use: ask it the same
 * thing in Chat and it learned; ask it in Chart AI and it forgot. Nothing
 * failed, nothing looked wrong, and the trader had asked for exactly the
 * opposite — "I want the model to still have the full handle in its learning."
 *
 * The fix is one call in the dock's solo-bot settle, and it is
 * fire-and-forget like all three siblings: a failed lesson write must never
 * turn a delivered answer into a failed turn.
 *
 * Source-contract rather than a mounted render: the settle is buried in a
 * 2,000-line component's solo branch, and the property that matters — that
 * EVERY bot-answering surface routes through the one learning call — is
 * precisely a cross-file property that no single-file test can see.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

const panelSrc = readFileSync('components/trade/TradeChatPanel.tsx', 'utf8');
const mailboxSrc = readFileSync('hooks/useBotMailbox.ts', 'utf8');
const groupsSrc = readFileSync('hooks/useAgentGroups.ts', 'utf8');
const automationsSrc = readFileSync('hooks/useAutomations.ts', 'utf8');

describe('every surface that answers as a bot teaches that bot', () => {
    it('the dock records the lesson — it did not, and nothing caught it', () => {
        expect(panelSrc, 'the Chart AI dock must teach a bot, like its three siblings')
            .toMatch(/recordBotTurnOutcome/);
    });

    it('all four surfaces call the SAME learning function', () => {
        // Four copies of "what a turn teaches" is four answers to the same
        // question, and they had already drifted to three.
        for (const [name, src] of [
            ['mailbox', mailboxSrc],
            ['group rooms', groupsSrc],
            ['automations', automationsSrc],
            ['dock', panelSrc],
        ] as const) {
            expect(src, `${name} does not record a bot turn's lesson`)
                .toMatch(/recordBotTurnOutcome/);
        }
    });

    it('records the ANSWER, not the question, and only when one arrived', () => {
        // A bot taught an empty string learns a lesson about nothing, and a bot
        // taught the stop placeholder learns that the trader gave up.
        expect(panelSrc).toMatch(/if \(answered\.trim\(\)\)/);
        expect(panelSrc).toMatch(/recordBotTurnOutcome\(bot, text, answered/);
    });

    it('is fire-and-forget, so a failed write cannot fail a delivered answer', () => {
        expect(panelSrc).toMatch(/void recordBotTurnOutcome\(/);
    });

    it('carries the trade journal, so a closed bot trade reaches the evidence path', () => {
        // Without `trades` the skill-evidence leg of the learning pass has
        // nothing to score, and the turn silently teaches only its prose.
        expect(panelSrc).toMatch(/trades,\s*\n\s*\}\);/);
    });

    it('is scoped to a bot session — a plain solo answer is not a bot turn', () => {
        // A session with no bound bot has no memory to write to; calling this
        // with a fake identity would put the lesson in the wrong place.
        expect(panelSrc).toMatch(/if \(bot && usernameNow\)/);
    });

    it('resolves the profile at settle time, not from a frozen closure', () => {
        // The dock's interval/render capture problem, one level down: reading
        // the username at the moment the turn settles means a profile switch
        // mid-answer cannot file the lesson under the wrong trader.
        expect(panelSrc).toMatch(/const usernameNow = getActiveUsername\(\)/);
    });
});
