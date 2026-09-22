/**
 * Math rendering, and the money it must not eat.
 *
 * `$` is two different things in this app: remark-math's inline delimiter,
 * and the currency of every price the UI writes. Naively enabling math made
 * "Risk $100 on the entry, target $200" render as
 * "Risk 100ontheentry,target100 on the entry, target 200" — the prices were
 * swallowed by a math span. These tests pin both halves: formulas typeset,
 * and a dollar amount is never anything but a dollar amount.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import MarkdownRenderer from '../components/shared/MarkdownRenderer';

const md = (content: string) => render(<MarkdownRenderer content={content} />);
const text = (content: string): string => md(content).container.textContent ?? '';

describe('money stays money', () => {
    const PRICES = [
        'Risk $100 on the entry, target $200, so size to 1% (= $700).',
        'Targets: $50,000 then $60,000. Invalid below $45,500.',
        'The stop sits at $69,000 — a $1,000 risk per contract.',
        'Funding is 0.01% and the mark price is $71,234.55.',
        'Budget: $$ for the month.',
        'USD $100 / EUR €90 / $50 total — pay $30 now, $20 later.',
        'A trailing stop of $2 follows the $94,500 level.',
        'PnL was +$1,240 today, -$300 yesterday.',
        'Entry zone $69,800–$70,200 with the level holding.',
    ];
    it.each(PRICES)('renders verbatim with no math span: %s', (src) => {
        const { container } = md(src);
        expect(container.textContent).toBe(src);
    });

    it('emits no katex node for plain money prose', () => {
        const { container } = md('Risk $100, target $200.');
        expect(container.querySelector('.katex')).toBeNull();
    });

    it('money and math in the same sentence both survive', () => {
        const out = text('Risk $100 but $\\alpha < 0.5$, target $200.');
        expect(out).toContain('$100');
        expect(out).toContain('$200');
        expect(out).toContain('α<0.5');
    });
});

describe('latex typesets', () => {
    it('inline math renders through katex', () => {
        const { container } = md('Momentum is fading: $\\alpha < 0.5$ and falling.');
        expect(container.querySelector('.katex')).not.toBeNull();
        expect(container.textContent).toContain('Momentum is fading:');
        expect(container.textContent).toContain('and falling.');
    });

    it('display math renders through katex', () => {
        const { container } = md('Before\n\n$$R:R = \\frac{TP - E}{E - SL}$$\n\nAfter.');
        expect(container.querySelector('.katex-display')).not.toBeNull();
        expect(container.textContent).toContain('Before');
        expect(container.textContent).toContain('After.');
    });

    it('accepts the paren delimiters models also emit', () => {
        const { container } = md('Size as \\(s = \\frac{risk}{entry - stop}\\) and\n\n\\[R:R = 2\\]');
        expect(container.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(2);
    });

    it('leaves a bracket escape alone instead of typesetting an index', () => {
        // `\[2\]` is how a model escapes a citation — it must stay "2".
        expect(text('Fib level \\[2\\] holds')).toContain('2');
        const { container } = md('Fib level \\[2\\] holds');
        expect(container.querySelector('.katex')).toBeNull();
    });

    it('code spans keep their bytes: no money guard, no delimiter rewrite', () => {
        expect(text('Use `$100` as the unit')).toContain('$100');
        expect(text('the regex `\\[0\\]` matches')).toContain('\\[0\\]');
        expect(text('write `\\(x\\)` here')).toContain('\\(x\\)');
        const fenced = text('fence:\n```js\nconst a = $100 + "\\(x)" ;\n```');
        expect(fenced).toContain('$100');
        expect(fenced).toContain('\\(x)');
        // …and none of them turned into a formula.
        expect(md('Use `$100` as the unit').container.querySelector('.katex')).toBeNull();
    });

    it('malformed math renders as source instead of throwing', () => {
        for (const src of [
            '$$\\frac{a}{$$',
            '$\\frac{a}{b}$',
            '$$\\begin{aligned a & b \\end{aligned}$$',
            '$ unclosed \\frac{',
        ]) {
            expect(() => md(src)).not.toThrow();
            expect(text(src).length).toBeGreaterThan(0);
        }
    });

    it('a formula-heavy reply keeps its table and surrounding prose', () => {
        const src = [
            '## Sizing',
            '',
            '| Metric | Value |',
            '| --- | --- |',
            '| $\\alpha$ | 0.42 |',
            '',
            'Risk is bounded by $\\frac{entry - SL}{entry} < r$.',
            '',
            'Target 72000 > entry 70000, so size to 1%.',
        ].join('\n');
        const { container } = md(src);
        expect(container.querySelector('table')).not.toBeNull();
        expect(container.textContent).toContain('Metric');
        expect(container.textContent).toContain('0.42');
        expect(container.textContent).toContain('Target 72000 > entry 70000');
        expect(container.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(2);
    });
});
