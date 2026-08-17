'use client';

import { useTrueFoundryResumeUnavailable } from '@truefoundry/assistant-ui-runtime';

import { useSlot } from '../theme/SlotsProvider.js';

export function ResumeUnavailableContainer() {
  const ResumeUnavailable = useSlot('ResumeUnavailable');
  const resumeUnavailable = useTrueFoundryResumeUnavailable();

  if (!resumeUnavailable) return null;

  return <ResumeUnavailable />;
}
