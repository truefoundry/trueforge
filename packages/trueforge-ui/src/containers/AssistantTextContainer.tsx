'use client';

import {
  useAuiState,
  useSmooth,
  type MessagePartState,
  type ReasoningMessagePart,
  type TextMessagePart,
} from '@assistant-ui/react';
import { useTrueForgeDownloadSandboxFile, useTrueForgeTurnId } from '@truefoundry/trueforge-assistant-ui-runtime';
import { useCallback, useMemo, useRef } from 'react';

import { FilePreviewLoaderScope, FilePreviewTurnScope } from '../filePreview/FilePreviewContext.js';
import { MARKDOWN_SMOOTH_BACKLOG_CHARS, useThrottledMarkdownText } from '../hooks/useThrottledMarkdownText.js';
import { useSlot } from '../theme/SlotsProvider.js';
import { filenameFromPath, triggerBrowserDownload } from '../utils/triggerBrowserDownload.js';
import { useToasterOptional } from './ToasterContainer.js';

export function AssistantTextContainer() {
  const Markdown = useSlot('Markdown');
  const toaster = useToasterOptional();
  const downloadSandboxFile = useTrueForgeDownloadSandboxFile();
  // The download closure changes as the turn streams; a ref keeps onDownloadArtifact stable so
  // OpenUI does not remount.
  const downloadRef = useRef({ downloadSandboxFile, toaster });
  downloadRef.current = { downloadSandboxFile, toaster };
  const turnId = useTrueForgeTurnId();
  const loadSandboxFile = useCallback((path: string) => downloadRef.current.downloadSandboxFile(path), []);
  const partState = useAuiState(s => s.part as MessagePartState & (TextMessagePart | ReasoningMessagePart));

  // Preserve the typewriter effect while it keeps pace. If its visible prefix falls too far
  // behind the raw stream, latch this part into bounded latest-prefix snapshots instead of
  // animating an ever-growing queue. We intentionally do not re-enable useSmooth for this part:
  // its private cursor still points at the old prefix and could visibly rewind the message.
  const pacedModeRef = useRef(false);
  const smoothedPart = useSmooth(
    partState,
    pacedModeRef.current
      ? false
      : {
          drainMs: 150,
          maxCharIntervalMs: 4,
          maxCharsPerFrame: 128,
          minCommitMs: 48,
        },
  );

  const networkComplete = partState.status?.type !== 'running';
  const smoothLag = partState.text.length - smoothedPart.text.length;
  if (!pacedModeRef.current && !networkComplete && smoothLag >= MARKDOWN_SMOOTH_BACKLOG_CHARS) {
    pacedModeRef.current = true;
  }
  const usePacedMode = pacedModeRef.current;

  const pacedText = useThrottledMarkdownText(partState.text, {
    enabled: usePacedMode,
    isComplete: networkComplete,
  });

  const text = usePacedMode ? pacedText : smoothedPart.text;
  // true while network stream is active OR while reveal/paced commit is still catching up
  const isStreaming = usePacedMode
    ? !networkComplete || text !== partState.text
    : smoothedPart.status?.type === 'running';

  const handleDownloadArtifact = useCallback(async (path: string) => {
    const { downloadSandboxFile, toaster } = downloadRef.current;
    try {
      triggerBrowserDownload(await downloadSandboxFile(path), filenameFromPath(path));
    } catch (error) {
      if (toaster != null) {
        toaster.showError(error);
      } else {
        console.error('Failed to download sandbox artifact', error);
      }
    }
  }, []);

  // Skip markdown re-parse when a raw SSE tick did not advance the committed display text.
  const markdown = useMemo(
    () => <Markdown content={text} isStreaming={isStreaming} onDownloadArtifact={handleDownloadArtifact} />,
    [Markdown, text, isStreaming, handleDownloadArtifact],
  );

  if (turnId == null) return markdown;

  return (
    <FilePreviewTurnScope turnId={turnId}>
      <FilePreviewLoaderScope load={loadSandboxFile}>{markdown}</FilePreviewLoaderScope>
    </FilePreviewTurnScope>
  );
}
