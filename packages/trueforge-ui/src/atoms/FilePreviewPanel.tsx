'use client';

import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';

import { clampPreviewWidth } from '../filePreview/previewPaneWidth.js';
import { FILE_PREVIEW_HIGHLIGHT_CHAR_LIMIT, type ReadFilePreviewResult } from '../filePreview/readFilePreview.js';
import { Icon } from '../icons/Icon.js';
import { useSlot } from '../theme/SlotsProvider.js';
import { auiButtonClass } from './lib/buttonClasses.js';
import { cn } from './lib/cn.js';
import { Spinner } from './primitives/Spinner.js';

export type FilePreviewView =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | Exclude<ReadFilePreviewResult, { status: 'media' }>
  | { status: 'media'; media: 'image' | 'pdf'; objectUrl: string };

export type FilePreviewPanelProps = {
  name: string;
  placement: 'side' | 'overlay' | 'full';
  view: FilePreviewView;
  onClose: () => void;
  onDownload: () => void;
  onEnterFullPage?: () => void;
  onExitFullPage?: () => void;
  onRetry?: () => void;
  downloadBusy?: boolean;
  /** Side-pane width in CSS pixels. Overlay and full-page placement ignore this. */
  widthPx?: number;
  onWidthChange?: (widthPx: number) => void;
};

function PreviewBody({ name, view }: { name: string; view: FilePreviewView }) {
  const SyntaxHighlighter = useSlot('SyntaxHighlighter');
  const Markdown = useSlot('Markdown');

  if (view.status === 'loading') {
    return (
      <div className="flex h-full items-center justify-center text-text-secondary">
        <Spinner size={20} />
      </div>
    );
  }

  if (view.status === 'error' || view.status === 'unavailable') {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-text-secondary">
        {view.message}
      </div>
    );
  }

  if (view.status === 'media') {
    if (view.media === 'image') {
      return (
        <div className="flex h-full items-center justify-center p-4">
          <img src={view.objectUrl} alt={name} className="max-h-full max-w-full object-contain" />
        </div>
      );
    }
    return <iframe title={name} src={view.objectUrl} className="absolute inset-0 h-full w-full border-0" />;
  }

  if (view.status === 'html') {
    return (
      <iframe
        title={name}
        // Scripts and forms run only after the page is opened. Popups stay off, and same-origin is omitted so the page cannot read the chat.
        sandbox="allow-scripts allow-forms"
        referrerPolicy="no-referrer"
        srcDoc={view.text}
        className="absolute inset-0 h-full w-full border-0 bg-white"
      />
    );
  }

  if (view.status === 'markdown') {
    return (
      <div className="px-4 py-3">
        <Markdown content={view.text} />
      </div>
    );
  }

  if (view.language != null && view.text.length <= FILE_PREVIEW_HIGHLIGHT_CHAR_LIMIT) {
    return (
      <SyntaxHighlighter
        code={view.text}
        language={view.language}
        showLineNumbers
        className="my-0 h-full rounded-none"
      />
    );
  }

  return (
    <pre className="m-0 min-h-full whitespace-pre-wrap break-words p-4 font-mono text-sm text-text-primary">
      {view.text}
    </pre>
  );
}

function resizePreview(aside: HTMLElement, requested: number, onWidthChange: (widthPx: number) => void) {
  const rowWidth = aside.parentElement?.getBoundingClientRect().width ?? 0;
  onWidthChange(clampPreviewWidth({ requested, rowWidth }));
}

export function FilePreviewPanel({
  name,
  placement,
  view,
  onClose,
  onDownload,
  onEnterFullPage,
  onExitFullPage,
  onRetry,
  downloadBusy = false,
  widthPx,
  onWidthChange,
}: FilePreviewPanelProps) {
  const panelRef = useRef<HTMLElement>(null);
  const showResizeHandle = placement === 'side' && onWidthChange != null;

  useEffect(() => {
    panelRef.current?.focus();
  }, [name, placement]);

  const onResizePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (onWidthChange == null) return;
    event.preventDefault();
    const handle = event.currentTarget;
    const aside = panelRef.current;
    if (aside == null) return;
    if (typeof handle.setPointerCapture === 'function') handle.setPointerCapture(event.pointerId);
    const originX = event.clientX;
    const originWidth = aside.getBoundingClientRect().width;

    const move = (ev: PointerEvent) => {
      resizePreview(aside, originWidth + (originX - ev.clientX), onWidthChange);
    };
    const end = (ev: PointerEvent) => {
      if (typeof handle.hasPointerCapture === 'function' && handle.hasPointerCapture(ev.pointerId)) {
        handle.releasePointerCapture(ev.pointerId);
      }
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  };

  const panel = (
    <aside
      ref={panelRef}
      tabIndex={-1}
      data-slot="aui_file-preview"
      data-placement={placement}
      aria-label={`Preview of ${name}`}
      onKeyDown={event => {
        if (event.key !== 'Escape') return;
        // Keep Escape from also dismissing the widget or mobile nav behind the preview.
        event.stopPropagation();
        if (placement === 'full' && onExitFullPage != null) onExitFullPage();
        else onClose();
      }}
      style={placement === 'side' && widthPx != null ? { width: `${widthPx}px` } : undefined}
      className={cn(
        'aui-file-preview relative flex min-h-0 min-w-0 flex-col bg-primary-bg outline-none',
        placement === 'overlay' && 'absolute inset-0 z-30',
        // Fills the chat pane only. The app sidebar and top bar stay visible.
        placement === 'full' && 'absolute inset-0 z-30',
        placement === 'side' && 'h-full shrink-0 border-l border-border',
        placement === 'side' && widthPx == null && 'w-1/2 max-w-[42rem]',
      )}
    >
      {showResizeHandle ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize preview"
          {...(widthPx != null ? { 'aria-valuenow': Math.round(widthPx) } : {})}
          tabIndex={0}
          title="Drag to resize"
          onPointerDown={onResizePointerDown}
          onKeyDown={event => {
            if (onWidthChange == null || panelRef.current == null) return;
            const step = event.shiftKey ? 48 : 16;
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            event.stopPropagation();
            const origin = panelRef.current.getBoundingClientRect().width;
            const delta = event.key === 'ArrowLeft' ? step : -step;
            resizePreview(panelRef.current, origin + delta, onWidthChange);
          }}
          className="group/resizer absolute inset-y-0 -left-2 z-20 flex w-4 cursor-col-resize touch-none items-center justify-center focus-visible:outline-none"
        >
          <div
            aria-hidden
            className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border group-hover/resizer:bg-primary-button-bg"
          />
          <div
            aria-hidden
            className={cn(
              'relative flex h-10 w-3.5 items-center justify-center rounded-full border border-border shadow-sm',
              'bg-primary-bg text-text-secondary',
              'group-hover/resizer:border-primary-button-bg group-hover/resizer:bg-primary-button-bg group-hover/resizer:text-primary-button-text',
              'group-focus-visible/resizer:border-primary-button-bg group-focus-visible/resizer:bg-primary-button-bg group-focus-visible/resizer:text-primary-button-text',
            )}
          >
            <Icon name="grip-vertical" size={12} />
          </div>
        </div>
      ) : null}
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        <Icon name="file" size={16} className="shrink-0 text-text-secondary" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">{name}</span>
        {view.status === 'error' && onRetry != null ? (
          <button type="button" onClick={onRetry} className={auiButtonClass({ variant: 'ghost', size: 'small' })}>
            Retry
          </button>
        ) : null}
        {placement === 'full' && onExitFullPage != null ? (
          <button
            type="button"
            onClick={onExitFullPage}
            aria-label="Exit full page"
            title="Exit full page"
            className={auiButtonClass({ variant: 'ghost', size: 'icon', className: 'h-7 w-7' })}
          >
            <Icon name="compress" size={14} />
          </button>
        ) : null}
        {placement !== 'full' && onEnterFullPage != null ? (
          <button
            type="button"
            onClick={onEnterFullPage}
            aria-label="Full page"
            title="Full page"
            className={auiButtonClass({ variant: 'ghost', size: 'icon', className: 'h-7 w-7' })}
          >
            <Icon name="expand" size={14} />
          </button>
        ) : null}
        <button
          type="button"
          onClick={onDownload}
          disabled={downloadBusy}
          aria-busy={downloadBusy || undefined}
          aria-label={downloadBusy ? `Downloading ${name}` : `Download ${name}`}
          title="Download"
          className={auiButtonClass({ variant: 'ghost', size: 'icon', className: 'h-7 w-7' })}
        >
          {downloadBusy ? <Spinner size={14} /> : <Icon name="download" size={14} />}
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close preview"
          title="Close preview"
          className={auiButtonClass({ variant: 'ghost', size: 'icon', className: 'h-7 w-7' })}
        >
          <Icon name="xmark" size={14} />
        </button>
      </header>
      <div
        className={cn(
          'relative h-full min-h-0 flex-1',
          view.status === 'html' || (view.status === 'media' && view.media === 'pdf')
            ? 'overflow-hidden'
            : 'overflow-auto',
        )}
      >
        <PreviewBody name={name} view={view} />
      </div>
    </aside>
  );

  return panel;
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    FilePreviewPanel: typeof FilePreviewPanel;
  }
}
