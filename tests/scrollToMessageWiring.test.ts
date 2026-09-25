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
const panelSrc = readFileSync('components/trade/TradeChatPanel.tsx', 'utf8');

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

    it('handleScrollToBottom resolves the LAST AI entry of the active dock session and calls the bridge', () => {
        expect(appSrc).toMatch(/const handleScrollToBottom = \(\) => \{[\s\S]{0,900}chatStore\.getSnapshot\(\)[\s\S]{0,400}e\.role === 'ai' && !e\.notice[\s\S]{0,400}scrollToMessageRef\.current\?\.\(targetId\);/);
    });

    it('the bridge is threaded into TradeView', () => {
        expect(appSrc).toMatch(/registerScrollToMessage=\{registerScrollToMessage\}/);
        // App reads the dock's store so jump-to-latest targets a real entry id.
        expect(appSrc).toMatch(/import \* as chatStore from '\.\/services\/trade\/chatStore'/);
    });
});

describe('TradeView: forwards the bridge to the dock', () => {
    it('declares the prop and includes it in dockProps (both dock renders spread dockProps)', () => {
        expect(tradeViewSrc).toMatch(/registerScrollToMessage\?: \(fn: \(\(messageId: string\) => void\) \| null\) => void/);
        expect(tradeViewSrc).toMatch(/const dockProps = \{[\s\S]{0,1200}registerScrollToMessage,\s*\};/);
        expect(tradeViewSrc.match(/<TradeChatPanel\b/g)?.length).toBe(2);
        expect(tradeViewSrc.match(/\{\.\.\.dockProps\}/g)?.length).toBe(2);
    });
});

describe('TradeChatPanel: renders the ids the bridge looks up', () => {
    it('entry wrappers carry data-entry-id + data-message-id without layout changes', () => {
        // The App message id is read once per entry (the Pin chip needs the
        // same value), and the wrapper still stamps both ids on one attribute
        // pair — no layout change.
        expect(panelSrc).toMatch(/const analysisId = analysisMessageIds\[e\.id\];/);
        expect(panelSrc).toMatch(/data-entry-id=\{e\.id\} data-message-id=\{analysisId \?\? e\.id\}/);
        expect(panelSrc).toMatch(/registerScrollToMessage\?: \(fn: \(\(messageId: string\) => void\) \| null\) => void/);
        // The registered function centers the target with a smooth scroll,
        // and the cleanup unregisters (null).
        expect(panelSrc).toMatch(/scrollIntoView\(\{ block: 'center', behavior: 'smooth' \}\)/);
        expect(panelSrc).toMatch(/return \(\) => \{ registerScrollToMessage\(null\); \};/);
    });

    it('the ensemble bridge may return { text, messageId } so answers carry the App message id', () => {
        expect(panelSrc).toMatch(/Promise<string \| \{ text: string; messageId\?: string \}>/);
        // The dock no longer settles the answer row itself — the shared turn
        // does, and hands the id back through `onMessageId` so the dock can map
        // the row it created to the App-side message Locate scrolls to.
        expect(panelSrc).toMatch(/onMessageId: \(entryId, messageId\) => \{/);
        expect(panelSrc).toMatch(/setAnalysisMessageIds\(prev => \(\{ \.\.\.prev, \[entryId\]: messageId \}\)\)/);
        // App's handleRunAnalysisFromChat actually supplies the id.
        expect(appSrc).toMatch(/messageId: aiMessage\.id,/);
    });
});

/**
 * The Chat surface and the Chart AI dock are one conversation.
 *
 * The Agents surface with no bot selected promises the same thing the dock's
 * "Full analysis" button does, and both call the same pipeline — but only the
 * dock wrote the transcript. A question asked in Chat ran a full ensemble
 * debate and left no trace in the session the dock renders, so the two surfaces
 * looked like separate products.
 *
 * The fix is one shared writer (`services/trade/analysisTurn.ts`), not a second
 * copy: a copy is how they drift again, and the drift is invisible because both
 * copies look correct alone.
 */
describe('Chat and Chart AI share one analysis turn', () => {
    const agentsSrc = readFileSync('components/agents/AgentsView.tsx', 'utf8');
    const turnSrc = readFileSync('services/trade/analysisTurn.ts', 'utf8');

    it('the Chat surface writes its analysis into the dock\'s session', () => {
        expect(agentsSrc).toMatch(/runAnalysisAsChatTurn\(\{/);
        // The SAME session the dock renders — not a parallel one.
        expect(agentsSrc).toMatch(/sid: chatStore\.getActiveId\(\)/);
    });

    it('both surfaces run the pipeline through that one writer', () => {
        expect(agentsSrc).toMatch(/run: \(\) => onAnalyze\(prompt, images\)/);
        expect(panelSrc).toMatch(/run: \(\) => onRunAnalysis!/);
        // And neither re-implements the append/settle bookkeeping.
        expect(turnSrc).toMatch(/entries: \[\.\.\.s\.entries, userEntry, aiEntry\]/);
        expect(turnSrc).toMatch(/streaming: false/);
    });

    it('Chat gets the dock\'s pipeline entry, not a weaker local copy', () => {
        // The old inline handler `void`ed the pipeline, so a rejection (an
        // analysis already running, no providers configured) vanished with no
        // row anywhere. Both surfaces now get a promise they can surface.
        expect(appSrc).toMatch(/onAnalyze=\{handleRunAnalysisFromAgents\}/);
        expect(appSrc).not.toMatch(/onAnalyze=\{\(prompt, images\) =>/);
        expect(turnSrc).toMatch(/ANALYSIS_FAILED_TEXT/);
    });

    it('Chat runs on the ACTIVE conversation, not the dock\'s private list', () => {
        // The dock deliberately runs into a private message list because it
        // renders the answer out of chatStore. The Chat surface renders the
        // ACTIVE conversation, so handing it the dock's `automation` entry ran
        // a full debate into a list it never reads: the probe caught it waiting
        // forever for a reply that had already been written somewhere else.
        expect(appSrc).toMatch(/const handleRunAnalysisFromAgents = useCallback/);
        const agentsHandler = appSrc.slice(
            appSrc.indexOf('const handleRunAnalysisFromAgents'),
            appSrc.indexOf('const handleForkDebate'),
        );
        expect(agentsHandler).toMatch(/onSettled: \(aiMessage\) =>/);
        expect(agentsHandler).not.toMatch(/automation:/);
        // And the pipeline's report-only channel must not flip the run into an
        // automation run, or the rows land in the private list all the same.
        expect(agentsHandler).not.toMatch(/isAutomationRun/);
    });

    it('the run slot is always released, including on an aborted run', () => {
        // An orphaned streaming:true bubble blocked all session persistence
        // until reload, so the settle must happen on every exit path.
        expect(turnSrc).toMatch(/finally \{[\s\S]*?chatStore\.endRunOwned\(sid, controller\);/);
    });
});
