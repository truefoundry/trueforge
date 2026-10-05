// @vitest-environment jsdom
import { AssistantRuntimeProvider, useExternalStoreRuntime, type ThreadMessageLike } from '@assistant-ui/react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { trueForgeExtras } from '@truefoundry/trueforge-assistant-ui-runtime';
import { describe, expect, it, vi } from 'vitest';

import { ThreadContainer } from '@/containers/ThreadContainer.js';

const artifactMessage = {
  role: 'assistant',
  content: ['Files ready:', '', '```sandbox_artifacts', '[report.txt](/tmp/report.txt)', '```'].join('\n'),
  metadata: { custom: { turnId: 'turn-42', sandboxId: 'sbx-1' } },
} satisfies ThreadMessageLike;

function PreviewHarness({
  downloadSandboxFile,
  message = artifactMessage,
}: {
  downloadSandboxFile: (req: { turnId: string; path: string }) => Promise<Blob>;
  message?: ThreadMessageLike;
}) {
  const runtime = useExternalStoreRuntime({
    messages: [message],
    isRunning: false,
    convertMessage: (message: ThreadMessageLike) => message,
    onNew: async () => {},
    extras: trueForgeExtras.provide({
      pendingApprovals: [],
      pendingToolResponses: [],
      pendingMcpAuth: null,
      resumeUnavailable: false,
      sandboxId: 'sbx-1',
      respondToToolApproval: () => {},
      respondToToolResponse: () => {},
      resumeMcpAuth: async () => {},
      downloadSandboxFile,
      cancel: async () => {},
      resetFromTurn: async () => {},
      reload: () => {},
      hasOlderHistory: false,
      isLoadingOlderHistory: false,
      loadOlderHistory: async () => {},
      draft: null,
    }),
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadContainer />
    </AssistantRuntimeProvider>
  );
}

describe('sandbox file preview', () => {
  it('opens a generated file beside the chat and still downloads it', async () => {
    const downloadSandboxFile = vi.fn(async () => new Blob(['hello harness']));
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    if (typeof Element.prototype.scrollTo !== 'function') {
      Element.prototype.scrollTo = () => undefined;
    }

    try {
      render(<PreviewHarness downloadSandboxFile={downloadSandboxFile} />);

      fireEvent.click(await screen.findByRole('button', { name: 'Preview report.txt' }));

      const panel = await screen.findByRole('complementary', { name: 'Preview of report.txt' });
      await waitFor(() => {
        expect(panel).toHaveTextContent('hello harness');
      });
      expect(downloadSandboxFile).toHaveBeenCalledTimes(1);
      expect(downloadSandboxFile).toHaveBeenCalledWith({ turnId: 'turn-42', path: '/tmp/report.txt' });
      expect(anchorClick).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Preview report.txt' })).toHaveAttribute('aria-pressed', 'true');

      fireEvent.click(within(panel).getByRole('button', { name: 'Download report.txt' }));
      await waitFor(() => {
        expect(anchorClick).toHaveBeenCalledTimes(1);
      });
      expect(downloadSandboxFile).toHaveBeenCalledTimes(1);

      fireEvent.click(
        within(screen.getByTestId('aui-sandbox-artifacts')).getByRole('button', { name: 'Download report.txt' }),
      );
      await waitFor(() => {
        expect(downloadSandboxFile).toHaveBeenCalledTimes(2);
      });
      expect(anchorClick).toHaveBeenCalledTimes(2);

      fireEvent.click(within(panel).getByRole('button', { name: 'Close preview' }));
      expect(screen.queryByRole('complementary', { name: 'Preview of report.txt' })).not.toBeInTheDocument();
    } finally {
      anchorClick.mockRestore();
    }
  });

  it('previews an html file in the chat, then enlarged and full page', async () => {
    const html = '<!doctype html><h1>Metrics</h1>';
    const downloadSandboxFile = vi.fn(async () => new Blob([html]));
    let downloadedName = '';
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function mockClick(
      this: HTMLAnchorElement,
    ) {
      downloadedName = this.download;
    });
    if (typeof Element.prototype.scrollTo !== 'function') {
      Element.prototype.scrollTo = () => undefined;
    }

    render(
      <PreviewHarness
        downloadSandboxFile={downloadSandboxFile}
        message={{
          role: 'assistant',
          content: ['Done', '', '```sandbox_artifacts', '[Metrics redesign](/tmp/metrics.html)', '```'].join('\n'),
          metadata: { custom: { turnId: 'turn-42', sandboxId: 'sbx-1' } },
        }}
      />,
    );

    const thumbnail = await screen.findByTitle('Thumbnail of Metrics redesign');
    await waitFor(() => {
      expect(thumbnail).toHaveAttribute('srcdoc', html);
    });
    expect(screen.queryByText('1 file generated')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Enlarge Metrics redesign' }));
    const panel = await screen.findByRole('complementary', { name: 'Preview of Metrics redesign' });
    await waitFor(() => {
      expect(within(panel).getByTitle('Metrics redesign')).toHaveAttribute('srcdoc', html);
    });
    expect(screen.getByRole('button', { name: 'Enlarge Metrics redesign' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(within(panel).getByRole('button', { name: 'Full page' }));
    const fullPage = screen.getByRole('complementary', { name: 'Preview of Metrics redesign' });
    expect(fullPage).toHaveAttribute('data-placement', 'full');
    expect(fullPage.parentElement).toHaveAttribute('data-slot', 'aui_file-preview-row');
    expect(fullPage).not.toHaveClass('fixed');

    fireEvent.click(screen.getByRole('button', { name: 'Exit full page' }));
    const side = screen.getByRole('complementary', { name: 'Preview of Metrics redesign' });
    expect(side).toHaveAttribute('data-placement', 'side');
    expect(side.parentElement).not.toBe(document.body);

    fireEvent.click(within(side).getByRole('button', { name: 'Download Metrics redesign' }));
    await waitFor(() => {
      expect(downloadedName).toBe('metrics.html');
    });
    anchorClick.mockRestore();
  });
});
