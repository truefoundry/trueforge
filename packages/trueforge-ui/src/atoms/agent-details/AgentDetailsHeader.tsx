'use client';

import { Icon } from '../../icons/Icon.js';
import { useOptionalScheduleServer, useOptionalServer } from '../../server/ServerContext.js';
import { useShellMode } from '../../server/ShellModeContext.js';
import { writeOpenSchedulesForAgentSearch } from '../../utils/scheduleShareUrl.js';
import { AgentOverflowMenu } from '../AgentOverflowMenu.js';
import { auiButtonClass } from '../lib/buttonClasses.js';
import type { AgentDetailsHeaderProps } from './types.js';

export function AgentDetailsHeader({ agentId, detail, onBack }: AgentDetailsHeaderProps) {
  const shell = useShellMode();
  const scheduleServer = useOptionalScheduleServer();
  const builder = useOptionalServer();
  const canMutate = shell.isComposerEnabled && detail != null && builder != null;
  const canManageSchedules = scheduleServer != null && detail != null;

  const handleTry = () => {
    if (detail == null) return;
    shell.selectLibraryAgent({
      isMutable: false,
      agentId: detail.agentId,
      agentName: detail.name,
    });
  };

  const handleEdit = () => {
    if (detail == null) return;
    shell.selectLibraryAgent({
      isMutable: true,
      isCreateAgent: true,
      agentId: detail.agentId,
      agentName: detail.name,
      agentSpec: detail.agentSpec,
    });
  };

  const handleManageSchedules = () => {
    writeOpenSchedulesForAgentSearch({ agentId });
    shell.setSchedulesOpen(true);
  };

  return (
    <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-primary-bg py-2.5 px-2">
      <button
        type="button"
        aria-label="Back to Agents"
        title="Back to Agents"
        className={auiButtonClass({ variant: 'ghost', size: 'icon' })}
        onClick={onBack}
      >
        <Icon name="arrow-left" />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1 truncate text-md font-semibold text-text-primary">
          <button type="button" className="cursor-pointer truncate hover:text-text-primary" onClick={onBack}>
            Agents
          </button>
          <Icon name="chevron-right" className="size-3 shrink-0" />
          <span className="truncate">{detail?.name ?? agentId}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          aria-label="Try agent"
          disabled={detail == null}
          className={auiButtonClass({ variant: 'default', size: 'sm' })}
          onClick={handleTry}
        >
          <Icon name="play" className="size-3.5" />
          Try
        </button>
        {detail != null ? (
          <AgentOverflowMenu
            agentName={detail.name}
            agentSpec={detail.agentSpec}
            canMutate={canMutate}
            canManageSchedules={canManageSchedules}
            onEdit={handleEdit}
            {...(canManageSchedules ? { onManageSchedules: handleManageSchedules } : {})}
            onDeleted={onBack}
          />
        ) : null}
      </div>
    </header>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    AgentDetailsHeader: typeof AgentDetailsHeader;
  }
}
