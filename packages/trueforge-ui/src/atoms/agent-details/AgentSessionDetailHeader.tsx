'use client';

import { Icon } from '../../icons/Icon.js';
import { useSlot } from '../../theme/SlotsProvider.js';
import { auiButtonClass } from '../lib/buttonClasses.js';
import { cn } from '../lib/cn.js';
import { Button } from '../primitives/Button.js';
import type { AgentSessionDetailHeaderProps } from './types.js';

export { buildAgentSessionShareUrl } from '../../utils/sessionShareUrl.js';

function SessionsShareTrigger({ disabled }: { disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} className={auiButtonClass({ variant: 'secondary', size: 'large' })}>
      <Icon name="share" />
      Share
    </button>
  );
}

export function AgentSessionDetailHeader({
  title,
  sessionId,
  onClose,
  metadata,
  resumeHref,
  onResume,
  resumeLabel,
  canResume = true,
  canShare = true,
}: AgentSessionDetailHeaderProps) {
  const PermissionGuard = useSlot('PermissionGuard');
  const ShareSessionDialog = useSlot('ShareSessionDialog');
  const hasMetadata = metadata != null && Object.keys(metadata).length > 0;

  return (
    <div className="flex shrink-0 flex-col border-b border-border">
      <div className="flex shrink-0 items-center gap-3 p-3">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 pb-0.5">
          <h2 className="min-w-0 truncate text-sm font-semibold leading-none text-text-primary">{title}</h2>
          <code className="min-w-0 truncate font-mono text-xs leading-none text-text-secondary">{sessionId}</code>
        </div>
        {canShare ? (
          <ShareSessionDialog sessionId={sessionId} trigger={<SessionsShareTrigger />} />
        ) : (
          <PermissionGuard allowed={false}>
            <SessionsShareTrigger />
          </PermissionGuard>
        )}
        {resumeLabel != null && resumeHref != null && canResume ? (
          <a
            href={resumeHref}
            target="_blank"
            rel="noopener noreferrer"
            className={auiButtonClass({ variant: 'secondary', size: 'large' })}
          >
            {resumeLabel}
            <Icon name="square-arrow-out-up-right" className="shrink-0" />
          </a>
        ) : resumeLabel != null && resumeHref != null ? (
          <PermissionGuard allowed={false}>
            <Button.Secondary type="button" size="large">
              {resumeLabel}
              <Icon name="square-arrow-out-up-right" className="shrink-0" />
            </Button.Secondary>
          </PermissionGuard>
        ) : resumeLabel != null && onResume != null ? (
          <PermissionGuard allowed={canResume}>
            <Button.Secondary
              type="button"
              size="large"
              onClick={() => {
                if (canResume) onResume();
              }}
            >
              {resumeLabel}
            </Button.Secondary>
          </PermissionGuard>
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
      {hasMetadata ? (
        <div
          className="flex flex-wrap items-center gap-1.5 border-t border-border px-3 py-2"
          data-slot="session-metadata-tags"
        >
          {Object.entries(metadata).map(([key, value]) => (
            <div
              key={key}
              className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-secondary-bg/40 px-2.5 py-1 text-xs"
            >
              <Icon name="tag" className="size-3 shrink-0 text-text-secondary" />
              <span className="shrink-0 font-mono text-text-secondary">{key}</span>
              <span className="truncate font-mono font-medium text-text-primary" title={value}>
                {value}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    AgentSessionDetailHeader: typeof AgentSessionDetailHeader;
  }
}
