import type { ScheduleStatus } from '../../server/types.js';
import { Badge } from '../primitives/Badge.js';

export function ScheduleStatusBadge({ status }: { status: ScheduleStatus }) {
  const active = status === 'active';
  return (
    <Badge variant={active ? 'success' : 'warning'} shape="pill" size="md" dot>
      {active ? 'Active' : 'Paused'}
    </Badge>
  );
}
