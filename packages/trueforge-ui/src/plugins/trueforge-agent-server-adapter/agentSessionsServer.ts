import type { TrueForge, TrueForgeApi } from '@truefoundry/trueforge-sdk';
import type { AgentSessionsServer, CodeSnippet, ListResult, SessionListEntry } from '../../server/types.js';
import { toUiAgentSpec } from './chatServer.js';
import { createTrueForgeClient, type CreateTrueForgeClientOptions } from './client.js';
import { toUiEventItem } from './toUiTurnState.js';
import type { HarnessAgentSpec } from './types.js';

export type CreateHarnessAgentSessionsServerOptions = CreateTrueForgeClientOptions & {
  client?: TrueForge;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null;
}

function parseSnippet(value: unknown): CodeSnippet | null {
  if (!isRecord(value) || !isRecord(value.sample_code)) return null;
  const { label_name: labelName, language, icon, sample_code: sampleCode } = value;
  if (
    typeof labelName !== 'string' ||
    typeof language !== 'string' ||
    typeof sampleCode.stream !== 'string' ||
    typeof sampleCode.non_stream !== 'string'
  ) {
    return null;
  }
  return {
    labelName,
    language,
    ...(typeof icon === 'string' ? { icon } : {}),
    sampleCode: {
      stream: sampleCode.stream,
      nonStream: sampleCode.non_stream,
    },
  };
}

interface HarnessPageSource<T> {
  data: T[];
  response: { pagination: TrueForgeApi.TokenPagination };
}

function toListResult<TSource, TResult>(
  page: HarnessPageSource<TSource>,
  map: (item: TSource) => TResult,
): ListResult<TResult> {
  const data = page.data.map(map);
  const token = page.response.pagination.nextPageToken;
  return {
    data,
    ...(token === undefined ? {} : { nextPageToken: token }),
  };
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
  const request = options.fetch ?? fetch;
  const baseUrl = options.baseUrl?.replace(/\/$/, '') ?? '';

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
      const response = await request(`${baseUrl}/api/v1/agents/${encodeURIComponent(agentId)}/code-snippets`, {
        headers: options.token === undefined ? undefined : { Authorization: `Bearer ${options.token}` },
      });
      if (!response.ok) {
        throw new Error(`Failed to load agent code snippets (${response.status}).`);
      }
      const body: unknown = await response.json();
      if (!isRecord(body) || !isRecord(body.data) || !Array.isArray(body.data.snippets)) {
        throw new Error('Agent code snippets response is invalid.');
      }
      return body.data.snippets.map(parseSnippet).filter(snippet => snippet != null);
    },
    async listSessions(requestParams = {}) {
      const page = await client.sessions.list({
        ...(requestParams.limit === undefined ? {} : { limit: requestParams.limit }),
        ...(requestParams.order === undefined ? {} : { order: requestParams.order }),
        ...(requestParams.pageToken === undefined ? {} : { pageToken: requestParams.pageToken }),
        ...(requestParams.startTimestamp === undefined
          ? {}
          : { startTimestamp: new Date(requestParams.startTimestamp) }),
        ...(requestParams.endTimestamp === undefined ? {} : { endTimestamp: new Date(requestParams.endTimestamp) }),
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
