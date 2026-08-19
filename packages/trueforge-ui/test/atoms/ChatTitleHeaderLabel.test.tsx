// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useAuiState = vi.fn();

vi.mock('@/assistant-ui.js', () => ({
  useAuiState: (selector: (state: unknown) => unknown) => useAuiState(selector),
}));

import { ChatTitleHeaderLabel } from '@/atoms/ChatTitleHeaderLabel.js';

function setChatTitle(title: string | null | undefined) {
  useAuiState.mockImplementation((selector: (state: unknown) => unknown) => selector({ threadListItem: { title } }));
}

describe('ChatTitleHeaderLabel', () => {
  beforeEach(() => {
    useAuiState.mockReset();
  });

  it('shows the full current chat title in a truncating label', () => {
    const title = 'Investigate an unusually long production deployment failure';
    setChatTitle(title);

    render(<ChatTitleHeaderLabel />);

    expect(screen.getByText(title)).toHaveClass('truncate');
    expect(screen.getByText(title)).toHaveAttribute('title', title);
  });

  it.each([undefined, null, '', '   '])('shows New Chat for an untitled chat (%s)', title => {
    setChatTitle(title);

    render(<ChatTitleHeaderLabel />);

    expect(screen.getByText('New Chat')).toHaveAttribute('title', 'New Chat');
  });
});
