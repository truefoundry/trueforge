'use client';

import type { ReactNode } from 'react';

import { Spinner } from '../atoms/primitives/Spinner.js';
import { Icon } from '../icons/Icon.js';
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
  onSubmit: () => void;
  onCancel?: () => void;
};

export type ComposerLeftSectionSlot = (props: ComposerLeftSectionProps) => ReactNode;
export type ComposerRightSectionSlot = (props: ComposerRightSectionProps) => ReactNode;
export type ComposerSendButtonSlot = (props: ComposerSendButtonProps) => ReactNode;

export function ComposerLeftSection({ onAttach }: ComposerLeftSectionProps) {
  if (!onAttach) return null;

  return (
    <Button.Ghost
      type="button"
      aria-label="Attach"
      title="Attach"
      size="small"
      className="aspect-square px-0"
      onClick={onAttach}
    >
      <Icon name="paperclip" />
    </Button.Ghost>
  );
}

export function ComposerRightSection(_: ComposerRightSectionProps): ReactNode {
  return null;
}

export function ComposerSendButton({ canSubmit, isRunning, onSubmit, onCancel }: ComposerSendButtonProps) {
  if (isRunning) {
    return (
      <Button.Primary type="button" size="small" disabled={!onCancel} onClick={onCancel} aria-label="Cancel">
        <Spinner size={14} />
        Cancel
      </Button.Primary>
    );
  }

  return (
    <Button.Primary
      type="button"
      size="small"
      className="aspect-square px-0"
      disabled={!canSubmit}
      onClick={onSubmit}
      title="Send message"
      aria-label="Send message"
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
