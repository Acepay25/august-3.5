import { describe, it, expect } from 'vitest';
import { MessageRole } from '../types/enums';
import { Message } from '../types/message';
import {
    threadForProvider,
    threadPreview,
    unreadCount,
    markThreadOpened,
    previewTextFor,
} from '../utils/agentThreads';

let seq = 0;
const msg = (over: Partial<Message>): Message => ({
    id: over.id ?? `m${seq += 1}`,
    role: over.role ?? MessageRole.USER,
    text: over.text ?? '',
    createdAt: over.createdAt ?? new Date(Date.now() - seq * 60_000).toISOString(),
    ...over,
});

describe('threadForProvider', () => {
    it('claims single-provider AI replies with their preceding user prompts', () => {
        const messages: Message[] = [
            msg({ role: MessageRole.USER, text: 'watch the tape' }),
            msg({ role: MessageRole.AI, text: 'tape looks heavy', modelsUsed: { a1: 'model-a' } }),
        ];
        const thread = threadForProvider(messages, 'a1');
        expect(thread.map(m => m.text)).toEqual(['watch the tape', 'tape looks heavy']);
    });

    it('does not leak ensemble (multi-provider) replies into a 1:1 thread', () => {
        const messages: Message[] = [
            msg({ role: MessageRole.USER, text: 'run the ensemble' }),
            msg({ role: MessageRole.AI, text: 'verdict', modelsUsed: { a1: 'model-a', b1: 'model-b' } }),
            msg({ role: MessageRole.AI, text: 'just us two', modelsUsed: { a1: 'model-a' } }),
        ];
        const thread = threadForProvider(messages, 'a1');
        expect(thread.map(m => m.text)).toEqual(['just us two']);
    });

    it("keeps another agent's replies out and drops the prompts they consumed", () => {
        const messages: Message[] = [
            msg({ role: MessageRole.USER, text: 'for b only' }),
            msg({ role: MessageRole.AI, text: 'b replies', modelsUsed: { b1: 'model-b' } }),
            msg({ role: MessageRole.USER, text: 'for a now' }),
            msg({ role: MessageRole.AI, text: 'a replies', modelsUsed: { a1: 'model-a' } }),
        ];
        const threadA = threadForProvider(messages, 'a1');
        expect(threadA.map(m => m.text)).toEqual(['for a now', 'a replies']);
        const threadB = threadForProvider(messages, 'b1');
        expect(threadB.map(m => m.text)).toEqual(['for b only', 'b replies']);
    });

    it('attaches system rows that occur inside the provider slice', () => {
        const messages: Message[] = [
            msg({ role: MessageRole.USER, text: 'hey' }),
            msg({ role: MessageRole.SYSTEM, text: 'provider offline' }),
            msg({ role: MessageRole.AI, text: 'back now', modelsUsed: { a1: 'model-a' } }),
        ];
        const thread = threadForProvider(messages, 'a1');
        expect(thread.map(m => m.role)).toEqual([MessageRole.USER, MessageRole.SYSTEM, MessageRole.AI]);
    });

    it('excludes trailing prompts that no reply ever claimed', () => {
        const messages: Message[] = [
            msg({ role: MessageRole.AI, text: 'earlier', modelsUsed: { a1: 'model-a' } }),
            msg({ role: MessageRole.USER, text: 'draft sent into the void' }),
        ];
        expect(threadForProvider(messages, 'a1').map(m => m.text)).toEqual(['earlier']);
    });
});

describe('threadPreview / unread', () => {
    it('previews the last thread message with its timestamp', () => {
        const messages: Message[] = [
            msg({ role: MessageRole.USER, text: 'hello?' }),
            msg({ role: MessageRole.AI, text: 'hi — desk is on', modelsUsed: { a1: 'm' } }),
        ];
        const preview = threadPreview(messages, 'a1');
        expect(preview.previewText).toBe('hi — desk is on');
        expect(preview.lastAt).toBeTruthy();
        expect(preview.lastMessage?.role).toBe(MessageRole.AI);
    });

    it('empty thread → null message and empty preview', () => {
        const preview = threadPreview([], 'a1');
        expect(preview.lastMessage).toBeNull();
        expect(preview.previewText).toBe('');
    });

    it('preview falls back to the analysis label for chart-only messages', () => {
        const m = msg({
            role: MessageRole.AI,
            text: '',
            modelsUsed: { a1: 'm' },
            analysis: { coinName: 'BTC' } as Message['analysis'],
        });
        expect(previewTextFor(m)).toContain('BTC');
    });

    it('unread counts AI replies newer than last-opened only', () => {
        const t0 = Date.parse('2026-08-29T10:00:00Z');
        const messages: Message[] = [
            msg({ role: MessageRole.USER, text: 'q1', createdAt: new Date(t0).toISOString() }),
            msg({ role: MessageRole.AI, text: 'r1', createdAt: new Date(t0 + 60_000).toISOString(), modelsUsed: { a1: 'm' } }),
            msg({ role: MessageRole.USER, text: 'q2', createdAt: new Date(t0 + 120_000).toISOString() }),
            msg({ role: MessageRole.AI, text: 'r2', createdAt: new Date(t0 + 180_000).toISOString(), modelsUsed: { a1: 'm' } }),
        ];
        // Opened after r1 → only r2 is unread.
        expect(unreadCount(messages, 'a1', new Date(t0 + 90_000).toISOString())).toBe(1);
        // Opened after everything → zero.
        expect(unreadCount(messages, 'a1', new Date(t0 + 600_000).toISOString())).toBe(0);
        // Never opened → capped tail count of AI replies (2).
        expect(unreadCount(messages, 'a1', null)).toBe(2);
    });

    it('unread ignores user prompts and other providers', () => {
        const t0 = Date.parse('2026-08-29T10:00:00Z');
        const messages: Message[] = [
            msg({ role: MessageRole.USER, text: 'q', createdAt: new Date(t0).toISOString() }),
            msg({ role: MessageRole.AI, text: 'other agent', createdAt: new Date(t0 + 30_000).toISOString(), modelsUsed: { b1: 'm' } }),
            msg({ role: MessageRole.USER, text: 'q2', createdAt: new Date(t0 + 60_000).toISOString() }),
        ];
        expect(unreadCount(messages, 'a1', null)).toBe(0);
    });

    it('markThreadOpened stamps now and preserves other entries', () => {
        const before = Date.now() - 1000;
        const map = markThreadOpened({ b1: new Date(before).toISOString() }, 'a1');
        expect(Date.parse(map.a1)).toBeGreaterThanOrEqual(before);
        expect(map.b1).toBeTruthy();
        expect(Object.keys(map).sort()).toEqual(['a1', 'b1']);
    });
});
