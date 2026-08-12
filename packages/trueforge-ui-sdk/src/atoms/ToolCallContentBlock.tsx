'use client';

import { useState } from 'react';

import { Icon } from '../icons/Icon.js';
import { useSlot } from '../theme/SlotsProvider.js';
import { cn } from './lib/cn.js';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './primitives/Dialog.js';
import { IconButton } from './primitives/IconButton.js';

export type ToolCallContentBlockProps = {
  title: string;
  content: string;
  isJson?: boolean;
  copyValue?: string;
  maxHeight?: string;
  resizable?: boolean;
  fullscreen?: boolean;
  onFullscreenChange?: (fullscreen: boolean) => void;
  contentHeightRem?: number;
  contentRef?: (node: HTMLDivElement | null) => void;
  onContentHeightChange?: (height: number) => void;
  dataTestPrefix?: string;
  className?: string;
};

function JsonEditor({
  content,
  height,
  autoHeight = false,
  maxHeight,
  onAutoHeightChange,
}: {
  content: string;
  height?: string | number;
  autoHeight?: boolean;
  maxHeight?: string | number;
  onAutoHeightChange?: (height: number) => void;
}) {
  const MonacoEditorCore = useSlot('MonacoEditorCore');

  return (
    <MonacoEditorCore
      language="json"
      value={content}
      height={height}
      autoHeight={autoHeight}
      maxHeight={maxHeight}
      onAutoHeightChange={onAutoHeightChange}
      options={{
        readOnly: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        wordWrap: 'on',
        lineNumbers: 'on',
        folding: true,
        fontSize: 12,
      }}
      className="border-0!"
    />
  );
}

export function ToolCallContentBlock({
  title,
  content,
  isJson = true,
  copyValue,
  maxHeight = '10.5rem',
  resizable = false,
  fullscreen = false,
  onFullscreenChange,
  contentHeightRem,
  contentRef,
  onContentHeightChange,
  dataTestPrefix,
  className,
}: ToolCallContentBlockProps) {
  const Markdown = useSlot('Markdown');
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    const val = copyValue ?? content;
    void navigator.clipboard.writeText(val).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const hasMeasuredResizableHeight = resizable && contentHeightRem !== undefined;
  const bodyStyle = resizable
    ? {
        ...(hasMeasuredResizableHeight ? { height: `${Math.min(contentHeightRem, 10)}rem` } : {}),
        resize: 'vertical' as const,
        padding: '0.25rem',
      }
    : {
        padding: '0.25rem',
      };

  return (
    <div
      className={cn(
        'aui-tool-call-content-block flex flex-col font-sans text-xs font-medium leading-4 text-text-primary',
        className,
      )}
      data-testid={dataTestPrefix ? `${dataTestPrefix}-content-block` : 'tfy-tool-call-content-block'}
      data-content={content}
    >
      <div className="flex items-center justify-between rounded-t-lg border border-primary-button-bg/30 bg-primary-button-bg/10 px-3 py-1">
        <div className="font-sans text-xs font-medium text-primary-button-bg">{title}</div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex size-6 cursor-pointer items-center justify-center rounded text-text-secondary transition-colors hover:text-text-primary"
            aria-label="Copy"
            data-testid={dataTestPrefix ? `${dataTestPrefix}-copy` : undefined}
          >
            <Icon name={copied ? 'check' : 'clone'} size={14} />
          </button>
          <button
            type="button"
            onClick={() => onFullscreenChange?.(true)}
            className="inline-flex size-6 cursor-pointer items-center justify-center rounded text-text-secondary transition-colors hover:text-text-primary"
            aria-label="Expand"
          >
            <Icon name="expand-alt" size={14} />
          </button>
        </div>
      </div>
      <div
        ref={resizable ? contentRef : undefined}
        className={cn(
          'relative min-h-7.5 rounded-b-lg border border-t-0 border-border bg-primary-bg',
          resizable && 'overflow-hidden',
        )}
        style={bodyStyle}
      >
        {isJson ? (
          <JsonEditor
            content={content}
            height={hasMeasuredResizableHeight ? '100%' : undefined}
            autoHeight={!hasMeasuredResizableHeight}
            maxHeight={maxHeight}
            onAutoHeightChange={resizable ? onContentHeightChange : undefined}
          />
        ) : (
          <div
            className={cn('overflow-y-auto', hasMeasuredResizableHeight && 'h-full')}
            style={!hasMeasuredResizableHeight && maxHeight ? { maxHeight } : undefined}
          >
            <Markdown content={content} className="text-xs text-text-secondary" />
          </div>
        )}
      </div>

      {fullscreen && (
        <Dialog open onOpenChange={open => onFullscreenChange?.(open)}>
          <DialogContent className="flex h-[80vh] max-w-4xl flex-col">
            <DialogHeader className="flex flex-row items-center justify-between gap-2">
              <DialogTitle>{title}</DialogTitle>
              <IconButton variant="ghost" onClick={() => onFullscreenChange?.(false)} aria-label="Minimize">
                <Icon name="compress" size="0.875em" />
              </IconButton>
            </DialogHeader>
            <div className="min-h-0 flex-1">
              <JsonEditor content={content} height="100%" />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    ToolCallContentBlock: typeof ToolCallContentBlock;
  }
}
