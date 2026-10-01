import type { SandboxEnvironmentStatus } from '../../server/types.js';
import { Badge, type BadgeVariant } from '../primitives/Badge.js';
import { Tooltip } from '../primitives/Tooltip.js';

const STATUS_CONFIG: Record<SandboxEnvironmentStatus, { label: string; variant: BadgeVariant }> = {
  pending: { label: 'Pending', variant: 'info' },
  ready: { label: 'Ready', variant: 'success' },
  failed: { label: 'Failed', variant: 'destructive' },
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
      {config.label}
    </Badge>
  );

  if (status === 'failed' && statusReason != null && statusReason.length > 0) {
    return <Tooltip content={statusReason}>{badge}</Tooltip>;
  }
  return badge;
}
