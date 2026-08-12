// @vitest-environment jsdom
import {
  AssistantRuntimeProvider,
  ThreadPrimitive,
  useExternalStoreRuntime,
  type ThreadMessageLike,
} from '@assistant-ui/react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { trueFoundryExtras } from '@truefoundry/assistant-ui-runtime';
import { describe, expect, it, vi } from 'vitest';

import type { MarkdownProps } from '@/atoms/Markdown.js';
import { AssistantMessageContainer } from '@/containers/AssistantMessageContainer.js';
import { SlotsProvider } from '@/theme/SlotsProvider.js';
import { RuntimeHarness } from './RuntimeHarness.js';

function renderAssistantMessage(messages: ThreadMessageLike[]) {
  return render(
    <RuntimeHarness messages={messages}>
      <ThreadPrimitive.Messages>{() => <AssistantMessageContainer />}</ThreadPrimitive.Messages>
    </RuntimeHarness>,
  );
}

describe('AssistantTextContainer', () => {
  it('renders markdown formatting from the live text part', () => {
    renderAssistantMessage([{ role: 'assistant', content: '**bold** text' }]);
    const strong = screen.getByText('bold');
    expect(strong.tagName).toBe('STRONG');
  });

  it('renders plain streaming text as it grows', () => {
    renderAssistantMessage([{ role: 'assistant', content: 'partial toke' }]);
    expect(screen.getByText('partial toke')).toBeInTheDocument();
  });

  it('renders openui fenced blocks via OpenUiFenceBlock instead of a code pre', async () => {
    renderAssistantMessage([
      {
        role: 'assistant',
        content: '```openui\nCard() { title: "Sales" }\n```',
      },
    ]);
    // Lazy import resolves asynchronously; wait for Suspense to settle.
    await waitFor(() => {
      expect(screen.getByTestId('aui-openui-renderer')).toBeInTheDocument();
    });
    expect(screen.getByTestId('aui-openui-renderer')).toHaveTextContent('Card() { title: "Sales" }');
    expect(document.querySelector('.code-block-header')).not.toBeInTheDocument();
  });

  it('passes the runtime-backed artifact download handler to markdown', () => {
    function Markdown({ onDownloadArtifact }: MarkdownProps) {
      return <div data-testid="artifact-download-handler">{typeof onDownloadArtifact}</div>;
    }

    render(
      <RuntimeHarness messages={[{ role: 'assistant', content: 'artifact' }]}>
        <SlotsProvider overrides={{ Markdown }}>
          <ThreadPrimitive.Messages>{() => <AssistantMessageContainer />}</ThreadPrimitive.Messages>
        </SlotsProvider>
      </RuntimeHarness>,
    );

    expect(screen.getByTestId('artifact-download-handler')).toHaveTextContent('function');
  });

  it('downloads an artifact through the turn that produced the message', async () => {
    const downloadSandboxFile = vi.fn(async () => new Blob(['hello harness']));
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    function ExtrasHarness() {
      const runtime = useExternalStoreRuntime({
        messages: [
          {
            role: 'assistant',
            content: ['Files ready:', '', '```sandbox_artifacts', '[report.txt](/tmp/report.txt)', '```'].join('\n'),
            metadata: { custom: { turnId: 'turn-42', sandboxId: 'sbx-1' } },
          } satisfies ThreadMessageLike,
        ],
        isRunning: false,
        convertMessage: (m: ThreadMessageLike) => m,
        onNew: async () => {},
        extras: trueFoundryExtras.provide({
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
          <ThreadPrimitive.Messages>{() => <AssistantMessageContainer />}</ThreadPrimitive.Messages>
        </AssistantRuntimeProvider>
      );
    }

    try {
      render(<ExtrasHarness />);

      fireEvent.click(await screen.findByText('report.txt'));

      await waitFor(() => {
        expect(downloadSandboxFile).toHaveBeenCalledWith({ turnId: 'turn-42', path: '/tmp/report.txt' });
      });
    } finally {
      anchorClick.mockRestore();
    }
  });
});
