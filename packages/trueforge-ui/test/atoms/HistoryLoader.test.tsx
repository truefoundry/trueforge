import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';

import { HistoryLoader } from '@/atoms/HistoryLoader.js';

describe('HistoryLoader', () => {
  it('describes the idle sentinel without showing a spinner', () => {
    const ref = createRef<HTMLDivElement>();
    render(<HistoryLoader ref={ref} className="host-loader" data-testid="history-loader" />);

    const loader = screen.getByRole('status', { name: 'Scroll up to load older messages' });
    expect(loader).toBe(ref.current);
    expect(loader).toHaveAttribute('aria-live', 'polite');
    expect(loader).toHaveAttribute('data-slot', 'aui_history-loader');
    expect(loader).toHaveClass('host-loader');
    expect(screen.queryByRole('status', { name: 'Loading' })).not.toBeInTheDocument();
  });

  it('announces loading and displays a spinner', () => {
    render(<HistoryLoader isLoading />);

    expect(screen.getByRole('status', { name: 'Loading older messages' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Loading' })).toHaveAttribute('width', '14');
  });
});
