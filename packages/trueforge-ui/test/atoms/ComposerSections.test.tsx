import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ComposerLeftSection, ComposerRightSection, ComposerSendButton } from '@/atoms/ComposerSections.js';

describe('ComposerLeftSection', () => {
  it('renders an accessible attachment action when a handler is provided', () => {
    const onAttach = vi.fn();
    render(<ComposerLeftSection disabled={false} isRunning={false} onAttach={onAttach} />);

    const button = screen.getByRole('button', { name: 'Attach' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveAttribute('title', 'Attach');
    fireEvent.click(button);
    expect(onAttach).toHaveBeenCalledOnce();
  });

  it('renders nothing when attachment handling is unavailable', () => {
    const { container } = render(<ComposerLeftSection disabled isRunning />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('ComposerRightSection', () => {
  it('reserves no default UI in either idle or running state', () => {
    const { container, rerender } = render(<ComposerRightSection disabled={false} isRunning={false} />);
    expect(container).toBeEmptyDOMElement();

    rerender(<ComposerRightSection disabled isRunning />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('ComposerSendButton', () => {
  it('disables submission until the composer can submit', () => {
    const onSubmit = vi.fn();
    const { rerender } = render(
      <ComposerSendButton disabled={false} canSubmit={false} isRunning={false} onSubmit={onSubmit} />,
    );

    const unavailableButton = screen.getByRole('button', { name: 'Send message' });
    expect(unavailableButton).toBeDisabled();
    fireEvent.click(unavailableButton);
    expect(onSubmit).not.toHaveBeenCalled();

    rerender(<ComposerSendButton disabled={false} canSubmit isRunning={false} onSubmit={onSubmit} />);
    const availableButton = screen.getByRole('button', { name: 'Send message' });
    expect(availableButton).toBeEnabled();
    expect(availableButton).toHaveAttribute('title', 'Send message');
    fireEvent.click(availableButton);
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('switches to a cancel action while running', () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    render(<ComposerSendButton disabled={false} canSubmit isRunning onSubmit={onSubmit} onCancel={onCancel} />);

    const cancelButton = screen.getByRole('button', { name: 'Cancel' });
    expect(cancelButton).toHaveTextContent('Cancel');
    expect(screen.queryByRole('button', { name: 'Send message' })).not.toBeInTheDocument();
    fireEvent.click(cancelButton);
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('disables cancellation when no cancel handler is supplied', () => {
    render(<ComposerSendButton disabled={false} canSubmit isRunning onSubmit={() => {}} />);

    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });
});
