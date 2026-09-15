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
    it('handleLocateMessage scrolls by messageId (the id its highlight uses) and keeps the highlight', () => {
        expect(appSrc).toMatch(new RegExp(
            'const handleLocateMessage = useCallback[\\s\\S]{0,400}' +
            'scrollToMessageRef\\.current\\?\\.\\(messageId\\);[\\s\\S]{0,80}' +
            'setHighlightedAnalysisId\\(messageId\\)',
        ));
    });

    it('handleScrollToBottom resolves the LAST AI entry of the active dock session and calls the bridge', () => {
        expect(appSrc).toMatch(/const handleScrollToBottom = \(\) => \{[\s\S]{0,900}chatStore\.getSnapshot\(\)[\s\S]{0,400}e\.role === 'ai' && !e\.notice[\s\S]{0,400}scrollToMessageRef\.current\?\.\(targetId\);/);
        // The highlight clear side-effect is preserved.
        expect(appSrc).toMatch(/scrollToMessageRef\.current\?\.\(targetId\);\s*setHighlightedAnalysisId\(null\);/);
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
        expect(panelSrc).toMatch(/data-entry-id=\{e\.id\} data-message-id=\{analysisMessageIds\[e\.id\] \?\? e\.id\}/);
        expect(panelSrc).toMatch(/registerScrollToMessage\?: \(fn: \(\(messageId: string\) => void\) \| null\) => void/);
        // The registered function centers the target with a smooth scroll,
        // and the cleanup unregisters (null).
        expect(panelSrc).toMatch(/scrollIntoView\(\{ block: 'center', behavior: 'smooth' \}\)/);
        expect(panelSrc).toMatch(/return \(\) => \{ registerScrollToMessage\(null\); \};/);
    });

    it('the ensemble bridge may return { text, messageId } so answers carry the App message id', () => {
        expect(panelSrc).toMatch(/Promise<string \| \{ text: string; messageId\?: string \}>/);
        expect(panelSrc).toMatch(/setAnalysisMessageIds\(prev => \(\{ \.\.\.prev, \[aiEntry\.id\]: analysisMessageId \}\)\)/);
        // App's handleRunAnalysisFromChat actually supplies the id.
        expect(appSrc).toMatch(/messageId: aiMessage\.id,/);
    });
});
