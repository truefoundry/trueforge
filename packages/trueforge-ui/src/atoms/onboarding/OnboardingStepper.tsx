import { cn } from '../lib/cn.js';

export type OnboardingStepperProps = {
  steps: readonly string[];
  /** Zero-based index of the step the user is on; earlier steps stay highlighted. */
  currentIndex: number;
};

export function OnboardingStepper({ steps, currentIndex }: OnboardingStepperProps) {
  return (
    <nav aria-label="Setup progress">
      <ol className="flex items-center gap-4">
        {steps.map((label, index) => {
          const reached = index <= currentIndex;
          return (
            <li
              key={label}
              aria-current={index === currentIndex ? 'step' : undefined}
              className="flex min-w-0 flex-1 flex-col gap-[0.6875rem]"
            >
              <span
                className={cn(
                  'truncate pl-[1.125rem] text-xs leading-[1.05rem]',
                  reached ? 'text-text-primary font-medium' : 'text-text-secondary',
                )}
              >
                {index + 1}. {label}
              </span>
              <span
                className={cn('h-[0.1875rem] rounded-[0.1875rem]', reached ? 'bg-text-primary' : 'bg-input-border')}
              />
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    OnboardingStepper: typeof OnboardingStepper;
  }
}
