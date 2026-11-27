// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AnalyticsProvider } from '@/analytics/AnalyticsProvider.js';
import { AnalyticsEvents } from '@/analytics/events.js';
import { SESSION_ARTIFACTS_RUN_POLL_MS, SessionArtifactsContainer } from '@/containers/SessionArtifactsContainer.js';
import { FilePreviewProvider, useFilePreview } from '@/filePreview/FilePreviewContext.js';
import { ServerProvider } from '@/server/ServerContext.js';
import type { Artifact } from '@/server/types.js';
import { SlotsProvider } from '@/theme/SlotsProvider.js';
import { createMockAgentUIServer, createMockArtifactServer, createMockCatalog } from '../server/mockServer.js';

const runtimeState = vi.hoisted(() => ({ remoteId: 's1' as string | null, isRunning: false }));

vi.mock('@assistant-ui/react', () => ({
  useAuiState: (selector: (state: unknown) => unknown) =>
    selector({
      thread: { isRunning: runtimeState.isRunning, isLoading: false, messages: [] },
      threads: { isLoading: false },
      threadListItem: { id: 't1', remoteId: runtimeState.remoteId },
    }),
}));

const subject = { subjectId: 'user-1', subjectType: 'user', subjectDisplayName: 'alice' };

function artifact(id: string, name: string): Artifact {
  return {
    id,
    name,
    createdBySubject: subject,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-02T00:00:00.000Z',
  };
}

function PreviewProbe() {
  const { target } = useFilePreview();
  return (
    <>
      <output aria-label="Preview target">{target?.name ?? 'none'}</output>
      {/* FilePreviewHost is not mounted here, so reading the file is triggered by hand. */}
      <button type="button" onClick={() => void target?.load()}>
        load preview
      </button>
    </>
  );
}

function renderContainer({
  artifacts,
  track,
}: {
  artifacts: ReturnType<typeof createMockArtifactServer> | undefined;
  track?: (eventName: string, data?: Record<string, string | number | boolean | undefined>) => void;
}) {
  const server = createMockAgentUIServer({
    catalog: createMockCatalog(),
    ...(artifacts === undefined ? {} : { artifacts }),
  });
  return render(
    <SlotsProvider>
      <AnalyticsProvider {...(track === undefined ? {} : { track })}>
        <ServerProvider server={server}>
          <FilePreviewProvider>
            <SessionArtifactsContainer />
            <PreviewProbe />
          </FilePreviewProvider>
        </ServerProvider>
      </AnalyticsProvider>
    </SlotsProvider>,
  );
}

describe('SessionArtifactsContainer', () => {
  beforeEach(() => {
    runtimeState.remoteId = 's1';
    runtimeState.isRunning = false;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('polls the session list while a run is active', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    runtimeState.isRunning = true;
    const listSessionArtifacts = vi.fn(async () => [artifact('a1', 'report.html')]);
    renderContainer({ artifacts: createMockArtifactServer({ listSessionArtifacts }) });

    await waitFor(() => expect(listSessionArtifacts).toHaveBeenCalledTimes(1));
    await act(() => vi.advanceTimersByTimeAsync(SESSION_ARTIFACTS_RUN_POLL_MS));
    expect(listSessionArtifacts.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('does not poll once the run is idle', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const listSessionArtifacts = vi.fn(async () => [artifact('a1', 'report.html')]);
    renderContainer({ artifacts: createMockArtifactServer({ listSessionArtifacts }) });

    await waitFor(() => expect(listSessionArtifacts).toHaveBeenCalledTimes(1));
    await act(() => vi.advanceTimersByTimeAsync(SESSION_ARTIFACTS_RUN_POLL_MS * 2));
    expect(listSessionArtifacts).toHaveBeenCalledTimes(1);
  });

  it('lists the session artifacts and opens a preview from a row', async () => {
    const listSessionArtifacts = vi.fn(async () => [artifact('a1', 'report.html')]);
    const readArtifactFile = vi.fn(async () => new Blob(['<p>hi</p>'], { type: 'text/html' }));
    const track = vi.fn();
    renderContainer({ artifacts: createMockArtifactServer({ listSessionArtifacts, readArtifactFile }), track });

    fireEvent.click(await screen.findByText('report.html'));

    expect(listSessionArtifacts).toHaveBeenCalledWith({ sessionId: 's1' });
    expect(screen.getByLabelText('Preview target')).toHaveTextContent('report.html');
    fireEvent.click(screen.getByRole('button', { name: 'load preview' }));
    expect(readArtifactFile).toHaveBeenCalledWith({ id: 'a1' });
    expect(track).toHaveBeenCalledWith(AnalyticsEvents.Artifact.SESSION_CARD_PREVIEW_OPENED, { artifact_id: 'a1' });
  });

  it('renders nothing when the session has no artifacts', async () => {
    const listSessionArtifacts = vi.fn(async () => []);
    renderContainer({ artifacts: createMockArtifactServer({ listSessionArtifacts }) });

    await waitFor(() => expect(listSessionArtifacts).toHaveBeenCalled());
    expect(screen.queryByLabelText('Session artifacts')).not.toBeInTheDocument();
  });

  it('renders nothing without an artifact server or a stored session', async () => {
    const { unmount } = renderContainer({ artifacts: undefined });
    expect(screen.queryByLabelText('Session artifacts')).not.toBeInTheDocument();
    unmount();

    runtimeState.remoteId = null;
    const listSessionArtifacts = vi.fn(async () => [artifact('a1', 'report.html')]);
    renderContainer({ artifacts: createMockArtifactServer({ listSessionArtifacts }) });
    expect(screen.queryByLabelText('Session artifacts')).not.toBeInTheDocument();
    expect(listSessionArtifacts).not.toHaveBeenCalled();
  });
});
