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
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveAttribute('data-track', 'settings');
    expect(button).toHaveClass('h-8', 'w-8', 'host-icon-button');
    expect(button.className).toMatch(/\[&_svg\]:size-3\.5/);

    fireEvent.mouseEnter(button);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Settings');

    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('does not render a tooltip when none is provided', () => {
    render(
      <IconButton aria-label="Close">
        <span aria-hidden="true">×</span>
      </IconButton>,
    );

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});
