'use client';

import { Icon } from '../../icons/Icon.js';
import { useShellMode } from '../../server/ShellModeContext.js';
import { auiButtonClass } from '../lib/buttonClasses.js';
import type { AgentDetailsHeaderProps } from './types.js';

export function AgentDetailsHeader({ agentId, detail, onBack }: AgentDetailsHeaderProps) {
  const shell = useShellMode();
  const canEdit = shell.isComposerEnabled && detail != null;

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
    <header className="shrink-0 border-b border-border bg-primary-bg">
      <div className="flex min-w-0 flex-wrap items-center gap-2 px-3 py-2">
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
          <div className="flex min-w-0 items-center gap-1 text-xs text-text-secondary">
            <button type="button" className="cursor-pointer truncate hover:text-text-primary" onClick={onBack}>
              Agents
            </button>
            <Icon name="chevron-right" className="size-3 shrink-0" />
            <span className="truncate">{detail?.name ?? agentId}</span>
          </div>
          <h1 className="truncate text-lg font-semibold tracking-tight text-text-primary">{detail?.name ?? agentId}</h1>
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
          {canEdit ? (
            <button
              type="button"
              aria-label="Edit agent"
              className={auiButtonClass({ variant: 'outline', size: 'sm' })}
              onClick={handleEdit}
            >
              <Icon name="pencil" className="size-3.5" />
              Edit
            </button>
          ) : null}
        </div>
      </div>
    </header>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    AgentDetailsHeader: typeof AgentDetailsHeader;
  }
}
