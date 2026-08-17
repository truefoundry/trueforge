import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MessageIndicator } from '@/atoms/MessageIndicator.js';

describe('MessageIndicator', () => {
  it('provides an accessible working state and preserves host styling', () => {
    render(<MessageIndicator className="host-indicator" />);

    const indicator = screen.getByLabelText('Assistant is working');
    expect(indicator).toHaveTextContent('●');
    expect(indicator).toHaveAttribute('data-slot', 'aui_assistant-message-indicator');
    expect(indicator).toHaveClass('animate-pulse', 'host-indicator');
  });
});
