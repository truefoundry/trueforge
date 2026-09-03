/**
 * AgentSpec → PUT `/internal/tfg/agents` body fields (domain → SF; inverse of mapSfyMcpServers / mapEnabledModels).
 */
import type { AgentSpec } from '@truefoundry/trueforge-core/agent-session';

import type { PutRemoteAgentInput } from './TrueFoundryServiceFoundryServerClient';

export function toPutRemoteAgentPayload({
  name,
  manifest,
}: {
  name: string;
  manifest: AgentSpec;
}): Omit<PutRemoteAgentInput, 'accessToken'> {
  return {
    name,
    description: manifest.instructions ?? name,
    model: manifest.model.name,
    ...(manifest.mcp_servers === undefined ? {} : { mcp_servers: manifest.mcp_servers.map(server => server.name) }),
  };
}
