import { Icon } from '../../icons/Icon.js';
import type { SandboxEnvironmentStatus } from '../../server/types.js';
import { Badge, type BadgeVariant } from '../primitives/Badge.js';
import { Tooltip } from '../primitives/Tooltip.js';

const STATUS_CONFIG: Record<
  SandboxEnvironmentStatus,
  { label: string; variant: BadgeVariant; icon?: 'check' | 'triangle-exclamation' }
> = {
  pending: { label: 'Building', variant: 'info' },
  ready: { label: 'Ready', variant: 'success', icon: 'check' },
  failed: { label: 'Failed', variant: 'destructive', icon: 'triangle-exclamation' },
};

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
      {config.icon != null ? <Icon name={config.icon} className="size-3.5 shrink-0" /> : null}
      {config.label}
    </Badge>
  );

  if (status === 'failed' && statusReason != null && statusReason.length > 0) {
    return <Tooltip content={statusReason}>{badge}</Tooltip>;
  }
  return badge;
}
