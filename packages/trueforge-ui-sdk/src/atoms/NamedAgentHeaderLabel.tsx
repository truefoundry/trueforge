'use client';

import { Icon } from '../icons/Icon.js';
import { useOptionalShellMode } from '../server/ShellModeContext.js';
import { cn } from './lib/cn.js';

/** Left-of-header title for an immutable (named) agent chat. Hidden for idle / draft. */
export function NamedAgentHeaderLabel({ className }: { className?: string }) {
  const shell = useOptionalShellMode();
  if (shell == null || shell.mode.status !== 'active' || shell.mode.isMutable) return null;

  const name = shell.mode.agentName ?? shell.mode.agentId;
  if (name == null || name.length === 0) return null;

  return (
    <h1
      className={cn('flex min-w-0 items-center gap-1.5 px-1 text-sm font-medium text-foreground', className)}
      title={name}
    >
      <Icon name="robot" className="size-3.5 shrink-0" />
      <span className="truncate">{name}</span>
    </h1>
  );
}
