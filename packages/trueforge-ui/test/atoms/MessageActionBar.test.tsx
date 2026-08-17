import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MessageActionBar } from '@/atoms/MessageActionBar.js';

describe('MessageActionBar', () => {
  it('invokes copy and switches from copy to confirmation state', () => {
    const onCopy = vi.fn();
    const { rerender } = render(
      <MessageActionBar isCopied={false} onCopy={onCopy} createdAt="2026-04-05T14:03:02.000Z" className="host-bar" />,
    );

    const copyButton = screen.getByRole('button', { name: 'Copy' });
    expect(copyButton).toHaveAttribute('title', 'Copy');
    expect(copyButton.querySelector('svg')).toHaveClass('lucide-copy');
    expect(copyButton.parentElement).toHaveClass('aui-assistant-action-bar-root', 'host-bar');

    fireEvent.click(copyButton);
    expect(onCopy).toHaveBeenCalledOnce();

    rerender(<MessageActionBar isCopied onCopy={onCopy} />);
    expect(screen.getByRole('button', { name: 'Copy' }).querySelector('svg')).toHaveClass('lucide-check');
  });
});
