'use client';

import { Icon } from '../icons/Icon.js';
import { auiButtonClass } from './lib/buttonClasses.js';
import { CenteredModal } from './primitives/CenteredModal.js';

export type ResumeUnavailableModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Shown when a response is still generating but this backend cannot stream it.
 */
export function ResumeUnavailableModal({ open, onOpenChange }: ResumeUnavailableModalProps) {
  return (
    <CenteredModal
      open={open}
      onOpenChange={onOpenChange}
      contentSized
      title="Resume unavailable"
      headerIcon={<Icon name="circle-exclamation" size="1.25em" className="text-destructive shrink-0" />}
    >
      <div className="flex flex-col gap-4 px-5 py-4">
        <p className="text-muted-foreground text-sm leading-snug">
          A response is still being generated for this conversation, but subscribing to that stream is not supported by
          this backend, so it cannot be shown live here.
        </p>
        <div className="flex justify-end">
          <button type="button" className={auiButtonClass()} onClick={() => onOpenChange(false)}>
            Dismiss
          </button>
        </div>
      </div>
    </CenteredModal>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    ResumeUnavailableModal: typeof ResumeUnavailableModal;
  }
}
