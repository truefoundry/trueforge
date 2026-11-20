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
  activityText?: string;
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
  activityText,
  children,
  renderInstruction,
  dataTestPrefix,
  className,
}: SubAgentCardProps) {
  const Markdown = useSlot('Markdown');
  const StepTreeItem = useSlot('StepTreeItem');

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
        title={
          <>
            {`Sub-agent: ${agentName}`}
            {agentStatus === 'running' && activityText ? (
              <span className="ml-2 font-normal text-text-secondary">{activityText}</span>
            ) : null}
          </>
        }
        expandable
        expanded={expanded}
        onToggle={onToggle}
        status={agentStatus}
        statusText={durationText}
        dataTestPrefix={dataTestPrefix}
      />
      {/* Instructions and nested steps render below the header (not in its indented body) so the tree line
          starts under this card's chevron and runs past the Instructions card into the first step. */}
      {expanded && (instructionContent != null || children != null) && (
        <div className="flex min-w-0 flex-col">
          {instructionContent != null && (
            <StepTreeItem branch={false} continuesBelow={children != null}>
              <div className="py-2">
                <div className="flex flex-col gap-2 rounded-md border border-border p-2">
                  <h4 className="text-sm font-semibold text-text-primary">Instructions</h4>
                  <div
                    className="text-sm text-text-secondary"
                    data-testid={dataTestPrefix ? `${dataTestPrefix}-instructions` : undefined}
                  >
                    {instructionContent}
                  </div>
                </div>
              </div>
            </StepTreeItem>
          )}
          {children != null && (
            <div
              className={cn('flex min-w-0 flex-col gap-3', instructionContent == null && 'mt-1')}
              data-testid={dataTestPrefix ? `${dataTestPrefix}-nested-content` : undefined}
            >
              {children}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    SubAgentCard: typeof SubAgentCard;
  }
}
