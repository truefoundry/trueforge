/**
 * `active_executor_id` is `{executorId}.{generation}`. Generation is 4 hex
 * chars from `randomBytes` so a stale in-memory run cannot persist after
 * steal/rebuild. Rows minted before this grammar parse as executor-only.
 */
import { randomBytes } from 'node:crypto';

const GENERATION = /^[0-9a-f]{4}$/;

export function parseActiveExecutorId(value: string): { executorId: string; generation: string | undefined } {
  const lastDot = value.lastIndexOf('.');
  if (lastDot <= 0) {
    return { executorId: value, generation: undefined };
  }
  const generation = value.slice(lastDot + 1);
  if (!GENERATION.test(generation)) {
    return { executorId: value, generation: undefined };
  }
  return { executorId: value.slice(0, lastDot), generation };
}

/** `{executorId}.{4 hex chars}`, never equal to `previous`. */
export function mintActiveExecutorId(executorId: string, previous?: string): string {
  const id = parseActiveExecutorId(executorId).executorId;
  for (;;) {
    const next = `${id}.${randomBytes(2).toString('hex')}`;
    if (next !== previous) {
      return next;
    }
  }
}
