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

    // The sanitizer now lets tag-shaped HTML through only when it is genuinely
    // a tag, and lets everything else through untouched — so this renderer is
    // the layer that must both KEEP the text and REFUSE the markup. Both
    // halves are load-bearing: dropping text here is the "response didn't
    // render" complaint, and rendering markup would be XSS.
    it('escapes raw HTML instead of executing or dropping it', () => {
        const { container } = render(
            <MarkdownRenderer content={'a <b>bold</b> c <script>alert(1)</script> d'} />,
        );
        expect(container.querySelector('script')).toBeNull();
        expect(container.querySelector('b')).toBeNull();
        // The text of the tag is still visible — nothing silently disappears.
        expect(container.textContent).toContain('alert(1)');
        expect(container.innerHTML).toContain('&lt;script&gt;');
    });

    it('never drops prose that merely contains < or >', () => {
        const cases = [
            '< then the slope turns negative',
            'drawdown < 5% and falling',
            'literal <tag here and more text',
            'Invalidation: close < 69000 means R:R < 2 and skip.',
            'Target 72000 > entry 70000, so size to 1%.',
        ];
        for (const content of cases) {
            const { container } = render(<MarkdownRenderer content={content} />);
            expect(container.textContent).toBe(content);
        }
    });

    it('keeps a math table and the paragraph after the formula', () => {
        const content = [
            '| K | V |',
            '| --- | --- |',
            '| $\\alpha$ | 1 |',
            '',
            '$$\\begin{aligned}',
            'a &= b \\\\',
            'c &< d',
            '\\end{aligned}$$',
            '',
            'tail text',
        ].join('\n');
        const { container } = render(<MarkdownRenderer content={content} />);
        expect(container.querySelector('table')).not.toBeNull();
        // The cell's formula is typeset rather than shown as source…
        expect(container.querySelector('td .katex')).not.toBeNull();
        expect(container.textContent).toContain('tail text');
    });
});
