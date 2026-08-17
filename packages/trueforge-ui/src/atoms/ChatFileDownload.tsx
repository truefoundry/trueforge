'use client';

import { useState, type MouseEvent } from 'react';

import { Icon } from '../icons/Icon.js';
import { cn } from './lib/cn.js';
import { Spinner } from './primitives/Spinner.js';

export type ChatFileDownloadFile = {
  name: string;
  path: string;
};

export type ChatFileDownloadProps = {
  files: ChatFileDownloadFile[];
  fileDownloadBaseUrl?: string;
  onDownloadArtifact?: (path: string, filename: string) => Promise<void>;
  readOnly?: boolean;
};

export function ChatFileDownload({ files, fileDownloadBaseUrl, onDownloadArtifact, readOnly }: ChatFileDownloadProps) {
  const [downloadingPath, setDownloadingPath] = useState<string | null>(null);

  return (
    <details
      open
      className="aui-sandbox-artifacts group my-2 overflow-hidden rounded-lg border border-primary-button-bg/20 bg-card-bg"
      data-testid="aui-sandbox-artifacts"
    >
      <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 bg-primary-button-bg/5 px-3 py-2 text-xs font-medium leading-none text-primary-button-bg [&::-webkit-details-marker]:hidden">
        <Icon name="chevron-down" size={13} className="shrink-0 transition-transform group-open:rotate-180" />
        <Icon name="file" size={16} className="shrink-0" />
        <span className="leading-none">
          {files.length} {files.length === 1 ? 'file' : 'files'} generated
        </span>
      </summary>

      <div className="flex flex-wrap items-center gap-y-1 px-3 py-2">
        {files.map(({ name, path }) => {
          if (readOnly) {
            return (
              <span
                key={path}
                className="mr-3 inline-flex min-h-7 items-center gap-1.5 border-r border-border pr-3 text-xs text-text-secondary last:mr-0 last:border-r-0 last:pr-0"
              >
                <Icon name="file" size={14} className="shrink-0" />
                <span className="leading-none">{name}</span>
              </span>
            );
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
            setDownloadingPath(path);
            void onDownloadArtifact(path, name).finally(() => {
              setDownloadingPath(current => (current === path ? null : current));
            });
          };

          return (
            <a
              key={path}
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
        })}
      </div>
    </details>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    ChatFileDownload: typeof ChatFileDownload;
  }
}
