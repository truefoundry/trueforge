import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { IncompleteResponseBanner } from '@/atoms/IncompleteResponseBanner.js';

describe('IncompleteResponseBanner', () => {
  it('announces the cut-short response with warning styling', () => {
    render(<IncompleteResponseBanner className="host-incomplete" />);

    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent('The model provider ended this response early, so it may be incomplete.');
    expect(banner).toHaveClass(
      'aui-incomplete-response-root',
      'host-incomplete',
      'border-warning-bg',
      'text-warning-bg',
      'w-fit',
    );
  });
});
