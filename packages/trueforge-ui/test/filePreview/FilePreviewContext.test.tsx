// @vitest-environment jsdom
import { AssistantRuntimeProvider, useExternalStoreRuntime, type ThreadMessageLike } from '@assistant-ui/react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState as useReactState } from 'react';
import { describe, expect, it } from 'vitest';

import { FilePreviewProvider, useFilePreview } from '@/filePreview/FilePreviewContext.js';

const message = {
  role: 'assistant',
  content: 'A local thread with no saved session id.',
} satisfies ThreadMessageLike;

function Probe() {
  const preview = useFilePreview();
  return (
    <>
      <button
        type="button"
        onClick={() => {
          preview.open({
            name: 'Dash',
            path: '/tmp/dash.html',
            turnId: 'turn-1',
            load: async () => new Blob(['hi']),
          });
        }}
      >
        Open preview
      </button>
      <span>{preview.target == null ? 'closed' : preview.target.path}</span>
    </>
  );
}

function Harness({ threadId }: { threadId: string }) {
  const runtime = useExternalStoreRuntime({
    messages: [message],
    isRunning: false,
    convertMessage: (next: ThreadMessageLike) => next,
    onNew: async () => {},
    adapters: { threadList: { threadId } },
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <FilePreviewProvider>
        <Probe />
      </FilePreviewProvider>
    </AssistantRuntimeProvider>
  );
}

function TestApp() {
  const [threadId, setThreadId] = useReactState('unsaved-a');
  return (
    <>
      <button type="button" onClick={() => setThreadId('unsaved-b')}>
        Switch thread
      </button>
      <Harness threadId={threadId} />
    </>
  );
}

describe('FilePreviewProvider', () => {
  it('closes the preview when the local thread changes, even without a remote id', async () => {
    render(<TestApp />);

    fireEvent.click(screen.getByRole('button', { name: 'Open preview' }));
    expect(screen.getByText('/tmp/dash.html')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Switch thread' }));
    await waitFor(() => {
      expect(screen.getByText('closed')).toBeInTheDocument();
    });
  });
});
