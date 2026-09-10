'use client';

import { Icon } from '../../icons/Icon.js';
import { useOptionalServer } from '../../server/ServerContext.js';
import { useShellMode } from '../../server/ShellModeContext.js';
import { AgentOverflowMenu } from '../AgentOverflowMenu.js';
import { auiButtonClass } from '../lib/buttonClasses.js';
import { cn } from '../lib/cn.js';
import { PageHeader, pageHeaderTitleClassName } from '../PageHeader.js';
import { Button } from '../primitives/Button.js';
import type { AgentDetailsHeaderProps } from './types.js';

export function AgentDetailsHeader({ agentId, detail, onBack }: AgentDetailsHeaderProps) {
  const shell = useShellMode();
  const builder = useOptionalServer();
  const canMutate = shell.isComposerEnabled && detail != null && builder != null;

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

  return (
    <PageHeader
      className="bg-primary-bg"
      start={
        <button
          type="button"
          aria-label="Back to Agents"
          title="Back to Agents"
          className={auiButtonClass({ variant: 'ghost', size: 'icon' })}
          onClick={onBack}
        >
          <Icon name="arrow-left" />
        </button>
      }
      title={
        <div className={cn('flex min-w-0 items-center gap-1', pageHeaderTitleClassName)}>
          <button type="button" className="cursor-pointer truncate hover:text-text-primary" onClick={onBack}>
            Agents
          </button>
          <Icon name="chevron-right" className="size-3 shrink-0" />
          <span className="truncate">{detail?.name ?? agentId}</span>
        </div>
      }
      end={
        <>
          <Button.Primary
            type="button"
            aria-label="Try agent"
            size="large"
            disabled={detail == null}
            onClick={handleTry}
          >
            <Icon name="play" className="size-3.5" />
            Try
          </Button.Primary>
          {detail != null ? (
            <AgentOverflowMenu
              agentName={detail.name}
              agentSpec={detail.agentSpec}
              canMutate={canMutate}
              canManageSchedules={false}
              onEdit={handleEdit}
              onDeleted={onBack}
            />
          ) : null}
        </>
      }
    />
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    AgentDetailsHeader: typeof AgentDetailsHeader;
  }
}
