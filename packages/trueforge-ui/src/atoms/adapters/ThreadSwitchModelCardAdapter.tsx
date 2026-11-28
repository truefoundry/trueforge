import type { ThreadSwitchModelEvent } from '@truefoundry/trueforge-assistant-ui-runtime';

import { useSlot } from '../../theme/SlotsProvider.js';
import { AgentStepRow } from '../agent-chat/AgentStepRow.js';
import { cn } from '../lib/cn.js';

export type ThreadSwitchModelCardProps = {
  data: ThreadSwitchModelEvent;
  expanded?: boolean;
  onToggle?: () => void;
  dataTestPrefix?: string;
  className?: string;
};

export function ThreadSwitchModelCard({
  data,
  expanded = false,
  onToggle,
  dataTestPrefix,
  className,
}: ThreadSwitchModelCardProps) {
  const ToolCallContentBlock = useSlot('ToolCallContentBlock');
  const json = JSON.stringify(data, null, 2);
  const effort = data.model.params?.reasoningEffort;
  const title = effort === undefined ? `Switched to ${data.model.name}` : `Switched to ${data.model.name} · ${effort}`;

  return (
    <div
      className={cn('aui-thread-switch-model-card mt-2 flex min-w-0 flex-col', className)}
      data-testid={dataTestPrefix ? `${dataTestPrefix}-thread-switch-model-card` : undefined}
    >
      <AgentStepRow
        icon="wand"
        iconVariant="primary"
        title={title}
        expandable
        expanded={expanded}
        onToggle={onToggle}
        status="success"
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
    ThreadSwitchModelCard: typeof ThreadSwitchModelCard;
  }
}
