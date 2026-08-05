'use client';

import {
  useAuiState,
  useSmooth,
  type MessagePartState,
  type ReasoningMessagePart,
  type TextMessagePart,
} from '@assistant-ui/react';
import { useTrueFoundryDownloadSandboxFile } from '@truefoundry/assistant-ui-runtime';
import { useCallback, useRef } from 'react';

import { useSlot } from '../theme/SlotsProvider.js';
import { useErrorToasterOptional } from './ErrorToasterContainer.js';

function filenameFromPath(path: string): string {
  return path.split('/').pop() || 'download';
}

function triggerBrowserDownload(blob: Blob, filename: string) {
  if (typeof document === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function AssistantTextContainer() {
  const Markdown = useSlot('Markdown');
  // Runtime download fn is unstable; refs keep onDownloadArtifact stable so OpenUI doesn't remount.
  const downloadSandboxFile = useTrueFoundryDownloadSandboxFile();
  const errorToaster = useErrorToasterOptional();
  const downloadSandboxFileRef = useRef(downloadSandboxFile);
  const errorToasterRef = useRef(errorToaster);
  downloadSandboxFileRef.current = downloadSandboxFile;
  errorToasterRef.current = errorToaster;
  const partState = useAuiState(s => s.part as MessagePartState & (TextMessagePart | ReasoningMessagePart));
  const smoothedPart = useSmooth(partState, {
    drainMs: 300,
    maxCharIntervalMs: 6,
    maxCharsPerFrame: 32,
    minCommitMs: 48,
  });
  const text = smoothedPart.text;
  // true while network stream is active OR while reveal is still catching up
  const isStreaming = smoothedPart.status?.type === 'running';
  const handleDownloadArtifact = useCallback(
    (path: string) =>
      downloadSandboxFileRef
        .current(path)
        .then(blob => triggerBrowserDownload(blob, filenameFromPath(path)))
        .catch(error => {
          const toaster = errorToasterRef.current;
          if (toaster != null) {
            toaster.showError(error);
          } else {
            console.error('Failed to download sandbox artifact', error);
          }
        }),
    [],
  );

  return <Markdown content={text} isStreaming={isStreaming} onDownloadArtifact={handleDownloadArtifact} />;
}
