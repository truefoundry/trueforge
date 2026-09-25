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
  resumeHref,
  onResume,
  resumeLabel,
  canResume = true,
  canShare = true,
}: AgentSessionDetailHeaderProps) {
  const PermissionGuard = useSlot('PermissionGuard');
  const ShareSessionDialog = useSlot('ShareSessionDialog');

  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-border p-3">
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
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    AgentSessionDetailHeader: typeof AgentSessionDetailHeader;
  }
}
