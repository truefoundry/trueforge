import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Button } from '@/atoms/primitives/Button.js';

describe('Button', () => {
  it('forwards its ref and host props while applying the requested presentation', () => {
    const ref = createRef<HTMLButtonElement>();
    const onClick = vi.fn();
    render(
      <Button
        ref={ref}
        type="button"
        variant="outline"
        size="lg"
        className="host-button"
        data-track="save"
        onClick={onClick}
      >
        Save changes
      </Button>,
    );

    const button = screen.getByRole('button', { name: 'Save changes' });
    expect(button).toBe(ref.current);
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveAttribute('data-track', 'save');
    expect(button).toHaveClass('border', 'h-10', 'host-button');

    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('preserves native disabled behavior', () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Delete
      </Button>,
    );

    const button = screen.getByRole('button', { name: 'Delete' });
    expect(button).toBeDisabled();

    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});
