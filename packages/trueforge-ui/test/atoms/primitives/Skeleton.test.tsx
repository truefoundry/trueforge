import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Skeleton } from '@/atoms/primitives/Skeleton.js';

describe('Skeleton', () => {
  it('renders host content and forwards attributes, styles, classes, and callbacks', () => {
    const onAnimationEnd = vi.fn();
    render(
      <Skeleton
        aria-label="Loading profile"
        className="host-skeleton"
        data-track="profile"
        style={{ width: 120 }}
        onAnimationEnd={onAnimationEnd}
      >
        <span>Placeholder</span>
      </Skeleton>,
    );

    const skeleton = screen.getByLabelText('Loading profile');
    expect(skeleton).toHaveTextContent('Placeholder');
    expect(skeleton).toHaveAttribute('data-track', 'profile');
    expect(skeleton).toHaveStyle({ width: '120px' });
    expect(skeleton).toHaveClass('animate-pulse', 'rounded-md', 'bg-secondary-bg', 'host-skeleton');

    fireEvent.animationEnd(skeleton);
    expect(onAnimationEnd).toHaveBeenCalledOnce();
  });
});
