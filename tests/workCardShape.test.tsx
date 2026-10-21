/**
 * The work card's SHAPE — a bare line with the card below it.
 *
 * The reference draws the work as a line ("Ran 4 commands, read a file") with
 * the card BELOW it, holding hairline-separated steps. August had the card
 * AROUND the line, so a collapsed turn showed a little box with a sentence in
 * it, and the steps inside it were boxes inside a box.
 *
 * The card is CSS, and jsdom does not read a stylesheet — so these claims are
 * split honestly: the MARKUP claims are rendered, and the CSS claims are read
 * out of the stylesheet the app ships.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import ChatWorkTimeline from '../components/trade/panels/ChatWorkTimeline';

describe('the work card', () => {
    it('the line that says what happened is not wrapped in a box', () => {
        const { container } = render(
            <ChatWorkTimeline entry={{ id: 'e1', tools: ['calling order book…', 'order book · ok'] }} />,
        );
        const wrapper = container.firstElementChild as HTMLElement;
        // The card is the open body now, so the wrapper carries no border, no
        // fill and no radius of its own.
        expect(wrapper.className).not.toContain('rounded-bubble');
        expect(wrapper.className).not.toContain('border');
        expect(wrapper.className).not.toContain('bg-zinc-900');
    });

    it('the card is the open body of the analyzed row', () => {
        const css = readFileSync('index.css', 'utf8');
        // The border and the fill live on the BODY; the `<details>` carries
        // none, and the running breath (which belonged to the old box) is off.
        expect(css).toMatch(/\.analyzed-row \.reasoning-row-body \{[^}]*border: 1px solid/);
        expect(css).toMatch(/\.analyzed-row \.reasoning-row-body \{[^}]*border-radius: var\(--radius-bubble\)/);
        expect(css).toMatch(/\.analyzed-row,\s*\n?\.analyzed-row\[data-state="running"\][\s\S]{0,200}?animation: none;/);
    });

    it('the steps inside the card are hairline-separated rows', () => {
        const css = readFileSync('index.css', 'utf8');
        expect(css).toMatch(/\.analyzed-row \.reasoning-row \+ \.tool-row[\s\S]{0,200}?border-top: 1px solid/);
    });

    it('a step that opens carries a chevron', () => {
        const { container } = render(
            <ChatWorkTimeline entry={{ id: 'e1', tools: ['calling order book…', 'order book · ok'] }} />,
        );
        // The reference draws a chevron on every expandable line; the work
        // line is the step that opens.
        expect(container.innerHTML).toContain('reasoning-row-chevron');
    });
});
