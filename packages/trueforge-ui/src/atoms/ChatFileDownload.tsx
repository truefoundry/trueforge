'use client';

import { useMemo, useState, type MouseEvent } from 'react';

import {
  useFilePreviewLoader,
  useFilePreviewTurnId,
  useOptionalFilePreview,
  type SandboxFilePreviewTarget,
} from '../filePreview/FilePreviewContext.js';
import { inlinePreviewKind } from '../filePreview/readFilePreview.js';
import { useLoadedFilePreview } from '../filePreview/useLoadedFilePreview.js';
import { Icon } from '../icons/Icon.js';
import { InlineFilePreviewCard } from './InlineFilePreviewCard.js';
import { cn } from './lib/cn.js';
import { Spinner } from './primitives/Spinner.js';
import { Tooltip } from './primitives/Tooltip.js';

export type ChatFileDownloadFile = {
  name: string;
  path: string;
};

export type ChatFileDownloadProps = {
  files: ChatFileDownloadFile[];
  fileDownloadBaseUrl?: string;
  onDownloadArtifact?: (path: string, filename: string) => Promise<void>;
  readOnly?: boolean;
  /** Shown on hover when `readOnly` is true. */
  readOnlyTooltip?: string;
};

export function ChatFileDownload({
  files,
  fileDownloadBaseUrl,
  onDownloadArtifact,
  readOnly,
  readOnlyTooltip,
}: ChatFileDownloadProps) {
  const [downloadingPath, setDownloadingPath] = useState<string | null>(null);
  const preview = useOptionalFilePreview();
  const previewTurnId = useFilePreviewTurnId();
  const loadPreviewFile = useFilePreviewLoader();
  const canPreview = preview != null && previewTurnId != null && loadPreviewFile != null && readOnly !== true;
  const visualFiles = canPreview ? files.filter(file => inlinePreviewKind(file) != null) : [];
  const chipFiles = canPreview ? files.filter(file => inlinePreviewKind(file) == null) : files;

  const startDownload = ({ path, name }: { path: string; name: string }) => {
    if (!onDownloadArtifact || downloadingPath === path) return;
    setDownloadingPath(path);
    void onDownloadArtifact(path, name).finally(() => {
      setDownloadingPath(current => (current === path ? null : current));
    });
  };

  const chips =
    chipFiles.length === 0 ? null : (
      <details
        open
        className={cn(
          'aui-sandbox-artifacts group overflow-hidden rounded-lg border border-primary-button-bg/20 bg-card-bg',
          visualFiles.length === 0 && 'my-2',
        )}
        data-testid="aui-sandbox-artifacts"
      >
        <summary className="min-h-9 cursor-pointer list-none bg-primary-button-bg/5 px-3 py-2 text-xs font-medium leading-none text-primary-button-bg [&::-webkit-details-marker]:hidden">
          <span className="inline-flex items-center gap-1">
            <Icon name="chevron-down" size={13} className="shrink-0 transition-transform group-open:rotate-180" />
            <Icon name="file" size={16} className="shrink-0" />
            <span className="leading-none">
              {chipFiles.length} {chipFiles.length === 1 ? 'file' : 'files'} generated
            </span>
          </span>
        </summary>

        <div className="flex flex-wrap items-center gap-y-1 px-3 py-2">
          {chipFiles.map(file => (
            <ArtifactChip
              key={file.path}
              file={file}
              downloadingPath={downloadingPath}
              onStartDownload={startDownload}
              {...(fileDownloadBaseUrl != null ? { fileDownloadBaseUrl } : {})}
              {...(onDownloadArtifact != null ? { onDownloadArtifact } : {})}
              {...(readOnly != null ? { readOnly } : {})}
              {...(readOnlyTooltip != null ? { readOnlyTooltip } : {})}
              {...(preview != null ? { preview } : {})}
              {...(previewTurnId != null ? { previewTurnId } : {})}
              {...(loadPreviewFile != null ? { loadPreviewFile } : {})}
              canPreview={canPreview}
            />
          ))}
        </div>
      </details>
    );

  if (visualFiles.length === 0 || preview == null || previewTurnId == null) return chips;

  return (
    <div className="my-2 flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {visualFiles.map(file => {
          const href = fileDownloadBaseUrl ? `${fileDownloadBaseUrl}${file.path}` : undefined;
          return (
            <VisualSandboxFile
              key={file.path}
              name={file.name}
              path={file.path}
              turnId={previewTurnId}
              enlarged={preview.target?.path === file.path && preview.target.turnId === previewTurnId}
              onEnlarge={() => {
                const loadFile = loadPreviewFile;
                if (loadFile == null) return;
                preview.open({
                  name: file.name,
                  path: file.path,
                  turnId: previewTurnId,
                  load: () => loadFile(file.path),
                });
              }}
              downloadBusy={downloadingPath === file.path}
              {...(onDownloadArtifact != null
                ? { onDownload: () => startDownload({ path: file.path, name: file.name }) }
                : {})}
              {...(href != null ? { downloadHref: href } : {})}
            />
          );
        })}
      </div>
      {chips}
    </div>
  );
}

function VisualSandboxFile({
  name,
  path,
  turnId,
  enlarged,
  onEnlarge,
  onDownload,
  downloadHref,
  downloadBusy,
}: {
  name: string;
  path: string;
  turnId: string;
  enlarged: boolean;
  onEnlarge: () => void;
  onDownload?: () => void;
  downloadHref?: string;
  downloadBusy: boolean;
}) {
  const loadFile = useFilePreviewLoader();
  const target = useMemo((): SandboxFilePreviewTarget | null => {
    if (loadFile == null) return null;
    return { name, path, turnId, load: () => loadFile(path) };
  }, [loadFile, name, path, turnId]);
  const loaded = useLoadedFilePreview(target, 0);

  return (
    <InlineFilePreviewCard
      name={name}
      view={loaded.view}
      enlarged={enlarged}
      onEnlarge={onEnlarge}
      downloadBusy={downloadBusy}
      {...(onDownload != null ? { onDownload } : {})}
      {...(downloadHref != null ? { downloadHref } : {})}
    />
  );
}

function ArtifactChip({
  file,
  downloadingPath,
  onStartDownload,
  fileDownloadBaseUrl,
  onDownloadArtifact,
  readOnly,
  readOnlyTooltip,
  preview,
  previewTurnId,
  loadPreviewFile,
  canPreview,
}: {
  file: ChatFileDownloadFile;
  downloadingPath: string | null;
  onStartDownload: (file: { path: string; name: string }) => void;
  fileDownloadBaseUrl?: string;
  onDownloadArtifact?: (path: string, filename: string) => Promise<void>;
  readOnly?: boolean;
  readOnlyTooltip?: string;
  preview?: ReturnType<typeof useOptionalFilePreview>;
  previewTurnId?: string;
  loadPreviewFile?: ((path: string) => Promise<Blob>) | null;
  canPreview: boolean;
}) {
  const { name, path } = file;

  if (readOnly) {
    const itemClassName =
      'mr-3 inline-flex min-h-7 items-center gap-1.5 border-r border-border pr-3 text-xs text-text-secondary last:mr-0 last:border-r-0 last:pr-0';
    const label = (
      <>
        <Icon name="file" size={14} className="shrink-0" />
        <span className="leading-none">{name}</span>
      </>
    );
    if (readOnlyTooltip) {
      return (
        <Tooltip content={readOnlyTooltip} triggerClassName={itemClassName}>
          <span className="inline-flex items-center gap-1.5">{label}</span>
        </Tooltip>
      );
    }
    return <span className={itemClassName}>{label}</span>;
  }

  const href = fileDownloadBaseUrl ? `${fileDownloadBaseUrl}${path}` : undefined;
  const canDownload = Boolean(onDownloadArtifact || href);
  const isDownloading = downloadingPath === path;

  const handleClick = (event: MouseEvent) => {
    if (!onDownloadArtifact || isDownloading) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    onStartDownload({ path, name });
  };

  if (canPreview && preview != null && previewTurnId != null && loadPreviewFile != null) {
    const previewing = preview.target?.path === path && preview.target.turnId === previewTurnId;
    const openPreview = () => {
      const loadFile = loadPreviewFile;
      preview.open({
        name,
        path,
        turnId: previewTurnId,
        load: () => loadFile(path),
      });
    };

    return (
      <span
        className={cn(
          'mr-3 inline-flex min-h-7 items-center gap-1 border-r border-border pr-3 last:mr-0 last:border-r-0 last:pr-0',
          previewing && 'rounded-md bg-primary-button-bg/10',
        )}
      >
        <button
          type="button"
          onClick={openPreview}
          aria-pressed={previewing}
          title={`Preview ${name}`}
          aria-label={`Preview ${name}`}
          className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-text-primary hover:text-primary-button-bg"
        >
          <Icon name="file" size={14} className="shrink-0 text-text-secondary" />
          <span className="leading-none">{name}</span>
        </button>
        {canDownload ? (
          onDownloadArtifact ? (
            <button
              type="button"
              onClick={() => onStartDownload({ path, name })}
              disabled={isDownloading}
              aria-busy={isDownloading || undefined}
              aria-label={isDownloading ? `Downloading ${name}` : `Download ${name}`}
              title={isDownloading ? `Downloading ${name}` : `Download ${name}`}
              className={cn(
                'inline-flex items-center text-primary-button-bg',
                isDownloading ? 'cursor-progress' : 'cursor-pointer hover:text-primary-button-bg',
              )}
            >
              {isDownloading ? <Spinner size={14} /> : <Icon name="download" size={14} />}
            </button>
          ) : (
            <a
              href={href}
              download={name}
              aria-label={`Download ${name}`}
              title={`Download ${name}`}
              className="inline-flex items-center text-primary-button-bg hover:text-primary-button-bg"
            >
              <Icon name="download" size={14} />
            </a>
          )
        ) : null}
      </span>
    );
  }

  return (
    <a
      href={canDownload ? (href ?? '#') : undefined}
      onClick={onDownloadArtifact ? handleClick : undefined}
      aria-busy={isDownloading || undefined}
      className={cn(
        'mr-3 inline-flex min-h-7 items-center gap-1.5 border-r border-border pr-3 text-xs text-text-primary last:mr-0 last:border-r-0 last:pr-0',
        canDownload && !isDownloading && 'cursor-pointer hover:text-primary-button-bg',
        (isDownloading || !canDownload) && 'pointer-events-none opacity-60',
      )}
      download={name}
      aria-label={isDownloading ? `Downloading ${name}` : `Download ${name}`}
    >
      <Icon name="file" size={14} className="shrink-0 text-text-secondary" />
      <span className="leading-none">{name}</span>
      {isDownloading ? (
        <Spinner size={14} className="shrink-0 text-primary-button-bg" />
      ) : (
        <Icon name="download" size={14} className="shrink-0 text-primary-button-bg" />
      )}
    </a>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    ChatFileDownload: typeof ChatFileDownload;
  }
}
