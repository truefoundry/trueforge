import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MessageIndicator } from '@/atoms/MessageIndicator.js';

vi.mock('thinking-orbs', () => ({
  ThinkingOrb: () => <div data-testid="thinking-orb" />,
}));

describe('MessageIndicator', () => {
  it('shows ThinkingOrb with Working... and preserves host styling', () => {
    render(<MessageIndicator className="host-indicator" />);

    const indicator = screen.getByRole('status');
    expect(indicator).toHaveTextContent('Working...');
    expect(indicator).toHaveAttribute('data-slot', 'aui_assistant-message-indicator');
    expect(indicator).toHaveClass('host-indicator');
    expect(screen.getByText('Working...')).toHaveClass('aui-message-indicator-shimmer');
    expect(screen.getByTestId('thinking-orb')).toBeInTheDocument();
  });
});
