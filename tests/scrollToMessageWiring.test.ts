/**
 * Scroll-to-message wiring contract (audit 2026-09-15, UI shell).
 *
 * The main transcript moved into the trade surface's Chart AI dock
 * (TradeChatPanel — a plain overflow scroller, NOT a Virtuoso), which left
 * App's `virtuosoRef` never attached: "Jump to latest analysis" and the
 * saved-analyses gallery's Locate scrolled nothing (silent no-ops). The fix
 * threads an imperative `registerScrollToMessage` bridge App → TradeView →
 * TradeChatPanel; the panel registers a scrollToMessage(id) function
 * (null on unmount) and both affordances call it.
 *
 * The panel half is BEHAVIOR-tested in tests/tradeChatPanelScrollToMessage
 * .test.tsx. The App half lives inside the 3k-line App component's closures,
 * which no jsdom render in this repo exercises — so, exactly like
 * tests/journalSurfaceNavigation.test.tsx, we assert the source contract.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

const appSrc = readFileSync('App.tsx', 'utf8');
const tradeViewSrc = readFileSync('components/trade/TradeView.tsx', 'utf8');
const agentsViewSrc = readFileSync('components/agents/AgentsView.tsx', 'utf8');
// The dock feature now spans the shell + the extracted orchestrator/
// transcript/composer modules — the contract follows the code.
const panelSrc = [
    readFileSync('components/trade/TradeChatPanel.tsx', 'utf8'),
    readFileSync('services/trade/chatTurnRunner.ts', 'utf8'),
    readFileSync('components/trade/panels/ChatTranscriptList.tsx', 'utf8'),
    readFileSync('components/trade/panels/ChatComposer.tsx', 'utf8'),
].join('\n');

describe('App: the dead virtuosoRef is gone', () => {
    it('no virtuoso handle remains in App', () => {
        expect(appSrc).not.toMatch(/virtuosoRef\.current/);
        expect(appSrc).not.toMatch(/VirtuosoHandle/);
        expect(appSrc).not.toMatch(/from 'react-virtuoso'/);
    });

    it('App stores the panel-provided function in a ref + registers it via useCallback', () => {
        expect(appSrc).toMatch(/const scrollToMessageRef = useRef<\(\(messageId: string\) => void\) \| null>\(null\)/);
        expect(appSrc).toMatch(/const registerScrollToMessage = useCallback\(\(fn: \(\(messageId: string\) => void\) \| null\): void => \{\s*scrollToMessageRef\.current = fn;/);
    });
});

describe('App: both affordances call the bridge', () => {
    it('handleLocateMessage scrolls by messageId through the bridge', () => {
        expect(appSrc).toMatch(new RegExp(
            'const handleLocateMessage = useCallback[\\s\\S]{0,400}' +
            'scrollToMessageRef\\.current\\?\\.\\(messageId\\);',
        ));
    });

    it('jump-to-latest lives on the Chat transcript as a scroll pill', () => {
        // Stage 3 deleted the palette's jump action; the pill rehomed it on
        // the Chat surface's scroller (the dock's bridge still serves
        // Locate, pinned below).
        expect(agentsViewSrc).toMatch(/data-testid="jump-to-latest"/);
        expect(agentsViewSrc).toMatch(/scrollHeight - el\.scrollTop - el\.clientHeight > 240/);
    });

    it('the bridge is threaded into TradeView', () => {
        expect(appSrc).toMatch(/registerScrollToMessage=\{registerScrollToMessage\}/);
        // App reads the dock's store so jump-to-latest targets a real entry id.
        expect(appSrc).toMatch(/import \* as chatStore from '\.\/services\/trade\/chatStore'/);
    });
});

describe('TradeView: forwards the bridge to the dock', () => {
    it('declares the prop and includes it in dockProps (the single dock render spreads them)', () => {
        expect(tradeViewSrc).toMatch(/registerScrollToMessage\?: \(fn: \(\(messageId: string\) => void\) \| null\) => void/);
        expect(tradeViewSrc).toMatch(/const dockProps = \{[\s\S]{0,1200}registerScrollToMessage,\s*\};/);
        // Was 2 until the dock became hide-not-close (Stage 2 Phase 2): there is
        // one mounted panel now, and the collapsed rail is a separate
        // presentation component. The bridge is registered once, which is the
        // point — a second panel was a second registration to keep in step.
        expect(tradeViewSrc.match(/<TradeChatPanel\b/g)?.length).toBe(1);
        expect(tradeViewSrc.match(/\{\.\.\.dockProps\}/g)?.length).toBe(1);
    });
});

describe('the dock transcript renders the ids the bridge looks up', () => {
    const listSrc = readFileSync('components/trade/panels/ChatTranscriptList.tsx', 'utf8');

    it('entry wrappers carry data-entry-id + data-message-id', () => {
        // A row projected out of the bound conversation carries the Message's
        // own id by construction (`liveEntryFromMessage` sets `id: m.id`), so
        // the entry id IS the analysis id — no side map is consulted, and the
        // Pin chip reads the same value.
        expect(listSrc).toMatch(/const analysisId = resolveVerdictByIdentity && e\.role === 'ai' \? e\.id : undefined;/);
        expect(listSrc).toMatch(/data-entry-id=\{e\.id\} data-message-id=\{analysisId \?\? e\.id\}/);
        expect(panelSrc).toMatch(/registerScrollToMessage\?: \(fn: \(\(messageId: string\) => void\) \| null\) => void/);
        // The registered function centers the target with a smooth scroll,
        // and the cleanup unregisters (null).
        expect(panelSrc).toMatch(/scrollIntoView\(\{ block: 'center', behavior: 'smooth' \}\)/);
        expect(panelSrc).toMatch(/return \(\) => \{ registerScrollToMessage\(null\); \};/);
    });

    it('nothing hands an analysis message id back out of a run', () => {
        // The bridge used to resolve `{ text, messageId }` and keep an
        // entryId → messageId map in the panel. The answer row now comes from
        // the conversation, whose id already IS the message id, so the map, the
        // hand-back and App's `messageId:` are all gone rather than unused.
        expect(listSrc).not.toMatch(/analysisMessageIds/);
        expect(panelSrc).not.toMatch(/analysisMessageIds|setAnalysisMessageIds/);
        expect(appSrc).not.toMatch(/messageId: aiMessage\.id,/);
    });
});

/**
 * The Chat surface and the Chart AI dock are ONE conversation, in both
 * directions.
 *
 * A "Full analysis" started on the chart used to run with the `automation`
 * option — into a private message list App built for it — so it never appeared
 * in the Chat surface's thread or the rail's list. And a turn asked in Chat
 * wrote its own copy into the dock's session, which the merge could not
 * recognise (fresh ids), so the dock showed the question twice with two
 * different answers. Both were the same defect seen from either side: two
 * records of one run. There is now one entry, one writer, one thread.
 */
describe('Chat and Chart AI share one analysis turn', () => {
    const agentsSrc = readFileSync('components/agents/AgentsView.tsx', 'utf8');
    const runnerSrc = readFileSync('services/trade/chatTurnRunner.ts', 'utf8');

    /** App's single analysis entry, sliced out so an assertion cannot match a
     *  neighbouring handler. The end marker has moved twice already (the
     *  2026-10-03 unwired-batch removal and stage 3's deletion of
     *  handleCalculateAIProbabilities), so it is located, not assumed. */
    const analysisEntry = (): string => {
        const start = appSrc.indexOf('const handleRunAnalysisFromChat = useCallback');
        expect(start, 'App\'s single analysis entry is gone or renamed').toBeGreaterThan(-1);
        const end = appSrc.indexOf('const handleCloseJournal', start);
        expect(end).toBeGreaterThan(start);
        return appSrc.slice(start, end);
    };

    it('both surfaces are wired to the SAME analysis entry', () => {
        // Stage 20f gave the dock's binding one extra argument (Full analysis is
        // an instruction now, not a keyword), so the wiring is an arrow function
        // around the same wrapper. The invariant this gate exists for is UNCHANGED:
        // one wrapper, reached from both homes, never a per-surface twin — the
        // twin is what drifted.
        expect(appSrc).toMatch(/onRunAnalysis=\{\(prompt, images\) => handleRunAnalysisFromChat\(prompt, images, true\)\}/);
        expect(appSrc).toMatch(/onAnalyze=\{handleRunAnalysisFromChat\}/);
        // One entry, not a per-surface twin — the twin is what drifted.
        expect(appSrc.match(/const handleRunAnalysis\w+ = useCallback/g)).toHaveLength(1);
    });

    it('the run writes the ACTIVE conversation: no private list, no second copy', () => {
        const entry = analysisEntry();
        expect(entry).toMatch(/await handleSendMessage\(/);
        expect(entry).not.toMatch(/automation:/);
        expect(entry).not.toMatch(/onSettled/);
        expect(appSrc).not.toMatch(/onSettled/);
        // Neither surface keeps a transcript writer for an analysis turn any
        // more, so the module that held it is gone rather than half-used. The
        // CALL and the import are measured, not the name: this file's own
        // comments still have to say what used to happen.
        expect(agentsSrc).not.toMatch(/import \{ runAnalysisAsChatTurn|runAnalysisAsChatTurn\(/);
        expect(runnerSrc).not.toMatch(/import \{ runAnalysisAsChatTurn|runAnalysisAsChatTurn\(/);
        // The dock still claims its session's run slot, or the composer's Stop
        // and its double-send guard vanish with the wrapper that used to hold it.
        expect(runnerSrc).toMatch(/const runFullAnalysis = async[\s\S]*?chatStore\.beginRun\(sid, controller\);[\s\S]*?finally \{\s*chatStore\.endRunOwned\(sid, controller\);/);
    });

    it('binds the session to the conversation before the run, so both homes see it', () => {
        // The dock merges a conversation's rows only for a session carrying the
        // link, so binding IS the sync: without it the analysis lands where the
        // other home cannot read it.
        expect(analysisEntry()).toMatch(/if \(activeConversationId\) chatStore\.bindConversation\(activeConversationId\);/);
    });
});
