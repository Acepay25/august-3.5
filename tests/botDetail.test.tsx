import { describe, it, expect, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

import { BotDetail } from '../components/chat/BotDetail';
import { BotAvatar } from '../components/chat/BotAvatar';
import { AgentBot } from '../services/agents/agentRoster';

afterEach(cleanup);

const bot = (over: Partial<AgentBot>): AgentBot => ({
    id: 'b1',
    name: 'Raven',
    providerId: 'p1',
    modelId: 'gpt-test',
    avatar: { kind: 'auto' },
    createdAt: new Date().toISOString(),
    ...over,
});

describe('BotDetail (reference bot page)', () => {
    it('renders the large identity page: name, mono handle, This device, Open chat', () => {
        const onOpenChat = vi.fn();
        render(<BotDetail bot={bot({})} onOpenChat={onOpenChat} />);
        expect(screen.getByTestId('bot-detail-handle').textContent).toBe('Bot · @raven');
        expect(screen.getByTestId('bot-detail').textContent).toContain('This device');
        fireEvent.click(screen.getByTestId('bot-detail-open'));
        expect(onOpenChat).toHaveBeenCalledTimes(1);
    });

    it('handle collapses the name (no spaces, lowercase)', () => {
        render(<BotDetail bot={bot({ name: 'Ra Ven 99' })} onOpenChat={() => {}} />);
        expect(screen.getByTestId('bot-detail-handle').textContent).toBe('Bot · @raven99');
    });

    it('shows the description when present, the generic hint when not', () => {
        const { rerender } = render(
            <BotDetail bot={bot({ description: 'Watches funding rates.' })} onOpenChat={() => {}} />,
        );
        expect(screen.getByTestId('bot-detail').textContent).toContain('Watches funding rates.');
        rerender(<BotDetail bot={bot({ description: undefined })} onOpenChat={() => {}} />);
        expect(screen.getByTestId('bot-detail').textContent).toContain('continuous chat');
    });

    it('BotAvatar renders an uploaded image clipped to the face shape', () => {
        const { container } = render(
            <BotAvatar bot={bot({ avatar: { kind: 'upload', src: 'data:image/png;base64,AAAA', shape: 'circle' } })} size={40} />,
        );
        expect(container.querySelector('image')).toBeTruthy();
        expect(container.querySelector('clipPath')).toBeTruthy();
    });
});
