'use client';

import { useCallback, useState, type MouseEvent } from 'react';

import { Icon } from '../../icons/Icon.js';
import type { SandboxEnvironmentStatus } from '../../server/types.js';
import { auiButtonClass } from '../lib/buttonClasses.js';
import { Badge, type BadgeVariant } from '../primitives/Badge.js';
import { Tooltip } from '../primitives/Tooltip.js';

const STATUS_CONFIG: Record<
  SandboxEnvironmentStatus,
  { label: string; variant: BadgeVariant; icon: 'loader' | 'check' | 'triangle-exclamation' }
> = {
  pending: { label: 'Building', variant: 'info', icon: 'loader' },
  ready: { label: 'Ready', variant: 'success', icon: 'check' },
  failed: { label: 'Failed', variant: 'destructive', icon: 'triangle-exclamation' },
};

function FailedStatusReason({ reason }: { reason: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      // Row click opens the environment form; keep copy from triggering that.
      event.stopPropagation();
      void navigator.clipboard.writeText(reason).then(
        () => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        },
        () => undefined,
      );
    },
    [reason],
  );

  return (
    <span className="flex max-w-md items-start gap-2">
      <span className="min-w-0 flex-1 text-left break-words whitespace-pre-wrap">{reason}</span>
      <button
        type="button"
        aria-label={copied ? 'Copied' : 'Copy failure message'}
        title={copied ? 'Copied' : 'Copy'}
        className={auiButtonClass({ variant: 'ghost', size: 'icon', className: 'size-6 shrink-0' })}
        onClick={handleCopy}
      >
        <Icon name={copied ? 'check' : 'copy'} size="0.875rem" />
      </button>
    </span>
  );
}

export function EnvironmentStatusBadge({
  status,
  statusReason,
}: {
  status: SandboxEnvironmentStatus;
  statusReason?: string | null;
}) {
  const config = STATUS_CONFIG[status];
  const badge = (
    <Badge variant={config.variant} shape="rounded" size="sm">
      <Icon
        name={config.icon}
        className={config.icon === 'loader' ? 'size-3.5 shrink-0 animate-spin' : 'size-3.5 shrink-0'}
      />
      {config.label}
    </Badge>
  );

  if (status === 'failed' && statusReason != null && statusReason.length > 0) {
    return (
      <Tooltip
        content={<FailedStatusReason reason={statusReason} />}
        className="max-w-md whitespace-normal"
        dismissOnClick={false}
      >
        {badge}
      </Tooltip>
    );
  }
  return badge;
}
