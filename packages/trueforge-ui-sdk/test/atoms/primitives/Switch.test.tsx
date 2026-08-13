// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Switch } from '@/atoms/primitives/Switch.js';

describe('Switch', () => {
  it('reports the next controlled value', () => {
    const onCheckedChange = vi.fn();
    const { rerender } = render(<Switch checked={false} aria-label="Capability" onCheckedChange={onCheckedChange} />);

    const control = screen.getByRole('switch', { name: 'Capability' });
    expect(control).toHaveAttribute('aria-checked', 'false');
    expect(control).toHaveClass('bg-text-secondary/35', 'focus-visible:ring-focus-ring/40');
    expect(control.firstElementChild).toHaveClass('bg-primary-bg');
    fireEvent.click(control);
    expect(onCheckedChange).toHaveBeenCalledWith(true);

    rerender(<Switch checked aria-label="Capability" onCheckedChange={onCheckedChange} />);
    expect(control).toHaveAttribute('aria-checked', 'true');
    expect(control).toHaveAttribute('data-state', 'checked');
    expect(control).toHaveClass('bg-primary-button-bg');
    expect(control.firstElementChild).toHaveClass('bg-primary-button-text');
  });

  it('does not change while disabled', () => {
    const onCheckedChange = vi.fn();
    render(<Switch checked={false} aria-label="Capability" disabled onCheckedChange={onCheckedChange} />);

    fireEvent.click(screen.getByRole('switch', { name: 'Capability' }));
    expect(onCheckedChange).not.toHaveBeenCalled();
  });
});
