import type { ReactNode } from 'react';

export type OnboardingStepFooterProps = {
  /** Leading action (Back); an empty node keeps the trailing actions right-aligned. */
  start?: ReactNode;
  end: ReactNode;
};

export function OnboardingStepFooter({ start, end }: OnboardingStepFooterProps) {
  return (
    <div className="border-border flex items-center justify-between gap-2 border-t pt-3">
      <div className="flex items-center gap-2">{start}</div>
      <div className="flex items-center gap-2">{end}</div>
    </div>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    OnboardingStepFooter: typeof OnboardingStepFooter;
  }
}
