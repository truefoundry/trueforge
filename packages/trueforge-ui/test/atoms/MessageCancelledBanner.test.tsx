import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MessageCancelledBanner } from '@/atoms/MessageCancelledBanner.js';

describe('MessageCancelledBanner', () => {
  it('announces the cancelled message as muted text without a warning box', () => {
    render(<MessageCancelledBanner message="client-cancelled" className="host-cancelled" />);

    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent('client-cancelled');
    expect(banner).toHaveClass('aui-message-cancelled-root', 'host-cancelled', 'text-text-secondary', 'w-fit');
    expect(banner).not.toHaveClass('border-warning-bg', 'text-warning-bg', 'bg-warning-bg/10');
  });
});
