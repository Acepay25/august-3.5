/**
 * ONE disclosure.
 *
 * The app had three ways to hide content behind a toggle: the transcript's
 * thinking row and its tool rows were native `<details>`, and the automation
 * card's "Reasoning (N)" was a `<button>` plus a grid-collapse `<div>`. Two
 * mechanisms means two keyboard behaviours, two focus treatments, and the same
 * kind of content looking different in two places — the automation card's was
 * the older one.
 *
 * So there is one component (`components/shared/Disclosure.tsx`), and it is the
 * native one: a `<details>` is a toggle without JavaScript, it is
 * keyboard-operable for free, and the CSS and the screen-reader behaviour
 * were already written against it.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { render, fireEvent } from '@testing-library/react';
import Disclosure from '../components/shared/Disclosure';

describe('Disclosure — the one expandable panel', () => {
    it('is a NATIVE details, so it is a toggle without JavaScript', () => {
        const { container } = render(<Disclosure summary="Reasoning (2)">body</Disclosure>);
        const el = container.querySelector('details');
        expect(el).toBeTruthy();
        expect(el?.querySelector('summary')?.textContent).toBe('Reasoning (2)');
    });

    it('reports its open state when toggled', () => {
        const seen: boolean[] = [];
        render(
            <Disclosure summary="x" onToggle={open => seen.push(open)}>
                body
            </Disclosure>,
        );
        const el = document.querySelector('details') as HTMLDetailsElement;
        // jsdom fires `toggle` for a details whose open attribute changes.
        el.open = true;
        fireEvent(el, new Event('toggle'));
        expect(seen).toEqual([true]);
    });

    it('carries the caller\'s classes, ref and attributes through untouched', () => {
        // It owns the SHAPE and nothing about what goes inside — a component
        // that grew an opinion about its contents would be the second place the
        // styling lived.
        const ref = React.createRef<HTMLDivElement>();
        const { container } = render(
            <Disclosure
                summary="x"
                className="c-one"
                summaryClassName="c-two"
                bodyClassName="c-three"
                bodyRef={ref}
                bodyProps={{ role: 'region', 'aria-label': 'the output' }}
                detailsProps={{ 'data-fold-count': 3 }}
                state="running"
            >
                body
            </Disclosure>,
        );
        const el = container.querySelector('details') as HTMLDetailsElement;
        expect(el.className).toBe('c-one');
        expect(el.getAttribute('data-state')).toBe('running');
        expect(el.getAttribute('data-fold-count')).toBe('3');
        expect(el.querySelector('summary')?.className).toBe('c-two');
        const body = el.querySelector('div') as HTMLDivElement;
        expect(body.className).toBe('c-three');
        expect(body.getAttribute('role')).toBe('region');
        expect(ref.current).toBe(body);
    });
});

describe('every disclosure in the app is that one', () => {
    it('the transcript\'s thinking row and the tool row both use it', () => {
        const reasoning = readFileSync('components/shared/ReasoningRow.tsx', 'utf8');
        expect(reasoning).toMatch(/import Disclosure from '\.\/Disclosure';/);
        expect(reasoning).toMatch(/<Disclosure/);

        const tools = readFileSync('components/shared/ToolActivityRow.tsx', 'utf8');
        expect(tools).toMatch(/import Disclosure from '\.\/Disclosure';/);
        expect(tools).toMatch(/<Disclosure/);
    });

    it('the automation card\'s SECOND thinking disclosure uses it too', () => {
        // It used to be a `<button>` plus a grid-collapse `<div>` — a different
        // mechanism for the same kind of thing, and the older of the two.
        const card = readFileSync('components/automation/AutomationRunCard.tsx', 'utf8');
        expect(card).toMatch(/import Disclosure from '\.\.\/shared\/Disclosure';/);
        expect(card).toMatch(/<Disclosure/);
        // The old mechanism is gone from the card.
        expect(card).not.toMatch(/collapsible-content/);
    });

    it('the shared component is where the shape lives, not in three places', () => {
        const shared = readFileSync('components/shared/Disclosure.tsx', 'utf8');
        expect(shared).toMatch(/<details/);
        expect(shared).toMatch(/onToggle/);
    });
});
