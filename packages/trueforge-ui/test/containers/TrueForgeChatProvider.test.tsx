// @vitest-environment jsdom
import { useExternalStoreRuntime, type ThreadMessageLike } from '@assistant-ui/react';
import { act, render, screen } from '@testing-library/react';
import {
  trueForgeAttachmentAdapter,
  type TrueForgeAgentConfig,
  type UseTrueForgeAgentRuntimeOptions,
} from '@truefoundry/assistant-ui-runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockAgentUIServer } from '../server/mockServer.js';

const runtimeSpy = vi.hoisted(() => vi.fn<(options: UseTrueForgeAgentRuntimeOptions) => void>());
const defaultAttachmentAdapter = vi.hoisted(() => ({}));

vi.mock('@truefoundry/assistant-ui-runtime', () => ({
  trueForgeAttachmentAdapter: defaultAttachmentAdapter,
  useTrueForgeAgentRuntime: (options: UseTrueForgeAgentRuntimeOptions) => {
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

import { TrueForgeChatProvider } from '@/containers/TrueForgeChatProvider.js';

describe('TrueForgeChatProvider', () => {
  beforeEach(() => {
    runtimeSpy.mockClear();
  });

  it('forwards legacy runtime options and supplies the default attachment adapter', () => {
    const server = createMockAgentUIServer();
    const onError = vi.fn();

    render(
      <TrueForgeChatProvider server={server} agentName="my-agent" initialSessionId="session-123" onError={onError}>
        <div>chat-child</div>
      </TrueForgeChatProvider>,
    );

    expect(screen.getByText('chat-child')).toBeInTheDocument();
    expect(runtimeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        agentName: 'my-agent',
        initialSessionId: 'session-123',
        listSessionsCreatedByMe: true,
        adapters: { attachments: defaultAttachmentAdapter },
      }),
    );
    expect(runtimeSpy.mock.calls[0]?.[0]?.server).not.toBe(server);
    const forwardedOnError = runtimeSpy.mock.calls[0]?.[0]?.onError;
    expect(typeof forwardedOnError).toBe('function');
    expect(forwardedOnError).not.toBe(onError);

    act(() => {
      forwardedOnError?.(new Error('createSession failed'));
    });
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });

  it('filters create-agent sessions from runtime history', async () => {
    const listSessions = vi.fn(async () => ({
      data: [
        {
          id: 'chat-session',
          title: 'Chat',
          isMutable: true,
          createdAt: '2026-09-09T00:00:00.000Z',
          updatedAt: '2026-09-09T00:00:00.000Z',
        },
        {
          id: 'builder-session',
          title: 'Builder',
          isMutable: true,
          metadata: { is_create_agent: 'true' },
          createdAt: '2026-09-09T00:00:00.000Z',
          updatedAt: '2026-09-09T00:00:00.000Z',
        },
      ],
      nextPageToken: 'next-page',
    }));

    render(
      <TrueForgeChatProvider server={createMockAgentUIServer({ listSessions })} agentName="my-agent">
        <div>chat-child</div>
      </TrueForgeChatProvider>,
    );

    const runtimeServer = runtimeSpy.mock.calls[0]?.[0]?.server;
    if (runtimeServer === undefined) {
      throw new Error('Expected runtime server');
    }
    const result = await runtimeServer.listSessions();

    expect(result.data.map(session => session.id)).toEqual(['chat-session']);
    expect(result.nextPageToken).toBe('next-page');
  });

  it('wraps session creation used for local ownership tracking', async () => {
    const createSession = vi.fn(async () => ({
      id: 'new-session',
      isMutable: false,
      createdAt: '2026-09-10T00:00:00.000Z',
      updatedAt: '2026-09-10T00:00:00.000Z',
    }));
    render(
      <TrueForgeChatProvider server={createMockAgentUIServer({ createSession })} agentName="my-agent">
        <div>chat-child</div>
      </TrueForgeChatProvider>,
    );
    const runtimeServer = runtimeSpy.mock.calls[0]?.[0]?.server;
    if (runtimeServer === undefined) throw new Error('Expected runtime server');

    await expect(runtimeServer.createSession({ agentName: 'my-agent' })).resolves.toEqual({
      id: 'new-session',
      isMutable: false,
      createdAt: '2026-09-10T00:00:00.000Z',
      updatedAt: '2026-09-10T00:00:00.000Z',
    });
    expect(createSession).toHaveBeenCalledWith({ agentName: 'my-agent' });
  });

  it('forwards a discriminated agent configuration', () => {
    const agent: TrueForgeAgentConfig = {
      mode: 'named',
      agentName: 'configured-agent',
    };

    render(
      <TrueForgeChatProvider server={createMockAgentUIServer()} agent={agent}>
        <div>chat-child</div>
      </TrueForgeChatProvider>,
    );

    expect(runtimeSpy).toHaveBeenCalledWith(expect.objectContaining({ agent }));
  });

  it('preserves a consumer-provided attachment adapter', () => {
    const attachmentAdapter = { ...trueForgeAttachmentAdapter };

    render(
      <TrueForgeChatProvider
        server={createMockAgentUIServer()}
        agentName="my-agent"
        adapters={{ attachments: attachmentAdapter }}
      >
        <div>chat-child</div>
      </TrueForgeChatProvider>,
    );

    expect(runtimeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        adapters: { attachments: attachmentAdapter },
      }),
    );
  });

  it('uses the toaster as the default runtime error handler', async () => {
    render(
      <TrueForgeChatProvider server={createMockAgentUIServer()} agentName="my-agent">
        <div>chat-child</div>
      </TrueForgeChatProvider>,
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
