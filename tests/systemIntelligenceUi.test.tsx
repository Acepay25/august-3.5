import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_VERSION } from '../constants/version';
import { VersionHistoryDashboard } from '../components/dashboards/VersionHistoryDashboard';
import { Header } from '../components/shared/Header';
import { DiagnosticsPanel } from '../components/settings/DiagnosticsPanel';

const data = vi.hoisted(() => ({
    highRate: null as number | null,
    tradeLogs: [] as unknown[],
    skills: [] as unknown[],
    totalInsights: 0,
}));
vi.mock('../services/learning/ReinforcementSignalService', () => ({
    ReinforcementSignalService: { getAllSignals: vi.fn().mockResolvedValue([]) },
}));
vi.mock('../services/validation/ConfidenceCalibrationService', () => ({
    getCalibrationSummary: (): object => ({ high: { winRate: data.highRate, total: 0 }, totalTrades: 12 }),
}));
vi.mock('../services/learning/GlobalLearningService', () => ({ default: { getCalibration: (): object => ({}) } }));
vi.mock('../services/infrastructure/StorageService', () => ({ storageService: { getTradeLogs: async (): Promise<unknown[]> => data.tradeLogs } }));
vi.mock('../services/learning/severityInsights', () => ({ getAttributedInsightsSummary: (): object => ({ topInsights: [], byProvider: {}, totalInsights: data.totalInsights }) }));
vi.mock('../services/learning/PatternMemorySynthesisService', () => ({ recordInsightFeedback: vi.fn() }));
vi.mock('../services/infrastructure/JobQueueService', () => ({ jobQueue: { getQueueLength: (): number => 0 } }));
vi.mock('../services/learning/SkillMemoryService', () => ({ listSkills: (): unknown[] => data.skills }));
vi.mock('../services/learning/MemoryFilesService', () => ({ getMemoryFilesStats: (): object => ({ enabledCount: 0, charCount: 0 }) }));
vi.mock('../services/infrastructure/SessionService', () => ({ getSessionContext: (): null => null, getAllSessionsStatus: (): never[] => [] }));
vi.mock('../components/shared/UpdateButton', () => ({ UpdateButton: (): null => null }));
vi.mock('../components/shared/Sidebar', () => ({ SidebarContent: (): null => null }));
vi.mock('../utils/thinkingLeakBin', () => ({ loadThinkingLeakBin: (): never[] => [], clearThinkingLeakBin: vi.fn() }));

beforeEach(() => {
    data.highRate = null;
    data.tradeLogs = [];
    data.skills = [];
    data.totalInsights = 0;
    localStorage.clear();
});
afterEach(cleanup);

describe('System Intelligence UI', () => {
    it('shows the actual static version and honest empty metrics, including no high-confidence outcomes', async () => {
        render(<VersionHistoryDashboard onClose={vi.fn()} />);
        await waitFor(() => expect(screen.getByText('No data')).toBeInTheDocument());
        const version = screen.getByLabelText('System version');
        expect(version.tagName).toBe('SPAN');
        expect(version).toHaveTextContent(`v${APP_VERSION}`);
        expect(screen.queryByRole('combobox')).toBeNull();
        expect(screen.queryByText(/v6\.0\.0|Version 6\.0|—%/)).toBeNull();
        expect(screen.getByText('No feedback yet')).toBeInTheDocument();
        expect(screen.getByText('Awaiting first resolved trade')).toBeInTheDocument();
        expect(screen.getByText('No files')).toBeInTheDocument();
        expect(screen.getByText('Log resolved high-confidence trades to calibrate')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'System' }));
        const storage = screen.getByText('Unified Storage').parentElement!;
        expect(storage).toHaveTextContent('0Items');
        expect(screen.getByText('Workers Idle')).toBeInTheDocument();
    });

    it('renders a measured zero percent and counts only recorded storage items', async () => {
        data.highRate = 0;
        data.tradeLogs = [{}, {}];
        data.totalInsights = 3;
        render(<VersionHistoryDashboard onClose={vi.fn()} />);
        expect(await screen.findByText('0%')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'System' }));
        await waitFor(() => expect(screen.getByText('Unified Storage').parentElement).toHaveTextContent('5Items'));
    });

    it('labels the header destination accurately and uses the History icon', () => {
        const open = vi.fn();
        render(<Header
            activeUsername="Alice" saveStatus="SAVED" isAnalysisInProgress={false}
            isPostMortemInProgress={false} currentVisionData={[]} isFreshSession
            isMobileMenuOpen={false} mobileMenuRef={React.createRef<HTMLDivElement>()}
            setIsMobileMenuOpen={vi.fn()} setIsVisionDataVisible={vi.fn()}
            surface="trade" onSelectSurface={vi.fn()}
            setIsSettingsVisible={vi.fn()} setIsLivePostMortemVisible={vi.fn()}
            onOpenLiveMarket={vi.fn()} onOpenVersionHistory={open}
            conversations={[]} activeConversationId={null} onNewConversation={vi.fn()}
            onLoadConversation={vi.fn()} onDeleteConversation={vi.fn()}
        />);
        const button = screen.getByRole('button', { name: 'System Intelligence' });
        expect(button).toHaveAttribute('title', 'System Intelligence');
        expect(button.querySelector('svg')).toHaveClass('lucide-history');
        fireEvent.click(button);
        expect(open).toHaveBeenCalledOnce();
        expect(screen.queryByRole('button', { name: /Changelog/ })).toBeNull();
    });
});

describe('diagnostics context', () => {
    it('adds uncertain context only to the exact error, retaining raw details and clear controls', () => {
        localStorage.setItem('lastGlobalError', JSON.stringify({
            timestamp: '2026-09-17T00:00:00Z', type: 'error',
            message: 'Cannot redefine property: onmessage', stack: 'original stack', filename: 'runtime.js', lineno: 2, colno: 3,
        }));
        render(<DiagnosticsPanel />);
        expect(screen.getByText('Cannot redefine property: onmessage')).toBeInTheDocument();
        expect(screen.getByText(/origin of this error is unknown/)).toHaveTextContent('may involve instrumentation');
        expect(screen.queryByText(/benign|proven cause/i)).toBeNull();
        expect(screen.getByText('runtime.js:2:3')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Show stack' }));
        expect(screen.getByText('original stack')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Clear Errors' }));
        expect(screen.queryByText(/origin of this error is unknown/)).toBeNull();
        expect(localStorage.getItem('lastGlobalError')).toBeNull();
    });

    it.each(['Cannot redefine property: other', 'TypeError: Cannot redefine property: onmessage', 'Cannot redefine property: onmessage extra'])(
        'does not attribute similar error %s to instrumentation', (message) => {
            localStorage.setItem('lastPromiseError', JSON.stringify({ timestamp: '2026-09-17T00:00:00Z', type: 'promise', message }));
            render(<DiagnosticsPanel />);
            expect(screen.getByText(message)).toBeInTheDocument();
            expect(screen.queryByText(/instrumentation/)).toBeNull();
        },
    );
});
