'use client';

import { Icon } from '../../icons/Icon.js';
import { useShellMode } from '../../server/ShellModeContext.js';
import { Button } from '../primitives/Button.js';
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
      agentId: detail.agentId,
      agentName: detail.name,
      agentSpec: detail.agentSpec,
    });
  };

  return (
    <header className="shrink-0 border-b border-border bg-primary-bg">
      <div className="flex min-w-0 flex-wrap items-center gap-2 px-3 py-2">
        <Button.Ghost
          type="button"
          aria-label="Back to Agents Library"
          title="Back to Agents Library"
          size="small"
          className="aspect-square px-0"
          onClick={onBack}
        >
          <Icon name="arrow-left" />
        </Button.Ghost>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1 text-xs text-text-secondary">
            <Button.Ghost
              type="button"
              className="h-auto truncate bg-transparent p-0 text-xs font-normal shadow-none hover:bg-transparent hover:text-text-primary"
              onClick={onBack}
            >
              Agents Library
            </Button.Ghost>
            <Icon name="chevron-right" className="size-3 shrink-0" />
            <span className="truncate">{detail?.name ?? agentId}</span>
          </div>
          <h1 className="truncate text-lg font-semibold tracking-tight text-text-primary">{detail?.name ?? agentId}</h1>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button.Primary
            type="button"
            aria-label="Try agent"
            disabled={detail == null}
            size="small"
            onClick={handleTry}
          >
            <Icon name="play" className="size-3.5" />
            Try
          </Button.Primary>
          {canEdit ? (
            <Button.Secondary type="button" aria-label="Edit agent" size="small" onClick={handleEdit}>
              <Icon name="pencil" className="size-3.5" />
              Edit
            </Button.Secondary>
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
