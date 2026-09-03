import { Icon } from '../../icons/Icon.js';
import { auiButtonClass } from '../lib/buttonClasses.js';
import type { AgentDetailsUnavailableProps } from './types.js';

export function AgentDetailsUnavailable({ onBack, reason }: AgentDetailsUnavailableProps) {
  return (
    <div className="flex h-full min-h-64 flex-col items-center justify-center gap-3 px-6 text-center">
      <span className="flex size-11 items-center justify-center rounded-full bg-secondary-bg text-text-secondary">
        <Icon name="circle-exclamation" />
      </span>
      <div>
        <h2 className="text-base font-semibold text-text-primary">Agent details unavailable</h2>
        <p className="mt-1 max-w-md text-sm text-text-secondary">
          {reason ?? 'The agent details could not be loaded. Please try again later.'}
        </p>
      </div>
      <button type="button" className={auiButtonClass({ variant: 'outline', size: 'sm' })} onClick={onBack}>
        <Icon name="arrow-left" className="size-3.5" />
        Back to Agents
      </button>
    </div>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    AgentDetailsUnavailable: typeof AgentDetailsUnavailable;
  }
}
