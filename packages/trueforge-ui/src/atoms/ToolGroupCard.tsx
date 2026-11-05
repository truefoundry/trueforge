import type { ReactNode } from 'react';

import { useSlot } from '../theme/SlotsProvider.js';
import { AgentStepRow, type AgentStepStatus } from './agent-chat/AgentStepRow.js';
import { cn } from './lib/cn.js';

export type ToolGroupCardProps = {
  toolCallCount: number;
  expanded: boolean;
  status?: AgentStepStatus;
  /** @deprecated Use `status="running"`. Kept because older slot overrides still pass `active`. */
  active?: boolean;
  onToggle: () => void;
  children: ReactNode;
  className?: string;
  dataTestPrefix?: string;
};

export function ToolGroupCard({
  toolCallCount,
  expanded,
  status,
  active = false,
  onToggle,
  children,
  className,
  dataTestPrefix,
}: ToolGroupCardProps) {
  const StepTree = useSlot('StepTree');
  const label = `${toolCallCount} tool calls in parallel`;
  const resolvedStatus: AgentStepStatus = status ?? (active ? 'running' : 'idle');

  return (
    <div
      data-slot="tool-group-card"
      className={cn('aui-tool-group-card min-w-0', className)}
      data-testid={dataTestPrefix ? `${dataTestPrefix}-tool-group-card` : undefined}
    >
      <AgentStepRow
        icon="wrench"
        iconVariant="muted"
        title={label}
        titleClassName="text-text-secondary"
        expandable
        expanded={expanded}
        onToggle={onToggle}
        status={resolvedStatus}
        showConnector={false}
        dataTestPrefix={dataTestPrefix}
      >
        <StepTree>{children}</StepTree>
      </AgentStepRow>
    </div>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    ToolGroupCard: typeof ToolGroupCard;
  }
}
