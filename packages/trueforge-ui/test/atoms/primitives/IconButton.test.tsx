import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { IconButton } from '@/atoms/primitives/IconButton.js';

describe('IconButton', () => {
  it('uses its label and tooltip accessibly while forwarding button behavior and its ref', () => {
    const ref = createRef<HTMLButtonElement>();
    const onClick = vi.fn();
    render(
      <IconButton
        ref={ref}
        type="button"
        aria-label="Open settings"
        tooltip="Settings"
        variant="ghost"
        className="host-icon-button"
        data-track="settings"
        onClick={onClick}
      >
        <span aria-hidden="true">⚙</span>
      </IconButton>,
    );

    const button = screen.getByRole('button', { name: 'Open settings' });
    expect(button).toBe(ref.current);
    expect(button).toHaveAttribute('title', 'Settings');
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveAttribute('data-track', 'settings');
    expect(button).toHaveClass('h-8', 'w-8', 'host-icon-button');

    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('does not add an empty title when no tooltip is provided', () => {
    render(
      <IconButton aria-label="Close">
        <span aria-hidden="true">×</span>
      </IconButton>,
    );

    expect(screen.getByRole('button', { name: 'Close' })).not.toHaveAttribute('title');
  });
});
