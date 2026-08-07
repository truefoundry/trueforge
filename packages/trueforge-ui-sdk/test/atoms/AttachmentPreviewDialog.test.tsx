import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';

import { AttachmentPreviewDialog } from '@/atoms/AttachmentPreviewDialog.js';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});

describe('AttachmentPreviewDialog', () => {
  it('renders children directly when no preview source is available', () => {
    render(
      <AttachmentPreviewDialog>
        <span>plain attachment</span>
      </AttachmentPreviewDialog>,
    );

    expect(screen.getByText('plain attachment')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open attachment preview' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens an accessible image dialog and closes it with its close control', () => {
    render(
      <AttachmentPreviewDialog previewSrc="/full-size.png">
        <img src="/thumbnail.png" alt="diagram thumbnail" />
      </AttachmentPreviewDialog>,
    );

    const trigger = screen.getByRole('button', { name: 'Open attachment preview' });
    expect(trigger).toHaveAttribute('type', 'button');
    fireEvent.click(trigger);

    const dialog = screen.getByRole('dialog', { name: 'Attachment preview' });
    expect(dialog).toHaveAttribute('open');
    expect(screen.getByRole('img', { name: 'Attachment preview' })).toHaveAttribute('src', '/full-size.png');

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(dialog).not.toHaveAttribute('open');
  });
});
