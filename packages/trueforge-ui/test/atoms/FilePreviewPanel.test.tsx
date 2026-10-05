// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FilePreviewPanel } from '@/atoms/FilePreviewPanel.js';

describe('FilePreviewPanel', () => {
  it('renders html in a sandboxed frame and closes from the header', () => {
    const onClose = vi.fn();
    render(
      <FilePreviewPanel
        name="dashboard.html"
        placement="side"
        view={{ status: 'html', text: '<h1>Dashboard</h1>' }}
        onClose={onClose}
        onDownload={vi.fn()}
      />,
    );

    const frame = screen.getByTitle('dashboard.html');
    expect(frame.tagName).toBe('IFRAME');
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts allow-forms');
    expect(frame.getAttribute('sandbox')).not.toContain('allow-popups');
    expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin');
    expect(frame).toHaveAttribute('srcdoc', '<h1>Dashboard</h1>');

    fireEvent.click(screen.getByRole('button', { name: 'Close preview' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('shows an image from the object url and downloads from the header', () => {
    const onDownload = vi.fn();
    render(
      <FilePreviewPanel
        name="chart.png"
        placement="overlay"
        view={{ status: 'media', media: 'image', objectUrl: 'blob:chart' }}
        onClose={vi.fn()}
        onDownload={onDownload}
      />,
    );

    expect(screen.getByRole('img', { name: 'chart.png' })).toHaveAttribute('src', 'blob:chart');
    expect(screen.getByRole('complementary', { name: 'Preview of chart.png' })).toHaveAttribute(
      'data-placement',
      'overlay',
    );
    expect(screen.queryByRole('separator', { name: 'Resize preview' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Download chart.png' }));
    expect(onDownload).toHaveBeenCalledOnce();
  });

  it('offers retry when the file failed to load and closes on Escape', () => {
    const onClose = vi.fn();
    const onRetry = vi.fn();
    render(
      <FilePreviewPanel
        name="report.txt"
        placement="side"
        view={{ status: 'error', message: "Couldn't load a preview of this file." }}
        onClose={onClose}
        onDownload={vi.fn()}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByText("Couldn't load a preview of this file.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
    fireEvent.keyDown(screen.getByRole('complementary', { name: 'Preview of report.txt' }), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('widens the side pane from the resize handle', () => {
    const onWidthChange = vi.fn();
    render(
      <div>
        <FilePreviewPanel
          name="report.txt"
          placement="side"
          widthPx={420}
          view={{ status: 'text', text: 'hello' }}
          onClose={vi.fn()}
          onDownload={vi.fn()}
          onWidthChange={onWidthChange}
        />
      </div>,
    );

    const aside = screen.getByRole('complementary', { name: 'Preview of report.txt' });
    const row = aside.parentElement;
    if (row == null) throw new Error('Expected the preview row');
    vi.spyOn(aside, 'getBoundingClientRect').mockReturnValue(rect(420));
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue(rect(1000));

    fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize preview' }), { key: 'ArrowLeft' });
    expect(onWidthChange).toHaveBeenCalledWith(436);
  });

  it('fills the chat pane from the full-page control and returns on Escape', () => {
    const onEnterFullPage = vi.fn();
    const onExitFullPage = vi.fn();
    const onClose = vi.fn();
    const { rerender } = render(
      <FilePreviewPanel
        name="dashboard.html"
        placement="side"
        view={{ status: 'html', text: '<h1>Dashboard</h1>' }}
        onClose={onClose}
        onDownload={vi.fn()}
        onEnterFullPage={onEnterFullPage}
        onExitFullPage={onExitFullPage}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Full page' }));
    expect(onEnterFullPage).toHaveBeenCalledOnce();

    rerender(
      <FilePreviewPanel
        name="dashboard.html"
        placement="full"
        view={{ status: 'html', text: '<h1>Dashboard</h1>' }}
        onClose={onClose}
        onDownload={vi.fn()}
        onEnterFullPage={onEnterFullPage}
        onExitFullPage={onExitFullPage}
      />,
    );

    const panel = screen.getByRole('complementary', { name: 'Preview of dashboard.html' });
    expect(panel).toHaveAttribute('data-placement', 'full');
    expect(panel.parentElement).not.toBe(document.body);
    expect(panel).toHaveClass('absolute', 'inset-0');
    expect(panel).not.toHaveClass('fixed');
    expect(screen.queryByRole('separator', { name: 'Resize preview' })).not.toBeInTheDocument();

    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(onExitFullPage).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Exit full page' }));
    expect(onExitFullPage).toHaveBeenCalledTimes(2);
  });
});

function rect(width: number): DOMRect {
  return {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: width,
    bottom: 0,
    width,
    height: 0,
    toJSON() {
      return {};
    },
  };
}
