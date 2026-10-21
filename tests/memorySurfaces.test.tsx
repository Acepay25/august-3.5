/**
 * memorySurfaces — the memory LIST and the memory DETAIL, at the reference's
 * shape.
 *
 * The reference (the Claude desktop app's Settings → Memory) is the visual
 * reference the owner sent: a list of named topics in three columns — the
 * label, what the entry says, and when it was last written — separated by
 * hairlines, with the selected row raised and carrying a pencil and a trash;
 * and a detail that leads with a back link, the title, a Delete action, and
 * the labelled fields "Last updated", "Summary" and "Details".
 *
 * These cases pin the parts of that shape that can quietly rot:
 *
 *  1. THE THREE COLUMNS ARE REAL. The label is the entry's name, the
 *     description is its first line of prose, and the date is the file's own
 *     `updatedAt`. A column that prints a made-up date is worse than no
 *     column, so the formatter says "unknown" rather than inventing one.
 *  2. ONLY THE SELECTED ROW CARRIES THE ACTIONS — the pencil and the trash
 *     belong to the row you are on.
 *  3. THE DETAIL'S FIELDS ARE LABELLED, and the Details really are a bulleted
 *     list.
 *  4. THE PROSE IS SET IN THE READING FACE. The Summary and the Details are
 *     what the trader READS, so they wear the app's serif (`AnswerBody`, the
 *     one home for the model's voice) while the chrome around them stays in
 *     the interface sans.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { ToastProvider } from '../components/shared/Toast';
import MemoryTopicsCard, { memoryUpdatedLabel } from '../components/learn/MemoryTopicsCard';
import MemoryTopicPanel from '../components/learn/MemoryTopicPanel';
import {
    initMemoryFiles,
    getMemoryFiles,
    createMemoryFile,
    createMemoryFolder,
} from '../services/learning/MemoryFilesService';

afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.restoreAllMocks();
});

/** A notebook with one user folder holding two entries, one of them the
 *  reference's own shape: a heading, a one-line summary, then bullets. */
const seedNotebook = async (user: string): Promise<{ folderId: string; fileId: string }> => {
    await initMemoryFiles(user);
    const folder = await createMemoryFolder('research', user);
    const file = await createMemoryFile(
        folder.id,
        'hardware.md',
        [
            '# Hardware',
            '',
            'Laptop, hardware specs, and tooling decisions.',
            '',
            '- Owns a 16GB gaming laptop',
            '- Uses a fixed-offset mobile ISP',
        ].join('\n'),
        user,
    );
    return { folderId: folder.id, fileId: file.id };
};

const renderCard = (onOpenTopic = vi.fn()) => {
    render(
        <ToastProvider>
            <MemoryTopicsCard onOpenTopic={onOpenTopic} />
        </ToastProvider>,
    );
    return onOpenTopic;
};

describe('the memory list reads as three columns', () => {
    it('a row is a label, a description and an updated date', async () => {
        await seedNotebook('memory-list-columns');
        renderCard();

        // The label: the entry's name.
        expect(screen.getByText('hardware')).toBeTruthy();
        // The description: the entry's first line of prose.
        expect(screen.getByText('Laptop, hardware specs, and tooling decisions.')).toBeTruthy();
        // The date: the file's own updatedAt, never a guess.
        const dates = screen.getAllByText(/^Updated /);
        expect(dates.length).toBeGreaterThan(0);
        expect(dates.every(d => d.textContent !== 'Updated unknown')).toBe(true);
    });

    it('the rows are separated by hairlines, not cards, and grouped under a heading', async () => {
        await seedNotebook('memory-list-hairlines');
        const { container } = render(
            <ToastProvider>
                <MemoryTopicsCard onOpenTopic={vi.fn()} />
            </ToastProvider>,
        );

        // The section heading is the notebook folder the entries live in.
        expect(screen.getByText('Research')).toBeTruthy();

        const list = container.querySelector('[data-testid="memory-topics-list"]');
        expect(list).toBeTruthy();
        // A hairline between the rows, not a card around each one.
        const groupList = list!.querySelector('ul');
        expect(groupList).toBeTruthy();
        expect(groupList!.className).toContain('divide-zinc-800');
        expect(container.querySelectorAll('[data-testid="memory-topics-list"] li').length).toBeGreaterThan(0);
    });

    it('only the selected row carries the pencil and the trash', async () => {
        await seedNotebook('memory-list-selection');
        const onOpenTopic = renderCard();

        // Nothing is selected yet: no edit control anywhere on the list.
        expect(screen.queryByRole('button', { name: /^Edit / })).toBeNull();
        expect(screen.queryByRole('button', { name: /^Delete / })).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Read hardware' }));
        expect(onOpenTopic).toHaveBeenCalledTimes(1);

        // The selected row alone carries them.
        expect(screen.getByRole('button', { name: 'Edit hardware' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Delete hardware' })).toBeTruthy();
        expect(screen.getAllByRole('button', { name: /^Edit / })).toHaveLength(1);
        expect(screen.getAllByRole('button', { name: /^Delete / })).toHaveLength(1);
    });

    it('the trash really deletes the entry', async () => {
        const { fileId } = await seedNotebook('memory-list-delete');
        renderCard();

        fireEvent.click(screen.getByRole('button', { name: 'Read hardware' }));
        fireEvent.click(screen.getByRole('button', { name: 'Delete hardware' }));

        // The destructive press is confirmed, not assumed.
        fireEvent.click(await screen.findByTestId('confirm-dialog-confirm'));

        await waitFor(() => {
            expect(getMemoryFiles().files.find(f => f.id === fileId)).toBeUndefined();
        });
        await waitFor(() => {
            expect(screen.queryByRole('button', { name: 'Read hardware' })).toBeNull();
        });
    });
});

describe('the date column never invents a timestamp', () => {
    it('says so when the entry has none', () => {
        expect(memoryUpdatedLabel(0)).toBe('Updated unknown');
        expect(memoryUpdatedLabel(undefined)).toBe('Updated unknown');
        expect(memoryUpdatedLabel(null)).toBe('Updated unknown');
    });

    it('counts the days for an entry that is still moving', () => {
        const now = Date.now();
        expect(memoryUpdatedLabel(now, now)).toBe('Updated today');
        expect(memoryUpdatedLabel(now - 3 * 86_400_000, now)).toBe('Updated 3 days ago');
        expect(memoryUpdatedLabel(now - 86_400_000, now)).toBe('Updated 1 day ago');
    });

    it('prints the day for an entry that has settled', () => {
        const now = Date.now();
        const old = now - 30 * 86_400_000;
        expect(memoryUpdatedLabel(old, now)).toMatch(/^Updated [A-Z][a-z]{2} \d{1,2}$/);
    });
});

describe('the memory detail reads as a document', () => {
    const renderPanel = (fileId: string, user: string) => {
        const onClose = vi.fn();
        render(
            <ToastProvider>
                <MemoryTopicPanel
                    fileId={fileId}
                    username={user}
                    memoryConfig={null}
                    onClose={onClose}
                />
            </ToastProvider>,
        );
        return onClose;
    };

    it('leads with a back link, the title and a Delete action', async () => {
        const user = 'memory-detail-head';
        const { fileId } = await seedNotebook(user);
        const onClose = renderPanel(fileId, user);

        // The back link returns to the list the entry came from.
        const back = screen.getByRole('button', { name: 'Back to memory topics' });
        fireEvent.click(back);
        expect(onClose).toHaveBeenCalled();

        // The title, in the interface sans.
        const title = screen.getByRole('heading', { level: 2 });
        expect(title.textContent).toBe('hardware');

        // The Delete action, as a raised chip beside the title.
        expect(screen.getByRole('button', { name: 'Delete hardware' })).toBeTruthy();
    });

    it('labels its fields — Last updated, Summary, Details', async () => {
        const user = 'memory-detail-fields';
        const { fileId } = await seedNotebook(user);
        renderPanel(fileId, user);

        expect(screen.getByText('Last updated')).toBeTruthy();
        expect(screen.getByText('Summary')).toBeTruthy();
        expect(screen.getByText('Details')).toBeTruthy();

        // The date is the file's own, printed as a real calendar date.
        const updated = screen.getByTestId('memory-topic-updated').textContent ?? '';
        expect(updated).toMatch(/\d{4}/);

        // The summary is the entry's own first line of prose.
        expect(await screen.findByText('Laptop, hardware specs, and tooling decisions.')).toBeTruthy();
    });

    it('the Details are a bulleted list', async () => {
        const user = 'memory-detail-bullets';
        const { fileId } = await seedNotebook(user);
        renderPanel(fileId, user);

        const details = await screen.findByTestId('memory-topic-details');
        await waitFor(() => expect(details.querySelectorAll('li').length).toBe(2));
        expect(details.querySelector('ul')).toBeTruthy();
        expect(details.textContent).toContain('Owns a 16GB gaming laptop');
    });

    it('the prose is set in the reading face, the chrome is not', async () => {
        const user = 'memory-detail-voice';
        const { fileId } = await seedNotebook(user);
        const { container } = render(
            <ToastProvider>
                <MemoryTopicPanel
                    fileId={fileId}
                    username={user}
                    memoryConfig={null}
                    onClose={vi.fn()}
                />
            </ToastProvider>,
        );

        // The Summary and the Details are what the trader READS: the app's
        // serif, the one home for the model's voice (AnswerBody).
        const summary = screen.getByTestId('memory-topic-summary');
        expect(summary.innerHTML).toContain('font-reading');
        const details = await screen.findByTestId('memory-topic-details');
        expect(details.innerHTML).toContain('font-reading');

        // The chrome around them stays in the interface sans.
        const title = screen.getByRole('heading', { level: 2 });
        expect(title.className).not.toContain('font-reading');
        expect(container.innerHTML).toContain('font-reading');
    });
});
