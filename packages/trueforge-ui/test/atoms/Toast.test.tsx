import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Toast, ToastStack } from '@/atoms/Toast.js';

vi.mock('@/icons/Icon.js', () => ({
  Icon: ({ name, className }: { name: string; className?: string }) => (
    <span className={className} data-testid={`icon-${name}`} />
  ),
}));

const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

describe('Toast', () => {
  afterEach(() => {
    vi.useRealTimers();
    if (clipboardDescriptor === undefined) {
      Reflect.deleteProperty(navigator, 'clipboard');
    } else {
      Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
    }
  });

  it('renders alert content while open and delegates dismissal', () => {
    const onOpenChange = vi.fn();
    render(
      <Toast
        title="Request failed"
        description={'First detail\nSecond detail'}
        open
        onOpenChange={onOpenChange}
        className="consumer-class"
      />,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveClass('consumer-class');
    expect(alert).toHaveTextContent('Request failed');
    expect(alert).toHaveTextContent('First detail Second detail');

    const closeButton = screen.getByRole('button', { name: 'Close' });
    expect(closeButton).toHaveAttribute('title', 'Close');
    fireEvent.click(closeButton);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('renders nothing when closed', () => {
    render(<Toast title="Hidden" description="Not visible" open={false} onOpenChange={() => {}} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('Hidden')).not.toBeInTheDocument();
  });

  it('uses semantic status tokens for error and success variants', () => {
    const { container, rerender } = render(
      <Toast title="Request failed" description="Failure detail" open onOpenChange={() => {}} />,
    );

    expect(screen.getByTestId('icon-circle-exclamation')).toHaveClass('text-failure-bg');
    expect(screen.getByText('Request failed')).toHaveClass('text-failure-bg');

    rerender(
      <Toast title="Request succeeded" description="Success detail" open onOpenChange={() => {}} variant="success" />,
    );

    expect(screen.getByTestId('icon-circle-check')).toHaveClass('text-success-bg');
    expect(screen.getByText('Request succeeded')).toHaveClass('text-success-bg');
    expect(container.querySelector('.text-destructive, .text-success')).not.toBeInTheDocument();
  });

  it('copies the full error and temporarily exposes copied state', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    render(<Toast title="Copy title" description="Copy body" open onOpenChange={() => {}} />);

    expect(screen.getByTestId('icon-clone')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledWith('Copy title\nCopy body');
    expect(screen.getByTestId('icon-check')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.getByTestId('icon-clone')).toBeInTheDocument();
  });
});

describe('ToastStack', () => {
  it('renders all children in the fixed non-interactive stack', () => {
    const { container } = render(
      <ToastStack>
        <div>Older toast</div>
        <div>Newer toast</div>
      </ToastStack>,
    );

    const stack = container.firstElementChild;
    expect(stack).toHaveClass('pointer-events-none', 'fixed', 'flex-col-reverse');
    expect(stack?.children).toHaveLength(2);
    expect(stack?.children[0]).toHaveTextContent('Older toast');
    expect(stack?.children[1]).toHaveTextContent('Newer toast');
  });
});
