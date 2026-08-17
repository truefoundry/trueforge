import { useSlot } from '../../theme/SlotsProvider.js';
import { AgentStepRow } from '../agent-chat/AgentStepRow.js';
import { cn } from '../lib/cn.js';

export type ReasoningCardProps = {
  content: string;
  isStreaming?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  isMultiLine?: boolean;
  reasoningTimeText?: string | null;
  previewText?: string;
  headingText?: string;
  contentRef?: (node: HTMLDivElement | null) => void;
  dataTestPrefix?: string;
  className?: string;
};

export function ReasoningCard({
  content,
  isStreaming = false,
  expanded = false,
  onToggle,
  isMultiLine = false,
  reasoningTimeText,
  headingText = 'Reasoning',
  contentRef,
  dataTestPrefix,
  className,
}: ReasoningCardProps) {
  const Markdown = useSlot('Markdown');
  const isShortText = !isStreaming && content.length > 0 && !isMultiLine;
  const isExpandable = isShortText || isMultiLine || isStreaming;
  const status = isStreaming ? 'running' : content.length > 0 ? 'success' : 'idle';
  const title = isStreaming ? headingText : (reasoningTimeText ?? headingText);
  const showContent = expanded && content.length > 0;

  return (
    <div
      className={cn('aui-reasoning-card mt-2 flex min-w-0 flex-col', className)}
      data-testid={
        dataTestPrefix ? `${dataTestPrefix}-${isShortText ? 'reasoning-inline' : 'reasoning-accordion'}` : undefined
      }
    >
      <AgentStepRow
        icon={isStreaming ? 'brain' : 'brain-regular'}
        iconVariant="primary"
        title={title}
        expandable={isExpandable}
        expanded={expanded}
        onToggle={onToggle}
        status={status}
        dataTestPrefix={dataTestPrefix}
      >
        {showContent && (
          <div
            ref={contentRef}
            className="py-2 pt-0 font-sans text-sm font-normal text-text-secondary"
            data-testid={dataTestPrefix ? `${dataTestPrefix}-content` : undefined}
          >
            <Markdown content={content} className="font-sans text-sm text-text-secondary" />
          </div>
        )}
      </AgentStepRow>
    </div>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    ReasoningCard: typeof ReasoningCard;
  }
}
