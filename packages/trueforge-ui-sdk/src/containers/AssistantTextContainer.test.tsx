// @vitest-environment jsdom
import { ThreadPrimitive, type ThreadMessageLike } from '@assistant-ui/react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { MarkdownProps } from '../atoms/Markdown.js';
import { SlotsProvider } from '../theme/SlotsProvider.js';
import { AssistantMessageContainer } from './AssistantMessageContainer.js';
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
});
