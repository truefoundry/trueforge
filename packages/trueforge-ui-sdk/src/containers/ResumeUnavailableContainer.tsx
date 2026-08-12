'use client';

import { useSlot } from '../theme/SlotsProvider.js';
import { useErrorToasterOptional } from './ErrorToasterContainer.js';

export function ResumeUnavailableContainer() {
  const ResumeUnavailableModal = useSlot('ResumeUnavailableModal');
  const errorToaster = useErrorToasterOptional();

  if (errorToaster == null || !errorToaster.resumeUnavailable) return null;

  return (
    <ResumeUnavailableModal
      open
      onOpenChange={open => {
        if (!open) errorToaster.dismissResumeUnavailable();
      }}
    />
  );
}
