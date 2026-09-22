'use client';

import { useResourcePermissions } from '../../hooks/useResourcePermissions.js';
import { Icon } from '../../icons/Icon.js';
import { useOptionalServer } from '../../server/ServerContext.js';
import { useShellMode } from '../../server/ShellModeContext.js';
import { useSlot } from '../../theme/SlotsProvider.js';
import { AgentOverflowMenu } from '../AgentOverflowMenu.js';
import { auiButtonClass } from '../lib/buttonClasses.js';
import { cn } from '../lib/cn.js';
import { PageHeader, pageHeaderTitleClassName } from '../PageHeader.js';
import { Button } from '../primitives/Button.js';
import type { AgentDetailsHeaderProps } from './types.js';

export function AgentDetailsHeader({ agentId, detail, onBack }: AgentDetailsHeaderProps) {
  const shell = useShellMode();
  const builder = useOptionalServer();
  const { allows } = useResourcePermissions({ resourceType: 'agent', resourceIds: [agentId] });
  const canMutate = shell.isComposerEnabled && detail != null && builder != null;
  const canUse = allows(agentId, 'USE');
  const canManage = allows(agentId, 'MANAGE');
  const canDelete = allows(agentId, 'DELETE');
  const PermissionGuard = useSlot('PermissionGuard');

  const handleTry = () => {
    if (!canUse || detail == null) return;
    shell.selectLibraryAgent({
      isMutable: false,
      agentId: detail.agentId,
      agentName: detail.name,
    });
  };

  const handleEdit = () => {
    if (!canManage || detail == null) return;
    shell.selectLibraryAgent({
      isMutable: true,
      isCreateAgent: true,
      agentId: detail.agentId,
      agentName: detail.name,
      ...(detail.description === undefined ? {} : { description: detail.description }),
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
          <PermissionGuard allowed={canUse}>
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
          </PermissionGuard>
          {detail != null ? (
            <AgentOverflowMenu
              agentName={detail.name}
              {...(detail.description === undefined ? {} : { description: detail.description })}
              agentSpec={detail.agentSpec}
              canMutate={canMutate}
              canUse={canUse}
              canManage={canManage}
              canDelete={canDelete}
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
