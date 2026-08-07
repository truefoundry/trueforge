import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MessageErrorBanner } from '@/atoms/MessageErrorBanner.js';

describe('MessageErrorBanner', () => {
  it('announces the supplied error and preserves host styling', () => {
    render(<MessageErrorBanner message="The response could not be generated" className="host-error" />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('The response could not be generated');
    expect(alert).toHaveClass('aui-message-error-root', 'host-error');
    expect(alert.firstElementChild).toHaveClass('aui-message-error-message', 'line-clamp-2');
  });
});
