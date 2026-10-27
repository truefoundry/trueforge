import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MessageCancelledBanner } from '@/atoms/MessageCancelledBanner.js';

describe('MessageCancelledBanner', () => {
  it('announces the cancelled message with warning styling', () => {
    render(<MessageCancelledBanner message="client-cancelled" className="host-cancelled" />);

    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent('client-cancelled');
    expect(banner).toHaveClass(
      'aui-message-cancelled-root',
      'host-cancelled',
      'border-warning-bg',
      'text-warning-bg',
      'w-fit',
    );
  });
});
