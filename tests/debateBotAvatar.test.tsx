import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import DebateBotAvatar, { botFillForKey } from '../components/analysis/DebateBotAvatar';

describe('DebateBotAvatar (Floor bot animation states)', () => {
    it('shows the voice equalizer while speaking instead of the idle mouth', () => {
        const { container } = render(<DebateBotAvatar name="Seat 1" speaking />);
        expect(container.querySelector('.debate-bot-voice')).toBeDefined();
        expect(container.querySelectorAll('.debate-bot-voice-bar').length).toBe(3);
        expect(container.querySelector('.debate-bot-mouth')).toBeNull();
    });

    it('shows the idle mouth when not speaking', () => {
        const { container } = render(<DebateBotAvatar name="Seat 1" />);
        expect(container.querySelector('.debate-bot-mouth')).toBeDefined();
        expect(container.querySelector('.debate-bot-voice')).toBeNull();
    });

    it('emits two offset sonar rings while speaking', () => {
        const { container } = render(<DebateBotAvatar name="Seat 1" speaking />);
        expect(container.querySelectorAll('.debate-bot-ring').length).toBe(2);
        expect(container.querySelector('.debate-bot-ring-2')).toBeDefined();
    });

    it('shows the thinking orbit only in the thinking state', () => {
        const thinking = render(<DebateBotAvatar name="Seat 1" thinking />);
        expect(thinking.container.querySelector('.debate-bot-orbit')).toBeDefined();
        const idle = render(<DebateBotAvatar name="Seat 1" />);
        expect(idle.container.querySelector('.debate-bot-orbit')).toBeNull();
    });

    it('keeps the moderator on the neutral fill', () => {
        expect(botFillForKey('Moderator')).toBe('#111111');
        expect(botFillForKey('moderator')).toBe('#111111');
    });
});
