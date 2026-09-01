import type { TrueForge, TrueForgeApi } from '@truefoundry/trueforge-sdk';
import type { AgentSessionsServer, SessionListEntry } from '../../server/types.js';
import { toListResult, toUiAgentSpec } from './chatServer.js';
import { createTrueForgeClient, type CreateTrueForgeClientOptions } from './client.js';
import { toUiEventItem } from './toUiTurnState.js';
import type { HarnessAgentSpec } from './types.js';

export type CreateHarnessAgentSessionsServerOptions = CreateTrueForgeClientOptions & {
  client?: TrueForge;
};

function toIsoDate(value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ISO timestamp: ${value}`);
  }
  return date;
}

function toSessionListEntry(session: TrueForgeApi.Session): SessionListEntry<HarnessAgentSpec> {
  return {
    id: session.id,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    lastActivityAt: session.updatedAt,
    // TrueForge listSessions (packages/trueforge/src/apis/sessions.ts) and SessionSchema
    // (packages/trueforge-core/src/agent-session/schemas/session.ts) have no aggregate
    // metrics field yet, so the UI contract stays zero until that API exists.
    metrics: {
      totalTurns: 0,
      totalCostInUsd: 0,
      totalDurationMs: 0,
    },
    ...(session.title === null ? {} : { title: session.title }),
    ...(session.agent.type === 'reference' && session.agent.name !== null ? { agentName: session.agent.name } : {}),
    ...(session.agent.type === 'inline' ? { agentSpec: toUiAgentSpec(session.agent.spec) } : {}),
  };
}

export function createHarnessAgentSessionsServer(
  options: CreateHarnessAgentSessionsServerOptions = {},
): AgentSessionsServer<HarnessAgentSpec> {
  const client = options.client ?? createTrueForgeClient(options);

  return {
    async getAgent({ agentId }) {
      const { data } = await client.agents.get(agentId);
      return {
        agentId: data.id,
        name: data.name,
        agentSpec: toUiAgentSpec(data.manifest),
      };
    },
    async getCodeSnippets({ agentId }) {
      const { data } = await client.internal.agents.getCodeSnippets(agentId);
      return data.snippets;
    },
    async listSessions(requestParams = {}) {
      const page = await client.sessions.list({
        ...(requestParams.limit === undefined ? {} : { limit: requestParams.limit }),
        ...(requestParams.order === undefined ? {} : { order: requestParams.order }),
        ...(requestParams.pageToken === undefined ? {} : { pageToken: requestParams.pageToken }),
        ...(requestParams.startTimestamp === undefined
          ? {}
          : { startTimestamp: toIsoDate(requestParams.startTimestamp) }),
        ...(requestParams.endTimestamp === undefined ? {} : { endTimestamp: toIsoDate(requestParams.endTimestamp) }),
        ...(requestParams.agentId === undefined || requestParams.agentId.length === 0
          ? {}
          : { agentId: requestParams.agentId }),
      });
      return toListResult(page, toSessionListEntry);
    },
    async listSessionEvents({ sessionId, pageToken, limit }) {
      const page = await client.sessions.listEvents(sessionId, {
        ...(pageToken === undefined ? {} : { pageToken }),
        ...(limit === undefined ? {} : { limit }),
      });
      return toListResult(page, toUiEventItem);
    },
  };
}
