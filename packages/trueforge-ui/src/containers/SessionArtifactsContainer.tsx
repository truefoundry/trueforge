'use client';

import { skipToken, useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { useTrackAnalytics } from '../analytics/AnalyticsProvider.js';
import { AnalyticsEvents } from '../analytics/events.js';
import { useAuiState } from '../assistant-ui.js';
import { artifactPreviewTarget } from '../atoms/artifacts/artifactDisplay.js';
import { useFilePreview } from '../filePreview/FilePreviewContext.js';
import { useServerQueryClient } from '../server/queryClient.js';
import { queryKeys } from '../server/queryKeys.js';
import { useOptionalArtifactServer } from '../server/ServerContext.js';
import type { Artifact } from '../server/types.js';
import { useSlot } from '../theme/SlotsProvider.js';

/** Width of the card column (card plus its padding). The composer uses the same inset so it sits under the chat. */
export const SESSION_ARTIFACTS_COLUMN_INSET_CLASS = 'lg:pr-[20rem]';

/** The backend writes artifacts mid-run and the stream has no artifact event, so the list is polled while a run is active. */
export const SESSION_ARTIFACTS_RUN_POLL_MS = 5000;

function useSessionArtifactsQuery() {
  const artifactServer = useOptionalArtifactServer();
  const sessionId = useAuiState(state => state.threadListItem.remoteId);
  const isRunning = useAuiState(state => state.thread.isRunning);
  const queryClient = useServerQueryClient();
  const query = useQuery(
    {
      queryKey: queryKeys.artifacts.session(sessionId ?? ''),
      queryFn:
        artifactServer == null || sessionId == null || sessionId === ''
          ? skipToken
          : () => artifactServer.listSessionArtifacts({ sessionId }),
      refetchInterval: isRunning ? SESSION_ARTIFACTS_RUN_POLL_MS : false,
    },
    queryClient,
  );
  return { artifactServer, sessionId: sessionId ?? null, artifacts: query.data };
}

/** True when the active session has artifacts, so the composer leaves room for the card column. */
export function useSessionArtifactsVisible(): boolean {
  return (useSessionArtifactsQuery().artifacts?.length ?? 0) > 0;
}

/** Card listing the artifacts the active session produced; renders nothing when there are none. */
export function SessionArtifactsContainer() {
  const SessionArtifactsCard = useSlot('SessionArtifactsCard');
  const queryClient = useServerQueryClient();
  const track = useTrackAnalytics();
  const preview = useFilePreview();
  const { open: openFilePreview } = preview;
  const isRunning = useAuiState(state => state.thread.isRunning);
  const { artifactServer, sessionId, artifacts } = useSessionArtifactsQuery();

  // A turn can create artifacts, so the list is refreshed when the run ends rather than on every stream tick.
  const wasRunning = useRef(isRunning);
  useEffect(() => {
    if (wasRunning.current && !isRunning && sessionId != null) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.artifacts.session(sessionId) });
    }
    wasRunning.current = isRunning;
  }, [isRunning, queryClient, sessionId]);

  if (artifactServer == null || artifacts == null || artifacts.length === 0) return null;

  const openArtifact = (artifact: Artifact) => {
    track(AnalyticsEvents.Artifact.SESSION_CARD_PREVIEW_OPENED, { artifact_id: artifact.id });
    openFilePreview(artifactPreviewTarget({ artifact, artifactServer }));
  };

  // Rendered inside the thread scroll root, beside the messages: the messages shift left and the
  // card stays pinned while the chat scrolls, with the scrollbar after it.
  return (
    <div className="sticky top-0 hidden shrink-0 self-start p-4 lg:block">
      <SessionArtifactsCard
        artifacts={artifacts}
        selectedKey={preview.target?.turnId}
        onOpen={openArtifact}
        onShowMore={() => track(AnalyticsEvents.Artifact.SESSION_CARD_SHOW_MORE)}
      />
    </div>
  );
}
