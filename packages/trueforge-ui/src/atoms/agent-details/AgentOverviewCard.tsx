import { Icon } from '../../icons/Icon.js';
import type { AgentOverviewCardProps } from './types.js';

export function AgentOverviewCard({ title, icon, count, children }: AgentOverviewCardProps) {
  return (
    <section className="rounded-lg border border-border bg-card-bg p-3 text-text-primary">
      <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold">
        <Icon name={icon} className="size-3.5 text-text-secondary" />
        {title}
        {count !== undefined ? <span className="text-text-secondary">({count})</span> : null}
      </h2>
      {children}
    </section>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    AgentOverviewCard: typeof AgentOverviewCard;
  }
}
