import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import UserProfileManager from '../components/settings/UserProfileManager';

const makeProps = (): React.ComponentProps<typeof UserProfileManager> => ({
    isVisible: true,
    existingUsers: ['Alice', 'Bob'],
    onUserSelect: vi.fn(),
    onDeleteUser: vi.fn(),
    onImportProfile: vi.fn().mockResolvedValue(undefined),
    onClose: vi.fn(),
});

afterEach(cleanup);

describe('profile selection UI', () => {
    it('uses separate native buttons with keyboard activation and no nested interactive controls', async () => {
        const user = userEvent.setup();
        const props = makeProps();
        const { container } = render(<UserProfileManager {...props} />);
        const select = screen.getByRole('button', { name: 'Continue session as Alice' });
        const remove = screen.getByRole('button', { name: 'Delete user Alice' });
        expect(select.tagName).toBe('BUTTON');
        expect(select).toHaveAttribute('type', 'button');
        expect(select.parentElement).toBe(remove.parentElement);
        expect(container.querySelector('button button, [role="button"] button')).toBeNull();
        select.focus();
        await user.keyboard('{Enter}');
        expect(props.onUserSelect).toHaveBeenCalledExactlyOnceWith('Alice');
        await waitFor(() => expect(remove).toBeEnabled());
        remove.focus();
        await user.keyboard(' ');
        expect(props.onDeleteUser).toHaveBeenCalledExactlyOnceWith('Alice');
        expect(props.onUserSelect).toHaveBeenCalledTimes(1);
    });

    it('shows the selected profile and blocks all duplicate actions until loading finishes', async () => {
        let finish: () => void = (): void => {};
        const pending = new Promise<void>(resolve => { finish = resolve; });
        const props = { ...makeProps(), onUserSelect: vi.fn(() => pending) };
        const { rerender } = render(<UserProfileManager {...props} />);
        const select = screen.getByRole('button', { name: 'Continue session as Alice' });
        fireEvent.click(select);
        fireEvent.click(select);
        expect(props.onUserSelect).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('status')).toHaveTextContent('Loading profile Alice');
        expect(select).toHaveAttribute('aria-busy', 'true');
        for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
        expect(screen.getByRole('textbox')).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Delete user Bob' }));
        fireEvent.submit(screen.getByRole('textbox').closest('form')!);
        fireEvent.keyDown(document, { key: 'Escape' });
        fireEvent.click(screen.getByRole('dialog'));
        expect(props.onDeleteUser).not.toHaveBeenCalled();
        expect(props.onClose).not.toHaveBeenCalled();
        rerender(<UserProfileManager {...props} isLoading />);
        await act(async () => { finish(); await pending; });
        expect(select).toBeDisabled();
        rerender(<UserProfileManager {...props} isLoading={false} />);
        expect(select).toBeEnabled();
        expect(screen.queryByRole('status')).toBeNull();
    });

    it('honors external loading even before any profile is selected', () => {
        const props = makeProps();
        render(<UserProfileManager {...props} isLoading />);
        for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
        fireEvent.submit(screen.getByRole('textbox').closest('form')!);
        expect(props.onUserSelect).not.toHaveBeenCalled();
        expect(screen.getByRole('status')).toHaveTextContent('Profile operation in progress');
    });

    it('keeps a fresh blank workspace non-dismissible and trims new names', async () => {
        const user = userEvent.setup();
        const props = { ...makeProps(), existingUsers: [] };
        render(<UserProfileManager {...props} />);
        expect(screen.queryByRole('button', { name: 'Close user selection' })).toBeNull();
        fireEvent.keyDown(document, { key: 'Escape' });
        fireEvent.click(screen.getByRole('dialog'));
        expect(props.onClose).not.toHaveBeenCalled();
        await user.type(screen.getByRole('textbox'), '  New trader  ');
        await user.click(screen.getByRole('button', { name: 'Enter' }));
        expect(props.onUserSelect).toHaveBeenCalledExactlyOnceWith('New trader');
    });

    it('rejects duplicate names case-insensitively and allows existing-profile dismissal', async () => {
        const user = userEvent.setup();
        const props = makeProps();
        render(<UserProfileManager {...props} />);
        await user.type(screen.getByRole('textbox'), ' alice ');
        await user.click(screen.getByRole('button', { name: 'Enter' }));
        expect(screen.getByRole('alert')).toHaveTextContent('Username already exists');
        expect(props.onUserSelect).not.toHaveBeenCalled();
        await user.click(screen.getByRole('button', { name: 'Close user selection' }));
        expect(props.onClose).toHaveBeenCalledOnce();
    });

    it('holds the interaction lock during deletion and recovers from failures', async () => {
        let fail: (error: Error) => void = (): void => {};
        const pending = new Promise<void>((_resolve, reject) => { fail = reject; });
        const props = { ...makeProps(), onDeleteUser: vi.fn(() => pending) };
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        render(<UserProfileManager {...props} />);
        fireEvent.click(screen.getByRole('button', { name: 'Delete user Alice' }));
        fireEvent.click(screen.getByRole('button', { name: 'Delete user Alice' }));
        expect(props.onDeleteUser).toHaveBeenCalledOnce();
        expect(screen.getByRole('button', { name: 'Continue session as Bob' })).toBeDisabled();
        await act(async () => { fail(new Error('private failure')); });
        expect(screen.getByRole('alert')).toHaveTextContent('Could not complete the profile operation');
        expect(screen.getByRole('alert')).not.toHaveTextContent('private failure');
        expect(screen.getByRole('button', { name: 'Continue session as Bob' })).toBeEnabled();
        log.mockRestore();
    });
});
