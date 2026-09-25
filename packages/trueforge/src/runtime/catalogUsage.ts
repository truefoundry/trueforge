/**
 * Delete pre-check for settings catalog entries. Agents reference models, MCP servers, and
 * skills by name, so removing an entry an agent still lists would leave that agent unrunnable.
 */
import type { AgentCatalogEntity, AgentCatalogUsageRow, IAgentStore } from '../db/agentStore';

/** How many agent names a conflict message spells out before summarising the rest. */
const NAMED_AGENTS_LIMIT = 3;

const ENTITY_LABELS: Record<AgentCatalogEntity, string> = {
  model_provider: 'model provider',
  model: 'model',
  mcp_server: 'MCP server',
  skill: 'skill',
};

function groupAgentsByReference(usage: readonly AgentCatalogUsageRow[]): Map<string, string[]> {
  const byReference = new Map<string, string[]>();
  for (const row of usage) {
    const agents = byReference.get(row.reference_name);
    if (agents === undefined) {
      byReference.set(row.reference_name, [row.agent_name]);
    } else if (!agents.includes(row.agent_name)) {
      agents.push(row.agent_name);
    }
  }
  return byReference;
}

/** Phrased without a leading verb so both delete and "update drops an entry" can use it. */
function conflictMessage({
  entity,
  usage,
}: {
  entity: AgentCatalogEntity;
  usage: readonly AgentCatalogUsageRow[];
}): string {
  const label = ENTITY_LABELS[entity];
  const clauses = [...groupAgentsByReference(usage)].map(([reference, agents]) => {
    const named = agents.slice(0, NAMED_AGENTS_LIMIT).join(', ');
    const remaining = agents.length - NAMED_AGENTS_LIMIT;
    const overflow = remaining > 0 ? `, and ${String(remaining)} more` : '';
    return `${label} "${reference}" is used by ${agents.length === 1 ? 'agent' : 'agents'} ${named}${overflow}`;
  });
  return `Still in use — ${clauses.join('; ')}. Delete those agents first.`;
}

/** Returns the 409 message when an agent still references one of `names`, else undefined. */
export async function findCatalogUsageConflict<TTransaction>(
  input: {
    agentStore: IAgentStore<TTransaction>;
    tenant_id: string;
    entity: AgentCatalogEntity;
    names: readonly string[];
  },
  transaction?: TTransaction,
): Promise<string | undefined> {
  const usage = await input.agentStore.listAgentCatalogUsage(
    { tenant_id: input.tenant_id, entity: input.entity, names: input.names },
    transaction,
  );
  if (usage.length === 0) {
    return undefined;
  }
  return conflictMessage({ entity: input.entity, usage });
}
