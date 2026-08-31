/**
 * Harness `AgentSessionsServer` adapter for agent-detail UI
 * (Overview, Use In Code, sessions list, event timeline).
 *
 * Code-snippets is Fern-excluded (`x-fern-ignore`), so it goes through
 * `client.fetch` and maps wire snake_case → UI camelCase.
 */
import type { TrueForge, TrueForgeApi } from '@truefoundry/trueforge-sdk';
import type {
  AgentDetail,
  AgentSessionsServer,
  CodeSnippet,
  ListSessionsParams,
  SessionListEntry,
  SessionListMetrics,
} from '../../server/types.js';
import { toListResult, toUiAgentSpec, toUiEventItem } from './chatServer.js';
import { createTrueForgeClient, type CreateTrueForgeClientOptions } from './client.js';
import type { HarnessAgentSpec } from './types.js';

export type CreateHarnessSessionsServerOptions = CreateTrueForgeClientOptions & {
  /** Injected client — skips creating one from options. */
  client?: TrueForge;
};

/** Harness Session wire has no aggregated metrics yet — zeros until the API grows them. */
const EMPTY_SESSION_LIST_METRICS: SessionListMetrics = {
  totalTurns: 0,
  totalCostInUsd: 0,
  totalDurationMs: 0,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toIsoDate(iso: string): Date {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ISO timestamp: ${iso}`);
  }
  return date;
}

export function toUiAgentDetail(agent: TrueForgeApi.Agent): AgentDetail<HarnessAgentSpec> {
  return {
    agentId: agent.id,
    name: agent.name,
    agentSpec: toUiAgentSpec(agent.manifest),
  };
}

export function toUiSessionListEntry(session: TrueForgeApi.Session): SessionListEntry<HarnessAgentSpec> {
  return {
    id: session.id,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    // Wire Session has no last_activity; updatedAt is the closest activity signal.
    lastActivityAt: session.updatedAt,
    metrics: EMPTY_SESSION_LIST_METRICS,
    ...(session.title === null ? {} : { title: session.title }),
    ...(session.agent.type === 'reference' && session.agent.name !== null ? { agentName: session.agent.name } : {}),
    ...(session.agent.type === 'inline' ? { agentSpec: toUiAgentSpec(session.agent.spec) } : {}),
  };
}

/** Map Fern-excluded `/code-snippets` wire body onto runtime `CodeSnippet[]`. */
export function toUiCodeSnippets(body: unknown): CodeSnippet[] {
  if (!isRecord(body) || !isRecord(body.data) || !Array.isArray(body.data.snippets)) {
    throw new Error('Invalid code-snippets response');
  }
  return body.data.snippets.map(entry => {
    if (!isRecord(entry) || !isRecord(entry.sample_code)) {
      throw new Error('Invalid code-snippet entry');
    }
    const labelName = entry.label_name;
    const language = entry.language;
    const icon = entry.icon;
    const stream = entry.sample_code.stream;
    const nonStream = entry.sample_code.non_stream;
    if (typeof labelName !== 'string' || typeof language !== 'string') {
      throw new Error('Code snippet must carry string label_name and language');
    }
    if (typeof stream !== 'string' || typeof nonStream !== 'string') {
      throw new Error('Code snippet sample_code must carry string stream and non_stream');
    }
    return {
      labelName,
      language,
      ...(typeof icon === 'string' ? { icon } : {}),
      sampleCode: { stream, nonStream },
    };
  });
}

export function createHarnessSessionsServer(
  options: CreateHarnessSessionsServerOptions = {},
): AgentSessionsServer<HarnessAgentSpec> {
  const client = options.client ?? createTrueForgeClient(options);

  return {
    async getAgent({ agentId }) {
      const response = await client.agents.get(agentId);
      return toUiAgentDetail(response.data);
    },

    async getCodeSnippets({ agentId }) {
      const response = await client.fetch(`api/v1/agents/${encodeURIComponent(agentId)}/code-snippets`);
      if (!response.ok) {
        throw new Error(`getCodeSnippets failed: ${response.status} ${response.statusText}`);
      }
      return toUiCodeSnippets(await response.json());
    },

    async listSessions(request: ListSessionsParams = {}) {
      const page = await client.sessions.list({
        ...(request.limit === undefined ? {} : { limit: request.limit }),
        ...(request.order === undefined ? {} : { order: request.order }),
        ...(request.pageToken === undefined ? {} : { pageToken: request.pageToken }),
        ...(request.agentId === undefined || request.agentId.length === 0 ? {} : { agentId: request.agentId }),
        ...(request.startTimestamp === undefined ? {} : { startTimestamp: toIsoDate(request.startTimestamp) }),
        ...(request.endTimestamp === undefined ? {} : { endTimestamp: toIsoDate(request.endTimestamp) }),
      });
      return toListResult(page, toUiSessionListEntry);
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
