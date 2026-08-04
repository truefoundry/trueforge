/**
 * Harness `AgentUIServer` adapter for @truefoundry/agent-ui-sdk.
 *
 * The SDK still declares the pre-0.1.6 server contract — mounts carry `id`,
 * list results are `PageResult`, and absent values are `undefined` — while the
 * runtime it delegates to reads `nextPageToken` and tolerates `null`. Harness
 * matches neither exactly: it keys mounts by name and returns `null`. The maps
 * below produce values valid under both contracts at once.
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
} from '@truefoundry/agent-ui-sdk';
import type { TrueHarness as Harness } from 'trueharness';
import { TrueHarnessClient } from 'trueharness';

export type HarnessSkillMount = SkillMount & Harness.SkillMount;
export type HarnessMcpServerMount = McpServerMount & Harness.McpServer;

export interface HarnessAgentSpec extends AgentSpec<Harness.AgentSpecModel, HarnessSkillMount, HarnessMcpServerMount> {
  config?: Harness.RuntimeConfig;
  instructions?: string;
  messages?: Harness.AgentSpecUserMessage[];
  responseFormat?: Harness.ResponseFormat;
  variables?: Record<string, string>;
}

export interface HarnessSession extends Session<HarnessAgentSpec> {
  agentSpec: HarnessAgentSpec;
  isMutable: true;
}

export interface CreateHarnessServerOptions {
  /** Catalog rows used to rebuild the git fields the SDK's skill picker drops. */
  listSkills: () => Promise<Harness.SkillEntry[]>;
  baseUrl?: string;
  fetch?: typeof fetch;
}

/** Default ref for catalog rows that omit one; the sandbox resolves it with `git ls-remote`. */
const DEFAULT_SKILL_REF = 'HEAD';

/** Mount ids are derived, not stored: Harness drops them and returns mounts keyed by name. */
function toUiMcpServer(server: Harness.McpServer): HarnessMcpServerMount {
  return { ...server, id: server.name };
}

function toUiSkill(skill: Harness.SkillMount): HarnessSkillMount {
  return { ...skill, id: `${skill.url}#${skill.path ?? ''}@${skill.ref}` };
}

/** Catalog row → git mount, so the picker lists and Harness admits the same value. */
export function toSkillMount(entry: Harness.SkillEntry): HarnessSkillMount {
  return toUiSkill({
    type: 'git',
    name: entry.name,
    description: entry.description,
    url: entry.url,
    ref: entry.ref ?? DEFAULT_SKILL_REF,
    ...(entry.path === undefined ? {} : { path: entry.path }),
  });
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
  const { title, agentSpec, ...rest } = session;
  return {
    ...rest,
    agentSpec: toUiAgentSpec(agentSpec),
    isMutable: true,
    ...(title === null ? {} : { title }),
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

/**
 * The runtime marks a chain root with the gateway's `"none"` sentinel; Harness
 * spells that `null` and would otherwise look `"none"` up as a turn id (404).
 */
function toHarnessPreviousTurnId(previousTurnId: string): Harness.PreviousTurnIdInput | null {
  return previousTurnId === 'none' ? null : previousTurnId;
}

export function createHarnessChatServer(options: CreateHarnessServerOptions): AgentChatServer<HarnessAgentSpec> {
  const client = new TrueHarnessClient({
    environment: options.baseUrl ?? '/',
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });

  /**
   * The SDK's picker round-trips a mount as `{ id, name }`, so a freshly selected
   * skill would reach admission without its git fields. Restore them from the catalog.
   */
  async function withCatalogSkills(spec: HarnessAgentSpec): Promise<HarnessAgentSpec> {
    const { skills } = spec;
    if (skills === undefined || skills.length === 0) return spec;
    const catalog = new Map((await options.listSkills()).map(entry => [entry.name, toSkillMount(entry)]));
    return { ...spec, skills: skills.map(skill => catalog.get(skill.name) ?? skill) };
  }

  return {
    async createSession(request) {
      if (!request.agentSpec) {
        throw new Error('Harness sessions require an agentSpec');
      }
      const created = await client.sessions.create({ agentSpec: await withCatalogSkills(request.agentSpec) });
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
        ...(agentSpec === undefined ? {} : { agentSpec: await withCatalogSkills(agentSpec) }),
      });
      return toUiSession(response.data);
    },

    async *prepareAndExecuteTurn({
      sessionId,
      input,
      previousTurnId,
      abortSignal,
      headers,
    }: {
      sessionId: string;
      input?: TurnInputItem[];
      previousTurnId?: string;
      abortSignal?: AbortSignal;
      headers?: Record<string, string>;
    }) {
      const stream = await client.sessions.createTurn(
        sessionId,
        {
          ...(input === undefined ? {} : { input: toHarnessInput(input) }),
          ...(previousTurnId === undefined ? {} : { previousTurnId: toHarnessPreviousTurnId(previousTurnId) }),
        },
        {
          ...(abortSignal === undefined ? {} : { abortSignal }),
          ...(headers === undefined ? {} : { headers }),
        },
      );
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
