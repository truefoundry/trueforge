import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Button } from '@/atoms/primitives/Button.js';

describe('Button', () => {
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
    expect(button).toHaveClass('border', 'h-8', 'host-button');
    expect(button.className).toMatch(/\[&_svg\]:size-3\.5/);

    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('sizes icons at 0.75rem for small buttons', () => {
    render(<Button.Primary size="small">Try</Button.Primary>);
    expect(screen.getByRole('button', { name: 'Try' }).className).toMatch(/\[&_svg\]:size-3/);
  });

  it('applies primary styles via Button.Primary', () => {
    render(<Button.Primary>Save</Button.Primary>);
    expect(screen.getByRole('button', { name: 'Save' })).toHaveClass('bg-primary-button-bg');
  });

  it('supports dynamic variant on the base Button', () => {
    render(
      <Button variant="destructive" type="button">
        Delete
      </Button>,
    );
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass('bg-failure-bg');
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
