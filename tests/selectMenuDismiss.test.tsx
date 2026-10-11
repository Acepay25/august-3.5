import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React, { useState } from 'react';
import SelectMenu from '../components/shared/SelectMenu';
import { useEscapeClose } from '../hooks/useEscapeClose';

/**
 * The dismissal contract the select migration lost once: Escape closes the
 * MENU, not the host modal above it — useEscapeClose (document-capture +
 * stopPropagation) stands down while SelectMenu marks data-menu-open on
 * <body>, and the marker clears on close so the next Escape reaches the
 * host. Focusout (Tab away) dismisses instead of stranding the portaled
 * list at body.
 */

const OPTIONS = [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }];

const MenuHost: React.FC<{ onHostEscape: () => void }> = ({ onHostEscape }) => {
    const [menuOpen, setMenuOpen] = useState(false);
    useEscapeClose(true, onHostEscape);
    return (
        <div>
            <button type="button" onClick={() => setMenuOpen(true)}>open menu</button>
            {menuOpen && (
                <SelectMenu
                    value="a"
                    onChange={() => { /* host re-render only */ }}
                    options={OPTIONS}
                    aria-label="pick"
                />
            )}
        </div>
    );
};

describe('SelectMenu dismissal', () => {
    it('sets the data-menu-open semaphore while open and clears it on choose', () => {
        render(<SelectMenu value="a" onChange={() => {}} options={OPTIONS} aria-label="pick" />);
        fireEvent.click(screen.getByRole('button', { name: 'pick' }));
        expect(document.body.getAttribute('data-menu-open')).toBe('1');
        fireEvent.click(screen.getByRole('option', { name: 'B' }));
        expect(document.body.getAttribute('data-menu-open')).toBeNull();
    });

    it('Escape closes the menu while the host modal stays open; the next Escape reaches the host', () => {
        const onHostEscape = vi.fn();
        render(<MenuHost onHostEscape={onHostEscape} />);
        fireEvent.click(screen.getByText('open menu'));
        // Mounting SelectMenu is not opening it — the trigger owns the list.
        fireEvent.click(screen.getByRole('button', { name: 'pick' }));
        expect(screen.getByRole('listbox')).toBeTruthy();

        // First Escape: the menu owns it — the host stands down.
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByRole('listbox')).toBeNull();
        expect(onHostEscape).not.toHaveBeenCalled();
        expect(document.body.getAttribute('data-menu-open')).toBeNull();

        // Second Escape: the menu is gone, the host gets its turn.
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onHostEscape).toHaveBeenCalledTimes(1);
    });

    it('Tab away (focusout) dismisses the portaled list instead of stranding it', () => {
        render(<SelectMenu value="a" onChange={() => {}} options={OPTIONS} aria-label="pick" />);
        fireEvent.click(screen.getByRole('button', { name: 'pick' }));
        expect(screen.getByRole('listbox')).toBeTruthy();
        // Focus moves outside both trigger and list.
        fireEvent.focusOut(screen.getByRole('listbox'), { relatedTarget: document.body });
        expect(screen.queryByRole('listbox')).toBeNull();
        expect(document.body.getAttribute('data-menu-open')).toBeNull();
    });
});
