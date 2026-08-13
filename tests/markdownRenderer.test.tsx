import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import MarkdownRenderer from '../components/shared/MarkdownRenderer';

describe('MarkdownRenderer', () => {
    it('renders **bold** as a strong element, not literal asterisks', () => {
        render(<MarkdownRenderer content="**Direction:** Short BTCUSDT" />);
        const strong = screen.getByText('Direction:');
        expect(strong.tagName).toBe('STRONG');
        expect(screen.queryByText(/\*\*Direction:\*\*/)).toBeNull();
        expect(screen.getByText(/Short BTCUSDT/)).toBeDefined();
    });

    it('renders a markdown list', () => {
        render(<MarkdownRenderer content={'- Entry at 64000\n- Stop at 65000'} />);
        expect(screen.getByText('Entry at 64000').closest('li')).not.toBeNull();
        expect(screen.getByText('Stop at 65000').closest('li')).not.toBeNull();
    });
});
