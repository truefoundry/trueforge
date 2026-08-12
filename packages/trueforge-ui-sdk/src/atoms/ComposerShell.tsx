'use client';

import { type ReactNode } from 'react';

import { useSlot } from '../theme/SlotsProvider.js';
import { cn } from './lib/cn.js';

export type ComposerShellProps = {
  /** Message input node, supplied by the container (e.g. `<ComposerPrimitive.Input />`). */
  input: ReactNode;
  disabled: boolean;
  canSubmit: boolean;
  isRunning?: boolean;
  attachments?: ReactNode;
  modelLabel?: string;
  modelIcon?: ReactNode;
  connectorStatusLabel?: string;
  onSubmit: () => void;
  onCancel?: () => void;
  onAttach?: () => void;
  className?: string;
};

export function ComposerShell({
  input,
  disabled,
  canSubmit,
  isRunning = false,
  attachments,
  modelLabel,
  modelIcon,
  connectorStatusLabel,
  onSubmit,
  onCancel,
  onAttach,
  className,
}: ComposerShellProps) {
  const ComposerLeftSection = useSlot('ComposerLeftSection');
  const ComposerRightSection = useSlot('ComposerRightSection');
  const ComposerSendButton = useSlot('ComposerSendButton');

  return (
    <div
      data-slot="aui_composer-shell"
      className={cn(
        'border-border/60 focus-within:border-focus-ring focus-within:ring-focus-ring/20 flex w-full flex-col gap-2 rounded-[var(--composer-radius,1.5rem)] border bg-input-box-bg p-[var(--composer-padding,8px)] shadow-sm transition-colors focus-within:ring-3',
        className,
      )}
    >
      {attachments}
      {input}
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 px-1">
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
          <ComposerLeftSection disabled={disabled} isRunning={isRunning} onAttach={onAttach} />
          {connectorStatusLabel && (
            <span className="text-text-secondary max-w-[12rem] truncate text-xs">{connectorStatusLabel}</span>
          )}
        </div>
        <div className="ml-auto flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-2">
          {modelLabel && (
            <span className="bg-secondary-bg text-text-secondary flex max-w-[10rem] items-center gap-1 truncate rounded-full px-2 py-0.5 text-xs">
              {modelIcon}
              <span className="truncate">{modelLabel}</span>
            </span>
          )}
          <ComposerRightSection disabled={disabled} isRunning={isRunning} />
          <ComposerSendButton
            disabled={disabled}
            canSubmit={canSubmit}
            isRunning={isRunning}
            onSubmit={onSubmit}
            onCancel={onCancel}
          />
        </div>
      </div>
    </div>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    ComposerShell: typeof ComposerShell;
  }
}
