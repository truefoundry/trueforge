'use client';

import type { ReactNode } from 'react';

import { Spinner } from '../atoms/primitives/Spinner.js';
import { Icon } from '../icons/Icon.js';
import { auiButtonClass } from './lib/buttonClasses.js';
import { Button } from './primitives/Button.js';

export type ComposerLeftSectionProps = {
  disabled: boolean;
  isRunning: boolean;
  onAttach?: () => void;
};

export type ComposerRightSectionProps = {
  disabled: boolean;
  isRunning: boolean;
};

export type ComposerSendButtonProps = {
  disabled: boolean;
  canSubmit: boolean;
  isRunning: boolean;
  /** True while a cancel request is in flight. */
  isCancelling?: boolean;
  /** True when the composer has trimmed text or attachments. */
  hasContent: boolean;
  /** Why Send is blocked (e.g. models or sandbox still loading); shown as the button tooltip. */
  blockedReason?: string;
  onSubmit: () => void;
  onCancel?: () => void;
};

export type ComposerLeftSectionSlot = (props: ComposerLeftSectionProps) => ReactNode;
export type ComposerRightSectionSlot = (props: ComposerRightSectionProps) => ReactNode;
export type ComposerSendButtonSlot = (props: ComposerSendButtonProps) => ReactNode;

export function ComposerLeftSection({ onAttach }: ComposerLeftSectionProps) {
  if (!onAttach) return null;

  return (
    <button
      type="button"
      aria-label="Attach"
      title="Attach"
      className={auiButtonClass({ variant: 'ghost', size: 'icon' })}
      onClick={onAttach}
    >
      <Icon name="paperclip" />
    </button>
  );
}

export function ComposerRightSection(_: ComposerRightSectionProps): ReactNode {
  return null;
}

export function ComposerSendButton({
  canSubmit,
  isRunning,
  isCancelling = false,
  hasContent,
  blockedReason,
  onSubmit,
  onCancel,
}: ComposerSendButtonProps) {
  // Cancel only while busy with an empty composer. Content (even when Send is
  // blocked by a missing model) keeps the Send affordance. Keep the control
  // visible while cancel is in flight even if the thread already looks idle.
  if ((isRunning || isCancelling) && !hasContent) {
    return (
      <Button.Primary
        type="button"
        size="small"
        disabled={!onCancel || isCancelling}
        onClick={onCancel}
        aria-label={isCancelling ? 'Cancelling' : 'Cancel'}
      >
        <Spinner size={14} />
        {isCancelling ? 'Cancelling...' : 'Cancel'}
      </Button.Primary>
    );
  }

  const sendLabel = !canSubmit && blockedReason != null ? blockedReason : 'Send message';

  return (
    <Button.Primary
      type="button"
      size="icon"
      data-slot="aui_composer-send"
      className="shadow-none"
      disabled={!canSubmit}
      onClick={onSubmit}
      title={sendLabel}
      aria-label={sendLabel}
    >
      <Icon name="arrow-up" />
    </Button.Primary>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    ComposerLeftSection: ComposerLeftSectionSlot;
    ComposerRightSection: ComposerRightSectionSlot;
    ComposerSendButton: ComposerSendButtonSlot;
  }
}
