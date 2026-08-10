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
 *
 * Session create takes `{ name }` or `{ spec }`; reads carry the
 * `reference`/`inline` discriminator, with reference rows already naming their
 * agent. The UI filters with registry `agentId`.
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
import type { TrueForgeApi } from 'trueforge-sdk';
import { createHarnessClient, harnessClient, type CreateHarnessClientOptions } from './harnessClient';
export type HarnessSkillMount = SkillMount;
export type HarnessMcpServerMount = McpServerMount & TrueForgeApi.McpServer;

export interface HarnessAgentSpec extends AgentSpec<
  TrueForgeApi.AgentSpecModel,
  HarnessSkillMount,
  HarnessMcpServerMount
> {
  config?: TrueForgeApi.RuntimeConfig;
  instructions?: string;
  messages?: TrueForgeApi.AgentSpecUserMessage[];
  responseFormat?: TrueForgeApi.ResponseFormat;
  variables?: Record<string, string>;
}

export type CreateHarnessServerOptions = CreateHarnessClientOptions;

/** Mount ids are derived, not stored: Harness returns MCP servers keyed by name. */
function toUiMcpServer(server: TrueForgeApi.McpServer): HarnessMcpServerMount {
  return { ...server, id: server.name };
}

/** Skill ids are derived from the name ref Harness persists. */
function toUiSkill(skill: TrueForgeApi.SkillNameRef): HarnessSkillMount {
  return { id: skill.name, name: skill.name };
}

/** Strip UI-only `id` before admission; Harness skills are name refs only. */
export function toHarnessAgentSpec(spec: HarnessAgentSpec): TrueForgeApi.AgentSpec {
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

export function toUiAgentSpec(spec: TrueForgeApi.AgentSpec): HarnessAgentSpec {
  const { mcpServers, skills, ...rest } = spec;
  return {
    ...rest,
    ...(mcpServers ? { mcpServers: mcpServers.map(toUiMcpServer) } : {}),
    ...(skills ? { skills: skills.map(toUiSkill) } : {}),
  };
}

/** Drop registry identity columns so the rest is a plain AgentSpec. */
export function agentManifest(agent: TrueForgeApi.Agent): TrueForgeApi.AgentSpec {
  const { id, name, ...spec } = agent;
  void id;
  void name;
  return spec;
}

function toUiSession(session: TrueForgeApi.Session): Session<HarnessAgentSpec> {
  return {
    id: session.id,
    isMutable: session.agent.type === 'inline',
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    ...(session.title === null ? {} : { title: session.title }),
    // `name` is a create-time snapshot, so references whose agent predates it stay
    // unlabelled; `isMutable` alone keeps them out of the composer.
    ...(session.agent.type === 'reference' && session.agent.name !== null ? { agentName: session.agent.name } : {}),
    ...(session.agent.type === 'inline' ? { agentSpec: toUiAgentSpec(session.agent.spec) } : {}),
  };
}

/** Spread drops the interface identity, which is what makes the SDK's index-signature part type accept it. */
function toUiContent(content: TrueForgeApi.UserMessageContent): UserMessageContent {
  return typeof content === 'string' ? content : content.map(part => ({ ...part }));
}

function toUiInput(input: TrueForgeApi.TurnInputItem[]): TurnInputItem[] {
  return input.map(item => (item.type === 'user.message' ? { ...item, content: toUiContent(item.content) } : item));
}

function toUiTurn(turn: TrueForgeApi.Turn): Turn {
  const { previousTurnId, input, ...rest } = turn;
  return {
    ...rest,
    ...(previousTurnId === null ? {} : { previousTurnId }),
    ...(input === undefined ? {} : { input: toUiInput(input) }),
  };
}

function toUiEvent(event: TrueForgeApi.SessionEvent | TrueForgeApi.TurnStreamingEvent): SessionEvent {
  return { ...event };
}

function toUiEventItem(item: TrueForgeApi.SessionEventItem): SessionEventItem {
  return { turnId: item.turnId, event: toUiEvent(item.event) };
}

interface HarnessPageSource<T> {
  data: T[];
  response: { pagination: TrueForgeApi.TokenPagination };
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

export function createHarnessChatServer(options: CreateHarnessServerOptions = {}): AgentChatServer<HarnessAgentSpec> {
  const client =
    options.baseUrl === undefined && options.fetch === undefined ? harnessClient : createHarnessClient(options);
  return {
    // The sandbox is resolved server-side from the turn, so `sandboxId` is accepted for parity
    // with hosts that address sandboxes directly and deliberately not forwarded.
    async downloadSandboxFile({ sessionId, turnId, path }) {
      const response = await client.sessions.downloadSandboxFile(sessionId, turnId, { path });
      return response.blob();
    },

    async createSession(request) {
      if (request.agentName !== undefined && request.agentName.length > 0) {
        const created = await client.sessions.create({
          agent: { name: request.agentName },
        });
        return toUiSession(created.data);
      }
      if (request.agentSpec !== undefined) {
        const created = await client.sessions.create({
          agent: { spec: toHarnessAgentSpec(request.agentSpec) },
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
      return toPage(page, toUiSession);
    },

    async getSession({ sessionId }) {
      const response = await client.sessions.get(sessionId);
      return toUiSession(response.data);
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
