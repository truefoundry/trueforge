import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { UserMessageActionBar } from '@/atoms/UserMessageActionBar.js';

describe('UserMessageActionBar', () => {
  it('exposes and invokes retry, edit, and copy actions', () => {
    const onRetry = vi.fn();
    const onEdit = vi.fn();
    const onCopy = vi.fn();
    render(
      <UserMessageActionBar isCopied={false} onRetry={onRetry} onEdit={onEdit} onCopy={onCopy} className="host-bar" />,
    );

    const retryButton = screen.getByRole('button', { name: 'Try again' });
    const editButton = screen.getByRole('button', { name: 'Edit' });
    const copyButton = screen.getByRole('button', { name: 'Copy' });

    fireEvent.mouseEnter(retryButton);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Try again');
    fireEvent.mouseLeave(retryButton);

    fireEvent.mouseEnter(editButton);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Edit');
    fireEvent.mouseLeave(editButton);

    fireEvent.mouseEnter(copyButton);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Copy');
    expect(retryButton.closest('.aui-user-action-bar-root')).toHaveClass('aui-user-action-bar-root', 'host-bar');

    fireEvent.click(retryButton);
    fireEvent.click(editButton);
    fireEvent.click(copyButton);

    expect(onRetry).toHaveBeenCalledOnce();
    expect(onEdit).toHaveBeenCalledOnce();
    expect(onCopy).toHaveBeenCalledOnce();
  });

  it('disables editing and shows the copied confirmation icon', () => {
    const onEdit = vi.fn();
    render(<UserMessageActionBar isCopied editDisabled onRetry={vi.fn()} onEdit={onEdit} onCopy={vi.fn()} />);

    const editButton = screen.getByRole('button', { name: 'Edit' });
    expect(editButton).toBeDisabled();
    fireEvent.click(editButton);
    expect(onEdit).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Copy' }).querySelector('svg')).toHaveClass('lucide-check');
  });
});
