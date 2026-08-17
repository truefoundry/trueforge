/**
 * TEMP: Gateway-backed `AgentUIServer` for `docs/server-types.temp.ts`.
 *
 * Not wired into the package. Sketch of how `createTrueFoundryServer` would look
 * once the unified session port is promoted.
 *
 * Pattern:
 * - Host-facing API = unified (createSession / listSessions / updateSession + isMutable)
 * - Gateway still has named + draft clients — adapter fans out internally
 */

import type { Page } from 'truefoundry-gateway-sdk';
import type { AgentSession as GwAgentSession } from 'truefoundry-gateway-sdk/agents';
import { AgentSessionClient } from 'truefoundry-gateway-sdk/agents';
import type { AgentDraftSession as GwAgentDraftSession } from 'truefoundry-gateway-sdk/agents/private';
import { PrivateAgentSessionClient } from 'truefoundry-gateway-sdk/agents/private';

import type {
  AgentLibraryEntry,
  AgentSession,
  AgentSkill,
  AgentSpec,
  AgentUIServer,
  ConnectorState,
  CreateSessionRequest,
  ListSessionsParams,
  ListSessionsResponse,
  ModelEntry,
  PageResult,
  SearchAgentsParams,
  Session,
  UpdateSessionRequest,
} from './server-types.temp.js';

type GwSession = GwAgentSession | GwAgentDraftSession;

export type CreateTrueFoundryServerOptions<
  TModel extends ModelEntry = ModelEntry,
  TSkill extends AgentSkill = AgentSkill,
  TMcp extends ConnectorState = ConnectorState,
  TAgent extends AgentLibraryEntry = AgentLibraryEntry,
  TSpec extends AgentSpec = AgentSpec,
  TSave = unknown,
> = {
  apiKey: string;
  baseUrl: string;
  getModels: () => Promise<TModel[]>;
  getSkills: () => Promise<TSkill[]>;
  getMcp: () => Promise<TMcp[]>;
  searchAgents: (req?: SearchAgentsParams) => Promise<TAgent[]>;
  saveAgent: (req: { agentName: string; agentSpec: TSpec; sessionId?: string }) => Promise<TSave>;
  deleteAgent?: (req: { agentName: string }) => Promise<void>;
  deleteSession?: (req: { sessionId: string }) => Promise<void>;
};

/** TFY adapter: unified port + gateway clients escape hatch. */
export type TrueFoundryServer<
  TModel extends ModelEntry = ModelEntry,
  TSkill extends AgentSkill = AgentSkill,
  TMcp extends ConnectorState = ConnectorState,
  TAgent extends AgentLibraryEntry = AgentLibraryEntry,
  TSpec extends AgentSpec = AgentSpec,
  TSave = unknown,
> = AgentUIServer<
  Session,
  CreateSessionRequest & { tfyMetadata?: string },
  ListSessionsParams,
  UpdateSessionRequest,
  import('./server-types.temp.js').Turn,
  import('./server-types.temp.js').SessionEventItem,
  TSpec,
  import('./server-types.temp.js').TurnStreamingEvent,
  TModel,
  TSkill,
  TMcp,
  TAgent,
  TSave
> & {
  getGatewayClients(): {
    client: AgentSessionClient;
    privateClient: PrivateAgentSessionClient;
  };
};

function isDraft(session: GwSession): session is GwAgentDraftSession {
  return session.type === 'session/draft';
}

/** Map gateway named/draft session → unified UI session (+ methods). */
function wrapSession(raw: GwSession): AgentSession {
  const mutable = isDraft(raw);
  return {
    id: raw.id,
    title: raw.title,
    agentName: raw.agentName,
    agentSpec: mutable ? raw.agentSpec : undefined,
    isMutable: mutable,
    createdBySubject: raw.createdBySubject,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    prepareTurn: opts => raw.prepareTurn(opts),
    listTurns: opts => raw.listTurns(opts) as unknown as ReturnType<AgentSession['listTurns']>,
    getTurn: req => raw.getTurn(req),
    cancel: () => raw.cancel(),
    listEvents: opts => raw.listEvents(opts) as unknown as ReturnType<AgentSession['listEvents']>,
    update: mutable ? req => raw.update(req) : undefined,
  };
}

function mapPage<TIn, TOut, R>(page: Page<TIn, R>, map: (item: TIn) => TOut): PageResult<TOut, R> {
  return {
    data: page.data.map(map),
    response: page.response,
    hasNextPage: () => page.hasNextPage(),
    getNextPage: async () => mapPage(await page.getNextPage(), map),
  };
}

async function resolveRaw(
  client: AgentSessionClient,
  privateClient: PrivateAgentSessionClient,
  sessionId: string,
): Promise<GwSession> {
  try {
    return await client.getSession({ sessionId });
  } catch {
    return privateClient.getDraftSession({ draftSessionId: sessionId });
  }
}

/**
 * Composes gateway chat clients with host-provided builder catalog callbacks.
 * Draft vs named is an internal fan-out; the host only sees unified sessions.
 */
export function createTrueFoundryServer<
  TModel extends ModelEntry = ModelEntry,
  TSkill extends AgentSkill = AgentSkill,
  TMcp extends ConnectorState = ConnectorState,
  TAgent extends AgentLibraryEntry = AgentLibraryEntry,
  TSpec extends AgentSpec = AgentSpec,
  TSave = unknown,
>(
  opts: CreateTrueFoundryServerOptions<TModel, TSkill, TMcp, TAgent, TSpec, TSave>,
): TrueFoundryServer<TModel, TSkill, TMcp, TAgent, TSpec, TSave> {
  const gatewayOpts = { apiKey: opts.apiKey, baseUrl: opts.baseUrl };
  const client = new AgentSessionClient(gatewayOpts);
  const privateClient = new PrivateAgentSessionClient(gatewayOpts);

  type CreateReq = CreateSessionRequest & { tfyMetadata?: string };

  const server = {
    // --- unified chat ---
    async createSession(req: CreateReq) {
      if (req.agentSpec) {
        const draft = await privateClient.createDraftSession({
          agentSpec: req.agentSpec,
          agentName: req.agentName,
          tfyMetadata: req.tfyMetadata,
        });
        return wrapSession(draft);
      }
      if (req.agentName) {
        const named = await client.createSession({
          agentName: req.agentName,
          tfyMetadata: req.tfyMetadata,
        });
        return wrapSession(named);
      }
      throw new Error('createSession requires agentName and/or agentSpec');
    },

    async listSessions(req?: ListSessionsParams) {
      const page = await privateClient.listOwnedSessions(req);
      return mapPage(page, wrapSession) as PageResult<AgentSession, ListSessionsResponse>;
    },

    async getSession(req: { sessionId: string }) {
      return wrapSession(await resolveRaw(client, privateClient, req.sessionId));
    },

    async updateSession(req: UpdateSessionRequest) {
      const raw = await resolveRaw(client, privateClient, req.sessionId);
      if (!isDraft(raw)) {
        throw new Error('updateSession: session is not mutable (isMutable=false)');
      }
      await raw.update({ agentSpec: req.agentSpec });
      // title is not on gateway draft update today — host/BFF if needed
      return wrapSession(raw);
    },

    createTurn: ((req: {
      sessionId: string;
      input?: Parameters<AgentSession['prepareTurn']>[0] extends infer O
        ? O extends { input?: infer I }
          ? I
          : never
        : never;
      previousTurnId?: string | 'auto';
      stream?: boolean;
      pollIntervalMs?: number;
    }) => {
      if (req.stream === false) {
        return (async () => {
          const session = await resolveRaw(client, privateClient, req.sessionId);
          return session
            .prepareTurn({
              input: req.input,
              previousTurnId: req.previousTurnId,
            })
            .execute({ stream: false, pollIntervalMs: req.pollIntervalMs });
        })();
      }
      return (async function* () {
        const session = await resolveRaw(client, privateClient, req.sessionId);
        yield* session
          .prepareTurn({
            input: req.input,
            previousTurnId: req.previousTurnId,
          })
          .execute({ stream: true });
      })();
    }) as TrueFoundryServer['createTurn'],

    async cancelSession({ sessionId }: { sessionId: string }) {
      await (await resolveRaw(client, privateClient, sessionId)).cancel();
    },

    async deleteSession({ sessionId }: { sessionId: string }) {
      if (!opts.deleteSession) {
        throw new Error('deleteSession is not on the gateway SDK. Pass deleteSession to createTrueFoundryServer.');
      }
      await opts.deleteSession({ sessionId });
    },

    async listTurns({ sessionId, ...page }: { sessionId: string; limit?: number; pageToken?: string }) {
      const raw = await resolveRaw(client, privateClient, sessionId);
      return raw.listTurns(page) as unknown as ReturnType<TrueFoundryServer['listTurns']>;
    },

    async getTurn({ sessionId, turnId }: { sessionId: string; turnId: string }) {
      return (await resolveRaw(client, privateClient, sessionId)).getTurn({
        turnId,
      });
    },

    async listEvents({
      sessionId,
      ...page
    }: {
      sessionId: string;
      pageToken?: string;
      lastTurnId?: string;
      limit?: number;
    }) {
      const raw = await resolveRaw(client, privateClient, sessionId);
      return raw.listEvents(page) as unknown as ReturnType<TrueFoundryServer['listEvents']>;
    },

    async *subscribeToTurn({
      sessionId,
      turnId,
      afterSequenceNumber,
    }: {
      sessionId: string;
      turnId: string;
      afterSequenceNumber?: number;
    }) {
      const raw = await resolveRaw(client, privateClient, sessionId);
      const turn = await raw.getTurn({ turnId });
      yield* turn.stream({ afterSequenceNumber });
    },

    downloadSandboxFile: (sandboxId: string, req: { path: string }) =>
      privateClient.downloadSandboxFile(sandboxId, req),

    // --- builder (host-owned) ---
    getModels: opts.getModels,
    getSkills: opts.getSkills,
    getMcp: opts.getMcp,
    searchAgents: opts.searchAgents,
    saveAgent: opts.saveAgent,
    async deleteAgent(req: { agentName: string }) {
      if (!opts.deleteAgent) {
        throw new Error('deleteAgent is host-owned. Pass deleteAgent to createTrueFoundryServer.');
      }
      await opts.deleteAgent(req);
    },

    getGatewayClients: () => ({ client, privateClient }),
  };

  return server as TrueFoundryServer<TModel, TSkill, TMcp, TAgent, TSpec, TSave>;
}
