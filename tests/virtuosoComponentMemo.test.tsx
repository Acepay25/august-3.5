import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import React from 'react';
import { render, cleanup } from '@testing-library/react';

// jsdom does not implement matchMedia (ChatArea reads it for reduced motion).
beforeAll(() => {
    if (typeof window !== 'undefined' && !window.matchMedia) {
        window.matchMedia = ((query: string) => ({
            matches: false,
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        })) as unknown as typeof window.matchMedia;
    }
});

// Capture every `components` object the list is handed. The perf fix hoists
// ChatArea's Virtuoso components out of the inline JSX, so the SAME object
// must arrive on every render — a fresh object per render is what remounted
// the footer on every stream chunk.
const { seenComponents } = vi.hoisted(() => ({ seenComponents: [] as unknown[] }));
vi.mock('react-virtuoso', () => ({
    Virtuoso: React.forwardRef((props: any, _ref: unknown) => {
        seenComponents.push(props.components);
        return <div data-testid="virtuoso" />;
    }),
    VirtuosoHandle: undefined,
}));

vi.mock('../components/chat/ChatInput', () => ({ ChatInput: () => null }));
vi.mock('../components/chat/MessageItem', () => ({ default: () => null }));
vi.mock('../components/chat/TranscriptRow', () => ({ default: () => null }));
vi.mock('../components/analysis/HybridDataPanel', () => ({ default: () => null }));
vi.mock('../components/modals/ImageViewerModal', () => ({ default: () => null }));
vi.mock('../components/chat/WorkspaceWelcome', () => ({ default: () => null }));
vi.mock('../components/chat/BotAvatar', () => ({ BotAvatar: () => null }));
vi.mock('../components/shared/ErrorBoundary', () => ({ default: ({ children }: any) => <>{children}</> }));

import { ChatArea } from '../components/chat/ChatArea';

afterEach(() => {
    cleanup();
    seenComponents.length = 0;
});

const oneMessage = [{
    id: 'm1', role: 'user', text: 'analyze btc', createdAt: new Date().toISOString(),
}] as never[];

const baseProps = () => ({
    messages: oneMessage,
    chatContext: {} as never,
    virtuosoRef: { current: null } as never,
    isRateLimited: false,
    setIsRateLimited: () => {},
    showScrollDown: false,
    setShowScrollDown: () => {},
    showScrollUp: false,
    setShowScrollUp: () => {},
    handleCycleAnalysisUp: () => {},
    handleScrollToBottom: () => {},
    highlightedAnalysisId: null,
    setHighlightedAnalysisId: () => {},
    analysisMessages: oneMessage,
    loadingMessage: null as string | null,
    isAnalysisInProgress: false,
    isPostMortemInProgress: false,
    setIsLivePostMortemVisible: () => {},
    handleCancelAnalysis: () => {},
    onDeleteMessages: () => {},
    images: [] as never[],
    removeImage: () => {},
    leverageInput: '10',
    handleLeverageChange: () => {},
    handleLeverageBlur: () => {},
    handlePresetLeverage: () => {},
    fileInputRef: { current: null } as never,
    isImageUploadDisabled: false,
    handleImageUpload: () => {},
    input: '',
    setInput: () => {},
    handleSendMessage: () => {},
    isSummarizing: false,
    isAnyProviderEnabled: true,
    isAccuracyModeEnabled: false,
    providers: [] as never[],
    selectedVisionModel: '',
    setSelectedVisionModel: () => {},
    lensConfig: { enabled: false, assignments: [], tradingStyle: 'swing' } as never,
    setLensConfig: () => {},
    ensembleModelSelection: [] as never,
    setEnsembleModelSelection: () => {},
    customEnsemblePrompt: null,
    setCustomEnsemblePrompt: () => {},
    customLensPrompts: {},
    setCustomLensPrompts: () => {},
    isEnsembleEnabled: false,
    setIsEnsembleEnabled: () => {},
    selectedChatModel: '',
    setSelectedChatModel: () => {},
});

describe('ChatArea Virtuoso components stability', () => {
    it('hands the list the SAME components object across re-renders, even when loadingMessage changes', () => {
        const Parent: React.FC = () => {
            const [loading, setLoading] = React.useState<string | null>(null);
            (Parent as unknown as { setLoad?: (v: string | null) => void }).setLoad = setLoading;
            return <ChatArea {...baseProps()} loadingMessage={loading} />;
        };

        render(<Parent />);
        expect(seenComponents.length).toBeGreaterThan(0);
        const first = seenComponents[0];
        expect(first).toBeTruthy();

        React.act(() => {
            (Parent as unknown as { setLoad: (v: string | null) => void }).setLoad('Debating…');
        });
        // Every render after the mount received the identical object: the
        // footer component type never changes, so it never remounts.
        for (const c of seenComponents.slice(1)) {
            expect(c).toBe(first);
        }
    });
});
