'use client';

import { Icon } from '../icons/Icon.js';
import type { FilePreviewView } from './FilePreviewPanel.js';
import { auiButtonClass } from './lib/buttonClasses.js';
import { cn } from './lib/cn.js';
import { Spinner } from './primitives/Spinner.js';

export type InlineFilePreviewCardProps = {
  name: string;
  view: FilePreviewView;
  enlarged: boolean;
  onEnlarge: () => void;
  onDownload?: () => void;
  downloadHref?: string;
  downloadBusy?: boolean;
};

function Thumbnail({ name, view }: { name: string; view: FilePreviewView }) {
  if (view.status === 'loading') {
    return (
      <div className="flex aspect-video items-center justify-center bg-primary-bg text-text-secondary">
        <Spinner size={16} />
      </div>
    );
  }

  if (view.status === 'error' || view.status === 'unavailable') {
    return (
      <div className="flex aspect-video items-center justify-center bg-primary-bg px-4 text-center text-xs text-text-secondary">
        {view.message}
      </div>
    );
  }

  if (view.status === 'html') {
    return (
      <div className="@container relative aspect-video overflow-hidden bg-white">
        <iframe
          title={`Thumbnail of ${name}`}
          // Scripts paint the page. Forms and popups stay off so a card cannot leave the thread on its own.
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          srcDoc={view.text}
          tabIndex={-1}
          // Desktop-sized frame, scaled into the card so the page lays out as it will when enlarged.
          style={{ width: '80rem', height: '45rem', transform: 'scale(calc(100cqw / 80rem))' }}
          className="pointer-events-none absolute top-0 left-0 origin-top-left border-0"
        />
      </div>
    );
  }

  if (view.status === 'media' && view.media === 'image') {
    return (
      <div className="aspect-video overflow-hidden bg-primary-bg">
        <img src={view.objectUrl} alt="" className="h-full w-full object-cover object-top" />
      </div>
    );
  }

  if (view.status === 'media' && view.media === 'pdf') {
    return (
      <iframe
        title={`Thumbnail of ${name}`}
        src={view.objectUrl}
        tabIndex={-1}
        className="pointer-events-none aspect-video w-full border-0 bg-white"
      />
    );
  }

  return (
    <div className="flex aspect-video items-center justify-center bg-primary-bg px-4 text-center text-xs text-text-secondary">
      Open the preview to read this file.
    </div>
  );
}

function DownloadControl({
  name,
  onDownload,
  downloadHref,
  downloadBusy,
}: {
  name: string;
  onDownload?: () => void;
  downloadHref?: string;
  downloadBusy: boolean;
}) {
  const className = auiButtonClass({ variant: 'ghost', size: 'icon', className: 'h-7 w-7' });
  const label = downloadBusy ? `Downloading ${name}` : `Download ${name}`;
  const icon = downloadBusy ? <Spinner size={14} /> : <Icon name="download" size={14} />;

  if (onDownload != null) {
    return (
      <button
        type="button"
        onClick={onDownload}
        disabled={downloadBusy}
        aria-busy={downloadBusy || undefined}
        aria-label={label}
        title="Download"
        className={className}
      >
        {icon}
      </button>
    );
  }

  if (downloadHref == null) return null;
  return (
    <a href={downloadHref} download={name} aria-label={label} title="Download" className={className}>
      {icon}
    </a>
  );
}

/** Thumbnail of a generated page or image, with enlarge and download controls. */
export function InlineFilePreviewCard({
  name,
  view,
  enlarged,
  onEnlarge,
  onDownload,
  downloadHref,
  downloadBusy = false,
}: InlineFilePreviewCardProps) {
  return (
    <article
      data-slot="aui_inline-file-preview"
      className={cn(
        'w-full max-w-80 overflow-hidden rounded-lg border bg-card-bg shadow-sm',
        enlarged ? 'border-primary-button-bg' : 'border-border',
      )}
    >
      <button
        type="button"
        onClick={onEnlarge}
        aria-pressed={enlarged}
        aria-label={`Enlarge preview of ${name}`}
        className="block w-full cursor-pointer text-left"
      >
        <Thumbnail name={name} view={view} />
      </button>
      <footer className="flex items-center gap-1 border-t border-border px-2.5 py-1.5">
        <span className="min-w-0 flex-1 truncate text-sm text-text-primary">{name}</span>
        <button
          type="button"
          onClick={onEnlarge}
          aria-pressed={enlarged}
          aria-label={`Enlarge ${name}`}
          title="Enlarge preview"
          className={auiButtonClass({ variant: 'ghost', size: 'icon', className: 'h-7 w-7' })}
        >
          <Icon name="expand" size={14} />
        </button>
        <DownloadControl
          name={name}
          downloadBusy={downloadBusy}
          {...(onDownload != null ? { onDownload } : {})}
          {...(downloadHref != null ? { downloadHref } : {})}
        />
      </footer>
    </article>
  );
}
