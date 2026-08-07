import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  ThreadListEmptyState,
  ThreadListNewButton,
  ThreadListRowSkeleton,
  ThreadListShell,
} from '@/atoms/ThreadListMisc.js';

describe('ThreadListNewButton', () => {
  it('renders the default accessible action and forwards button behavior', () => {
    const onClick = vi.fn();
    render(<ThreadListNewButton onClick={onClick} className="consumer-class" />);

    const button = screen.getByRole('button', { name: 'Start new chat' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveTextContent('New Chat');
    expect(button).toHaveClass('consumer-class');
    expect(button).toHaveStyle({ borderRadius: 'var(--thread-list-item-radius, 0.5rem)' });
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('accepts custom content and native disabled state while preserving consumer styles', () => {
    const onClick = vi.fn();
    render(
      <ThreadListNewButton disabled onClick={onClick} style={{ borderRadius: '2rem', color: 'red' }}>
        Start over
      </ThreadListNewButton>,
    );

    const button = screen.getByRole('button', { name: 'Start new chat' });
    expect(button).toHaveTextContent('Start over');
    expect(button).toHaveStyle({ borderRadius: '2rem', color: 'rgb(255, 0, 0)' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('ThreadListRowSkeleton', () => {
  it('announces loading and renders the requested number of skeleton rows', () => {
    const { rerender } = render(<ThreadListRowSkeleton count={3} className="consumer-class" />);

    const status = screen.getByRole('status', { name: 'Loading threads' });
    expect(status).toHaveClass('consumer-class');
    expect(status.querySelectorAll('.animate-pulse')).toHaveLength(3);

    rerender(<ThreadListRowSkeleton count={1} />);
    expect(screen.getByRole('status', { name: 'Loading threads' }).querySelectorAll('.animate-pulse')).toHaveLength(1);
  });

  it('uses five rows by default', () => {
    render(<ThreadListRowSkeleton />);
    expect(screen.getByRole('status', { name: 'Loading threads' }).querySelectorAll('.animate-pulse')).toHaveLength(5);
  });
});

describe('ThreadListEmptyState', () => {
  it('renders the default and custom empty messages', () => {
    const { rerender } = render(<ThreadListEmptyState className="consumer-class" />);
    expect(screen.getByText('No threads yet')).toHaveClass('consumer-class');

    rerender(<ThreadListEmptyState message="No matching conversations" />);
    expect(screen.getByText('No matching conversations')).toBeInTheDocument();
    expect(screen.queryByText('No threads yet')).not.toBeInTheDocument();
  });
});

describe('ThreadListShell', () => {
  it('keeps header and history-owned overflow in separate regions', () => {
    const { container } = render(
      <ThreadListShell header={<button type="button">Create thread</button>} className="consumer-class">
        <a href="/threads/one">Thread one</a>
      </ThreadListShell>,
    );

    const root = container.firstElementChild;
    expect(root).toHaveClass('consumer-class');
    expect(root?.children).toHaveLength(2);
    expect(root?.children[0]).toContainElement(screen.getByRole('button', { name: 'Create thread' }));
    expect(root?.children[1]).toContainElement(screen.getByRole('link', { name: 'Thread one' }));
    expect(root?.children[1]).toHaveClass('overflow-hidden');
  });
});
