import type { TrueForge, TrueForgeApi } from '@truefoundry/trueforge-sdk';
import { readSessionIsCreateAgent } from '../../atoms/lib/sessionCreateAgent.js';
import type { AgentSessionsServer, SessionListEntry } from '../../server/types.js';
import { toListResult, toUiAgentSpec } from './chatServer.js';
import {
  createTrueForgeClient,
  parseIsoDate,
  resolveTrueForgeBaseUrl,
  type CreateTrueForgeClientOptions,
} from './client.js';
import { toUiEventItem } from './toUiTurnState.js';
import type { HarnessAgentSpec } from './types.js';

export type CreateHarnessAgentSessionsServerOptions = CreateTrueForgeClientOptions & {
  client?: TrueForge;
};

export type HarnessSessionListEntry = SessionListEntry<HarnessAgentSpec> & {
  isCreateAgent: boolean;
  isMutable: boolean;
  sourceType?: 'schedule';
};

function toSessionListEntry(session: TrueForgeApi.Session): HarnessSessionListEntry {
  return {
    id: session.id,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    lastActivityAt: session.updatedAt,
    isCreateAgent: readSessionIsCreateAgent(session.metadata),
    isMutable: session.agent.type === 'inline',
    metrics: {
      totalTurns: session.metrics.totalTurns,
      ...(session.metrics.totalCostInUsd == null ? {} : { totalCostInUsd: session.metrics.totalCostInUsd }),
      totalDurationMs: session.metrics.totalDurationMs,
    },
    ...(session.title === null ? {} : { title: session.title }),
    ...(session.agent.type === 'reference' && session.agent.name !== null ? { agentName: session.agent.name } : {}),
    ...(session.agent.type === 'inline' ? { agentSpec: toUiAgentSpec(session.agent.spec) } : {}),
    ...(session.source?.type === 'schedule' ? { sourceType: session.source.type } : {}),
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
      const absoluteBaseUrl = resolveTrueForgeBaseUrl(options.baseUrl ?? '/');
      const { data } = await client.internal.agents.getCodeSnippets(
        agentId,
        /^https?:\/\//i.test(absoluteBaseUrl) ? { baseUrl: absoluteBaseUrl } : undefined,
      );
      return data.snippets;
    },
    async listSessions(requestParams = {}) {
      const page = await client.sessions.list({
        ...(requestParams.limit === undefined ? {} : { limit: requestParams.limit }),
        ...(requestParams.order === undefined ? {} : { order: requestParams.order }),
        ...(requestParams.pageToken === undefined ? {} : { pageToken: requestParams.pageToken }),
        ...(requestParams.startTimestamp === undefined
          ? {}
          : { startTimestamp: parseIsoDate(requestParams.startTimestamp) }),
        ...(requestParams.endTimestamp === undefined ? {} : { endTimestamp: parseIsoDate(requestParams.endTimestamp) }),
        ...(requestParams.agentId === undefined || requestParams.agentId.length === 0
          ? {}
          : { agentId: requestParams.agentId }),
        ...(requestParams.createdByMe === undefined ? {} : { createdByMe: requestParams.createdByMe }),
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
