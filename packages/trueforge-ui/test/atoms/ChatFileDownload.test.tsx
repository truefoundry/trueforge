import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ChatFileDownload } from '@/atoms/ChatFileDownload.js';

describe('ChatFileDownload', () => {
  it('renders direct download links with singular and plural summaries', () => {
    const { rerender } = render(
      <ChatFileDownload
        files={[{ name: 'report.pdf', path: '/report.pdf' }]}
        fileDownloadBaseUrl="https://files.example.com"
      />,
    );

    expect(screen.getByText('1 file generated')).toBeInTheDocument();
    const reportLink = screen.getByRole('link', { name: 'Download report.pdf' });
    expect(reportLink).toHaveAttribute('href', 'https://files.example.com/report.pdf');
    expect(reportLink).toHaveAttribute('download', 'report.pdf');

    rerender(
      <ChatFileDownload
        files={[
          { name: 'report.pdf', path: '/report.pdf' },
          { name: 'data.csv', path: '/data.csv' },
        ]}
        fileDownloadBaseUrl="/downloads"
      />,
    );
    expect(screen.getByText('2 files generated')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download data.csv' })).toHaveAttribute('href', '/downloads/data.csv');
  });

  it('shows per-file progress and suppresses duplicate artifact downloads', async () => {
    let resolveDownload: (() => void) | undefined;
    const downloadPromise = new Promise<void>(resolve => {
      resolveDownload = resolve;
    });
    const onDownloadArtifact = vi.fn(() => downloadPromise);
    render(
      <ChatFileDownload
        files={[{ name: 'bundle.zip', path: '/bundle.zip' }]}
        onDownloadArtifact={onDownloadArtifact}
      />,
    );

    fireEvent.click(screen.getByRole('link', { name: 'Download bundle.zip' }));
    expect(onDownloadArtifact).toHaveBeenCalledWith('/bundle.zip', 'bundle.zip');

    const downloadingLink = screen.getByRole('link', { name: 'Downloading bundle.zip' });
    expect(downloadingLink).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    fireEvent.click(downloadingLink);
    expect(onDownloadArtifact).toHaveBeenCalledOnce();

    if (resolveDownload === undefined) {
      throw new Error('Expected the download resolver to be assigned');
    }
    const completeDownload = resolveDownload;
    await act(async () => {
      completeDownload();
      await downloadPromise;
    });

    expect(screen.getByRole('link', { name: 'Download bundle.zip' })).not.toHaveAttribute('aria-busy');
    expect(screen.queryByRole('status', { name: 'Loading' })).not.toBeInTheDocument();
  });

  it('renders read-only filenames without interactive download controls', () => {
    render(
      <ChatFileDownload
        readOnly
        files={[
          { name: 'one.txt', path: '/one.txt' },
          { name: 'two.txt', path: '/two.txt' },
        ]}
        fileDownloadBaseUrl="/downloads"
        onDownloadArtifact={vi.fn(async () => {})}
      />,
    );

    expect(screen.getByText('one.txt')).toBeInTheDocument();
    expect(screen.getByText('two.txt')).toBeInTheDocument();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.queryByLabelText(/Download /)).not.toBeInTheDocument();
  });

  it('marks files as unavailable when no download mechanism is configured', () => {
    render(<ChatFileDownload files={[{ name: 'offline.txt', path: '/offline.txt' }]} />);

    const unavailable = screen.getByLabelText('Download offline.txt');
    expect(unavailable).not.toHaveAttribute('href');
    expect(unavailable).toHaveClass('pointer-events-none', 'opacity-60');
    expect(screen.queryByRole('link', { name: 'Download offline.txt' })).not.toBeInTheDocument();
  });
});
