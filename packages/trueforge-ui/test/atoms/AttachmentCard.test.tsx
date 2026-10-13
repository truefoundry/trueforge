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
    expect(chip).toHaveClass('size-14', 'rounded-lg');
    expect(chip).toHaveStyle({ maxWidth: '8rem' });
    expect(screen.getByRole('img', { name: 'long-image-name.png' })).toHaveAttribute('src', '/thumbnail.png');
    expect(screen.queryByText('long-image-name.png')).not.toBeInTheDocument();
    expect(screen.queryByText('0.07 KB')).not.toBeInTheDocument();

    const removeButton = screen.getByRole('button', { name: 'Remove file' });
    expect(removeButton).toHaveAttribute('type', 'button');
    expect(removeButton).toHaveAttribute('title', 'Remove file');
    expect(removeButton.className).toMatch(/md:opacity-0/);
    expect(removeButton.className).not.toMatch(/(?:^|\s)opacity-0(?:\s|$)/);
    fireEvent.click(removeButton);
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it('renders visible file metadata when image preview data is unavailable', () => {
    const { container } = render(
      <AttachmentCard name="report.pdf" contentType="application/pdf" isImage sizeBytes={72} />,
    );

    const chip = container.querySelector('[data-slot="aui_attachment-chip"]');
    expect(chip).toBeInTheDocument();
    expect(chip).toHaveClass('h-14', 'rounded-lg', 'max-w-40');
    expect(screen.getByText('report.pdf')).toBeInTheDocument();
    expect(screen.getByText('0.07 KB')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove file' })).not.toBeInTheDocument();
  });

  it('matches image chip height and radius with a capped file chip width', () => {
    const { container } = render(
      <>
        <AttachmentCard name="photo.png" previewSrc="/photo.png" isImage />
        <AttachmentCard name="very-long-report-filename.pdf" contentType="application/pdf" sizeBytes={2048} />
      </>,
    );

    const chips = container.querySelectorAll('[data-slot="aui_attachment-chip"]');
    expect(chips).toHaveLength(2);
    expect(chips[0]).toHaveClass('size-14', 'rounded-lg');
    expect(chips[1]).toHaveClass('h-14', 'rounded-lg', 'max-w-40');
    expect(screen.getByText('very-long-report-filename.pdf')).toHaveClass('truncate');
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
