// @vitest-environment jsdom
import { AssistantRuntimeProvider, useExternalStoreRuntime, type ThreadMessageLike } from '@assistant-ui/react';
import { render, screen, waitFor } from '@testing-library/react';
import { trueFoundryExtras } from '@truefoundry/assistant-ui-runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HistoryLoaderContainer } from '@/containers/HistoryLoaderContainer.js';

type ObserverCallback = (entries: Array<{ isIntersecting: boolean }>) => void;

let observerCallbacks: ObserverCallback[] = [];

class IntersectionObserverStub {
  constructor(callback: ObserverCallback) {
    observerCallbacks.push(callback);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  observerCallbacks = [];
  vi.stubGlobal('IntersectionObserver', IntersectionObserverStub);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function Harness({
  hasOlderHistory,
  isLoadingOlderHistory = false,
  loadOlderHistory = async () => {},
}: {
  hasOlderHistory: boolean;
  isLoadingOlderHistory?: boolean;
  loadOlderHistory?: () => Promise<void>;
}) {
  const messages: ThreadMessageLike[] = [];
  const runtime = useExternalStoreRuntime({
    messages,
    isRunning: false,
    convertMessage: (m: ThreadMessageLike) => m,
    onNew: async () => {},
    extras: trueFoundryExtras.provide({
      pendingApprovals: [],
      pendingToolResponses: [],
      pendingMcpAuth: null,
      resumeUnavailable: false,
      sandboxId: undefined,
      respondToToolApproval: () => {},
      respondToToolResponse: () => {},
      resumeMcpAuth: async () => {},
      downloadSandboxFile: async () => new Blob(),
      cancel: async () => {},
      resetFromTurn: async () => {},
      reload: () => {},
      hasOlderHistory,
      isLoadingOlderHistory,
      loadOlderHistory,
      draft: null,
    }),
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <HistoryLoaderContainer />
    </AssistantRuntimeProvider>
  );
}

describe('HistoryLoaderContainer', () => {
  it('renders nothing when there is no older history', () => {
    render(<Harness hasOlderHistory={false} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('renders the sentinel when older history is available', () => {
    render(<Harness hasOlderHistory={true} />);
    expect(screen.getByRole('status', { name: 'Scroll up to load older messages' })).toBeInTheDocument();
  });

  it('shows the spinner while a page is being fetched', () => {
    render(<Harness hasOlderHistory={true} isLoadingOlderHistory={true} />);
    expect(screen.getByRole('status', { name: 'Loading older messages' })).toBeInTheDocument();
  });

  it('loads older history when the sentinel intersects the viewport', async () => {
    const loadOlderHistory = vi.fn().mockResolvedValue(undefined);
    render(<Harness hasOlderHistory={true} loadOlderHistory={loadOlderHistory} />);

    expect(observerCallbacks.length).toBeGreaterThan(0);
    observerCallbacks.forEach(cb => cb([{ isIntersecting: true }]));

    await waitFor(() => expect(loadOlderHistory).toHaveBeenCalledTimes(1));
  });

  it('ignores intersection entries that are not intersecting', async () => {
    const loadOlderHistory = vi.fn().mockResolvedValue(undefined);
    render(<Harness hasOlderHistory={true} loadOlderHistory={loadOlderHistory} />);

    observerCallbacks.forEach(cb => cb([{ isIntersecting: false }]));

    await new Promise(resolve => setTimeout(resolve, 0));
    expect(loadOlderHistory).not.toHaveBeenCalled();
  });
});
