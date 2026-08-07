import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MistakeWarningBanner from '../components/shared/MistakeWarningBanner';

// Deterministic weakness analysis — no storage access in the banner test.
vi.mock('../services/learning/MistakePatternService', () => ({
  getTradingWeaknesses: vi.fn(() => ({
    mistakes: [
      { id: 'm1', description: 'Chased entry after a pump', severity: 'high', occurrences: 3, pattern: 'chase', setup: 'Breakout' },
    ],
    worstPerformingSetups: [
      { setup: 'BTCUSDT Breakout', count: 5, wins: 1, winRate: 20 },
    ],
    lastUpdated: new Date().toISOString(),
  })),
}));

describe('MistakeWarningBanner', () => {
  it('renders warnings and dismisses without crashing (hooks-order regression)', () => {
    // Regression: the early `if (!isVisible) return null` used to sit BEFORE
    // the useMemo hooks — dismissing re-rendered with fewer hooks than the
    // previous render, which React treats as a hooks-order violation and
    // unmounts the whole app tree.
    render(
      <MistakeWarningBanner
        tradeLog={[{ id: 't1' } as any]}
        currentCoin="BTC"
        currentDirection="Long"
      />
    );

    expect(screen.getByText('Personal Trading Alert')).toBeTruthy();
    expect(screen.getByText('Chased entry after a pump')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Dismiss warning'));

    // Dismissed → banner gone, tree still mounted (no "Rendered fewer hooks").
    expect(screen.queryByText('Personal Trading Alert')).toBeNull();
  });

  it('renders nothing when there are no trades', () => {
    const { container } = render(<MistakeWarningBanner tradeLog={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
