// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Markdown } from '@/atoms/Markdown.js';
import { parseSandboxArtifacts, SandboxArtifactDownload } from '@/atoms/SandboxArtifactDownload.js';
import { SlotsProvider } from '@/theme/SlotsProvider.js';
import { ThemeProvider } from '@/theme/ThemeProvider.js';

describe('parseSandboxArtifacts', () => {
  it('parses tfy markdown-link pairs', () => {
    expect(parseSandboxArtifacts('[sample.js](/tmp/sample.js)\n[notes.txt](/tmp/notes.txt)')).toEqual([
      { name: 'sample.js', path: '/tmp/sample.js' },
      { name: 'notes.txt', path: '/tmp/notes.txt' },
    ]);
  });

  it('strips a leading sandbox_artifacts prefix', () => {
    expect(parseSandboxArtifacts('sandbox_artifacts\n[a.py](/tmp/a.py)')).toEqual([
      { name: 'a.py', path: '/tmp/a.py' },
    ]);
  });

  it('falls back to name: path lines', () => {
    expect(parseSandboxArtifacts('report.pdf: /sandbox/out/report.pdf')).toEqual([
      { name: 'report.pdf', path: '/sandbox/out/report.pdf' },
    ]);
  });
});

describe('SandboxArtifactDownload', () => {
  it('renders download links for link-format artifacts', () => {
    const onDownload = vi.fn(async () => {});
    render(<SandboxArtifactDownload code={'[hello.js](/tmp/hello.js)'} onDownloadArtifact={onDownload} />);
    expect(screen.getByRole('link', { name: /Download hello\.js/i })).toBeInTheDocument();
    expect(screen.getByText('1 file generated')).toBeInTheDocument();
  });

  it('shows a loader while the download is in flight', async () => {
    let resolveDownload!: () => void;
    const onDownload = vi.fn(
      () =>
        new Promise<void>(resolve => {
          resolveDownload = resolve;
        }),
    );
    render(<SandboxArtifactDownload code={'[hello.js](/tmp/hello.js)'} onDownloadArtifact={onDownload} />);

    await act(async () => {
      screen.getByRole('link', { name: /Download hello\.js/i }).click();
    });
    expect(screen.getByRole('link', { name: /Downloading hello\.js/i })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();

    await act(async () => {
      resolveDownload();
      await Promise.resolve();
    });
    expect(screen.getByRole('link', { name: /Download hello\.js/i })).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Loading' })).not.toBeInTheDocument();
  });

  it('renders nothing when the fence body does not parse', () => {
    const { container } = render(<SandboxArtifactDownload code={'not an artifact'} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('Markdown sandbox_artifacts fence', () => {
  it('routes the fence to SandboxArtifactDownload', () => {
    render(
      <ThemeProvider>
        <SlotsProvider>
          <Markdown
            content={['Files ready:', '', '```sandbox_artifacts', '[demo.js](/tmp/demo.js)', '```'].join('\n')}
          />
        </SlotsProvider>
      </ThemeProvider>,
    );
    expect(screen.getByTestId('aui-sandbox-artifacts')).toBeInTheDocument();
    expect(screen.getByText('demo.js')).toBeInTheDocument();
  });
});
