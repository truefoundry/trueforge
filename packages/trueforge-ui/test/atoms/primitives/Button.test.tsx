import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Button } from '@/atoms/primitives/Button.js';

describe('Button', () => {
  it('supports semantic button variants', () => {
    const { rerender } = render(<Button.Primary size="small">Continue</Button.Primary>);
    expect(screen.getByRole('button', { name: 'Continue' })).toHaveClass('bg-primary-button-bg');
    expect(screen.getByRole('button', { name: 'Continue' })).toHaveClass('h-8');

    rerender(<Button.Secondary size="medium">Continue</Button.Secondary>);
    expect(screen.getByRole('button', { name: 'Continue' })).toHaveClass('bg-secondary-button-bg');
    expect(screen.getByRole('button', { name: 'Continue' })).toHaveClass('h-9');

    rerender(<Button.Ghost size="large">Continue</Button.Ghost>);
    expect(screen.getByRole('button', { name: 'Continue' })).toHaveClass('bg-ghost-button-bg');
    expect(screen.getByRole('button', { name: 'Continue' })).toHaveClass('h-10');

    rerender(<Button.Destructive>Continue</Button.Destructive>);
    expect(screen.getByRole('button', { name: 'Continue' })).toHaveClass('bg-failure-bg');
  });

  it('forwards its ref and host props while applying the requested presentation', () => {
    const ref = createRef<HTMLButtonElement>();
    const onClick = vi.fn();
    render(
      <Button.Secondary
        ref={ref}
        type="button"
        size="large"
        className="host-button"
        data-track="save"
        onClick={onClick}
      >
        Save changes
      </Button.Secondary>,
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
      <Button.Primary disabled onClick={onClick}>
        Delete
      </Button.Primary>,
    );

    const button = screen.getByRole('button', { name: 'Delete' });
    expect(button).toBeDisabled();

    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});
