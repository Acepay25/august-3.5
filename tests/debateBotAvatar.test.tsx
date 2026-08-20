import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import DebateBotAvatar, { botFillForKey } from '../components/analysis/DebateBotAvatar';

describe('DebateBotAvatar (flat roster)', () => {
    it('renders an initial disc', () => {
        const { container } = render(<DebateBotAvatar name="Seat 1" />);
        expect(container.querySelector('.bot-avatar')).not.toBeNull();
        expect(container.textContent).toMatch(/S/);
    });

    it('marks thinking and speaking states', () => {
        const thinking = render(<DebateBotAvatar name="Seat 1" thinking />);
        expect(thinking.container.querySelector('.bot-avatar.is-thinking')).not.toBeNull();
        const speaking = render(<DebateBotAvatar name="Seat 1" speaking />);
        expect(speaking.container.querySelector('.bot-avatar.is-speaking')).not.toBeNull();
    });

    it('keeps the moderator on the neutral fill', () => {
        expect(botFillForKey('Moderator')).toBe('#111111');
        expect(botFillForKey('moderator')).toBe('#111111');
    });

    it('gives distinct fills per model', () => {
        expect(botFillForKey('gemini-2.0-flash')).not.toBe(botFillForKey('deepseek-v4-flash'));
        expect(botFillForKey('gemini-2.0-flash')).toBe(botFillForKey('gemini-2.0-flash'));
    });
});
