/**
 * Harness `AgentChatServer` adapter for @truefoundry/trueforge-ui.
 *
 * Runtime contract: opaque mounts (`object`), flat `ListResult` (`data` +
 * `nextPageToken`), and `null` normalized to absent. Harness keys MCP mounts by
 * name and returns `null` for optional fields — the maps below bridge both.
 *
 * Skills are name refs on the wire (`Skill`).
 *
 * Session create takes `{ name }` or `{ spec }`; reads carry the
 * `reference`/`inline` discriminator, with reference rows already naming their
 * agent. The UI filters with registry `agentId`.
 */
import type { TrueForge, TrueForgeApi } from '@truefoundry/trueforge-sdk';
import { readSessionIsCreateAgent } from '../../atoms/lib/sessionCreateAgent.js';
import type {
  AgentChatServer,
  CreateSessionRequest,
  ListResult,
  Session,
  Turn,
  TurnInputItem,
  UserMessageContent,
} from '../../server/types.js';
import { createTrueForgeClient, type CreateTrueForgeClientOptions } from './client.js';
import { toUiEventItem, toUiStreamingEvent, toUiTurnState } from './toUiTurnState.js';
import type { HarnessAgentSpec, HarnessMcpServerMount, HarnessSkillMount } from './types.js';

export type { HarnessAgentSpec, HarnessMcpServerMount, HarnessSkillMount } from './types.js';
export type CreateHarnessChatServerOptions = CreateTrueForgeClientOptions & {
  /** Injected client — skips creating one from options. */
  client?: TrueForge;
};

/** UI session with create-agent intent for resume chrome. */
export type HarnessUiSession = Session<HarnessAgentSpec> & { isCreateAgent: boolean };

export type HarnessCreateSessionRequest = CreateSessionRequest<HarnessAgentSpec> & {
  metadata?: Record<string, string>;
};

function toUiMcpServer(server: TrueForgeApi.McpServer): HarnessMcpServerMount {
  return server;
}

function toUiSkill(skill: TrueForgeApi.Skill): HarnessSkillMount {
  return { name: skill.name };
}

/** Drop UI draft `id` before admission; Harness MCP mounts are name-keyed. */
export function toHarnessAgentSpec(spec: HarnessAgentSpec): TrueForgeApi.AgentSpec {
  const { skills, mcpServers, ...rest } = spec;
  return {
    ...rest,
    ...(mcpServers === undefined
      ? {}
      : {
          mcpServers: mcpServers.map(server => {
            // Draft picker may round-trip mounts as `{ id, name, ... }`; strip UI-only `id`.
            if ('id' in server) {
              const { id, ...mount } = server;
              void id;
              return mount;
            }
            return server;
          }),
        }),
    ...(skills === undefined ? {} : { skills: skills.map(({ name }) => ({ name })) }),
  };
}

export function toUiAgentSpec(spec: TrueForgeApi.AgentSpec): HarnessAgentSpec {
  const { mcpServers, skills, ...rest } = spec;
  return {
    ...rest,
    ...(mcpServers ? { mcpServers: mcpServers.map(toUiMcpServer) } : {}),
    ...(skills ? { skills: skills.map(toUiSkill) } : {}),
  };
}

function toUiSession(session: TrueForgeApi.Session): HarnessUiSession {
  return {
    id: session.id,
    isMutable: session.agent.type === 'inline',
    isCreateAgent: readSessionIsCreateAgent(session.metadata),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    ...(session.title === null ? {} : { title: session.title }),
    // `name` is a create-time snapshot, so references whose agent predates it stay
    // unlabelled; `isMutable` alone keeps them out of the composer.
    ...(session.agent.type === 'reference' && session.agent.name !== null ? { agentName: session.agent.name } : {}),
    ...(session.agent.type === 'inline' ? { agentSpec: toUiAgentSpec(session.agent.spec) } : {}),
  };
}

function createSessionMetadata(request: HarnessCreateSessionRequest): Record<string, string> | undefined {
  if (request.metadata === undefined) return undefined;
  return request.metadata;
}

/** Spread drops the interface identity, which is what makes the SDK's index-signature part type accept it. */
function toUiContent(content: TrueForgeApi.UserMessageContent): UserMessageContent {
  return typeof content === 'string' ? content : content.map(part => ({ ...part }));
}

function toUiInput(input: TrueForgeApi.TurnInputItem[]): TurnInputItem[] {
  return input.map(item => (item.type === 'user.message' ? { ...item, content: toUiContent(item.content) } : item));
}

function toUiTurn(turn: TrueForgeApi.Turn): Turn {
  const { previousTurnId, input, state, ...rest } = turn;
  return {
    ...rest,
    state: toUiTurnState(state),
    ...(previousTurnId === null ? {} : { previousTurnId }),
    ...(input === undefined ? {} : { input: toUiInput(input) }),
  };
}

export interface HarnessPageSource<T> {
  data: T[];
  response: { pagination: TrueForgeApi.TokenPagination };
}

export function toListResult<TSource, TResult>(
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

function sequenceNumber(id: string | undefined, fallback: number): number {
  if (id === undefined) return fallback;
  const parsed = Number(id);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function toHarnessContent(content: UserMessageContent): TrueForgeApi.UserMessageContent {
  if (typeof content === 'string') return content;
  return content.map(part => {
    if (part.type === 'text') return part;
    const { name, data } = part;
    if (typeof name !== 'string' || typeof data !== 'string') {
      throw new Error('File attachment must carry a string `name` and a data-URI `data`');
    }
    return { type: 'file', name, data };
  });
}

function toHarnessInput(input: TurnInputItem[]): TrueForgeApi.TurnInputItem[] {
  return input.map(item =>
    item.type === 'user.message' ? { ...item, content: toHarnessContent(item.content) } : item,
  );
}

export function createHarnessChatServer(
  options: CreateHarnessChatServerOptions = {},
): AgentChatServer<HarnessAgentSpec, HarnessUiSession, HarnessCreateSessionRequest> {
  const client = options.client ?? createTrueForgeClient(options);
  return {
    // The sandbox is resolved server-side from the turn, so `sandboxId` is accepted for parity
    // with hosts that address sandboxes directly and deliberately not forwarded.
    async downloadSandboxFile({ sessionId, turnId, path }) {
      const response = await client.sessions.downloadSandboxFile(sessionId, turnId, { path });
      return response.blob();
    },

    async createSession(request) {
      const metadata = createSessionMetadata(request);
      if (request.agentName !== undefined && request.agentName.length > 0) {
        const created = await client.sessions.create({
          agent: { name: request.agentName },
          ...(metadata === undefined ? {} : { metadata }),
        });
        return toUiSession(created.data);
      }
      if (request.agentSpec !== undefined) {
        const created = await client.sessions.create({
          agent: { spec: toHarnessAgentSpec(request.agentSpec) },
          ...(metadata === undefined ? {} : { metadata }),
        });
        return toUiSession(created.data);
      }
      throw new Error('createSession requires agentName or agentSpec');
    },

    async listSessions(request = {}) {
      const page = await client.sessions.list({
        ...(request.limit === undefined ? {} : { limit: request.limit }),
        ...(request.order === undefined ? {} : { order: request.order }),
        ...(request.pageToken === undefined ? {} : { pageToken: request.pageToken }),
        ...(request.agentId === undefined || request.agentId.length === 0 ? {} : { agentId: request.agentId }),
      });
      return toListResult(page, toUiSession);
    },

    async getSession({ sessionId }) {
      const response = await client.sessions.get(sessionId);
      return toUiSession(response.data);
    },

    async deleteSession({ sessionId }) {
      await client.sessions.delete(sessionId);
    },

    async updateSession({ sessionId, agentSpec }) {
      // Named (reference) sessions reject agent updates server-side.
      const response = await client.sessions.update(sessionId, {
        ...(agentSpec === undefined ? {} : { agent: { spec: toHarnessAgentSpec(agentSpec) } }),
      });
      return toUiSession(response.data);
    },

    async *createTurn({
      sessionId,
      input,
      previousTurnId,
    }: {
      sessionId: string;
      input?: TurnInputItem[];
      previousTurnId?: string;
    }) {
      const stream = await client.sessions.createTurnStream(sessionId, {
        ...(input === undefined ? {} : { input: toHarnessInput(input) }),
        ...(previousTurnId === undefined ? {} : { previousTurnId }),
      });
      let fallbackSequence = 0;
      for await (const item of stream.withMetadata()) {
        yield {
          sequenceNumber: sequenceNumber(item.id, fallbackSequence),
          event: toUiStreamingEvent(item.data),
        };
        fallbackSequence += 1;
      }
    },

    /** Resume a live turn; omitted/0 `afterSequenceNumber` replays from the start. */
    async *subscribeToTurn({
      sessionId,
      turnId,
      afterSequenceNumber,
    }: {
      sessionId: string;
      turnId: string;
      afterSequenceNumber?: number;
    }) {
      const stream = await client.sessions.subscribeToTurn(sessionId, turnId, {
        ...(afterSequenceNumber === undefined ? {} : { afterSequenceNumber }),
      });
      let fallbackSequence = 0;
      for await (const item of stream.withMetadata()) {
        yield {
          sequenceNumber: sequenceNumber(item.id, fallbackSequence),
          event: toUiStreamingEvent(item.data),
        };
        fallbackSequence += 1;
      }
    },

    async cancelSession({ sessionId }) {
      await client.sessions.cancel(sessionId);
    },

    async listTurns({ sessionId, limit, pageToken }) {
      const page = await client.sessions.listTurns(sessionId, {
        ...(limit === undefined ? {} : { limit }),
        ...(pageToken === undefined ? {} : { pageToken }),
      });
      return toListResult(page, toUiTurn);
    },

    async getTurn({ sessionId, turnId }) {
      const response = await client.sessions.getTurn(sessionId, turnId);
      return toUiTurn(response.data);
    },

    async listEvents({ sessionId, pageToken, lastTurnId, limit }) {
      const page = await client.sessions.listEvents(sessionId, {
        ...(pageToken === undefined ? {} : { pageToken }),
        ...(lastTurnId === undefined ? {} : { lastTurnId }),
        ...(limit === undefined ? {} : { limit }),
      });
      return toListResult(page, toUiEventItem);
    },
  };
}
