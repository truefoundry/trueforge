'use client';

import { useNamedAgentHeaderVisible } from '../hooks/useChatChromeActionsVisible.js';
import { Icon } from '../icons/Icon.js';
import { useOptionalShellMode } from '../server/ShellModeContext.js';
import { cn } from './lib/cn.js';

/** Left-of-header title for an immutable (named) agent chat. Hidden for idle / draft. */
export function NamedAgentHeaderLabel({ className }: { className?: string }) {
  const shell = useOptionalShellMode();
  const visible = useNamedAgentHeaderVisible();
  if (!visible || shell == null || shell.mode.status !== 'active') return null;

  const name = shell.mode.agentName ?? shell.mode.agentId;
  if (name == null || name.length === 0) return null;

  return (
    <h1
      className={cn('flex min-w-0 items-center gap-1.5 px-1 text-sm font-medium text-text-primary', className)}
      title={name}
    >
      <Icon name="robot" className="size-3.5 shrink-0" />
      <span className="truncate">{name}</span>
    </h1>
  );
}
