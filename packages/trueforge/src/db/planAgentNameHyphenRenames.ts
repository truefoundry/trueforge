/**
 * One-shot rename plan for agent registry names that still use "." or "_".
 *
 * Behavior:
 * - Skip names that are already hyphen-only (no "." / "_").
 * - Replace "." and "_" with "-".
 * - Always append `-<4 hex chars>` (no occupancy / collision check).
 * - Truncate the hyphenated base so `base + suffix` is ≤ 64; strip trailing hyphens after truncate.
 * - Result is meant for `AgentNameSchema`; truncated names may look inconsistent — that is OK.
 *
 * Example: `my.agent` → `my-agent-a1b2` (suffix random each call).
 */
import { randomBytes } from 'node:crypto';

export interface AgentNameRow {
  id: string;
  tenant_id: string;
  name: string;
}

export interface AgentNameRename {
  id: string;
  tenant_id: string;
  from: string;
  to: string;
}

const MAX_LEN = 64;

export function planAgentNameHyphenRenames(agents: readonly AgentNameRow[]): AgentNameRename[] {
  const renames: AgentNameRename[] = [];
  for (const agent of agents) {
    if (!/[._]/.test(agent.name)) {
      continue;
    }
    const suffix = `-${randomBytes(2).toString('hex')}`;
    const base = agent.name
      .replace(/[._]/g, '-')
      .slice(0, MAX_LEN - suffix.length)
      .replace(/-+$/, '');
    renames.push({ id: agent.id, tenant_id: agent.tenant_id, from: agent.name, to: `${base}${suffix}` });
  }
  return renames;
}
