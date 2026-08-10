import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { UserMessageEdit } from '@/atoms/UserMessageEdit.js';

describe('UserMessageEdit', () => {
  it('renders edit context and forwards root HTML attributes', () => {
    render(
      <UserMessageEdit
        timestamp={<time dateTime="2026-08-06">Today</time>}
        attachments={<span>notes.txt</span>}
        input={<textarea aria-label="Edit message" defaultValue="Draft text" />}
        footer={<button type="button">Save edit</button>}
        className="consumer-class"
        data-testid="edit-root"
        aria-label="Message editor"
      />,
    );

    const root = screen.getByTestId('edit-root');
    expect(root).toHaveAttribute('data-slot', 'aui_user-message-edit');
    expect(root).toHaveAttribute('aria-label', 'Message editor');
    expect(root).toHaveClass('consumer-class');
    expect(screen.getByText('User')).toBeInTheDocument();
    expect(screen.getByText('Today')).toHaveAttribute('datetime', '2026-08-06');
    expect(screen.getByText('notes.txt')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Edit message' })).toHaveValue('Draft text');
    expect(screen.getByRole('button', { name: 'Save edit' })).toBeInTheDocument();
  });

  it('does not add a user metadata row when timestamp and attachments are absent', () => {
    render(
      <UserMessageEdit
        input={<input aria-label="Edit message" />}
        footer={<button type="button">Cancel edit</button>}
      />,
    );

    expect(screen.queryByText('User')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Edit message' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel edit' })).toBeInTheDocument();
  });
});
