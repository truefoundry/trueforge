'use client';

import { useOptionalShellMode } from '../server/ShellModeContext.js';
import { cn } from './lib/cn.js';

/** Left-of-header title for an immutable (named) agent chat. Hidden for idle / draft. */
export function NamedAgentHeaderLabel({ className }: { className?: string }) {
  const shell = useOptionalShellMode();
  if (shell == null || shell.mode.status !== 'active' || shell.mode.isMutable) return null;

  const name = shell.mode.agentName ?? shell.mode.agentId;
  if (name == null || name.length === 0) return null;

  return (
    <h1 className={cn('min-w-0 truncate px-1 text-sm font-medium text-foreground', className)} title={name}>
      {name}
    </h1>
  );
}
