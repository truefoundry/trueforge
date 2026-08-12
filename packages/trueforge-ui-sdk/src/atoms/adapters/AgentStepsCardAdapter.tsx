import type { ReactNode } from 'react';

import { Icon } from '../../icons/Icon.js';
import { cn } from '../lib/cn.js';
import { Accordion, AccordionDetails, AccordionSummary } from '../primitives/Accordion.js';
import { Spinner } from '../primitives/Spinner.js';

export type AgentStepsCardProps = {
  toolCount: number;
  thinkingCount: number;
  expanded: boolean;
  active?: boolean;
  onToggle: () => void;
  children: ReactNode;
  borderColor?: string;
  background?: string;
  dataTestPrefix?: string;
  className?: string;
};

export function AgentStepsCard({
  toolCount,
  thinkingCount,
  expanded,
  active = false,
  onToggle,
  children,
  borderColor,
  background,
  dataTestPrefix,
  className,
}: AgentStepsCardProps) {
  const toolLabel = `${toolCount} tool ${toolCount === 1 ? 'call' : 'calls'}`;
  const thinkingLabel = thinkingCount > 0 ? ` · ${thinkingCount} thought${thinkingCount === 1 ? '' : 's'}` : '';

  return (
    <Accordion
      expanded={expanded}
      onChange={() => onToggle()}
      className={cn(
        'aui-agent-steps-card mb-3 rounded-lg border border-border bg-card-bg text-text-primary',
        className,
      )}
      style={{
        ...(background !== undefined ? { background } : {}),
        ...(borderColor !== undefined ? { borderColor } : {}),
      }}
      data-testid={dataTestPrefix ? `${dataTestPrefix}-agent-steps-card` : undefined}
    >
      <AccordionSummary className="p-0">
        <div className="flex w-full items-center gap-2 px-2 py-2 text-left text-xs">
          <Icon
            name={expanded ? 'chevron-down' : 'chevron-right'}
            size="0.75em"
            className="shrink-0 text-text-secondary"
          />
          <span className="font-semibold text-text-primary">Agent steps</span>
          <span className="text-text-secondary">
            · {toolLabel}
            {thinkingLabel}
          </span>
          {active && (
            <div className="ml-auto">
              <Spinner size={12} className="text-primary-button-bg" />
            </div>
          )}
        </div>
      </AccordionSummary>
      <AccordionDetails>
        <div
          className="space-y-3 border-t border-border p-3"
          data-testid={dataTestPrefix ? `${dataTestPrefix}-content` : undefined}
        >
          {children}
        </div>
      </AccordionDetails>
    </Accordion>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    AgentStepsCard: typeof AgentStepsCard;
  }
}
