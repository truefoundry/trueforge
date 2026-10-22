/**
 * DB-backed turns API (mounted at /api/v1/sessions).
 */
import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import type {
  ISessionStore,
  Sessions,
  Turn,
  TurnRecord,
  TurnStreamingEvent,
} from '@truefoundry/trueforge-core/agent-session';
import {
  CancellationReason,
  EventType,
  isNonTerminalTurnState,
  isTurnOffloadReason,
  SessionStoreConflictError,
  SessionStoreNotFoundError,
  TurnEventAlreadyExistsError,
  TurnNotFoundError,
  TurnOffloadReason,
  TurnOwnershipLostError,
  TurnResourceResolver,
  TurnUserEventSchema,
  type SessionHandle,
  type TurnHandle,
  type TurnRecordWithoutSnapshot,
  type TurnUserEvent,
  type UserMessage,
} from '@truefoundry/trueforge-core/agent-session';
import type { IWebSearchProvider } from '@truefoundry/trueforge-core/core';
import {
  AgentHarnessError,
  existingSandboxIdForProvider,
  extractErrorLogFields,
  isFileContentPart,
  McpConnectionError,
  newEventId,
  PromiseTimeoutError,
  rawSandboxId,
  redisKey,
  SandboxError,
  VercelAILLM,
  withTimeout,
} from '@truefoundry/trueforge-core/core';
import {
  jsonValueFrom,
  NO_RESPONDER_HEARTBEAT_LOST_DETAIL,
  NoResponderError,
  redisRequest,
  RequestTimeoutError,
  type RedisClient,
  type RouteHandler as RequestReplyRouteHandler,
  type RequestReplyRouter,
} from '@truefoundry/trueforge-core/request-reply';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { streamSSE } from 'hono/streaming';
import type { Logger } from 'winston';
import { z } from 'zod';
import type { Authorizer } from '../auth/authorizer';
import { requestContextFromWire, type RequestContext, type ResolveRequestContext } from '../auth/identity';
import configuration from '../config';
import type { AgentRecord, IAgentStore } from '../db/agentStore';
import type { IMcpServerWithAuthStore } from '../db/mcpServerStore';
import type { IModelProviderStore } from '../db/modelProviderStore';
import type { ISandboxEnvironmentStore } from '../db/sandboxEnvironmentStore';
import type { ISandboxProviderStore } from '../db/sandboxProviderStore';
import type { ISkillStore } from '../db/skillStore';
import type { TurnMetadata } from '../db/turnMetadata';
import type { IWebSearchProviderStore } from '../db/webSearchProviderStore';
import { currentLogContext, runWithLogContext, updateLogContext } from '../logger';
import {
  createAndExecuteTurnRoute,
  downloadSandboxFileRoute,
  getTurnRoute,
  listTurnEventsRoute,
  listTurnsRoute,
  postTurnEventsRoute,
  subscribeTurnRoute,
} from '../routes/turnRoutes';
import type { ActiveTurnRegistry } from '../runtime/activeTurns';
import { StreamGoneError, type EventSubscription, type EventSubscriptionRegistry } from '../runtime/event-subscription';
import { validateSandboxFilePath } from '../runtime/sandboxFilePath';
import {
  buildTurnSandbox,
  getMcpConnection,
  getModelDetails,
  resolveSandboxEnvironment,
  resolveSandboxProvider,
} from '../runtime/sessionResources';
import { DEFAULT_SANDBOX_ENVIRONMENT_NAME } from '../schemas/sandboxEnvironment';
import { MAX_SESSION_TITLE_LENGTH } from '../schemas/session';
import { assertGatewayMetadataRequestHeaders } from '../truefoundry/gatewayMetadata';
import { newId } from '../utils/id';
import { resolveWebSearchProvider } from '../websearch/providers';
import { canReadAgentBoundResource, canReadSession } from './agentAccess';

const FORBIDDEN_SESSION_ACCESS = 'Only the session creator can access this session';
const FORBIDDEN_CREATE_TURN = 'Only the session creator can create turns';
const MAX_OWNERSHIP_ATTEMPTS = 3;

export function toWireTurn(record: TurnRecordWithoutSnapshot): Turn {
  return {
    id: record.turn_id,
    session_id: record.session_id,
    previous_turn_id: record.previous_turn_id,
    input: record.input,
    state: record.state,
    created_at: record.created_at.toISOString(),
  };
}

/**
 * Copies into a standalone ArrayBuffer for the response body: a pooled Buffer's
 * backing store is shared and typed as ArrayBufferLike, which is not a body.
 * Bounded by SANDBOX_FILE_MAX_BYTES_FOR_DOWNLOAD.
 */
function toArrayBuffer(content: Buffer): ArrayBuffer {
  const buffer = new ArrayBuffer(content.byteLength);
  new Uint8Array(buffer).set(content);
  return buffer;
}

/**
 * Builds the Content-Disposition telling the browser to save the file under its sandbox name.
 *
 * A sandbox file can be named in any script, but an HTTP header can only carry bytes, so a name
 * like `中文.csv` cannot be written into the header as-is — doing so throws when the response is
 * constructed. RFC 6266's `filename*` exists for this: percent-encode the UTF-8 name so the value
 * stays plain ASCII, and the client decodes it back. Encoding also defuses quotes and newlines,
 * which could otherwise close the value or inject another header.
 */
export function toContentDisposition(path: string): string {
  // Trailing separators are dropped so a path ending in `/` still yields its last real segment.
  const fileName = path.split('/').filter(Boolean).pop() ?? 'download';
  // encodeURIComponent covers everything except these four, which RFC 5987 also disallows here.
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename*=UTF-8''${encoded}`;
}

/**
 * Model, MCP, skill, agent, sandbox, and web-search stores for one turn.
 * HTTP passes the request's context and headers. A peered `turns/send-events` passes the body fields.
 */
export interface ResolveTurnExecutionStoresInput {
  session: SessionHandle;
  requestContext: RequestContext;
  requestHeaders?: Record<string, string> | undefined;
  /** Saved agent when the session references one. The caller loads it. */
  runAsAgent?: AgentRecord;
}

export interface TurnExecutionStores<TTransaction = never> {
  agentStore: IAgentStore<TTransaction>;
  modelProviderStore: IModelProviderStore<TTransaction>;
  mcpServerStore: IMcpServerWithAuthStore<TTransaction>;
  skillStore: Pick<ISkillStore<TTransaction>, 'resolveTurnSkills'>;
  sandboxProviderStore: ISandboxProviderStore<TTransaction>;
  webSearchProviderStore: IWebSearchProviderStore<TTransaction>;
}

export interface TurnsRouterDeps {
  activeTurns: ActiveTurnRegistry;
  authorizer: Authorizer;
  /** Resumable live turn-event transport: create-turn writes, subscribe polls. */
  eventSubscriptions: EventSubscriptionRegistry<TurnStreamingEvent>;
  logger: Logger;
  /**
   * Publishes to another executor:
   *  - POST /events -> redis request `turns/send-events`
   *  - Creating the next turn -> redis request `sessions/cancel`
   * when the previous run is not in this process.
   * Unset in standalone.
   */
  redis?: RedisClient | undefined;
  /**
   * Used to register routes
   * - `turns/send-events` -> {@link handlePeerTurnEvents}
   */
  requestReplyRouter: RequestReplyRouter;
  /** List, get, list events, subscribe, download, and create (referenced-agent check). */
  resolveAgentStore: (requestContext: RequestContext) => IAgentStore;
  resolveRequestContext: ResolveRequestContext;
  /**
   * Model, MCP, skill, agent, sandbox, and web-search stores for a turn.
   * Create, POST /events, and a peered `turns/send-events` all call this with the caller's
   * request context and headers.
   */
  resolveTurnExecutionStores: (input: ResolveTurnExecutionStoresInput) => Promise<TurnExecutionStores>;
  /** Create, POST /events, and peered send-events, via the turn execution deps. */
  sandboxEnvironmentStore: ISandboxEnvironmentStore;
  /** Sandbox file download. */
  sandboxProviderStore: ISandboxProviderStore;
  sessions: Sessions;
  sessionStore: ISessionStore;
}

/**
 * Deps needed to create a turn and drain events in-process (no HTTP). Carries already-resolved
 * stores; callers must resolve them from the request context (e.g. schedule `resolveTurnDeps(c, agent)`)
 * so TrueFoundry mode stays token-bound for models, MCP, and skills.
 */
export type BeginTurnExecutionDeps = Pick<
  TurnsRouterDeps,
  'activeTurns' | 'eventSubscriptions' | 'logger' | 'sandboxEnvironmentStore'
> & {
  agentStore: IAgentStore;
  modelProviderStore: IModelProviderStore;
  mcpServerStore: IMcpServerWithAuthStore;
  sandboxProviderStore: ISandboxProviderStore;
  webSearchProviderStore: IWebSearchProviderStore;
  skillStore: Pick<ISkillStore, 'resolveTurnSkills'>;
  /** Loads the previous turn when create must cancel a run that is not in this process. */
  sessionStore: Pick<ISessionStore, 'getTurn'>;
  redis?: RedisClient | undefined;
};

async function referencedRunAsAgent(input: {
  session: SessionHandle;
  agentStore: IAgentStore;
}): Promise<AgentRecord | undefined> {
  if (input.session.record.agent.type !== 'reference') {
    return undefined;
  }
  return input.agentStore.getAgent({
    tenant_id: input.session.tenant_id,
    id: input.session.record.agent.id,
  });
}

async function executionDepsForCaller(input: {
  deps: TurnsRouterDeps;
  session: SessionHandle;
  requestContext: RequestContext;
  requestHeaders?: Record<string, string> | undefined;
  runAsAgent?: AgentRecord;
}): Promise<BeginTurnExecutionDeps> {
  const stores = await input.deps.resolveTurnExecutionStores(input);
  return {
    activeTurns: input.deps.activeTurns,
    eventSubscriptions: input.deps.eventSubscriptions,
    logger: input.deps.logger,
    sandboxEnvironmentStore: input.deps.sandboxEnvironmentStore,
    sessionStore: input.deps.sessionStore,
    redis: input.deps.redis,
    ...stores,
  };
}

interface BeginTurnExecutionParams {
  session: SessionHandle;
  input: UserMessage[] | undefined;
  previous_turn_id: string | undefined;
  userRef: string;
  /** Raw inbound request headers. Absent for a schedule run. */
  requestHeaders?: Record<string, string>;
  deps: BeginTurnExecutionDeps;
}

/**
 * Builds the per-turn resolver. Agent / MCP / sandbox / LLM lookups are wired
 * the same way: async factories over the corresponding stores.
 */
function createTurnResolver(deps: {
  mcpServerStore: IMcpServerWithAuthStore;
  skillStore: Pick<ISkillStore, 'resolveTurnSkills'>;
  sandboxProviderStore: ISandboxProviderStore;
  sandboxEnvironmentStore: ISandboxEnvironmentStore;
  agentStore: IAgentStore;
  modelProviderStore: IModelProviderStore;
  webSearchProvider: IWebSearchProvider | undefined;
  logger: Logger;
  signal: AbortSignal;
  userRef: string;
  session: SessionHandle;
  turnMetadata: TurnMetadata;
}): TurnResourceResolver {
  const {
    mcpServerStore,
    skillStore,
    sandboxProviderStore,
    sandboxEnvironmentStore,
    agentStore,
    modelProviderStore,
    webSearchProvider,
    logger,
    signal,
    userRef,
    session,
    turnMetadata,
  } = deps;
  const tenant_id = session.tenant_id;
  const sessionId = session.session_id;

  return new TurnResourceResolver({
    llm: async name => {
      const resolved = await getModelDetails({
        tenant_id,
        name,
        store: modelProviderStore,
        turnMetadata,
      });
      return {
        modelClient: new VercelAILLM({
          providerConfig: resolved.providerConfig,
          logger,
          signal,
        }),
        defaultModelParams: resolved.defaultModelParams,
        modelProperties: resolved.modelProperties,
      };
    },
    mcp: async name => {
      const connection = await getMcpConnection({
        tenant_id,
        name,
        store: mcpServerStore,
        userRef,
        turnMetadata,
      });
      if (connection === undefined) {
        throw new HTTPException(422, {
          message: `Unknown MCP server "${name}" — not configured`,
        });
      }
      return {
        url: connection.url,
        headers: connection.headers,
      };
    },
    mcpRequestTimeoutMs: configuration.MCP_REQUEST_TIMEOUT_MS,
    mcpConnectTimeoutMs: configuration.MCP_CONNECT_TIMEOUT_MS,
    mcpMaxResponseBytes: configuration.MCP_TOOL_CALL_MAX_RESPONSE_BYTES,
    sandboxProvider: async ({ spec, existingSandboxId, tracing }) => {
      const provider = await resolveSandboxProvider({
        tenant_id,
        store: sandboxProviderStore,
        logger,
        sessionId,
      });
      if (provider === undefined) {
        throw new HTTPException(422, {
          message: 'no sandbox provider configured — PUT /settings/sandbox-providers',
        });
      }
      const skills = spec.skills ?? [];
      const mountSkills =
        skills.length === 0
          ? []
          : await skillStore.resolveTurnSkills({
              tenant_id,
              skills,
            });
      const carriedSandboxId = existingSandboxIdForProvider({
        existingSandboxId,
        currentProviderType: provider.type,
      });
      const turnSandboxBase = {
        logger,
        skills: mountSkills,
        fileDownloadEnabled: spec.config.sandbox.file_downloads,
        existingSandboxId: carriedSandboxId,
        tracing,
      };
      // Env-capable providers (Daytona): resolve env. Others skip (no snapshot concept).
      if (provider.envSupported) {
        const environment = await resolveSandboxEnvironment({
          tenant_id,
          name: spec.config.sandbox.environment_name ?? DEFAULT_SANDBOX_ENVIRONMENT_NAME,
          sandboxEnvironmentStore,
          optional: spec.config.sandbox.environment_name === undefined,
        });
        return buildTurnSandbox({
          provider,
          ...(environment !== undefined ? { environment } : {}),
          ...turnSandboxBase,
        });
      }
      return buildTurnSandbox({
        provider,
        ...turnSandboxBase,
      });
    },
    agent: async agentId => {
      const record = await agentStore.getAgent({ tenant_id, id: agentId });
      if (record === undefined) {
        throw new HTTPException(422, { message: `Agent not found: ${agentId}` });
      }
      return record.manifest;
    },
    webSearchProvider,
    logger,
  });
}

/** Grapheme segmentation for title truncation (locale-independent per UAX #29). */
const titleSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/**
 * Caps a title at {@link MAX_SESSION_TITLE_LENGTH} UTF-16 units without splitting a
 * grapheme cluster: clusters that would cross the cap (emoji with skin tones or
 * ZWJ sequences, which read as one unit but span several) are dropped whole.
 */
function truncateSessionTitle(title: string): string {
  let truncated = '';
  let length = 0;
  for (const { segment } of titleSegmenter.segment(title)) {
    if (length + segment.length > MAX_SESSION_TITLE_LENGTH) {
      break;
    }
    truncated += segment;
    length += segment.length;
  }
  return truncated;
}

/**
 * Derives a session title from the first user message of the first turn. Returns the
 * trimmed text (capped at {@link MAX_SESSION_TITLE_LENGTH}) or `undefined` when no usable
 * text is present (for example, a file-only message).
 */
export function deriveSessionTitle(input: UserMessage[] | undefined): string | undefined {
  const firstUserMessage = input?.[0];
  if (!firstUserMessage) {
    return undefined;
  }

  const text =
    typeof firstUserMessage.content === 'string'
      ? firstUserMessage.content
      : firstUserMessage.content
          .filter(part => !isFileContentPart(part))
          .map(part => part.text)
          .join(' ');

  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }
  const title = truncateSessionTitle(trimmed);
  // A single cluster longer than the cap truncates to nothing; treat it as no usable title
  // so the store keeps the title unset instead of persisting a blank first-write-wins value.
  if (!title) {
    return undefined;
  }
  return title;
}

/**
 * SSE payload for one turn event. The `id` field carries the per-stream
 * sequence number; the event body itself is not numbered (yield order is
 * persist order, so the transport boundary stamps).
 */
export function turnEventSsePayload(event: TurnStreamingEvent, sequenceNumber: number): { id: string; data: string } {
  return {
    id: String(sequenceNumber),
    data: JSON.stringify(event),
  };
}

/**
 * turn.created arms the active-run TTL, turn.done shortens it to the
 * post-completion drain window; mid-run events leave the TTL untouched.
 */
export function streamTTLSecondsFor(event: TurnStreamingEvent): number | undefined {
  if (event.type === EventType.TURN_CREATED) {
    return configuration.TURN_STREAM_TTL_SECONDS;
  }
  if (event.type === EventType.TURN_DONE) {
    return configuration.TURN_STREAM_POST_COMPLETION_TTL_SECONDS;
  }
  return undefined;
}

/** Redis/in-memory key for one turn's resumable event stream. */
export function turnStreamId(tenantId: string, sessionId: string, turnId: string): string {
  return redisKey('agent', 'turn', tenantId, sessionId, turnId, 'stream');
}
/**
 * Dual-write turn events to the resumable subscription registry, then optionally
 * forward each sequenced event (SSE path). Shared by streaming and non-streaming
 * create-turn; the HTTP response lifecycle does not own execution.
 */
/** Start and clear the pause timer for the one turn this drain is consuming. */
interface TurnPausedKeepalive {
  start: () => void;
  clear: () => void;
}

/**
 * Running-only execution deadline for one turn.
 * Each entry to `running` starts a fresh window. Pause clears it.
 */
interface TurnExecutionTimeout {
  start: () => void;
  clear: () => void;
}

export async function drainTurnEvents(input: {
  trackedStream: AsyncIterable<TurnStreamingEvent>;
  turnEventStream: EventSubscription<TurnStreamingEvent>;
  executionTimeout: TurnExecutionTimeout;
  logger: Logger;
  pausedKeepalive: TurnPausedKeepalive;
  onEvent?: (event: TurnStreamingEvent, sequenceNumber: number) => Promise<void>;
}): Promise<void> {
  const { trackedStream, turnEventStream, executionTimeout, logger, pausedKeepalive, onEvent } = input;
  try {
    for await (const event of trackedStream) {
      // Dual-write before any client sink so subscribers can resume after disconnect.
      const sequenceNumber = await turnEventStream.put(event, {
        streamTTLSeconds: streamTTLSecondsFor(event),
      });
      if (event.type === EventType.TURN_UPDATE) {
        if (event.state.status === 'paused') {
          pausedKeepalive.start();
          executionTimeout.clear();
        } else {
          pausedKeepalive.clear();
          executionTimeout.start();
        }
      }
      await onEvent?.(event, sequenceNumber);
    }
  } catch (error) {
    if (error instanceof SessionStoreNotFoundError) {
      logger.warn('Turn stream ended after session/turn was removed', extractErrorLogFields(error));
    } else {
      logger.error('Unexpected error in turn event drain', extractErrorLogFields(error));
    }
  } finally {
    executionTimeout.clear();
  }
}

/** Inputs for {@link drainTurnEvents} produced by {@link beginTurnExecution}. */
export interface TurnEventDrainInput {
  trackedStream: AsyncIterable<TurnStreamingEvent>;
  turnEventStream: EventSubscription<TurnStreamingEvent>;
  executionTimeout: TurnExecutionTimeout;
  logger: Logger;
  pausedKeepalive: TurnPausedKeepalive;
}

/**
 * Header check, abort, execution timeout, web search, and the per-turn resolver.
 * Create and resume each keep their own persist and drain steps.
 */
async function prepareTurnExecution(input: {
  session: SessionHandle;
  turnId: string;
  userRef: string;
  requestHeaders: Record<string, string> | undefined;
  deps: BeginTurnExecutionDeps;
}): Promise<{
  abortController: AbortController;
  resolver: TurnResourceResolver;
  executionTimeout: TurnExecutionTimeout;
}> {
  assertGatewayMetadataRequestHeaders(input.requestHeaders);
  const abortController = new AbortController();
  const webSearchProvider = await resolveWebSearchProvider({
    tenant_id: input.session.tenant_id,
    store: input.deps.webSearchProviderStore,
  });
  const sessionAgent = input.session.record.agent;
  const resolver = createTurnResolver({
    mcpServerStore: input.deps.mcpServerStore,
    skillStore: input.deps.skillStore,
    sandboxProviderStore: input.deps.sandboxProviderStore,
    sandboxEnvironmentStore: input.deps.sandboxEnvironmentStore,
    agentStore: input.deps.agentStore,
    modelProviderStore: input.deps.modelProviderStore,
    webSearchProvider,
    logger: input.deps.logger,
    signal: abortController.signal,
    userRef: input.userRef,
    session: input.session,
    turnMetadata: {
      sessionId: input.session.session_id,
      turnId: input.turnId,
      ...(sessionAgent.type === 'reference' ? { agent: { id: sessionAgent.id, name: sessionAgent.name } } : {}),
      ...(input.requestHeaders === undefined ? {} : { requestHeaders: input.requestHeaders }),
    },
  });
  let executionTimer: NodeJS.Timeout | undefined;
  const executionTimeout: TurnExecutionTimeout = {
    start: () => {
      if (executionTimer !== undefined) {
        clearTimeout(executionTimer);
      }
      executionTimer = setTimeout(() => {
        executionTimer = undefined;
        if (!abortController.signal.aborted) {
          abortController.abort(CancellationReason.ServerExecutionTimeout);
        }
      }, configuration.SERVER_EXECUTION_TIMEOUT_SECONDS * 1000);
      executionTimer.unref();
    },
    clear: () => {
      if (executionTimer === undefined) {
        return;
      }
      clearTimeout(executionTimer);
      executionTimer = undefined;
    },
  };
  return {
    abortController,
    resolver,
    executionTimeout,
  };
}

/**
 * Shared create-turn engine: persist the turn, start execution, and return the
 * drain inputs. Does not wait for events and does not write HTTP/SSE.
 */
export async function beginTurnExecution(
  params: BeginTurnExecutionParams,
): Promise<{ turn: TurnHandle; drainInput: TurnEventDrainInput }> {
  const { session, input, previous_turn_id: previousTurnId, userRef, requestHeaders, deps } = params;
  const sessionId = session.session_id;
  const turnId = newId();
  const tenantId = session.tenant_id;
  // Before the resolver, so model, MCP, and sandbox lines on this chain carry the ids.
  updateLogContext({
    tenant_id: tenantId,
    session_id: sessionId,
    turn_id: turnId,
  });
  const { abortController, resolver, executionTimeout } = await prepareTurnExecution({
    session,
    turnId,
    userRef,
    requestHeaders,
    deps,
  });

  // First turn only: derive the title from the first user message. The store
  // never overwrites an existing title.
  const title = session.record.last_turn_id ? undefined : deriveSessionTitle(input);

  // Freeze the predecessor in the store and leave its generator parked. A paused previous
  // turn stays in memory until the keepalive timer offloads it. That is deliberate.
  // TODO: freezing drops the previous turn's token cost. Fix when paused turns persist metrics.
  const turn = await session.createTurn({
    turn_id: turnId,
    active_executor_id: configuration.EXECUTOR_ID,
    resolver,
    abortController,
    previous_turn_id: previousTurnId,
    input,
    update_session_title_if_not_exist: title,
  });

  // A new turn is running immediately. Pause and the later resume are handled from the drain.
  executionTimeout.start();
  const trackedStream = deps.activeTurns.track({
    abortController,
    stream: turn.stream(),
    turn,
  });

  // Held for the whole turn; the stream's sequence counter dies with it.
  const turnEventStream = deps.eventSubscriptions.get(turnStreamId(tenantId, sessionId, turn.id));

  return {
    turn,
    drainInput: {
      trackedStream,
      turnEventStream,
      executionTimeout,
      logger: deps.logger,
      pausedKeepalive: {
        start: () => {
          deps.activeTurns.startPausedKeepalive({ sessionId, turnId: turn.id });
        },
        clear: () => {
          deps.activeTurns.clearPausedKeepalive({ sessionId, turnId: turn.id });
        },
      },
    },
  };
}

/**
 * Non-stream create-turn: begin execution and resolve once the first event is
 * dual-written so immediate subscribe cannot 412. Same as `stream: false`.
 */
export async function startTurnInProcess(params: BeginTurnExecutionParams): Promise<TurnHandle> {
  const { turn, drainInput } = await beginTurnExecution(params);

  // Same unawaited drain scheduling as Hono streamSSE's run(cb).
  const { promise: firstEventDualWritten, resolve: markFirstEventDualWritten } = Promise.withResolvers<undefined>();
  void drainTurnEvents({
    ...drainInput,
    onEvent: () => {
      markFirstEventDualWritten(undefined);
      return Promise.resolve();
    },
  }).finally(() => {
    markFirstEventDualWritten(undefined);
  });
  await firstEventDualWritten;
  return turn;
}

function cancellationReason(reason: unknown): CancellationReason {
  switch (reason) {
    case CancellationReason.ServerExecutionTimeout:
    case CancellationReason.CancelledForNextTurn:
    case CancellationReason.Abandoned:
    case CancellationReason.ClientCancelled:
      return reason;
    default:
      return CancellationReason.ClientCancelled;
  }
}

/**
 * Rebuild a paused turn this replica owns, reseed the event-stream counter from
 * the existing tail, and drain in the background. Inbox replay happens inside rebuild.
 */
async function resumePausedTurn(input: {
  session: SessionHandle;
  turnId: string;
  requestContext: RequestContext;
  requestHeaders?: Record<string, string> | undefined;
  deps: BeginTurnExecutionDeps;
}): Promise<{ turn: TurnHandle; signal: AbortSignal; startDrain: () => void }> {
  // Same chain as create: model, MCP, sandbox, and the detached drain keep these ids.
  updateLogContext({
    tenant_id: input.session.tenant_id,
    session_id: input.session.session_id,
    turn_id: input.turnId,
  });
  const { abortController, resolver, executionTimeout } = await prepareTurnExecution({
    session: input.session,
    turnId: input.turnId,
    userRef: input.requestContext.subject.id,
    requestHeaders: input.requestHeaders,
    deps: input.deps,
  });
  const sessionId = input.session.session_id;
  // Visible to cancel and shutdown before rebuildTurn returns a handle.
  input.deps.activeTurns.reservePausedTurn({
    sessionId,
    turnId: input.turnId,
    abortController,
  });

  let turn: TurnHandle;
  try {
    turn = await input.session.rebuildTurn({
      turn_id: input.turnId,
      active_executor_id: configuration.EXECUTOR_ID,
      resolver,
      abortController,
    });
  } catch (error) {
    executionTimeout.clear();
    // Cancel aborted this rebuilding run and did not freeze. If the stream never starts,
    // freeze here so the row still becomes terminal. Offload leaves the row paused.
    if (
      abortController.signal.aborted &&
      !isTurnOffloadReason(abortController.signal.reason) &&
      !(error instanceof TurnOwnershipLostError)
    ) {
      try {
        await input.session.freezeTurn({
          turn_id: input.turnId,
          reason: cancellationReason(abortController.signal.reason),
        });
      } catch (freezeError) {
        if (!(freezeError instanceof TurnNotFoundError)) {
          input.deps.activeTurns.releaseReservedTurn({ sessionId, turnId: input.turnId });
          throw new Error(`Failed to freeze turn ${input.turnId} after rebuild failed`, { cause: freezeError });
        }
      }
    }
    input.deps.activeTurns.releaseReservedTurn({ sessionId, turnId: input.turnId });
    throw error;
  }

  const turnEventStream = input.deps.eventSubscriptions.get(
    turnStreamId(input.session.tenant_id, input.session.session_id, turn.id),
  );
  try {
    // Counter only. A missing stream stays at 1; log repair from the TurnRecord is later.
    await turnEventStream.resumeProducer({ streamTTLSeconds: configuration.TURN_STREAM_TTL_SECONDS });
  } catch (error) {
    executionTimeout.clear();
    abortController.abort(TurnOffloadReason);
    const tracked = input.deps.activeTurns.track({
      abortController,
      stream: turn.stream(),
      turn,
    });
    await tracked.return(undefined);
    throw error;
  }

  let drainStarted = false;
  return {
    turn,
    signal: abortController.signal,
    startDrain: () => {
      if (drainStarted) {
        return;
      }
      drainStarted = true;
      const trackedStream = input.deps.activeTurns.track({
        abortController,
        stream: turn.stream(),
        turn,
      });
      // Resume starts execute already paused, so no new paused `turn.update` is yielded
      // unless the turn runs and pauses again. Arm here or this run never offloads.
      input.deps.activeTurns.startPausedKeepalive({
        sessionId: input.session.session_id,
        turnId: turn.id,
      });
      void drainTurnEvents({
        trackedStream,
        turnEventStream,
        executionTimeout,
        logger: input.deps.logger,
        pausedKeepalive: {
          start: () => {
            input.deps.activeTurns.startPausedKeepalive({
              sessionId: input.session.session_id,
              turnId: turn.id,
            });
          },
          clear: () => {
            input.deps.activeTurns.clearPausedKeepalive({
              sessionId: input.session.session_id,
              turnId: turn.id,
            });
          },
        },
      });
    },
  };
}

/** Mapped client error from turn execution; undefined means rethrow. */
export interface TurnExecutionError {
  status: 400 | 404 | 422;
  message: string;
}

/**
 * Resolve turn-start failures to HTTP status + message.
 * Returns undefined when the caller should rethrow (unexpected / 5xx).
 */
export function getTurnExecutionError(error: unknown): TurnExecutionError | undefined {
  if (error instanceof HTTPException) {
    if (error.status === 400 || error.status === 404 || error.status === 422) {
      return { status: error.status, message: error.message };
    }
    return undefined;
  }
  if (error instanceof SessionStoreNotFoundError) {
    return { status: 404, message: error.message };
  }
  if (error instanceof AgentHarnessError && !(error instanceof McpConnectionError)) {
    switch (error.code) {
      case 'invalid_file_input':
        return { status: 400, message: error.message };
      case 'invalid_send_input':
      case 'agent_sandbox_required':
      case 'tool_name_collision':
        return { status: 422, message: error.message };
      case 'capability_state_error':
      case 'mcp_connection_failed':
        return undefined;
    }
  }
  return undefined;
}

/**
 * Resume cursor: `Last-Event-ID` header wins over the body value because the
 * header is updated by the SDK on every reconnect to reflect the last delivered
 * event, whereas the body is the original caller-supplied cursor and never
 * changes between reconnect attempts.
 */
export function resolveAfterSequenceNumber(c: Context, bodyAfterSequenceNumber?: number): number | undefined {
  const lastEventId = c.req.header('last-event-id');
  if (lastEventId) {
    const sequenceNumber = Number(lastEventId);
    if (!Number.isInteger(sequenceNumber) || sequenceNumber < 0) {
      throw new HTTPException(400, { message: 'Invalid Last-Event-Id header' });
    }
    return sequenceNumber;
  }
  return bodyAfterSequenceNumber;
}

/** True when the subject is the session creator (`created_by_subject.subject_id`). */
function isSessionOwner({
  subject_id,
  created_by_subject,
}: {
  subject_id: string;
  created_by_subject: { subject_id: string };
}): boolean {
  return created_by_subject.subject_id === subject_id;
}

/** Request-reply path the owner serves for inbound turn events. */
const TURNS_SEND_EVENTS_PATH = 'turns/send-events';

const PeerRequestContextSchema = z.object({
  tenant_id: z.string(),
  subject: z.object({
    id: z.string(),
    type: z.string(),
    display_name: z.string(),
  }),
  roles: z.array(z.string()),
  user_credential: z.string().nullable(),
});

const SendEventsPeerBodySchema = z.object({
  tenant_id: z.string(),
  session_id: z.string(),
  turn_id: z.string(),
  events: z.array(TurnUserEventSchema),
  request_context: PeerRequestContextSchema,
  request_headers: z.record(z.string(), z.string()).optional(),
});

const PeerEventsReplySchema = z.object({
  events: z.array(TurnUserEventSchema),
});

const PeerMessageSchema = z.object({
  message: z.string(),
});

type SendEventsResult =
  | { type: 'applied'; events: TurnUserEvent[] } // the events were applied successfully
  | { type: 'invalid'; message: string } // the events were invalid
  | { type: 'conflict'; message: string } // the turn is not accepting events
  | { type: 'failed'; message: string }; // this executor ran the request and failed while applying the events

export enum PeerOutcome {
  /** The owner did not receive this request: heartbeat missing, or publish reached nobody. */
  NoResponder = 'no_responder',
  /** The peer replied that it does not own the row. The batch was not applied. */
  NotOwner = 'not_owner',
  /** The request may already have been applied. Do not send it again. */
  OwnerNotGone = 'owner_not_gone',
}

type ForwardedSendResult = SendEventsResult | { type: 'peer'; peerOutcome: PeerOutcome };

export enum TurnOwnershipAction {
  /** Handle on the local ActiveTurn. */
  Run = 'run',
  /** This replica owns the turn but has no ActiveTurn: rebuild it, then handle. */
  Rebuild = 'rebuild',
  /** The turn cannot accept this request (terminal, or running with its executor gone). */
  Reject = 'reject',
}

/** Send a batch to the live handle and persist each yielded inbox batch. */
async function applyTurnEvents(input: {
  handle: TurnHandle;
  events: TurnUserEvent[];
  sessionStore: Pick<ISessionStore, 'insertTurnInboundEvents'>;
  sessionId: string;
  turnId: string;
}): Promise<SendEventsResult> {
  try {
    for await (const batch of input.handle.send(input.events)) {
      await input.sessionStore.insertTurnInboundEvents({
        session_id: input.sessionId,
        turn_id: input.turnId,
        active_executor_id: input.handle.record.active_executor_id,
        events: batch,
      });
    }
  } catch (error) {
    if (error instanceof AgentHarnessError && error.code === 'invalid_send_input') {
      return { type: 'invalid', message: error.message };
    }
    if (error instanceof TurnEventAlreadyExistsError) {
      return { type: 'conflict', message: error.message };
    }
    throw error;
  }
  return { type: 'applied', events: input.events };
}

/**
 * Run or rebuild a turn this executor owns, then apply the batch.
 * An HTTP send that already owns the row, a peered send, and a steal that just claimed the row all come here.
 * If the row is claimed away before the batch is applied, return `'retry'`.
 * The peered send turns that into 412. A peered request does not steal.
 */
async function rebuildOptionallyAndRun(input: {
  session: SessionHandle;
  turn: TurnRecord;
  events: TurnUserEvent[];
  sessionStore: Pick<ISessionStore, 'insertTurnInboundEvents'>;
  requestContext: RequestContext;
  requestHeaders: Record<string, string> | undefined;
  deps: BeginTurnExecutionDeps;
}): Promise<SendEventsResult | 'retry'> {
  const sessionId = input.session.session_id;
  const turnId = input.turn.turn_id;
  try {
    const handle = input.deps.activeTurns.getTurnHandle({ sessionId, turnId });
    const hasLocalActiveTurn = handle !== undefined;
    let action: TurnOwnershipAction;
    if (!isNonTerminalTurnState(input.turn.state)) {
      // done, cancelled, and error cannot accept a send
      action = TurnOwnershipAction.Reject;
    } else if (hasLocalActiveTurn) {
      // we already have a local active turn
      action = TurnOwnershipAction.Run;
    } else if (input.turn.state.status === 'paused') {
      // a paused turn, but we don't have a local active turn
      action = TurnOwnershipAction.Rebuild;
    } else {
      // a running state turn, either
      // - cancelled but hasn't reached turn.done
      // - stuck in running state because the executor died suddenly
      action = TurnOwnershipAction.Reject;
    }

    switch (action) {
      case TurnOwnershipAction.Run: {
        if (handle === undefined) {
          throw new Error('Unreachable: run requires a local turn');
        }
        // Drop the pause timer before wake. If it fired while this handler held the lock,
        // the callback sees the timer was replaced and does not offload. A send that leaves
        // the turn paused rearms; a later `running` update clears that timer from the drain.
        input.deps.activeTurns.clearPausedKeepalive({ sessionId, turnId });
        try {
          return await applyTurnEvents({
            handle,
            events: input.events,
            sessionStore: input.sessionStore,
            sessionId,
            turnId,
          });
        } finally {
          if (handle.state.status === 'paused') {
            input.deps.activeTurns.startPausedKeepalive({ sessionId, turnId });
          }
        }
      }
      case TurnOwnershipAction.Rebuild: {
        // A cancel on paused turn aborts the local run and leaves the turn status paused in store
        // until the drain writes turn.done
        // getTurnHandle hides that run. Reject instead of rebuilding over it.
        // we will not be able to apply events on cancelled turn anyway.
        if (input.deps.activeTurns.isCancelled({ sessionId, turnId })) {
          return { type: 'conflict', message: 'Turn is cancelled, cannot apply events' };
        }
        const resumed = await resumePausedTurn({
          session: input.session,
          turnId,
          requestContext: input.requestContext,
          requestHeaders: input.requestHeaders,
          deps: input.deps,
        });

        // when we start resumePausedTurn, we first stage the turn in ActiveTurns while it is being rebuilt
        // Case 1:
        // Happy path: the turn is resumed and events are applied
        // resumed? -> applyTurnEvents -> startDrain -> return applied
        // Case 2:
        // While we are rebuilding, the turn can be cancelled or server shutdown can happen
        // We startDrain regardless so the loop exits (turn.done or offloaded)
        // aborted? -> startDrain (without await) -> return conflict
        // Case 3:
        // Applying events fails after the turn is resumed
        // We startDrain so turn gets parked and sticks around in memory
        // apply? -> startDrain (without await) -> return conflict
        try {
          if (resumed.signal.aborted) {
            return { type: 'conflict', message: 'Turn is cancelled or unable to accept events' };
          }
          return await applyTurnEvents({
            handle: resumed.turn,
            events: input.events,
            sessionStore: input.sessionStore,
            sessionId,
            turnId,
          });
        } finally {
          resumed.startDrain();
        }
      }
      case TurnOwnershipAction.Reject:
        return {
          type: 'conflict',
          message:
            input.turn.state.status === 'running'
              ? 'Turn is running but its executor is gone'
              : 'Turn is cancelled or unable to accept events',
        };
    }
  } catch (error) {
    if (error instanceof TurnOwnershipLostError) {
      return 'retry';
    }
    input.deps.logger.error('Failed to apply events to an owned turn', {
      sessionId,
      turnId,
      ...extractErrorLogFields(error),
    });
    const cause = error instanceof Error ? error.message : String(error);
    return { type: 'failed', message: `Failed to apply events: ${cause}` };
  }
}

/** Ask the owning replica to apply the events. A peer outcome means this replica must decide again. */
async function forwardTurnEvents(input: {
  redis: RedisClient | undefined;
  owner: string;
  sessionId: string;
  turnId: string;
  events: TurnUserEvent[];
  requestContext: RequestContext;
  requestHeaders?: Record<string, string> | undefined;
  logger: Logger;
}): Promise<ForwardedSendResult> {
  if (!input.redis) {
    // unreachable code, we should always have a redis client
    input.logger.error('Failed to apply turn events: no redis client');
    return { type: 'failed', message: 'Unable to reach the turn executor' };
  }
  const { requestContext } = input;
  const body = SendEventsPeerBodySchema.parse({
    tenant_id: requestContext.tenant_id,
    session_id: input.sessionId,
    turn_id: input.turnId,
    events: input.events,
    request_context: {
      tenant_id: requestContext.tenant_id,
      subject: requestContext.subject,
      roles: requestContext.roles,
      user_credential: requestContext.user_credential,
    },
    ...(input.requestHeaders === undefined ? {} : { request_headers: input.requestHeaders }),
  });
  try {
    const reply = await redisRequest({
      redis: input.redis,
      executorId: input.owner,
      path: TURNS_SEND_EVENTS_PATH,
      request: { body: jsonValueFrom(body) },
      options: {
        replyTimeoutMs: configuration.REDIS_REQUEST_REPLY_TIMEOUT_MS,
        pollIntervalMs: configuration.REDIS_REQUEST_REPLY_POLL_INTERVAL_MS,
      },
    });

    switch (reply.status) {
      case 200: {
        const parsed = PeerEventsReplySchema.safeParse(reply.body);
        if (!parsed.success) {
          // ideally unreachable because peer should send a valid response
          // this can cause a bad state for e.g. if peer accepted the batch, applied approvals, but then sent an invalid response
          return { type: 'failed', message: 'Turn executor sent an invalid response' };
        }
        return { type: 'applied', events: parsed.data.events };
      }
      // The peer replied the events were invalid
      case 400: {
        const parsed = PeerMessageSchema.safeParse(reply.body);
        return {
          type: 'invalid',
          message: parsed.success ? parsed.data.message : `Turn rejected the events`,
        };
      }
      // The peer replied turn is not accepting events
      case 409: {
        const parsed = PeerMessageSchema.safeParse(reply.body);
        return {
          type: 'conflict',
          message: parsed.success ? parsed.data.message : `Turn is not accepting events`,
        };
      }
      // The peer replied that it does not own the row. The batch was not applied.
      case 412:
        return { type: 'peer', peerOutcome: PeerOutcome.NotOwner };
      case 500:
      default: {
        const parsed = PeerMessageSchema.safeParse(reply.body);
        return {
          type: 'failed',
          message: parsed.success ? parsed.data.message : `Failed to apply events`,
        };
      }
    }
  } catch (error) {
    if (error instanceof NoResponderError) {
      // The request was published, then the heartbeat disappeared while waiting for the reply.
      // The owner may have applied the batch. Do not send it again.
      if (error.detail === NO_RESPONDER_HEARTBEAT_LOST_DETAIL) {
        return { type: 'peer', peerOutcome: PeerOutcome.OwnerNotGone };
      }
      // Heartbeat was already missing, or publish reached nobody. This batch was not delivered.
      return { type: 'peer', peerOutcome: PeerOutcome.NoResponder };
    } else if (error instanceof RequestTimeoutError) {
      // The owner may have applied the batch before the reply wait ended.
      // Do not send it again; the client retries.
      return { type: 'peer', peerOutcome: PeerOutcome.OwnerNotGone };
    }
    input.logger.warn('Failed to reach owning executor for turn events', {
      sessionId: input.sessionId,
      turnId: input.turnId,
      owner: input.owner,
    });
    return { type: 'peer', peerOutcome: PeerOutcome.OwnerNotGone };
  }
}

async function handleParsedPeerTurnEvents(deps: TurnsRouterDeps, body: z.infer<typeof SendEventsPeerBodySchema>) {
  const session = await deps.sessions.get({
    tenant_id: body.tenant_id,
    session_id: body.session_id,
  });
  if (!session) {
    return { status: 404, body: { message: `Session not found` } };
  }
  const result = await deps.activeTurns.withTurnLock(
    { sessionId: body.session_id, turnId: body.turn_id },
    async (): Promise<SendEventsResult | { type: 'not_owner' }> => {
      const requestContext = requestContextFromWire(body.request_context);
      const runAsAgent = await referencedRunAsAgent({
        session,
        agentStore: deps.resolveAgentStore(requestContext),
      });
      const executionDeps = await executionDepsForCaller({
        deps,
        session,
        requestContext,
        requestHeaders: body.request_headers,
        ...(runAsAgent !== undefined ? { runAsAgent } : {}),
      });
      // Same run as an owner. A peered request does not steal, so a lost row is 412.
      const turn = await session.getTurn(body.turn_id);
      if (!turn) {
        return { type: 'conflict', message: `Turn not found` };
      }
      if (turn.active_executor_id !== configuration.EXECUTOR_ID) {
        return { type: 'not_owner' };
      }
      const owned = await rebuildOptionallyAndRun({
        session,
        turn,
        events: body.events,
        sessionStore: deps.sessionStore,
        requestContext,
        requestHeaders: body.request_headers,
        deps: executionDeps,
      });
      if (owned === 'retry') {
        return { type: 'not_owner' };
      }
      return owned;
    },
  );
  switch (result.type) {
    case 'applied':
      return { status: 200, body: jsonValueFrom({ events: result.events }) };
    case 'invalid':
      return { status: 400, body: { message: result.message } };
    case 'not_owner':
      return { status: 412, body: { message: 'Turn is no longer owned by this executor' } };
    case 'conflict':
      return { status: 409, body: { message: result.message } };
    case 'failed':
      return { status: 500, body: { message: result.message } };
    default: {
      const _exhaustive: never = result;
      throw new Error(`Unreachable send result: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

function handlePeerTurnEvents(deps: TurnsRouterDeps): RequestReplyRouteHandler {
  return async request => {
    const parsed = SendEventsPeerBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return { status: 400, body: { message: 'Invalid turns/send-events payload' } };
    }
    // No HTTP request context on this path. Resume and its drain inherit these ids.
    return runWithLogContext(
      {
        tenant_id: parsed.data.tenant_id,
        session_id: parsed.data.session_id,
        turn_id: parsed.data.turn_id,
      },
      () => handleParsedPeerTurnEvents(deps, parsed.data),
    );
  };
}

/**
 * A user send ends in `rebuildOptionallyAndRun` by one of three paths:
 * this process already owns the row and runs it;
 * this process forwards to the owner, and that peer runs it;
 * the owner never received the batch, this process steals the paused row, and then runs it.
 */

/**
 * One try at delivering a user send.
 * We own the turn: run or rebuild it. If the turn is claimed away before the batch is applied, try again.
 * The peer says it is not the owner: the batch was not applied, so load the turn and send it to whoever owns it now.
 * The batch never reached the owner: steal it when the turn is still paused under that same owner. If the turn is running, or another executor owns it, try again.
 * The owner may already have applied the batch: stop, and let the client retry.
 */
async function sendTurnEvents(input: {
  session: SessionHandle;
  sessionStore: Pick<ISessionStore, 'claimTurnExecutor' | 'insertTurnInboundEvents'>;
  turnId: string;
  events: TurnUserEvent[];
  requestContext: RequestContext;
  requestHeaders: Record<string, string> | undefined;
  deps: BeginTurnExecutionDeps;
}): Promise<SendEventsResult | 'retry'> {
  const sessionId = input.session.session_id;
  const turn = await input.session.getTurn(input.turnId);
  if (!turn) {
    return { type: 'conflict', message: `Turn not found: ${input.turnId}` };
  }
  // done, cancelled, and error cannot accept a send.
  if (!isNonTerminalTurnState(turn.state)) {
    return { type: 'conflict', message: `Turn is not accepting events: ${turn.turn_id}` };
  }
  if (turn.active_executor_id === configuration.EXECUTOR_ID) {
    return rebuildOptionallyAndRun({
      session: input.session,
      turn,
      events: input.events,
      sessionStore: input.sessionStore,
      requestContext: input.requestContext,
      requestHeaders: input.requestHeaders,
      deps: input.deps,
    });
  }

  // If the turn got paused and parked and then stolen, we need to drop the local turn
  await input.deps.activeTurns.dropLocalTurn({ sessionId, turnId: input.turnId });

  // Try to forward the events to the owner
  const forwarded = await forwardTurnEvents({
    redis: input.deps.redis,
    owner: turn.active_executor_id,
    sessionId,
    turnId: input.turnId,
    events: input.events,
    requestContext: input.requestContext,
    requestHeaders: input.requestHeaders,
    logger: input.deps.logger,
  });

  // If the reply anything other than peering call status, return the result
  // that means owner either accepted the events or rejected them
  if (forwarded.type !== 'peer') {
    return forwarded;
  }

  const refetchedTurn = await input.session.getTurn(input.turnId);
  if (refetchedTurn === undefined) {
    // Unreachable. Turns are not deleted, and the load above found this row.
    return { type: 'conflict', message: `Turn not found` };
  }

  // 412: the peer did not apply the batch. Load the row again and send to the current owner.
  // Timeout, heartbeat lost after publish, and transport errors may already have been
  // applied, so this pass does not send again.
  if (forwarded.peerOutcome === PeerOutcome.NotOwner || forwarded.peerOutcome === PeerOutcome.OwnerNotGone) {
    if (!isNonTerminalTurnState(refetchedTurn.state)) {
      return { type: 'conflict', message: 'Turn is not accepting events' };
    }
    if (forwarded.peerOutcome === PeerOutcome.NotOwner) {
      return 'retry';
    }
    return { type: 'failed', message: `Turn executor did not acknowledge the events` };
  }

  // This batch was not delivered. A finished row is a conflict. A running row or a new
  // owner is loaded again and sent to whoever owns it now.
  if (!isNonTerminalTurnState(refetchedTurn.state)) {
    return { type: 'conflict', message: `Turn is in terminal state, cannot apply events` };
  }
  if (refetchedTurn.state.status === 'running' || refetchedTurn.active_executor_id !== turn.active_executor_id) {
    return 'retry';
  }

  // Paused, still owned by the executor that did not receive this batch.
  input.deps.logger.info('Stealing paused turn', {
    fromExecutor: refetchedTurn.active_executor_id,
  });
  const won = await input.sessionStore.claimTurnExecutor({
    session_id: sessionId,
    turn_id: input.turnId,
    expected_executor_id: refetchedTurn.active_executor_id,
    new_executor_id: configuration.EXECUTOR_ID,
  });
  if (!won) {
    input.deps.logger.info('Paused turn steal lost the claim', {
      fromExecutor: refetchedTurn.active_executor_id,
    });
    return 'retry';
  }
  input.deps.logger.info('Paused turn steal claimed the row', {
    executorId: configuration.EXECUTOR_ID,
  });
  return rebuildOptionallyAndRun({
    session: input.session,
    turn: refetchedTurn,
    events: input.events,
    sessionStore: input.sessionStore,
    requestContext: input.requestContext,
    requestHeaders: input.requestHeaders,
    deps: input.deps,
  });
}

/** User send. Forwards to the owner and may steal a paused turn whose heartbeat is gone. */
async function sendTurnEventsWithRetries(input: {
  session: SessionHandle;
  sessionStore: Pick<ISessionStore, 'claimTurnExecutor' | 'insertTurnInboundEvents'>;
  turnId: string;
  events: TurnUserEvent[];
  requestContext: RequestContext;
  requestHeaders: Record<string, string> | undefined;
  deps: BeginTurnExecutionDeps;
}): Promise<SendEventsResult> {
  for (let attempt = 0; attempt < MAX_OWNERSHIP_ATTEMPTS; attempt++) {
    const result = await sendTurnEvents(input);
    if (result !== 'retry') {
      return result;
    }
  }
  input.deps.logger.error('Turn ownership did not settle while trying to apply events');
  return { type: 'failed', message: 'Unable to determine the executor for the turn' };
}

/** DB-backed turns (mounted at /api/v1/sessions). */
export function createTurnsRouter(deps: TurnsRouterDeps) {
  const listTurnsHandler: RouteHandler<typeof listTurnsRoute> = async c => {
    const { session_id: sessionId } = c.req.valid('param');
    const query = c.req.valid('query');
    const requestContext = deps.resolveRequestContext(c);
    const session = await deps.sessions.get({
      tenant_id: requestContext.tenant_id,
      session_id: sessionId,
    });
    if (!session) {
      return c.json({ error: { message: `Session not found: ${sessionId}` } }, 404);
    }
    const allowed = await canReadSession({
      shared: session.record.shared,
      store: deps.resolveAgentStore(requestContext),
      context: requestContext,
      authorizer: deps.authorizer,
      agent_id: session.record.agent.type === 'reference' ? session.record.agent.id : undefined,
      created_by_subject_id: session.record.created_by_subject.subject_id,
    });
    if (!allowed) {
      return c.json({ error: { message: FORBIDDEN_SESSION_ACCESS } }, 403);
    }
    try {
      const { data, pagination } = await session.listTurns({
        limit: query.limit,
        page_token: query.page_token,
      });
      return c.json({ data: data.map(toWireTurn), pagination }, 200);
    } catch (error) {
      if (error instanceof SessionStoreConflictError) {
        throw new HTTPException(400, { message: error.message, cause: error });
      }
      throw error;
    }
  };

  const getTurnHandler: RouteHandler<typeof getTurnRoute> = async c => {
    const { session_id: sessionId, turn_id: turnId } = c.req.valid('param');
    const requestContext = deps.resolveRequestContext(c);
    const session = await deps.sessions.get({
      tenant_id: requestContext.tenant_id,
      session_id: sessionId,
    });
    if (!session) {
      return c.json({ error: { message: `Session not found: ${sessionId}` } }, 404);
    }
    const allowed = await canReadSession({
      shared: session.record.shared,
      store: deps.resolveAgentStore(requestContext),
      context: requestContext,
      authorizer: deps.authorizer,
      agent_id: session.record.agent.type === 'reference' ? session.record.agent.id : undefined,
      created_by_subject_id: session.record.created_by_subject.subject_id,
    });
    if (!allowed) {
      return c.json({ error: { message: FORBIDDEN_SESSION_ACCESS } }, 403);
    }
    const turn = await session.getTurn(turnId);
    if (!turn) {
      return c.json({ error: { message: `Turn not found: ${turnId}` } }, 404);
    }
    return c.json({ data: toWireTurn(turn) }, 200);
  };

  const downloadSandboxFileHandler: RouteHandler<typeof downloadSandboxFileRoute> = async c => {
    const { session_id: sessionId, turn_id: turnId } = c.req.valid('param');
    const { path } = c.req.valid('query');

    let sandboxId: string | undefined;
    try {
      // Cheapest first: a malformed path costs no store read and no provider round-trip.
      validateSandboxFilePath(path);

      const requestContext = deps.resolveRequestContext(c);
      const session = await deps.sessions.get({
        tenant_id: requestContext.tenant_id,
        session_id: sessionId,
      });
      if (!session) {
        return c.json({ error: { message: `Session not found: ${sessionId}` } }, 404);
      }
      if (
        !isSessionOwner({
          subject_id: requestContext.subject.id,
          created_by_subject: session.record.created_by_subject,
        })
      ) {
        return c.json({ error: { message: FORBIDDEN_SESSION_ACCESS } }, 403);
      }

      // Loading the turn through the session is also a session-binding check: a turn id from another
      // session cannot be used to reach this session's sandbox.
      const turn = await session.getTurn(turnId);
      if (!turn) {
        return c.json({ error: { message: `Turn not found: ${turnId}` } }, 404);
      }
      sandboxId = turn.snapshot.sandbox_info?.sandbox_id;
      if (sandboxId === undefined) {
        return c.json({ error: { message: `Turn has no sandbox: ${turnId}` } }, 412);
      }

      const provider = await resolveSandboxProvider({
        tenant_id: requestContext.tenant_id,
        store: deps.sandboxProviderStore,
        logger: deps.logger,
        sessionId,
      });
      if (provider === undefined) {
        return c.json({ error: { message: 'No sandbox provider configured' } }, 412);
      }

      // TODO: stream the body instead of buffering the whole file in memory.
      const content = await provider.downloadFile({ sandboxId: rawSandboxId(sandboxId), path });
      return c.body(toArrayBuffer(content), 200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(content.byteLength),
        'Content-Disposition': toContentDisposition(path),
        'Cache-Control': 'private, no-store',
      });
    } catch (error) {
      // Every guard and the provider itself raise SandboxError, whose statusCode is the contract.
      if (error instanceof SandboxError) {
        throw new HTTPException(error.statusCode, { message: error.message, cause: error });
      }
      deps.logger.error('Sandbox file download failed', {
        ...extractErrorLogFields(error),
        sandboxId,
        path,
      });
      return c.json({ error: { message: 'Failed to download file from sandbox' } }, 424);
    }
  };

  const listTurnEventsHandler: RouteHandler<typeof listTurnEventsRoute> = async c => {
    const { session_id: sessionId, turn_id: turnId } = c.req.valid('param');
    const query = c.req.valid('query');
    const requestContext = deps.resolveRequestContext(c);
    const session = await deps.sessions.get({
      tenant_id: requestContext.tenant_id,
      session_id: sessionId,
    });
    if (!session) {
      return c.json({ error: { message: `Session not found: ${sessionId}` } }, 404);
    }
    const allowed = await canReadSession({
      shared: session.record.shared,
      store: deps.resolveAgentStore(requestContext),
      context: requestContext,
      authorizer: deps.authorizer,
      agent_id: session.record.agent.type === 'reference' ? session.record.agent.id : undefined,
      created_by_subject_id: session.record.created_by_subject.subject_id,
    });
    if (!allowed) {
      return c.json({ error: { message: FORBIDDEN_SESSION_ACCESS } }, 403);
    }
    const turn = await session.getTurn(turnId);
    if (!turn) {
      return c.json({ error: { message: `Turn not found: ${turnId}` } }, 404);
    }
    try {
      const { data, pagination } = await session.listTurnEvents({
        turn_id: turnId,
        limit: query.limit,
        page_token: query.page_token,
        order: query.order,
      });
      return c.json({ data, pagination }, 200);
    } catch (error) {
      if (error instanceof SessionStoreConflictError) {
        throw new HTTPException(400, { message: error.message, cause: error });
      }
      throw error;
    }
  };

  const createAndExecuteTurnHandler: RouteHandler<typeof createAndExecuteTurnRoute> = async c => {
    const { session_id: sessionId } = c.req.valid('param');
    const body = c.req.valid('json');
    const requestContext = deps.resolveRequestContext(c);

    const session = await deps.sessions.get({
      tenant_id: requestContext.tenant_id,
      session_id: sessionId,
    });
    if (!session) {
      return c.json({ error: { message: `Session not found: ${sessionId}` } }, 404);
    }
    if (
      !isSessionOwner({
        subject_id: requestContext.subject.id,
        created_by_subject: session.record.created_by_subject,
      })
    ) {
      return c.json({ error: { message: FORBIDDEN_CREATE_TURN } }, 403);
    }

    let referencedAgent: AgentRecord | undefined;
    if (session.record.agent.type === 'reference') {
      const agentId = session.record.agent.id;
      const agent = await deps.resolveAgentStore(requestContext).getAgent({
        tenant_id: requestContext.tenant_id,
        id: agentId,
      });
      if (agent === undefined) {
        return c.json({ error: { message: `Agent not found: ${agentId}` } }, 422);
      }
      const canUseAgent = await deps.authorizer.canAccessAgent({
        context: requestContext,
        action: 'use',
        agent,
      });
      if (!canUseAgent) {
        return c.json({ error: { message: `Agent not found: ${agentId}` } }, 404);
      }
      referencedAgent = agent;
    }

    // x-tfg-skills / x-tfg-mcp / x-tfg-models on turns only when the session agent is inline.
    const turnParams: BeginTurnExecutionParams = {
      session,
      input: body.input,
      previous_turn_id: body.previous_turn_id,
      userRef: requestContext.subject.id,
      requestHeaders: c.req.header(),
      deps: await executionDepsForCaller({
        deps,
        session,
        requestContext,
        requestHeaders: c.req.header(),
        ...(referencedAgent !== undefined ? { runAsAgent: referencedAgent } : {}),
      }),
    };

    try {
      // Non-stream: wait for first dual-write, return JSON (also used by schedule run-now).
      if (!body.stream) {
        const turn = await startTurnInProcess(turnParams);
        return c.json({ data: toWireTurn(turn.record) }, 200);
      }

      // Stream: same engine; a hung SSE write is timed out so drain/dual-write continue.
      const { drainInput, turn } = await beginTurnExecution(turnParams);
      // Hono maps client disconnect to stream.abort() (body cancel / AbortSignal)
      // outside request ALS, so capture ids here and pass them on the disconnect line.
      const disconnectLogContext = {
        ...currentLogContext(),
        session_id: sessionId,
        turn_id: turn.id,
      };
      let shouldWriteToSSEStream = true;
      return streamSSE(c, async stream => {
        stream.onAbort(() => {
          shouldWriteToSSEStream = false;
          deps.logger.info(
            'Create-turn SSE client disconnected, continuing drain without writing',
            disconnectLogContext,
          );
        });
        await drainTurnEvents({
          ...drainInput,
          onEvent: async (event, sequenceNumber) => {
            if (!stream.closed && !stream.aborted && shouldWriteToSSEStream) {
              try {
                await withTimeout(
                  stream.writeSSE(turnEventSsePayload(event, sequenceNumber)),
                  configuration.TURN_SSE_STREAM_WRITE_TIMEOUT_MS,
                );
              } catch (error) {
                if (error instanceof PromiseTimeoutError) {
                  deps.logger.error('SSE stream write timed out', extractErrorLogFields(error));
                } else {
                  deps.logger.error('SSE stream write error', extractErrorLogFields(error));
                }
                shouldWriteToSSEStream = false;
              }
            }
          },
        });
        if (!shouldWriteToSSEStream && !stream.closed) {
          stream.abort();
        }
        await stream.close();
      });
    } catch (error) {
      const turnError = getTurnExecutionError(error);
      if (turnError) {
        throw new HTTPException(turnError.status, { message: turnError.message, cause: error });
      }
      throw error;
    }
  };

  const postTurnEventsHandler: RouteHandler<typeof postTurnEventsRoute> = async c => {
    const { session_id: sessionId, turn_id: turnId } = c.req.valid('param');
    const body = c.req.valid('json');
    const requestContext = deps.resolveRequestContext(c);
    const session = await deps.sessions.get({
      tenant_id: requestContext.tenant_id,
      session_id: sessionId,
    });
    if (!session) {
      return c.json({ error: { message: `Session not found: ${sessionId}` } }, 404);
    }
    if (
      !isSessionOwner({
        subject_id: requestContext.subject.id,
        created_by_subject: session.record.created_by_subject,
      })
    ) {
      return c.json({ error: { message: FORBIDDEN_SESSION_ACCESS } }, 403);
    }
    const turn = await session.getTurn(turnId);
    if (!turn) {
      return c.json({ error: { message: `Turn not found: ${turnId}` } }, 404);
    }

    const createdAt = new Date().toISOString();
    const events: TurnUserEvent[] = body.events.map(payload => ({
      ...payload,
      id: newEventId(),
      created_at: createdAt,
    }));
    const requestHeaders = c.req.header();

    return deps.activeTurns.withTurnLock({ sessionId, turnId }, async () => {
      const runAsAgent = await referencedRunAsAgent({
        session,
        agentStore: deps.resolveAgentStore(requestContext),
      });
      const executionDeps = await executionDepsForCaller({
        deps,
        session,
        requestContext,
        requestHeaders,
        ...(runAsAgent !== undefined ? { runAsAgent } : {}),
      });
      const result = await sendTurnEventsWithRetries({
        session,
        sessionStore: deps.sessionStore,
        turnId,
        events,
        requestContext,
        requestHeaders,
        deps: executionDeps,
      });
      switch (result.type) {
        case 'applied':
          return c.json({ data: result.events }, 201);
        case 'invalid':
          return c.json({ error: { message: `Failed to apply events: ${result.message}` } }, 400);
        case 'conflict':
          return c.json({ error: { message: `Failed to apply events: ${result.message}` } }, 409);
        case 'failed':
          return c.json({ error: { message: `Failed to apply events: ${result.message}` } }, 500);
        default: {
          const _exhaustive: never = result;
          throw new Error(`Unreachable send result: ${JSON.stringify(_exhaustive)}`);
        }
      }
    });
  };

  const subscribeTurnHandler: RouteHandler<typeof subscribeTurnRoute> = async c => {
    const { session_id: sessionId, turn_id: turnId } = c.req.valid('param');
    const query = c.req.valid('query');
    const afterSequenceNumber = resolveAfterSequenceNumber(c, query.after_sequence_number);
    const requestContext = deps.resolveRequestContext(c);

    const session = await deps.sessions.get({
      tenant_id: requestContext.tenant_id,
      session_id: sessionId,
    });
    if (!session) {
      return c.json({ error: { message: `Session not found: ${sessionId}` } }, 404);
    }
    const allowed = await canReadAgentBoundResource({
      store: deps.resolveAgentStore(requestContext),
      context: requestContext,
      authorizer: deps.authorizer,
      agent_id: session.record.agent.type === 'reference' ? session.record.agent.id : undefined,
      created_by_subject_id: session.record.created_by_subject.subject_id,
    });
    if (!allowed) {
      return c.json({ error: { message: FORBIDDEN_SESSION_ACCESS } }, 403);
    }
    const turn = await session.getTurn(turnId);
    if (!turn) {
      return c.json({ error: { message: `Turn not found: ${turnId}` } }, 404);
    }

    const turnEventStream = deps.eventSubscriptions.get(turnStreamId(requestContext.tenant_id, sessionId, turnId));

    // Admission check before SSE headers are sent, so it can still map to HTTP 412.
    try {
      await turnEventStream.assertSubscribable();
    } catch (error) {
      if (error instanceof StreamGoneError) {
        throw new HTTPException(412, { message: error.message, cause: error });
      }
      throw error;
    }

    // One lifecycle controller: server-side timeout, client disconnect, and
    // normal teardown all abort it, which ends poll even while it is parked
    // waiting for events.
    const subscribeAbort = new AbortController();
    const timeoutMs = configuration.TURN_SUBSCRIBE_TIMEOUT_MS;
    const timeoutHandler = setTimeout(() => {
      deps.logger.info('Subscribe turn stream server-side timeout reached, closing stream', {
        afterSequenceNumber,
        timeoutMs,
      });
      subscribeAbort.abort(new Error('subscribe-timeout'));
    }, timeoutMs);

    return streamSSE(c, async stream => {
      stream.onAbort(() => {
        subscribeAbort.abort(new Error('client-disconnected'));
      });

      const generator = turnEventStream.poll(afterSequenceNumber, { signal: subscribeAbort.signal });
      try {
        for await (const { sequence_number: sequenceNumber, ...event } of generator) {
          await stream.writeSSE(turnEventSsePayload(event, sequenceNumber));
          if (event.type === EventType.TURN_DONE) {
            break;
          }
        }
      } catch (error) {
        if (!subscribeAbort.signal.aborted) {
          deps.logger.error('Unexpected error in turn subscribe SSE loop', extractErrorLogFields(error));
        }
      } finally {
        clearTimeout(timeoutHandler);
        // Poll loops forever by design; aborting releases a parked generator
        // immediately so the return() below settles right away.
        subscribeAbort.abort();
        await generator.return(undefined);
        await stream.close();
      }
    });
  };

  const router = new OpenAPIHono();
  router.openapi(createAndExecuteTurnRoute, createAndExecuteTurnHandler);
  router.openapi(listTurnsRoute, listTurnsHandler);
  router.openapi(getTurnRoute, getTurnHandler);
  router.openapi(downloadSandboxFileRoute, downloadSandboxFileHandler);
  router.openapi(listTurnEventsRoute, listTurnEventsHandler);
  router.openapi(postTurnEventsRoute, postTurnEventsHandler);
  router.openapi(subscribeTurnRoute, subscribeTurnHandler);
  deps.requestReplyRouter.registerRoute(TURNS_SEND_EVENTS_PATH, handlePeerTurnEvents(deps));
  return router;
}
