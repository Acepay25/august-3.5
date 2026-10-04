/**
 * A restored backup carries no image bytes (`ExportService.stripChatSessionImages`
 * leaves an `imageOmitted` stub). The row must still say an image was there — and
 * must not render an `<img>` whose src is missing, which is what a browser shows as
 * a broken icon. This mounts the transcript list itself, so the assertion is on
 * rendered DOM, not on the entry object.
 */

import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';

import ChatTranscriptList from '../components/trade/panels/ChatTranscriptList';
import type { LiveEntry } from '../services/trade/chatStore';

const entry = (over: Partial<LiveEntry>): LiveEntry => ({
    id: 'e1', role: 'user', text: 'look at this chart', tools: [], ...over,
} as LiveEntry);

const renderList = (entries: LiveEntry[]) => render(
    <ChatTranscriptList
        entries={entries}
        send={async () => {}}
        analysisMessageIds={{}}
        symbol="BTCUSDT"
        getMark={() => null}
        onChatLevels={() => {}}
    />,
);

afterEach(cleanup);

describe('the image-not-backed-up row', () => {
    it('names the stub it came from and shows no broken image', () => {
        renderList([
            entry({ imageOmitted: { bytes: 400_128, mime: 'image/png' } }),
            entry({ id: 'e2', role: 'ai', text: 'the reclaim failed on the close' }),
        ]);

        const note = screen.getByTestId('chat-image-omitted');
        expect(note.textContent).toMatch(/image not backed up/);
        expect(note.textContent).toContain('image/png');
        expect(note.textContent).toContain('391 KB');
        // The notice does not swallow the conversation.
        expect(screen.getByText('look at this chart')).toBeTruthy();
        expect(screen.getByText('the reclaim failed on the close')).toBeTruthy();
        // No <img> without a src — the failure mode this branch replaces.
        const srcless = [...document.querySelectorAll('img')].filter(i => !i.getAttribute('src'));
        expect(srcless).toHaveLength(0);
    });

    it('leaves a real image alone', () => {
        renderList([entry({ image: 'data:image/png;base64,AAAA' })]);
        expect(screen.queryByTestId('chat-image-omitted')).toBeNull();
        expect(document.querySelector('img[src^="data:image/png"]')).toBeTruthy();
    });

    it('says nothing when the entry never had an image', () => {
        renderList([entry({})]);
        expect(screen.queryByTestId('chat-image-omitted')).toBeNull();
        expect(document.querySelectorAll('img')).toHaveLength(0);
    });
});
