import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MessageListSkeleton } from '@/atoms/Skeletons.js';

describe('MessageListSkeleton', () => {
  it('announces conversation loading and renders message-shaped placeholders', () => {
    const { container } = render(<MessageListSkeleton className="host-skeleton" />);

    const status = screen.getByRole('status', { name: 'Loading conversation' });
    expect(status).toHaveAttribute('data-slot', 'aui_thread-history-skeleton');
    expect(status).toHaveClass('host-skeleton');
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(4);
    expect(container.querySelector('.justify-end .h-10')).toBeInTheDocument();
    expect(container.querySelectorAll('.px-2 .h-4')).toHaveLength(3);
  });
});
