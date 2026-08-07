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
 * Sessions bind either an inline draft (`agent.type === 'value'`) or a named
 * registry ref (`agent.type === 'ref'`). The UI speaks names; the wire carries
 * agent ids — resolve via the agents registry.
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
import type { TrueForgeApi as Harness, TrueForge } from 'trueforge';
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
export function toHarnessAgentSpec(spec: HarnessAgentSpec): Harness.AgentSpec {
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

export function toUiAgentSpec(spec: Harness.AgentSpec): HarnessAgentSpec {
  const { mcpServers, skills, ...rest } = spec;
  return {
    ...rest,
    ...(mcpServers ? { mcpServers: mcpServers.map(toUiMcpServer) } : {}),
    ...(skills ? { skills: skills.map(toUiSkill) } : {}),
  };
}

/** Drop registry identity columns so the rest is a plain AgentSpec. */
export function agentManifest(agent: Harness.Agent): Harness.AgentSpec {
  const { id, name, ...spec } = agent;
  void id;
  void name;
  return spec;
}

/** `agentName` is caller-known (UI speaks names; the wire carries only agent ids). */
function toUiSession(session: Harness.Session, agentName?: string): Session<HarnessAgentSpec> {
  return {
    id: session.id,
    isMutable: session.agent.type === 'value',
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    ...(session.title === null ? {} : { title: session.title }),
    // Ref sessions stay named even when the registry row is gone — stamp agentId
    // so older runtimes that only forward custom.agentName still treat them immutable.
    ...(session.agent.type === 'ref' ? { agentName: agentName ?? session.agent.agentId } : {}),
    ...(session.agent.type === 'value' ? { agentSpec: toUiAgentSpec(session.agent.agentSpec) } : {}),
  };
}

/**
 * UI `agentId` filters may be a registry id or a display name (history filter /
 * SingleAgent lock both pass names today).
 */
export async function findAgent(client: TrueForge, agentIdOrName: string): Promise<Harness.Agent | undefined> {
  const { data } = await client.agents.list();
  return data.find(candidate => candidate.id === agentIdOrName || candidate.name === agentIdOrName);
}

export async function resolveAgent(client: TrueForge, agentIdOrName: string): Promise<Harness.Agent> {
  const agent = await findAgent(client, agentIdOrName);
  if (agent === undefined) {
    throw new Error(`Agent not found: ${agentIdOrName}`);
  }
  return agent;
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
    // The sandbox is resolved server-side from the turn, so `sandboxId` is accepted for parity
    // with hosts that address sandboxes directly and deliberately not forwarded.
    async downloadSandboxFile({ sessionId, turnId, path }) {
      const response = await client.sessions.downloadSandboxFile(sessionId, turnId, { path });
      return response.blob();
    },

    async createSession(request) {
      if (request.agentName !== undefined && request.agentName.length > 0) {
        const agent = await resolveAgent(client, request.agentName);
        const created = await client.sessions.create({
          agent: { type: 'ref', agentId: agent.id },
        });
        return toUiSession(created.data, agent.name);
      }
      if (request.agentSpec !== undefined) {
        const created = await client.sessions.create({
          agent: { type: 'value', agentSpec: toHarnessAgentSpec(request.agentSpec) },
        });
        return toUiSession(created.data);
      }
      throw new Error('createSession requires agentName or agentSpec');
    },

    async listSessions(request = {}) {
      const filterKey = request.agentId !== undefined && request.agentId.length > 0 ? request.agentId : undefined;
      // Soft lookup: stale history filter / deleted agent / SingleAgent mismatch → empty page.
      const agentFilter = filterKey === undefined ? undefined : await findAgent(client, filterKey);
      if (filterKey !== undefined && agentFilter === undefined) {
        const limit = request.limit ?? 20;
        const data: Session<HarnessAgentSpec>[] = [];
        const pagination = { limit };
        const empty = (): HarnessPage<Session<HarnessAgentSpec>> => ({
          data,
          response: { data, pagination },
          hasNextPage: () => false,
          getNextPage: () => Promise.resolve(empty()),
        });
        return empty();
      }
      // Stamp ref rows with display names; registries are small (one tenant).
      const nameById =
        agentFilter !== undefined
          ? new Map([[agentFilter.id, agentFilter.name]])
          : new Map((await client.agents.list()).data.map(agent => [agent.id, agent.name]));

      const page = await client.sessions.list({
        ...(request.limit === undefined ? {} : { limit: request.limit }),
        ...(request.order === undefined ? {} : { order: request.order }),
        ...(request.pageToken === undefined ? {} : { pageToken: request.pageToken }),
        ...(agentFilter === undefined ? {} : { agentId: agentFilter.id }),
      });
      return toPage(page, session =>
        toUiSession(session, session.agent.type === 'ref' ? nameById.get(session.agent.agentId) : undefined),
      );
    },

    async getSession({ sessionId }) {
      const response = await client.sessions.get(sessionId);
      const { agent } = response.data;
      if (agent.type === 'ref') {
        try {
          const resolved = await resolveAgent(client, agent.agentId);
          return toUiSession(response.data, resolved.name);
        } catch {
          return toUiSession(response.data);
        }
      }
      return toUiSession(response.data);
    },

    async updateSession({ sessionId, agentSpec }) {
      if (agentSpec !== undefined) {
        const current = await client.sessions.get(sessionId);
        if (current.data.agent.type === 'ref') {
          throw new Error('Cannot update agent on a named session');
        }
      }
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
