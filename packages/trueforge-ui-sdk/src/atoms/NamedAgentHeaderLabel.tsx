'use client';

import { Icon } from '../icons/Icon.js';
import { useOptionalShellMode } from '../server/ShellModeContext.js';
import { cn } from './lib/cn.js';

/** Left-of-header title for a named agent, including its mutable edit state. */
export function NamedAgentHeaderLabel({ className }: { className?: string }) {
  const shell = useOptionalShellMode();
  if (shell == null || shell.mode.status !== 'active') return null;

  const name = shell.mode.agentName ?? shell.mode.agentId;
  if (name == null || name.length === 0) return null;

  return (
    <h1
      className={cn('flex min-w-0 items-center gap-1.5 px-1 text-sm font-medium text-text-primary', className)}
      title={name}
    >
      <Icon name="robot" className="size-3.5 shrink-0" />
      <span className="truncate">{name}</span>
      {shell.mode.isMutable ? (
        <span className="bg-secondary-bg text-text-secondary inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium">
          <Icon name="pencil" className="size-3" />
          Editing
        </span>
      ) : null}
    </h1>
  );
}
