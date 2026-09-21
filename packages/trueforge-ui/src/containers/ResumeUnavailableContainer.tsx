'use client';

import { useTrueForgeResumeUnavailable } from '@truefoundry/trueforge-assistant-ui-runtime';

import { useSlot } from '../theme/SlotsProvider.js';

export function ResumeUnavailableContainer() {
  const ResumeUnavailable = useSlot('ResumeUnavailable');
  const resumeUnavailable = useTrueForgeResumeUnavailable();

  if (!resumeUnavailable) return null;

  return <ResumeUnavailable />;
}
