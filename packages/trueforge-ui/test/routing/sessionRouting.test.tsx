// @vitest-environment jsdom
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type ExternalStoreThreadListAdapter,
  type ThreadMessageLike,
} from '@assistant-ui/react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { CompactLayoutProvider } from '@/atoms/lib/CompactLayoutContext.js';
import type { ThreadListRowProps } from '@/atoms/ThreadListRow.js';
import { ThreadListContainer } from '@/containers/ThreadListContainer.js';
import { resolveRoutesConfig } from '@/routing/paths.js';
import { RemoteIdRouteBridge } from '@/routing/RemoteIdRouteBridge.js';
import { ShellRouteSync } from '@/routing/ShellRouteSync.js';
import { ShellModeProvider } from '@/server/ShellModeContext.js';
import { SlotsProvider } from '@/theme/SlotsProvider.js';

const routes = resolveRoutesConfig();

let pathname = '';
let search = '';
let hash = '';

function CaptureLocation() {
  const location = useLocation();
  pathname = location.pathname;
  search = location.search;
  hash = location.hash;
  return null;
}

function BackButton() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(-1)}>
      Go back
    </button>
  );
}

function ThreadListRowOverride({ title, onSelect }: ThreadListRowProps) {
  return (
    <button type="button" onClick={onSelect}>
      {title}
    </button>
  );
}

function RuntimeHarness({ threadList, children }: { threadList: ExternalStoreThreadListAdapter; children: ReactNode }) {
  const runtime = useExternalStoreRuntime<ThreadMessageLike>({
    messages: [],
    convertMessage: message => message,
    onNew: async () => {},
    adapters: { threadList },
  });
  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}

/** Mirrors production: sync outside the chat runtime, remote-id bridge inside it. */
function Harness({
  threads,
  onSwitchToThread,
}: {
  threads: NonNullable<ExternalStoreThreadListAdapter['threads']>;
  onSwitchToThread?: (id: string) => void;
}) {
  const [activeRemoteId, setActiveRemoteId] = useState<string | undefined>(undefined);
  const [threadId, setThreadId] = useState('thread-draft');
  return (
    <SlotsProvider overrides={{ ThreadListRow: ThreadListRowOverride }}>
      <ShellModeProvider agentConfig={{ mode: 'AgentLibraryWithComposer' }}>
        <ShellRouteSync routes={routes} activeRemoteId={activeRemoteId} initialSettingsOpen={false} />
        <RuntimeHarness
          threadList={{
            threadId,
            threads,
            onSwitchToThread: async id => {
              onSwitchToThread?.(id);
              setThreadId(id);
            },
          }}
        >
          <RemoteIdRouteBridge onRemoteIdChange={setActiveRemoteId} />
          <CompactLayoutProvider>
            <ThreadListContainer />
          </CompactLayoutProvider>
        </RuntimeHarness>
      </ShellModeProvider>
    </SlotsProvider>
  );
}

describe('selecting a session updates the URL', () => {
  it('routes to /sessions/:id when picking a history row', async () => {
    const onSwitchToThread = vi.fn(async () => {});
    render(
      <MemoryRouter initialEntries={['/']}>
        <CaptureLocation />
        <Harness
          threads={[
            { status: 'regular', id: 'thread-draft', title: 'New Chat' },
            { status: 'regular', id: 'thread-2', remoteId: 'session-2', title: 'Second' },
          ]}
          onSwitchToThread={onSwitchToThread}
        />
      </MemoryRouter>,
    );

    expect(pathname).toBe('/');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Second' }));
    });

    await waitFor(() => {
      expect(onSwitchToThread).toHaveBeenCalledWith('thread-2');
    });
    await waitFor(() => {
      expect(pathname).toBe('/sessions/session-2');
    });
  });

  // Reuse via switchToThread never clears pendingSessionId, so a session opened
  // through the shell (deep link, agent row) must not pin the URL afterwards.
  it('follows a pick made after the shell already holds a pending session', async () => {
    render(
      <MemoryRouter initialEntries={['/sessions/session-1']}>
        <CaptureLocation />
        <Harness
          threads={[
            { status: 'regular', id: 'thread-draft', title: 'New Chat' },
            { status: 'regular', id: 'thread-1', remoteId: 'session-1', title: 'First' },
            { status: 'regular', id: 'thread-2', remoteId: 'session-2', title: 'Second' },
          ]}
        />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(pathname).toBe('/sessions/session-1');
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Second' }));
    });
    await waitFor(() => {
      expect(pathname).toBe('/sessions/session-2');
    });
  });

  // The live thread leads the derived place, so Back must not be dragged forward
  // again by the thread the runtime still has mounted.
  it('stays put when Back moves between two sessions', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <CaptureLocation />
        <BackButton />
        <Harness
          threads={[
            { status: 'regular', id: 'thread-draft', title: 'New Chat' },
            { status: 'regular', id: 'thread-1', remoteId: 'session-1', title: 'First' },
            { status: 'regular', id: 'thread-2', remoteId: 'session-2', title: 'Second' },
          ]}
        />
      </MemoryRouter>,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'First' }));
    });
    await waitFor(() => {
      expect(pathname).toBe('/sessions/session-1');
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Second' }));
    });
    await waitFor(() => {
      expect(pathname).toBe('/sessions/session-2');
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Go back' }));
    });
    expect(pathname).toBe('/sessions/session-1');

    // Let every follow-up effect settle: the URL must not bounce forward.
    await act(async () => {
      await Promise.resolve();
    });
    expect(pathname).toBe('/sessions/session-1');
  });

  // The shell owns the pathname only; host query state must survive navigation.
  it('keeps query string and hash when the place changes', async () => {
    render(
      <MemoryRouter initialEntries={['/sessions/session-1?tenant=acme#top']}>
        <CaptureLocation />
        <Harness
          threads={[
            { status: 'regular', id: 'thread-draft', title: 'New Chat' },
            { status: 'regular', id: 'thread-1', remoteId: 'session-1', title: 'First' },
            { status: 'regular', id: 'thread-2', remoteId: 'session-2', title: 'Second' },
          ]}
        />
      </MemoryRouter>,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Second' }));
    });

    await waitFor(() => {
      expect(pathname).toBe('/sessions/session-2');
    });
    expect(search).toBe('?tenant=acme');
    expect(hash).toBe('#top');
  });
});
