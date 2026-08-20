// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useAuiState = vi.fn();

vi.mock('@/assistant-ui.js', () => ({
  useAuiState: (selector: (state: unknown) => unknown) => useAuiState(selector),
}));

import { ChatTitleHeaderLabel } from '@/atoms/ChatTitleHeaderLabel.js';

describe('ChatTitleHeaderLabel', () => {
  beforeEach(() => {
    useAuiState.mockImplementation((selector: (state: unknown) => unknown) =>
      selector({ threadListItem: { title: undefined } }),
    );
  });

  it('shows a placeholder for an untitled chat', () => {
    render(<ChatTitleHeaderLabel />);

    expect(screen.getByRole('heading', { name: 'New Chat' })).toBeInTheDocument();
  });

  it('shows the current title with truncation and a full-title tooltip', () => {
    const title = 'A very long conversation title that should stay on one line';
    useAuiState.mockImplementation((selector: (state: unknown) => unknown) => selector({ threadListItem: { title } }));

    render(<ChatTitleHeaderLabel />);

    expect(screen.getByRole('heading', { name: title })).toHaveClass('min-w-0', 'flex-1', 'truncate');
    expect(screen.getByRole('heading', { name: title })).toHaveAttribute('title', title);
  });
});
