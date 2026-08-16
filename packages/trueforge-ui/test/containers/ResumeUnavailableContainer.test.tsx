// @vitest-environment jsdom
import { AssistantRuntimeProvider, useExternalStoreRuntime, type ThreadMessageLike } from '@assistant-ui/react';
import { render, screen } from '@testing-library/react';
import { trueFoundryExtras } from '@truefoundry/assistant-ui-runtime';
import { describe, expect, it } from 'vitest';

import { ResumeUnavailableContainer } from '@/containers/ResumeUnavailableContainer.js';
import { SlotsProvider } from '@/theme/SlotsProvider.js';

function Harness({ resumeUnavailable }: { resumeUnavailable: boolean }) {
  const messages: ThreadMessageLike[] = [];
  const runtime = useExternalStoreRuntime({
    messages,
    isRunning: resumeUnavailable,
    convertMessage: (m: ThreadMessageLike) => m,
    onNew: async () => {},
    extras: trueFoundryExtras.provide({
      pendingApprovals: [],
      pendingToolResponses: [],
      pendingMcpAuth: null,
      resumeUnavailable,
      sandboxId: undefined,
      respondToToolApproval: () => {},
      respondToToolResponse: () => {},
      resumeMcpAuth: async () => {},
      downloadSandboxFile: async () => new Blob(),
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
      <SlotsProvider>
        <ResumeUnavailableContainer />
      </SlotsProvider>
    </AssistantRuntimeProvider>
  );
}

describe('ResumeUnavailableContainer', () => {
  it('renders nothing while resume is available', () => {
    render(<Harness resumeUnavailable={false} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows an in-chat waiting notice when resume is unavailable', () => {
    render(<Harness resumeUnavailable={true} />);

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent("Still generating a response. It'll appear here when ready.");
    expect(status).toHaveClass('flex', 'items-center');
    expect(status.querySelector('[aria-hidden]')).toHaveTextContent('●');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
