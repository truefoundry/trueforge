import type { ComponentType } from 'react';
import { Icon } from '../../icons/Icon.js';

export default function AgentSessions() {
  return (
    <div className="flex h-full min-h-64 flex-col items-center justify-center gap-2 px-6 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-secondary-bg text-text-secondary">
        <Icon name="clock-rotate-left" />
      </span>
      <h2 className="text-sm font-semibold text-text-primary">Coming soon</h2>
      <p className="max-w-sm text-xs text-text-secondary">Sessions created with this agent will appear here.</p>
    </div>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    AgentSessions: ComponentType;
  }
}
