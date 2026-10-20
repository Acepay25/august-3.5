/**
 * The desk-tool catalogue.
 *
 * Settings had ONE line about the desk's tools: a toggle that lets the desk
 * call live tools "anytime — web search, funding/OI, order book, liquidations,
 * BTC context, session timing". Six named tools out of forty. A trader
 * deciding whether to let the desk hold the tools had no way to see the other
 * thirty-four — and the ones nobody names are exactly the ones that WRITE.
 *
 * So the catalogue lists them all, by kind, and it is built from the desk
 * service's OWN list: a tool that is added to the desk without appearing here
 * is a tool the trader cannot see, and this suite fails on that.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import DeskToolCatalogue from '../components/settings/tabs/DeskToolCatalogue';
import { DESK_TOOL_DEFINITIONS, toolLabel } from '../services/analysis/DeskToolsService';
import { toolKindOf } from '../utils/toolKinds';

describe('the catalogue lists every tool the desk can call', () => {
    it('names the count it actually shows', () => {
        render(<DeskToolCatalogue />);
        expect(screen.getByText(new RegExp(`${DESK_TOOL_DEFINITIONS.length} live tools`))).toBeTruthy();
    });

    it('has a row per tool — the list and the catalogue cannot disagree', () => {
        render(<DeskToolCatalogue />);
        const rows = screen.getAllByTestId('desk-tool-row');
        expect(rows).toHaveLength(DESK_TOOL_DEFINITIONS.length);
    });

    it('shows the name the transcript shows AND the name the tool is called', () => {
        render(<DeskToolCatalogue />);
        // The human label is what a trader reads in the transcript; the tool
        // name is what the model calls. One without the other is half the row.
        const label = toolLabel('get_order_book');
        expect(screen.getByText(label)).toBeTruthy();
        expect(screen.getByText('get_order_book')).toBeTruthy();
    });

    it('groups them by the kind the transcript wears', () => {
        render(<DeskToolCatalogue />);
        const kinds = new Set(DESK_TOOL_DEFINITIONS.map(d => toolKindOf(toolLabel(d.function.name)).kind));
        for (const kind of kinds) {
            expect(screen.getByTestId(`desk-tool-group-${kind}`)).toBeTruthy();
        }
    });

    it('says what each one does', () => {
        render(<DeskToolCatalogue />);
        const rows = screen.getAllByTestId('desk-tool-row');
        // No row is a bare name: the point of the catalogue is what the tool
        // is FOR.
        for (const row of rows) {
            expect((row.textContent ?? '').length).toBeGreaterThan(20);
        }
    });
});

describe('it is a reader', () => {
    it('offers no per-tool switch the app does not honour', () => {
        render(<DeskToolCatalogue />);
        // The allow-lists are code, not preferences. A switch here would be a
        // promise the app does not keep, so the catalogue only shows.
        expect(screen.queryAllByRole('checkbox').length).toBe(0);
        expect(screen.queryAllByRole('switch').length).toBe(0);
    });

    it('is a native disclosure, like every other expander in the app', () => {
        const { container } = render(<DeskToolCatalogue />);
        expect(container.querySelector('details')).toBeTruthy();
    });
});
