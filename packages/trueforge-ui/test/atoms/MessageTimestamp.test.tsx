import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MessageTimestamp } from '@/atoms/MessageTimestamp.js';

const createdAt = new Date('2026-04-05T14:03:02.000Z');

function expectedTime(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).format(date);
}

function expectedFullDate(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

describe('MessageTimestamp', () => {
  it('renders Date and ISO string values using the local time format', () => {
    const { rerender } = render(<MessageTimestamp createdAt={createdAt} className="host-timestamp" />);

    expect(screen.getByText(expectedTime(createdAt))).toHaveClass('host-timestamp');

    rerender(<MessageTimestamp createdAt={createdAt.toISOString()} />);
    expect(screen.getByText(expectedTime(createdAt))).toBeInTheDocument();
  });

  it('shows the full date in a tooltip on focus', () => {
    render(<MessageTimestamp createdAt={createdAt} />);
    const timestamp = screen.getByText(expectedTime(createdAt));

    fireEvent.focus(timestamp);

    expect(screen.getByRole('tooltip')).toHaveTextContent(expectedFullDate(createdAt));
    fireEvent.blur(timestamp);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('renders nothing for missing or invalid dates', () => {
    const { container, rerender } = render(<MessageTimestamp />);
    expect(container).toBeEmptyDOMElement();

    rerender(<MessageTimestamp createdAt="not-a-date" />);
    expect(container).toBeEmptyDOMElement();
  });
});
