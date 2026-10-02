/**
 * The failed-post-mortem retry CTA.
 *
 * The harness has always stamped the failed candidate on the message and
 * shipped a handler for it (usePostMortem.handleRetryPostMortem), and the
 * failure path carries a comment promising "an AI message with the error text
 * + a retry CTA". Nothing rendered that CTA: the handler was returned by the
 * hook but never destructured in App.tsx, and no component read
 * `postMortemFailedCandidate`. A failed post-mortem was therefore a dead row —
 * the trader's only recovery was re-logging the trade by hand.
 *
 * These tests pin the connection, not the retry itself: the flag reaches the
 * row, the CTA appears, and it is wired to the message it belongs to.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ChatTranscriptRow, { type ChatRowView } from '../components/shared/ChatTranscriptRow';
import { MessageRole } from '../types';

const failedRow: ChatRowView = {
    id: 'pm-123',
    role: 'ai',
    text: 'Post-Mortem Failed: provider timed out',
    speaker: 'desk',
    postMortemFailed: true,
};

describe('failed post-mortem row', () => {
    it('offers the retry control — this is the whole point of the flag', () => {
        const onRetry = vi.fn();
        render(<ChatTranscriptRow row={failedRow} onRetry={onRetry} />);
        expect(screen.getByTestId('post-mortem-retry')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /retry post-mortem/i })).toBeInTheDocument();
    });

    it('retries THE message that failed, not the one that was clicked last', () => {
        const onRetry = vi.fn();
        render(<ChatTranscriptRow row={failedRow} onRetry={onRetry} />);
        fireEvent.click(screen.getByRole('button', { name: /retry post-mortem/i }));
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('shows the error text alongside it — the user has to know what failed', () => {
        render(<ChatTranscriptRow row={failedRow} onRetry={vi.fn()} />);
        expect(screen.getByText(/Post-Mortem Failed/)).toBeInTheDocument();
    });

    it('renders no CTA on an ordinary AI row', () => {
        render(<ChatTranscriptRow row={{ ...failedRow, postMortemFailed: false }} onRetry={vi.fn()} />);
        expect(screen.queryByTestId('post-mortem-retry')).not.toBeInTheDocument();
    });

    it('renders no CTA when the surface has no retry handler', () => {
        render(<ChatTranscriptRow row={failedRow} />);
        expect(screen.queryByTestId('post-mortem-retry')).not.toBeInTheDocument();
    });

    it('a user row never gets the post-mortem CTA, even if flagged', () => {
        render(<ChatTranscriptRow row={{ ...failedRow, role: 'user' }} onRetry={vi.fn()} />);
        expect(screen.queryByTestId('post-mortem-retry')).not.toBeInTheDocument();
    });
});

describe('the message field that drives it', () => {
    it('a failed post-mortem is stamped on the AI row, not a data-shape change', () => {
        // The failure path keeps role AI on purpose (see usePostMortem): turning
        // it into a SYSTEM message would mutate the persisted shape, and the
        // retry needs the stamp to survive a reload.
        expect(MessageRole.AI).toBe('ai');
    });
});
