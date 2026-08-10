// @vitest-environment jsdom
import { useExternalStoreRuntime, type ThreadMessageLike } from '@assistant-ui/react';
import { act, render, screen } from '@testing-library/react';
import {
  trueFoundryAttachmentAdapter,
  type TrueFoundryAgentConfig,
  type UseTrueFoundryAgentRuntimeOptions,
} from '@truefoundry/assistant-ui-runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockAgentUIServer } from '../server/mockServer.js';

const runtimeSpy = vi.hoisted(() => vi.fn<(options: UseTrueFoundryAgentRuntimeOptions) => void>());
const defaultAttachmentAdapter = vi.hoisted(() => ({}));

vi.mock('@truefoundry/assistant-ui-runtime', () => ({
  trueFoundryAttachmentAdapter: defaultAttachmentAdapter,
  useTrueFoundryAgentRuntime: (options: UseTrueFoundryAgentRuntimeOptions) => {
    runtimeSpy(options);
    // Called from ChatRuntimeScope (a React component), so hooks are valid here.
    return useExternalStoreRuntime<ThreadMessageLike>({
      messages: [],
      isRunning: false,
      convertMessage: (message: ThreadMessageLike) => message,
      onNew: async () => {},
    });
  },
}));

import { TrueFoundryChatProvider } from '@/containers/TrueFoundryChatProvider.js';

describe('TrueFoundryChatProvider', () => {
  beforeEach(() => {
    runtimeSpy.mockClear();
  });

  it('forwards legacy runtime options and supplies the default attachment adapter', () => {
    const server = createMockAgentUIServer();
    const onError = vi.fn();

    render(
      <TrueFoundryChatProvider server={server} agentName="my-agent" initialSessionId="session-123" onError={onError}>
        <div>chat-child</div>
      </TrueFoundryChatProvider>,
    );

    expect(screen.getByText('chat-child')).toBeInTheDocument();
    expect(runtimeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        server,
        agentName: 'my-agent',
        initialSessionId: 'session-123',
        adapters: { attachments: defaultAttachmentAdapter },
      }),
    );
    const forwardedOnError = runtimeSpy.mock.calls[0]?.[0]?.onError;
    expect(typeof forwardedOnError).toBe('function');
    expect(forwardedOnError).not.toBe(onError);

    act(() => {
      forwardedOnError?.(new Error('createSession failed'));
    });
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });

  it('forwards a discriminated agent configuration', () => {
    const agent: TrueFoundryAgentConfig = {
      mode: 'named',
      agentName: 'configured-agent',
    };

    render(
      <TrueFoundryChatProvider server={createMockAgentUIServer()} agent={agent}>
        <div>chat-child</div>
      </TrueFoundryChatProvider>,
    );

    expect(runtimeSpy).toHaveBeenCalledWith(expect.objectContaining({ agent }));
  });

  it('preserves a consumer-provided attachment adapter', () => {
    const attachmentAdapter = { ...trueFoundryAttachmentAdapter };

    render(
      <TrueFoundryChatProvider
        server={createMockAgentUIServer()}
        agentName="my-agent"
        adapters={{ attachments: attachmentAdapter }}
      >
        <div>chat-child</div>
      </TrueFoundryChatProvider>,
    );

    expect(runtimeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        adapters: { attachments: attachmentAdapter },
      }),
    );
  });

  it('uses the toaster as the default runtime error handler', async () => {
    render(
      <TrueFoundryChatProvider server={createMockAgentUIServer()} agentName="my-agent">
        <div>chat-child</div>
      </TrueFoundryChatProvider>,
    );
    const options = runtimeSpy.mock.calls[0]?.[0];
    if (options?.onError === undefined) {
      throw new Error('Expected runtime onError handler');
    }

    act(() => {
      options.onError?.(new Error('runtime failed'));
    });

    expect(await screen.findByText('runtime failed')).toBeInTheDocument();
  });
});
