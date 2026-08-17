import type { ReactNode } from 'react';

import { Icon } from '../icons/Icon.js';
import { useSlot } from '../theme/SlotsProvider.js';
import { cn } from './lib/cn.js';

export type ToolGroupCardProps = {
  toolCallCount: number;
  expanded: boolean;
  active?: boolean;
  onToggle: () => void;
  children: ReactNode;
  className?: string;
};

export function ToolGroupCard({
  toolCallCount,
  expanded,
  active = false,
  onToggle,
  children,
  className,
}: ToolGroupCardProps) {
  const Accordion = useSlot('Accordion');
  const AccordionSummary = useSlot('AccordionSummary');
  const AccordionDetails = useSlot('AccordionDetails');
  const label = `${toolCallCount} tool ${toolCallCount === 1 ? 'call' : 'calls'}`;

  return (
    <Accordion
      data-slot="tool-group-card"
      expanded={expanded}
      onChange={() => onToggle()}
      background="transparent"
      className={cn('aui-tool-group-card group/tool-group w-full', className)}
      sx={{ margin: 0, border: 'none', boxShadow: 'none' }}
    >
      <AccordionSummary
        hideIcon
        disableRipple
        sx={{
          padding: 0,
          minHeight: 0,
          '&.Mui-expanded': { minHeight: 0 },
          '&:hover': { backgroundColor: 'transparent' },
          '& .MuiAccordionSummary-content': { margin: 0, width: '100%' },
        }}
      >
        <div className="text-text-secondary hover:text-text-primary flex origin-left items-center gap-2 py-1.5 text-sm transition-[color,scale] active:scale-[0.98]">
          {active && <Icon name="loader" className="size-3 shrink-0 animate-spin [animation-duration:0.6s]" />}
          <span className="text-xs font-medium">{label}</span>
          <Icon
            name="chevron-down"
            className={cn(
              'size-3 shrink-0 transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]',
              expanded ? 'rotate-0' : '-rotate-90',
            )}
          />
        </div>
      </AccordionSummary>
      <AccordionDetails sx={{ padding: 0 }}>
        <div className="mt-1 flex flex-col gap-2 text-text-primary">{children}</div>
      </AccordionDetails>
    </Accordion>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    ToolGroupCard: typeof ToolGroupCard;
  }
}
