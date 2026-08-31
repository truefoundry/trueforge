'use client';

import { Icon } from '../../icons/Icon.js';
import { cn } from '../lib/cn.js';
import type { AgentSessionDetailHeaderProps } from './types.js';

export function AgentSessionDetailHeader({ title, sessionId, onClose }: AgentSessionDetailHeaderProps) {
  const copySessionId = async () => {
    try {
      await navigator.clipboard.writeText(sessionId);
    } catch {
      // Clipboard may be unavailable; ignore.
    }
  };

  return (
    <div className="flex shrink-0 items-start gap-3 border-b border-border px-4 py-3">
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-sm font-semibold text-text-primary">{title}</h2>
        <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-text-secondary">
          <code className="truncate font-mono">{sessionId}</code>
          <button
            type="button"
            aria-label="Copy session id"
            className={cn(
              'inline-flex size-6 shrink-0 items-center justify-center rounded-md text-text-secondary',
              'hover:bg-ghost-button-hover hover:text-text-primary',
            )}
            onClick={() => void copySessionId()}
          >
            <Icon name="copy" className="size-3.5" />
          </button>
        </div>
      </div>
      <button
        type="button"
        aria-label="Close session details"
        className={cn(
          'inline-flex size-8 shrink-0 items-center justify-center rounded-md text-text-secondary',
          'hover:bg-ghost-button-hover hover:text-text-primary',
        )}
        onClick={onClose}
      >
        <Icon name="xmark" className="size-4" />
      </button>
    </div>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    AgentSessionDetailHeader: typeof AgentSessionDetailHeader;
  }
}
