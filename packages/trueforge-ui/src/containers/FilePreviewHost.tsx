'use client';

import { useAuiState } from '@assistant-ui/react';
import { Suspense, useLayoutEffect, useState } from 'react';

import { useTrackAnalytics } from '../analytics/AnalyticsProvider.js';
import { AnalyticsEvents } from '../analytics/events.js';
import { useCompactLayout } from '../atoms/lib/CompactLayoutContext.js';
import { useIsMobile } from '../atoms/lib/useIsMobile.js';
import { useFilePreview } from '../filePreview/FilePreviewContext.js';
import { clampPreviewWidth, defaultPreviewWidth } from '../filePreview/previewPaneWidth.js';
import { useLoadedFilePreview } from '../filePreview/useLoadedFilePreview.js';
import { useOptionalArtifactServer } from '../server/ServerContext.js';
import { useSlot } from '../theme/SlotsProvider.js';
import { filenameFromPath, triggerBrowserDownload } from '../utils/triggerBrowserDownload.js';
import { useToasterOptional } from './ToasterContainer.js';

const PREVIEW_WIDTH_KEY = 'trueforge.file-preview-width';

function readStoredPreviewWidth(): number | null {
  try {
    const raw = sessionStorage.getItem(PREVIEW_WIDTH_KEY);
    if (raw == null) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function storePreviewWidth(widthPx: number) {
  try {
    sessionStorage.setItem(PREVIEW_WIDTH_KEY, String(Math.round(widthPx)));
  } catch {
    // Private browsing can reject storage. The width still applies for this view.
  }
}

/** Side pane, or a preview that fills the chat column without covering the app sidebar. */
export function FilePreviewHost() {
  const preview = useFilePreview();
  const FilePreviewPanel = useSlot('FilePreviewPanel');
  const PublishArtifactDialog = useSlot('PublishArtifactDialog');
  const artifacts = useOptionalArtifactServer();
  const remoteId = useAuiState(state => state.threadListItem.remoteId);
  const track = useTrackAnalytics();
  const compact = useCompactLayout();
  const isMobile = useIsMobile();
  const toaster = useToasterOptional();
  const [reloadToken, setReloadToken] = useState(0);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [widthPx, setWidthPx] = useState<number | null>(readStoredPreviewWidth);
  const loaded = useLoadedFilePreview(preview.target, reloadToken);
  const target = preview.target;
  const sessionId = remoteId ?? null;
  const canPublish =
    artifacts != null &&
    sessionId != null &&
    target != null &&
    (loaded.view.status === 'html' || loaded.view.status === 'markdown');
  const placement = preview.presentation === 'full' ? 'full' : compact || isMobile ? 'overlay' : 'side';

  useLayoutEffect(() => {
    if (target == null || placement !== 'side') return;
    const rowWidth = document.querySelector('[data-slot="aui_file-preview-row"]')?.getBoundingClientRect().width ?? 0;
    if (rowWidth <= 0) return;
    const next = widthPx == null ? defaultPreviewWidth(rowWidth) : clampPreviewWidth({ requested: widthPx, rowWidth });
    if (widthPx == null || Math.abs(next - widthPx) > 1) setWidthPx(next);
  }, [placement, target, widthPx]);

  if (target == null) return null;
  const canRetry = loaded.view.status === 'error';

  const handleDownload = () => {
    if (downloadBusy) return;
    setDownloadBusy(true);
    void (async () => {
      try {
        const blob = loaded.blob ?? (await target.load());
        triggerBrowserDownload(blob, filenameFromPath(target.path));
      } catch (error) {
        if (toaster != null) toaster.showError(error);
        else console.error('Failed to download sandbox file', error);
      } finally {
        setDownloadBusy(false);
      }
    })();
  };

  return (
    <>
      <FilePreviewPanel
        name={target.name}
        placement={placement}
        view={loaded.view}
        onClose={preview.close}
        onDownload={handleDownload}
        onEnterFullPage={() => preview.setPresentation('full')}
        onExitFullPage={() => preview.setPresentation('panel')}
        downloadBusy={downloadBusy}
        {...(canPublish
          ? {
              onPublish: () => {
                track(AnalyticsEvents.Artifact.PUBLISH_DIALOG_OPENED);
                setPublishOpen(true);
              },
            }
          : {})}
        {...(placement === 'side' && widthPx != null ? { widthPx } : {})}
        {...(placement === 'side'
          ? {
              onWidthChange: (next: number) => {
                setWidthPx(next);
                storePreviewWidth(next);
              },
            }
          : {})}
        {...(canRetry ? { onRetry: () => setReloadToken(token => token + 1) } : {})}
      />
      {canPublish ? (
        <Suspense fallback={null}>
          <PublishArtifactDialog
            open={publishOpen}
            onOpenChange={setPublishOpen}
            sessionId={sessionId}
            turnId={target.turnId}
            entryPath={target.path}
            suggestedTitle={target.name}
          />
        </Suspense>
      ) : null}
    </>
  );
}
