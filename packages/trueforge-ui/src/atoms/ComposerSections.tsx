'use client';

import type { ReactNode } from 'react';

import { Spinner } from '../atoms/primitives/Spinner.js';
import { Icon } from '../icons/Icon.js';
import { auiButtonClass } from './lib/buttonClasses.js';

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

export function ComposerSendButton({ canSubmit, isRunning, onSubmit, onCancel }: ComposerSendButtonProps) {
  if (isRunning) {
    return (
      <button
        type="button"
        className={auiButtonClass({ size: 'sm' })}
        disabled={!onCancel}
        onClick={onCancel}
        aria-label="Cancel"
      >
        <Spinner size={14} />
        Cancel
      </button>
    );
  }

  return (
    <button
      type="button"
      className={auiButtonClass({ size: 'icon' })}
      disabled={!canSubmit}
      onClick={onSubmit}
      title="Send message"
      aria-label="Send message"
    >
      <Icon name="arrow-up" />
    </button>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    ComposerLeftSection: ComposerLeftSectionSlot;
    ComposerRightSection: ComposerRightSectionSlot;
    ComposerSendButton: ComposerSendButtonSlot;
  }
}
