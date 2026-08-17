import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ComposerShell } from '@/atoms/ComposerShell.js';

describe('ComposerShell', () => {
  it('composes input, attachments, metadata, and idle actions', () => {
    const onAttach = vi.fn();
    const onSubmit = vi.fn();
    const { container } = render(
      <ComposerShell
        input={<textarea aria-label="Message" defaultValue="Hello" />}
        attachments={<div>design.png</div>}
        disabled={false}
        canSubmit
        modelLabel="GPT 5"
        modelIcon={<span aria-label="Model icon">M</span>}
        connectorStatusLabel="Connected"
        onAttach={onAttach}
        onSubmit={onSubmit}
        className="consumer-class"
      />,
    );

    const shell = container.querySelector('[data-slot="aui_composer-shell"]');
    expect(shell).toHaveClass('consumer-class');
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Hello');
    expect(screen.getByText('design.png')).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('GPT 5')).toBeInTheDocument();
    expect(screen.getByLabelText('Model icon')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Attach' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(onAttach).toHaveBeenCalledOnce();
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('shows the running cancel action and delegates cancellation', () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    render(
      <ComposerShell
        input={<textarea aria-label="Message" />}
        disabled
        canSubmit={false}
        isRunning
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Send message' })).not.toBeInTheDocument();
    const cancelButton = screen.getByRole('button', { name: 'Cancel' });
    expect(cancelButton).toBeEnabled();
    fireEvent.click(cancelButton);
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('omits optional composer chrome when labels and attachment handling are absent', () => {
    render(
      <ComposerShell input={<input aria-label="Message" />} disabled={false} canSubmit={false} onSubmit={() => {}} />,
    );

    expect(screen.queryByRole('button', { name: 'Attach' })).not.toBeInTheDocument();
    expect(screen.queryByText('Connected')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
  });
});
