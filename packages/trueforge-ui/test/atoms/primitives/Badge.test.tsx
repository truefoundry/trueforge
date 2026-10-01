import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Badge } from '@/atoms/primitives/Badge.js';

describe('Badge', () => {
  it('renders with default variant and children', () => {
    render(<Badge>Default</Badge>);
    const badge = screen.getByText('Default');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute('data-variant', 'default');
    expect(badge).toHaveAttribute('data-shape', 'rounded');
    expect(badge).toHaveAttribute('data-size', 'sm');
  });

  it('renders with specified variant, shape, and size', () => {
    render(
      <Badge variant="success" shape="pill" size="md">
        Active
      </Badge>,
    );
    const badge = screen.getByText('Active');
    expect(badge).toHaveAttribute('data-variant', 'success');
    expect(badge).toHaveAttribute('data-shape', 'pill');
    expect(badge).toHaveAttribute('data-size', 'md');
  });

  it('renders a status dot when dot is true', () => {
    const { container } = render(
      <Badge variant="warning" dot>
        Paused
      </Badge>,
    );
    expect(screen.getByText('Paused')).toBeInTheDocument();
    const dot = container.querySelector('.rounded-full.size-1\\.5');
    expect(dot).toBeInTheDocument();
  });
});
