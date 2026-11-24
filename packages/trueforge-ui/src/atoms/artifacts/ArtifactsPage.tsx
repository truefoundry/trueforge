'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';

import { useTrackAnalytics } from '../../analytics/AnalyticsProvider.js';
import { AnalyticsEvents } from '../../analytics/events.js';
import { FilePreviewHost } from '../../containers/FilePreviewHost.js';
import { useToasterOptional } from '../../containers/ToasterContainer.js';
import { FilePreviewBoundary, useFilePreview } from '../../filePreview/FilePreviewContext.js';
import { useServerQueryClient } from '../../server/queryClient.js';
import { queryKeys } from '../../server/queryKeys.js';
import { useArtifactServer } from '../../server/ServerContext.js';
import { useOptionalShellMode } from '../../server/ShellModeContext.js';
import type { Artifact, ListArtifactsParams } from '../../server/types.js';
import { artifactIdFromRef, artifactRef } from '../../utils/artifactRef.js';
import { getErrorMessage } from '../../utils/getErrorMessage.js';
import { filenameFromPath, triggerBrowserDownload } from '../../utils/triggerBrowserDownload.js';
import { EmptyScreen } from '../EmptyScreen.js';
import { PageHeader } from '../PageHeader.js';
import SearchInput from '../primitives/SearchInput.js';
import { Skeleton } from '../primitives/Skeleton.js';
import { DEFAULT_TABLE_PAGE_SIZE, TableTokenPagination } from '../primitives/Table.js';
import { artifactPreviewKey } from './artifactDisplay.js';
import { ArtifactDeleteDialog, ArtifactEditDialog, artifactMutations } from './ArtifactEditDialog.js';
import { ArtifactScopeFilter, type ArtifactScope } from './ArtifactScopeFilter.js';
import { ArtifactsEmptyState } from './ArtifactsEmptyState.js';
import { ArtifactsTable } from './ArtifactsTable.js';

const PAGE_SIZE_OPTIONS = [10, 25] as const;
const SEARCH_DEBOUNCE_MS = 300;
const EMPTY_ARTIFACTS: Artifact[] = [];

function nonEmptyToken(token: string | undefined): string | undefined {
  return token === undefined || token === '' ? undefined : token;
}

export type ArtifactsPageProps = Record<string, never>;

export function ArtifactsPage(_props: ArtifactsPageProps) {
  return (
    <FilePreviewBoundary>
      <ArtifactsPageBody />
    </FilePreviewBoundary>
  );
}

function ArtifactsPageBody() {
  const artifactServer = useArtifactServer();
  const queryClient = useServerQueryClient();
  const toaster = useToasterOptional();
  const track = useTrackAnalytics();
  const preview = useFilePreview();
  const { close: closePreview, open: openFilePreview } = preview;
  const shell = useOptionalShellMode();
  const setArtifactRef = shell?.setArtifactRef;
  const urlArtifactRef = shell?.artifactRef ?? null;
  // Ref of the artifact whose preview this page opened; keeps URL and preview in step.
  const openedRefRef = useRef<string | null>(null);

  const [searchInput, setSearchInput] = useState('');
  const [name, setName] = useState('');
  const [scope, setScope] = useState<ArtifactScope>('all');
  const [editing, setEditing] = useState<Artifact | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Artifact | null>(null);
  const [pageSize, setPageSize] = useState(DEFAULT_TABLE_PAGE_SIZE);
  const pageScope = JSON.stringify([pageSize, name, scope]);
  const [pageCursor, setPageCursor] = useState<{ scope: string; token: string | undefined }>({
    scope: pageScope,
    token: undefined,
  });
  const pageToken = pageCursor.scope === pageScope ? pageCursor.token : undefined;

  // The preview target outlives this page in a shared provider, so clear it on both ends.
  useEffect(() => {
    closePreview();
    return closePreview;
  }, [closePreview]);

  useEffect(() => {
    const timer = window.setTimeout(() => setName(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const listParams = useMemo(
    (): ListArtifactsParams => ({
      limit: pageSize,
      ...(pageToken === undefined ? {} : { pageToken }),
      ...(name === '' ? {} : { name }),
      scope,
    }),
    [name, pageSize, pageToken, scope],
  );
  const listQuery = useQuery(
    {
      queryKey: queryKeys.artifacts.list(listParams),
      queryFn: () => artifactServer.listArtifacts(listParams),
      placeholderData: keepPreviousData,
    },
    queryClient,
  );

  const artifacts = listQuery.data?.data ?? EMPTY_ARTIFACTS;
  const listSettled = !listQuery.isPlaceholderData;
  const nextPageToken = listSettled ? nonEmptyToken(listQuery.data?.nextPageToken) : undefined;
  const previousPageToken = listSettled ? nonEmptyToken(listQuery.data?.previousPageToken) : undefined;
  const showSkeleton = (listQuery.isPending || listQuery.isPlaceholderData) && artifacts.length === 0;
  const error =
    listQuery.error != null && artifacts.length === 0
      ? getErrorMessage(listQuery.error, 'Check your connection and try again.')
      : null;

  const openPreview = useCallback(
    (artifact: Artifact) => {
      const { entryPoint, id } = artifact;
      if (entryPoint == null) return;
      track(AnalyticsEvents.Artifact.PREVIEW_OPENED, { artifact_id: id });
      const ref = artifactRef(artifact);
      openedRefRef.current = ref;
      setArtifactRef?.(ref);
      openFilePreview({
        name: artifact.name,
        path: entryPoint,
        turnId: artifactPreviewKey(artifact),
        load: () => artifactServer.readArtifactFile({ id }),
      });
    },
    [artifactServer, openFilePreview, setArtifactRef, track],
  );

  // URL -> preview: deep link, or back to the list.
  useEffect(() => {
    if (urlArtifactRef == null) {
      if (openedRefRef.current != null) {
        openedRefRef.current = null;
        closePreview();
      }
      return;
    }
    if (urlArtifactRef === openedRefRef.current) return;
    let cancelled = false;
    void artifactServer
      .getArtifact({ id: artifactIdFromRef(urlArtifactRef) })
      .then(artifact => {
        if (!cancelled) openPreview(artifact);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        toaster?.showError(caught);
        setArtifactRef?.(null);
      });
    return () => {
      cancelled = true;
    };
  }, [urlArtifactRef, artifactServer, openPreview, closePreview, setArtifactRef, toaster]);

  // Preview -> URL: closing the panel returns to the list URL.
  const previewOpen = preview.target != null;
  useEffect(() => {
    if (!previewOpen && openedRefRef.current != null) {
      openedRefRef.current = null;
      setArtifactRef?.(null);
    }
  }, [previewOpen, setArtifactRef]);

  const { saveName, deleteArtifact } = artifactMutations({
    artifactServer,
    queryClient,
    toaster,
    track,
    previewTurnId: preview.target?.turnId,
    closePreview,
    setArtifactRef,
    openedRef: openedRefRef,
  });

  const downloadArtifact = async (artifact: Artifact) => {
    if (artifact.entryPoint == null) return;
    try {
      const blob = await artifactServer.readArtifactFile({ id: artifact.id });
      triggerBrowserDownload(blob, filenameFromPath(artifact.entryPoint));
      track(AnalyticsEvents.Artifact.DOWNLOADED, { artifact_id: artifact.id });
    } catch (caught) {
      toaster?.showError(caught);
    }
  };

  const hasPageNav = nextPageToken != null || previousPageToken != null || artifacts.length > 0;

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-primary-bg">
      <PageHeader
        title="Artifacts"
        end={
          <div className="flex items-center gap-2">
            <div className="w-64">
              <SearchInput query={searchInput} setQuery={setSearchInput} placeholder="Search artifacts by name" />
            </div>
            <ArtifactScopeFilter scope={scope} onChange={setScope} />
          </div>
        }
      />
      <div data-slot="aui_file-preview-row" className="flex min-h-0 w-full min-w-0 flex-1">
        <div className="min-h-0 min-w-0 flex-1 overflow-auto px-4 py-4">
          {error != null ? (
            <div role="alert" className="flex h-full flex-col items-center justify-center">
              <EmptyScreen
                title="Couldn't load artifacts"
                description={error}
                className="h-auto min-h-0 flex-none py-0"
              />
            </div>
          ) : showSkeleton ? (
            <div className="flex flex-col gap-2" role="status" aria-label="Loading artifacts">
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="h-12 w-full rounded-md" />
              ))}
            </div>
          ) : artifacts.length === 0 ? (
            <ArtifactsEmptyState title={name} scope={scope} />
          ) : (
            <div className="overflow-hidden rounded-lg border border-border">
              <ArtifactsTable
                artifacts={artifacts}
                selectedKey={preview.target?.turnId}
                onOpen={openPreview}
                onDownload={artifact => void downloadArtifact(artifact)}
                onEdit={setEditing}
                onDelete={setPendingDelete}
                onShare={artifact => track(AnalyticsEvents.Artifact.SHARE_OPENED, { artifact_id: artifact.id })}
              />
              {hasPageNav ? (
                <TableTokenPagination
                  pageSize={pageSize}
                  rowCount={artifacts.length}
                  canPrev={previousPageToken != null}
                  canNext={nextPageToken != null}
                  onPrev={() => setPageCursor({ scope: pageScope, token: previousPageToken })}
                  onNext={() => {
                    if (nextPageToken != null) setPageCursor({ scope: pageScope, token: nextPageToken });
                  }}
                  pageSizeOptions={PAGE_SIZE_OPTIONS}
                  onPageSizeChange={setPageSize}
                />
              ) : null}
            </div>
          )}
        </div>
        <FilePreviewHost />
      </div>
      {editing != null ? (
        <ArtifactEditDialog
          artifact={editing}
          onCancel={() => setEditing(null)}
          onSave={next => {
            if (editing == null) return;
            void saveName({ artifact: editing, name: next }).then(saved => {
              if (saved) setEditing(null);
            });
          }}
        />
      ) : null}
      {pendingDelete != null ? (
        <ArtifactDeleteDialog
          artifact={pendingDelete}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            if (pendingDelete == null) return;
            const target = pendingDelete;
            setPendingDelete(null);
            void deleteArtifact(target);
          }}
        />
      ) : null}
    </div>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    ArtifactsPage: ComponentType<ArtifactsPageProps>;
  }
}
