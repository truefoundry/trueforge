import type { ContextCompactionPartData } from '@truefoundry/trueforge-assistant-ui-runtime';

import { useSlot } from '../../theme/SlotsProvider.js';
import { AgentStepRow, type AgentStepStatus } from '../agent-chat/AgentStepRow.js';
import { cn } from '../lib/cn.js';

export type ContextCompactionCardProps = {
  data: ContextCompactionPartData;
  expanded?: boolean;
  onToggle?: () => void;
  dataTestPrefix?: string;
  className?: string;
};

function eventJson(data: ContextCompactionPartData): string {
  return JSON.stringify(data.status === 'complete' ? data.finished : data.started, null, 2);
}

function cardPresentation(data: ContextCompactionPartData): {
  title: string;
  status: AgentStepStatus;
  showSpinner: boolean;
} {
  switch (data.status) {
    case 'running':
      return { title: 'Summarizing context...', status: 'running', showSpinner: true };
    case 'complete':
      return { title: 'Summarized context', status: 'success', showSpinner: false };
    case 'incomplete':
      return {
        title: data.reason === 'cancelled' ? 'Context summarization cancelled' : 'Context summarization failed',
        status: 'error',
        showSpinner: false,
      };
  }
}

export function ContextCompactionCard({
  data,
  expanded = false,
  onToggle,
  dataTestPrefix,
  className,
}: ContextCompactionCardProps) {
  const ToolCallContentBlock = useSlot('ToolCallContentBlock');
  const { title, status, showSpinner } = cardPresentation(data);
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
        status={status}
        showSpinner={showSpinner}
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
