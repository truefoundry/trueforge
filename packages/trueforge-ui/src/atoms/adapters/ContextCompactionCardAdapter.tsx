import type { ContextCompactionPartData } from '@truefoundry/trueforge-assistant-ui-runtime';

import { useSlot } from '../../theme/SlotsProvider.js';
import { AgentStepRow } from '../agent-chat/AgentStepRow.js';
import { cn } from '../lib/cn.js';

export type ContextCompactionCardProps = {
  data: ContextCompactionPartData;
  expanded?: boolean;
  onToggle?: () => void;
  dataTestPrefix?: string;
  className?: string;
};

function eventJson(data: ContextCompactionPartData): string {
  const event = data.finished ?? data.started;
  return JSON.stringify(event, null, 2);
}

export function ContextCompactionCard({
  data,
  expanded = false,
  onToggle,
  dataTestPrefix,
  className,
}: ContextCompactionCardProps) {
  const ToolCallContentBlock = useSlot('ToolCallContentBlock');
  const isRunning = data.status === 'running';
  const title = isRunning ? 'Summarizing context...' : 'Summarized context';
  const json = eventJson(data);

  return (
    <div
      className={cn('aui-context-compaction-card mt-2 flex min-w-0 flex-col', className)}
      data-testid={dataTestPrefix ? `${dataTestPrefix}-context-compaction-card` : undefined}
    >
      <AgentStepRow
        icon="layers"
        iconVariant="primary"
        iconClassName="text-[#a855f7]"
        title={title}
        expandable
        expanded={expanded}
        onToggle={onToggle}
        status={isRunning ? 'running' : 'success'}
        showSpinner={isRunning}
        dataTestPrefix={dataTestPrefix}
      >
        {expanded ? (
          <div className="py-2 pt-0" data-testid={dataTestPrefix ? `${dataTestPrefix}-event-json` : undefined}>
            <ToolCallContentBlock title="Event" content={json} isJson copyValue={json} />
          </div>
        ) : null}
      </AgentStepRow>
    </div>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    ContextCompactionCard: typeof ContextCompactionCard;
  }
}
