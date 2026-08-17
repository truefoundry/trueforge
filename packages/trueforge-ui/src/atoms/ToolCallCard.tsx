'use client';

import type { ReactNode } from 'react';

import { AgentStepRow, type AgentStepStatus } from './agent-chat/AgentStepRow.js';
import { cn } from './lib/cn.js';

export type ToolCallStatus = 'running' | 'success' | 'error';

export type ToolCallCardProps = {
  icon?: string;
  iconClassName?: string;
  iconVariant?: 'primary' | 'muted';
  toolName: string;
  expanded?: boolean;
  onToggle?: () => void;
  awaiting?: boolean;
  awaitingText?: string;
  status?: ToolCallStatus;
  exitCode?: number | null;
  showExpandChevron?: boolean;
  showResponseLine?: boolean;
  responseIcon?: ReactNode;
  approvalSlot?: ReactNode;
  requestSlot?: ReactNode;
  responseSlot?: ReactNode;
  highlightCard?: boolean;
  className?: string;
  mcpServerName?: string;
  dataTestPrefix?: string;
};

const DEFAULT_AWAITING_TEXT = 'Awaiting Response...';

export function ToolCallCard({
  icon = 'mcp-server',
  iconClassName,
  iconVariant,
  toolName,
  expanded = false,
  onToggle,
  awaiting = false,
  awaitingText = DEFAULT_AWAITING_TEXT,
  status: explicitStatus,
  exitCode,
  showExpandChevron = true,
  showResponseLine = false,
  approvalSlot,
  requestSlot,
  responseSlot,
  highlightCard = false,
  className,
  mcpServerName: _mcpServerName,
  dataTestPrefix,
}: ToolCallCardProps) {
  const hasApproval = !!approvalSlot;
  const hasRequest = !!requestSlot;
  const hasResponse = !!responseSlot;
  const showConnector = hasApproval || hasRequest || hasResponse;
  const isExpandable = showExpandChevron && (hasRequest || hasResponse);

  let derivedStatus: AgentStepStatus = 'idle';
  if (explicitStatus) derivedStatus = explicitStatus;
  else if (awaiting) derivedStatus = 'running';
  else if (exitCode === 0) derivedStatus = 'success';
  else if (exitCode != null) derivedStatus = 'error';
  else if (showResponseLine) derivedStatus = 'success';

  const statusText = awaiting ? awaitingText : undefined;
  const isCubeIcon = icon === 'cube';
  const derivedIconVariant = iconVariant || (isCubeIcon ? 'primary' : 'muted');
  const derivedIconSize = isCubeIcon ? '0.75em' : undefined;

  return (
    <div
      className={cn(
        'aui-tool-call-card flex min-w-0 flex-col',
        highlightCard ? 'rounded-md p-1 -mx-1' : 'mx-0 mt-2 p-0',
        className,
      )}
      data-testid={dataTestPrefix ? `${dataTestPrefix}-tool-call-card` : undefined}
    >
      <AgentStepRow
        icon={icon}
        iconClassName={iconClassName}
        iconVariant={derivedIconVariant}
        iconSize={derivedIconSize}
        title={toolName}
        expandable={isExpandable}
        expanded={expanded}
        onToggle={onToggle}
        status={derivedStatus}
        statusText={statusText}
        showConnector={showConnector}
        showContentConnector={true}
        showPersistentContentConnector={!hasApproval}
        dataTestPrefix={dataTestPrefix ? `${dataTestPrefix}-header` : undefined}
        persistentChildren={
          <>
            {approvalSlot}
            {expanded && showResponseLine && responseSlot && (
              <div data-testid={dataTestPrefix ? `${dataTestPrefix}-response` : undefined}>{responseSlot}</div>
            )}
          </>
        }
      >
        {requestSlot && (
          <div className="py-2 pt-0" data-testid={dataTestPrefix ? `${dataTestPrefix}-request` : undefined}>
            {requestSlot}
          </div>
        )}
      </AgentStepRow>
    </div>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    ToolCallCard: typeof ToolCallCard;
  }
}
