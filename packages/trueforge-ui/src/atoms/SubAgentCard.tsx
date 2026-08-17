'use client';

import type { ReactNode } from 'react';

import { useSlot } from '../theme/SlotsProvider.js';
import { AgentStepRow, type AgentStepStatus } from './agent-chat/AgentStepRow.js';
import { cn } from './lib/cn.js';
import type { ToolCallStatus } from './ToolCallCard.js';

export type SubAgentCardProps = {
  agentName: string;
  instruction: string;
  stepCount: number;
  status: ToolCallStatus;
  expanded: boolean;
  onToggle: () => void;
  durationText?: string;
  children?: ReactNode;
  renderInstruction?: (instruction: string) => ReactNode;
  dataTestPrefix?: string;
  className?: string;
};

export function SubAgentCard({
  agentName,
  instruction,
  stepCount: _stepCount,
  status,
  expanded,
  onToggle,
  durationText,
  children,
  renderInstruction,
  dataTestPrefix,
  className,
}: SubAgentCardProps) {
  const Markdown = useSlot('Markdown');

  const agentStatus: AgentStepStatus = status === 'running' ? 'running' : status === 'success' ? 'success' : 'error';

  const instructionContent =
    instruction.trim().length > 0 ? (
      renderInstruction ? (
        renderInstruction(instruction)
      ) : (
        <Markdown content={instruction} className="flex flex-col font-sans text-sm text-text-secondary" />
      )
    ) : null;

  return (
    <div
      className={cn('aui-sub-agent-card min-w-0', className)}
      data-testid={dataTestPrefix ? `${dataTestPrefix}-sub-agent-card` : undefined}
    >
      <AgentStepRow
        icon="agent-2"
        iconVariant="primary"
        title={`Sub-agent: ${agentName}`}
        expandable
        expanded={expanded}
        onToggle={onToggle}
        status={agentStatus}
        statusText={durationText}
        dataTestPrefix={dataTestPrefix}
      >
        {instructionContent != null && (
          <div className="mb-3 flex flex-col gap-2 rounded-md border border-border p-2">
            <h4 className="text-sm font-semibold text-text-primary">Instructions</h4>
            <div
              className="text-sm text-text-secondary"
              data-testid={dataTestPrefix ? `${dataTestPrefix}-instructions` : undefined}
            >
              {instructionContent}
            </div>
          </div>
        )}

        {children != null && (
          <div
            className="flex min-w-0 flex-col gap-3"
            data-testid={dataTestPrefix ? `${dataTestPrefix}-nested-content` : undefined}
          >
            {children}
          </div>
        )}
      </AgentStepRow>
    </div>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    SubAgentCard: typeof SubAgentCard;
  }
}
