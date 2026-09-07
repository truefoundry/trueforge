'use client';

import { useEffect, useState } from 'react';

import { Icon } from '../../icons/Icon.js';
import { buildAgentSessionShareUrl } from '../../utils/sessionShareUrl.js';
import { auiButtonClass } from '../lib/buttonClasses.js';
import { cn } from '../lib/cn.js';
import { LightTooltip } from '../primitives/Tooltip.js';
import type { AgentSessionDetailHeaderProps } from './types.js';

export { buildAgentSessionShareUrl } from '../../utils/sessionShareUrl.js';

export function AgentSessionDetailHeader({
  title,
  sessionId,
  agentId,
  createdAt,
  view,
  onClose,
  resumeHref,
  onResume,
  resumeLabel,
}: AgentSessionDetailHeaderProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copySessionLink = async () => {
    try {
      await navigator.clipboard.writeText(buildAgentSessionShareUrl({ sessionId, agentId, createdAt, view }));
      setCopied(true);
    } catch {
      // Clipboard may be unavailable; ignore.
    }
  };

  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <h2 className="min-w-0 truncate text-sm font-semibold text-text-primary">{title}</h2>
        <code className="min-w-0 truncate font-mono text-xs text-text-secondary">{sessionId}</code>
        <LightTooltip title={copied ? 'Copied' : 'Copy session link'} dismissOnClick={false}>
          <button
            type="button"
            aria-label="Copy session link"
            className={cn(
              'inline-flex size-6 shrink-0 items-center justify-center rounded-md text-text-secondary',
              'hover:bg-ghost-button-hover hover:text-text-primary',
            )}
            onClick={() => void copySessionLink()}
          >
            <Icon name="link" className="size-3.5" />
          </button>
        </LightTooltip>
      </div>
      {resumeLabel != null && resumeHref != null ? (
        <a
          href={resumeHref}
          target="_blank"
          rel="noopener noreferrer"
          className={auiButtonClass({ variant: 'outline', size: 'sm' })}
        >
          {resumeLabel}
          <Icon name="square-arrow-out-up-right" size="0.875em" className="shrink-0" />
        </a>
      ) : resumeLabel != null && onResume != null ? (
        <button type="button" className={auiButtonClass({ variant: 'outline', size: 'sm' })} onClick={onResume}>
          {resumeLabel}
        </button>
      ) : null}
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
