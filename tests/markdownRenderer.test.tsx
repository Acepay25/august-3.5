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

    // A fence with no language tag carries no `language-*` class, so the
    // renderer's block test missed it and it fell through to the INLINE code
    // pill. An inline element paints its background once per line box, so the
    // Chart AI's key-levels block arrived as a stack of grey bands inside the
    // pre's own box. The pre now neutralises any code inside it.
    it('renders a language-less fence as one block, not per-line pills', () => {
        const fence = ['```', 'R1 | 86879 | pivot resistance', 'PP | 85979 | session midpoint', 'S2 | 84359 | next support'].join('\n');
        const { container } = render(<MarkdownRenderer content={fence} />);
        const pre = container.querySelector('pre');
        expect(pre).not.toBeNull();
        // The descendant overrides are the whole fix; without them the pill's
        // background and border come back per line.
        expect(pre!.className).toContain('[&_code]:bg-transparent');
        expect(pre!.className).toContain('[&_code]:border-0');
        expect(pre!.querySelector('code')).not.toBeNull();
        // And the content survives the restyle.
        expect(pre!.textContent).toContain('pivot resistance');
        expect(pre!.textContent).toContain('next support');
    });

    it('keeps the pill on real inline code, which is what it was for', () => {
        const { container } = render(<MarkdownRenderer content={'stop is `65000` here'} />);
        expect(container.querySelector('pre')).toBeNull();
        const code = container.querySelector('code');
        expect(code).not.toBeNull();
        expect(code!.className).toContain('bg-white/[0.06]');
        expect(code!.textContent).toBe('65000');
    });
});
