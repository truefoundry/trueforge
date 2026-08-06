/**
 * Harness `AgentUIServer` adapter for @truefoundry/trueforge-ui.
 *
 * The SDK still declares the pre-0.1.6 server contract — mounts carry `id`,
 * list results are `PageResult`, and absent values are `undefined` — while the
 * runtime it delegates to reads `nextPageToken` and tolerates `null`. Harness
 * matches neither exactly: it keys mounts by name and returns `null`. The maps
 * below produce values valid under both contracts at once.
 *
 * Skills are name refs on the wire (`SkillNameRef`); the UI SkillMount only
 * needs `{ id, name }`, so id is derived as the skill name.
 */
import type {
  AgentChatServer,
  AgentSpec,
  McpServerMount,
  PageResult,
  Session,
  SessionEvent,
  SessionEventItem,
  SkillMount,
  TokenPagination,
  Turn,
  TurnInputItem,
  UserMessageContent,
} from '@truefoundry/trueforge-ui';
import type { TrueForgeApi as Harness } from 'trueforge';
import { createHarnessClient, harnessClient, type CreateHarnessClientOptions } from './harnessClient';
export type HarnessSkillMount = SkillMount;
export type HarnessMcpServerMount = McpServerMount & Harness.McpServer;

export interface HarnessAgentSpec extends AgentSpec<Harness.AgentSpecModel, HarnessSkillMount, HarnessMcpServerMount> {
  config?: Harness.RuntimeConfig;
  instructions?: string;
  messages?: Harness.AgentSpecUserMessage[];
  responseFormat?: Harness.ResponseFormat;
  variables?: Record<string, string>;
}

export interface HarnessSession extends Session<HarnessAgentSpec> {
  agentSpec?: HarnessAgentSpec;
  isMutable: boolean;
}

export type CreateHarnessServerOptions = CreateHarnessClientOptions;

/** Mount ids are derived, not stored: Harness returns MCP servers keyed by name. */
function toUiMcpServer(server: Harness.McpServer): HarnessMcpServerMount {
  return { ...server, id: server.name };
}

/** Skill ids are derived from the name ref Harness persists. */
function toUiSkill(skill: Harness.SkillNameRef): HarnessSkillMount {
  return { id: skill.name, name: skill.name };
}

/** Strip UI-only `id` before admission; Harness skills are name refs only. */
function toHarnessAgentSpec(spec: HarnessAgentSpec): Harness.AgentSpec {
  const { skills, mcpServers, ...rest } = spec;
  return {
    ...rest,
    ...(mcpServers === undefined
      ? {}
      : {
          mcpServers: mcpServers.map(server => {
            const { id, ...mount } = server;
            void id;
            return mount;
          }),
        }),
    ...(skills === undefined ? {} : { skills: skills.map(({ name }) => ({ name })) }),
  };
}

function toUiAgentSpec(spec: Harness.AgentSpec): HarnessAgentSpec {
  const { mcpServers, skills, ...rest } = spec;
  return {
    ...rest,
    ...(mcpServers ? { mcpServers: mcpServers.map(toUiMcpServer) } : {}),
    ...(skills ? { skills: skills.map(toUiSkill) } : {}),
  };
}

function toUiSession(session: Harness.Session): HarnessSession {
  // Value agents are draft/mutable; ref agents are named/immutable.
  const isMutable = session.agent.type === 'value';
  return {
    id: session.id,
    isMutable,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    ...(session.title === null ? {} : { title: session.title }),
    ...(session.agent.type === 'value' ? { agentSpec: toUiAgentSpec(session.agent.agentSpec) } : {}),
  };
}

/** Spread drops the interface identity, which is what makes the SDK's index-signature part type accept it. */
function toUiContent(content: Harness.UserMessageContent): UserMessageContent {
  return typeof content === 'string' ? content : content.map(part => ({ ...part }));
}

function toUiInput(input: Harness.TurnInputItem[]): TurnInputItem[] {
  return input.map(item => (item.type === 'user.message' ? { ...item, content: toUiContent(item.content) } : item));
}

function toUiTurn(turn: Harness.Turn): Turn {
  const { previousTurnId, input, ...rest } = turn;
  return {
    ...rest,
    ...(previousTurnId === null ? {} : { previousTurnId }),
    ...(input === undefined ? {} : { input: toUiInput(input) }),
  };
}

function toUiEvent(event: Harness.SessionEvent | Harness.TurnStreamingEvent): SessionEvent {
  return { ...event };
}

function toUiEventItem(item: Harness.SessionEventItem): SessionEventItem {
  return { turnId: item.turnId, event: toUiEvent(item.event) };
}

interface HarnessPageSource<T> {
  data: T[];
  response: { pagination: Harness.TokenPagination };
  getNextPage(): Promise<HarnessPageSource<T>>;
}

/** Carries `nextPageToken` for the runtime alongside the `PageResult` shape the SDK types demand. */
type HarnessPage<T> = PageResult<T, { data: T[]; pagination: TokenPagination }> & { nextPageToken?: string };

function toPage<TSource, TResult>(
  page: HarnessPageSource<TSource>,
  map: (item: TSource) => TResult,
): HarnessPage<TResult> {
  const data = page.data.map(map);
  const { pagination } = page.response;
  return {
    data,
    response: { data, pagination },
    hasNextPage: () => pagination.nextPageToken !== undefined,
    getNextPage: async () => toPage(await page.getNextPage(), map),
    ...(pagination.nextPageToken === undefined ? {} : { nextPageToken: pagination.nextPageToken }),
  };
}

function sequenceNumber(id: string | undefined, fallback: number): number {
  if (id === undefined) return fallback;
  const parsed = Number(id);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function toHarnessContent(content: UserMessageContent): Harness.UserMessageContent {
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

function toHarnessInput(input: TurnInputItem[]): Harness.TurnInputItem[] {
  return input.map(item =>
    item.type === 'user.message' ? { ...item, content: toHarnessContent(item.content) } : item,
  );
}

export function createHarnessChatServer(options: CreateHarnessServerOptions = {}): AgentChatServer<HarnessAgentSpec> {
  const client =
    options.baseUrl === undefined && options.fetch === undefined ? harnessClient : createHarnessClient(options);

  return {
    async createSession(request) {
      if (!request.agentSpec) {
        throw new Error('Harness sessions require an agentSpec');
      }
      const created = await client.sessions.create({
        agent: { type: 'value', agentSpec: toHarnessAgentSpec(request.agentSpec) },
      });
      return toUiSession(created.data);
    },

    async listSessions(request = {}) {
      const page = await client.sessions.list({
        ...(request.limit === undefined ? {} : { limit: request.limit }),
        ...(request.order === undefined ? {} : { order: request.order }),
        ...(request.pageToken === undefined ? {} : { pageToken: request.pageToken }),
      });
      return toPage(page, toUiSession);
    },

    async getSession({ sessionId }) {
      const response = await client.sessions.get(sessionId);
      return toUiSession(response.data);
    },

    async updateSession({ sessionId, agentSpec }) {
      const response = await client.sessions.update(sessionId, {
        ...(agentSpec === undefined ? {} : { agent: { type: 'value', agentSpec: toHarnessAgentSpec(agentSpec) } }),
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
          event: toUiEvent(item.data),
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
          event: toUiEvent(item.data),
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
      return toPage(page, toUiTurn);
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
      return toPage(page, toUiEventItem);
    },
  };
}
