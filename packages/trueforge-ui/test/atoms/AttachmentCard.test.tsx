import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AttachmentCard, getAttachmentFileIconName } from '@/atoms/AttachmentCard.js';

describe('AttachmentCard', () => {
  it('renders an image preview with accessible text and a configured size', () => {
    const { container } = render(
      <AttachmentCard
        name="diagram.png"
        previewSrc="/diagram.png"
        isImage
        size="preview"
        previewRem={12}
        className="consumer-class"
      />,
    );

    const preview = container.querySelector('[data-slot="aui_attachment-preview"]');
    expect(preview).toHaveClass('consumer-class');
    expect(preview).toHaveStyle({ width: '12rem', height: '12rem' });
    expect(screen.getByRole('img', { name: 'diagram.png' })).toHaveAttribute('src', '/diagram.png');
  });

  it('renders a removable image chip and invokes its removal callback', () => {
    const onRemove = vi.fn();
    const { container } = render(
      <AttachmentCard
        name="long-image-name.png"
        previewSrc="/thumbnail.png"
        isImage
        previewRem={8}
        sizeBytes={72}
        onRemove={onRemove}
      />,
    );

    const chip = container.querySelector('[data-slot="aui_attachment-chip"]');
    expect(chip).toHaveStyle({ maxWidth: '8rem' });
    expect(screen.getByRole('img', { name: 'long-image-name.png' })).toHaveAttribute('src', '/thumbnail.png');
    expect(screen.queryByText('long-image-name.png')).not.toBeInTheDocument();
    expect(screen.queryByText('0.07 KB')).not.toBeInTheDocument();

    const removeButton = screen.getByRole('button', { name: 'Remove file' });
    expect(removeButton).toHaveAttribute('type', 'button');
    expect(removeButton).toHaveAttribute('title', 'Remove file');
    fireEvent.click(removeButton);
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it('renders visible file metadata when image preview data is unavailable', () => {
    const { container } = render(
      <AttachmentCard name="report.pdf" contentType="application/pdf" isImage sizeBytes={72} />,
    );

    expect(container.querySelector('[data-slot="aui_attachment-chip"]')).toBeInTheDocument();
    expect(screen.getByText('report.pdf')).toBeInTheDocument();
    expect(screen.getByText('0.07 KB')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove file' })).not.toBeInTheDocument();
  });

  it.each([
    ['report.pdf', 'file-text'],
    ['slides.pptx', 'file-text'],
    ['document.docx', 'file-text'],
    ['notes.txt', 'file-text'],
    ['results.csv', 'file-spreadsheet'],
    ['workbook.xlsx', 'file-spreadsheet'],
    ['config.json', 'file-code'],
    ['bundle.zip', 'file'],
    ['photo.png', 'file'],
    ['attachment', 'file'],
  ])('maps %s to the %s icon', (name, expectedIcon) => {
    expect(getAttachmentFileIconName(name)).toBe(expectedIcon);
  });
});
