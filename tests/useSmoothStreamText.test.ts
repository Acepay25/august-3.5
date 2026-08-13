import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSmoothStreamText } from '../hooks/useSmoothStreamText';

describe('useSmoothStreamText', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('shows the full target immediately when not live', () => {
        const { result } = renderHook(() => useSmoothStreamText('hello world', false));
        expect(result.current).toBe('hello world');
    });

    it('catches up append-only token streams', () => {
        const { result, rerender } = renderHook(
            ({ text, live }: { text: string; live: boolean }) => useSmoothStreamText(text, live),
            { initialProps: { text: 'Hi', live: true } },
        );
        act(() => {
            rerender({ text: 'Hi there', live: true });
        });
        expect(result.current).toBe('Hi there');
    });
});
