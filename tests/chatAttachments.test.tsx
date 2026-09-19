/**
 * useChatAttachments — the reader BOTH chat composers now share (the Agents
 * surface was told to reuse the dock's image pipeline, so the pipeline moved
 * here and the dock's copy was deleted). Its contract is the pipeline's:
 * images come back as `{ name, dataURL }`, files stay text, four at a time.
 */

import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { renderHook, act, render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { useChatAttachments, MAX_ATTACHMENTS } from '../hooks/useChatAttachments';

const Harness: React.FC = () => {
    const a = useChatAttachments();
    return (
        <>
            <input type="file" multiple accept="image/*" ref={a.fileInputRef} data-testid="picker"
                onChange={e => { a.attachFiles(e.target.files); e.target.value = ''; }} />
            <button type="button" data-testid="open" onClick={a.openPicker}>open</button>
            <button type="button" data-testid="add"
                onClick={() => a.add({ kind: 'image', name: 'chart.png', payload: 'data:image/png;base64,AAA' })}>add</button>
            <button type="button" data-testid="images" onClick={() => a.images()}>images</button>
            <button type="button" data-testid="clear" onClick={a.clear}>clear</button>
            <div data-testid="count">{a.attachments.length}</div>
            <div data-testid="kinds">{a.attachments.map(x => x.kind).join(',')}</div>
            {a.attachments.map(x => (
                <button key={x.id} type="button" aria-label={`Remove ${x.name}`} onClick={() => a.remove(x.id)}>x</button>
            ))}
        </>
    );
};

afterEach(cleanup);

const file = (name: string, type: string): File => new File(['bytes'], name, { type });

/** jsdom's input.files is read-only, and FileReader reports on a later task —
 *  both have to be handled for the chip to exist by the time we assert. */
const pick = async (files: File[]): Promise<void> => {
    const input = screen.getByTestId('picker');
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    await act(async () => {
        fireEvent.change(input);
        await new Promise(resolve => setTimeout(resolve, 0));
    });
};

describe('useChatAttachments', () => {
    it('reads a picked image into a chip on the data URL', async () => {
        render(<Harness />);
        await pick([file('shot.png', 'image/png')]);
        await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1'));
        expect(screen.getByTestId('kinds').textContent).toBe('image');
    });

    it('reads a non-image as a text file, not a data URL', async () => {
        render(<Harness />);
        await pick([file('notes.txt', 'text/plain')]);
        await waitFor(() => expect(screen.getByTestId('kinds').textContent).toBe('file'));
    });

    it('stops at the shared ceiling and says so by count', async () => {
        render(<Harness />);
        await pick(Array.from({ length: MAX_ATTACHMENTS + 3 }, (_, i) => file(`s${i}.png`, 'image/png')));
        await waitFor(() => expect(Number(screen.getByTestId('count').textContent)).toBe(MAX_ATTACHMENTS));
    });

    it('add() takes an image that never came off the picker (chart snapshot)', () => {
        render(<Harness />);
        fireEvent.click(screen.getByTestId('add'));
        expect(screen.getByTestId('count').textContent).toBe('1');
        expect(screen.getByTestId('kinds').textContent).toBe('image');
    });

    it('removes one and clears the tray', () => {
        render(<Harness />);
        fireEvent.click(screen.getByTestId('add'));
        fireEvent.click(screen.getByTestId('add'));
        expect(screen.getByTestId('count').textContent).toBe('2');
        fireEvent.click(screen.getAllByLabelText('Remove chart.png')[0]);
        expect(screen.getByTestId('count').textContent).toBe('1');
        fireEvent.click(screen.getByTestId('clear'));
        expect(screen.getByTestId('count').textContent).toBe('0');
    });

    it('openPicker clicks the input the caller rendered', () => {
        render(<Harness />);
        const input = screen.getByTestId('picker') as HTMLInputElement;
        let clicked = 0;
        input.addEventListener('click', () => { clicked += 1; });
        fireEvent.click(screen.getByTestId('open'));
        expect(clicked).toBe(1);
    });

    it('exposes a stable-shaped images list to the caller', async () => {
        const { result } = renderHook(() => useChatAttachments());
        act(() => { result.current.add({ kind: 'image', name: 'a.png', payload: 'data:image/png;base64,AA' }); });
        act(() => { result.current.add({ kind: 'file', name: 'b.txt', payload: 'text' }); });
        expect(result.current.images()).toEqual([{ name: 'a.png', dataURL: 'data:image/png;base64,AA' }]);
    });
});
