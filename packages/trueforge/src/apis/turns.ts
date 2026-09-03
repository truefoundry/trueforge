/**
 * DB-backed turns API (mounted at /api/v1/sessions).
 */
import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import type { ISessionStore, Sessions, Turn, TurnStreamingEvent } from '@truefoundry/trueforge-core/agent-session';
import {
  CancellationReason,
  EventType,
  SessionStoreConflictError,
  SessionStoreNotFoundError,
  TurnResourceResolver,
  type SessionHandle,
  type TurnHandle,
  type TurnInputItem,
  type TurnRecordWithoutSnapshot,
} from '@truefoundry/trueforge-core/agent-session';
import {
  AgentHarnessError,
  existingSandboxIdForProvider,
  extractErrorLogFields,
  isAgentInputUserMessage,
  isFileContentPart,
  McpConnectionError,
  rawSandboxId,
  SandboxError,
  VercelAILLM,
} from '@truefoundry/trueforge-core/core';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { streamSSE } from 'hono/streaming';
import type { Logger } from 'winston';
import type { ResolveRequestContext } from '../auth/identity';
import configuration from '../config';
import type { IAgentStore } from '../db/agentStore';
import type { IMcpServerWithAuthStore } from '../db/mcpServerStore';
import type { IModelProviderStore } from '../db/modelProviderStore';
import type { ISandboxProviderStore } from '../db/sandboxProviderStore';
import type { ISkillStore } from '../db/skillStore';
import {
  createAndExecuteTurnRoute,
  downloadSandboxFileRoute,
  getTurnRoute,
  listTurnEventsRoute,
  listTurnsRoute,
  subscribeTurnRoute,
} from '../routes/turnRoutes';
import type { ActiveTurnRegistry } from '../runtime/activeTurns';
import { StreamGoneError, type EventSubscription, type EventSubscriptionRegistry } from '../runtime/event-subscription';
import { mintPeeredTurnId } from '../runtime/peeringIds';
import { validateSandboxFilePath } from '../runtime/sandboxFilePath';
import {
  buildTurnSandbox,
  getMcpConnection,
  getModelDetails,
  resolveGitSkills,
  resolveSandboxProvider,
} from '../runtime/sessionResources';
import { checkSnapshotStatus } from '../sandbox/providerUtils';

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

export interface TurnsRouterDeps {
  sessions: Sessions;
  sessionStore: ISessionStore;
  activeTurns: ActiveTurnRegistry;
  resolveModelProviderStore: (c: Context) => IModelProviderStore;
  resolveMcpServerStore: (c: Context) => IMcpServerWithAuthStore;
  skillStore: ISkillStore;
  resolveAgentStore: (c: Context) => IAgentStore;
  /** Resumable live turn-event transport: create-turn writes, subscribe polls. */
  eventSubscriptions: EventSubscriptionRegistry<TurnStreamingEvent>;
  sandboxProviderStore: ISandboxProviderStore;
  logger: Logger;
  resolveRequestContext: ResolveRequestContext;
}

/**
 * Deps needed to create a turn and drain events in-process (no HTTP). Unlike the HTTP path, this
 * carries already-resolved `modelProviderStore` / `mcpServerStore` / `agentStore` (the scheduler has no request
 * context to resolve them).
 */
export type BeginTurnExecutionDeps = Pick<
  TurnsRouterDeps,
  'activeTurns' | 'eventSubscriptions' | 'skillStore' | 'sandboxProviderStore' | 'logger'
> & {
  modelProviderStore: IModelProviderStore;
  mcpServerStore: IMcpServerWithAuthStore;
  agentStore: IAgentStore;
};

/**
 * Builds the per-turn resolver. Agent / MCP / sandbox / LLM lookups are wired
 * the same way: async factories over the corresponding stores.
 */
function createTurnResolver(deps: {
  mcpServerStore: IMcpServerWithAuthStore;
  skillStore: ISkillStore;
  sandboxProviderStore: ISandboxProviderStore;
  agentStore: IAgentStore;
  modelProviderStore: IModelProviderStore;
  logger: Logger;
  signal: AbortSignal;
  tenant_id: string;
  userRef: string;
  sessionId: string;
}): TurnResourceResolver {
  const {
    mcpServerStore,
    skillStore,
    sandboxProviderStore,
    agentStore,
    modelProviderStore,
    logger,
    signal,
    tenant_id,
    userRef,
    sessionId,
  } = deps;
  return new TurnResourceResolver({
    llm: async name => {
      const resolved = await getModelDetails({
        tenant_id,
        name,
        store: modelProviderStore,
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
      });
      if (connection === undefined) {
        throw new HTTPException(422, {
          message: `Unknown MCP server "${name}" — not configured`,
        });
      }
      return connection;
    },
    mcpRequestTimeoutMs: configuration.MCP_REQUEST_TIMEOUT_MS,
    mcpConnectTimeoutMs: configuration.MCP_CONNECT_TIMEOUT_MS,
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
      const carriedSandboxId = existingSandboxIdForProvider({
        existingSandboxId,
        currentProviderType: provider.type,
      });
      // A fresh Daytona sandbox is cloned from the release snapshot, so the build must be ready first.
      // Restoring an existing sandbox goes through daytona.get and never touches the snapshot.
      // Local fallback has no image build.
      if (carriedSandboxId === undefined && provider.type !== 'local') {
        const status = await checkSnapshotStatus({ store: sandboxProviderStore, tenant_id, logger });
        if (status?.status !== 'ready') {
          throw new HTTPException(422, {
            message:
              status?.status === 'failed'
                ? `sandbox image build failed (${status.status_reason ?? 'unknown error'})`
                : 'sandbox image is activating — retry shortly',
          });
        }
      }
      const gitSkills = await resolveGitSkills({
        tenant_id,
        skills: spec.skills ?? [],
        store: skillStore,
      });
      return buildTurnSandbox({
        provider,
        logger,
        gitSkills,
        fileDownloadEnabled: spec.config.sandbox.file_downloads,
        existingSandboxId: carriedSandboxId,
        tracing,
      });
    },
    agent: async agentId => {
      const record = await agentStore.getAgent({ tenant_id, id: agentId });
      if (record === undefined) {
        throw new HTTPException(422, { message: `Agent not found: ${agentId}` });
      }
      return record.manifest;
    },
    logger,
  });
}

const MAX_SESSION_TITLE_LENGTH = 50;

/**
 * Derives a session title from the first user message of the first turn. Returns the
 * trimmed text (capped at {@link MAX_SESSION_TITLE_LENGTH}) or `undefined` when no usable
 * text is present (e.g. file-only or tool-approval input).
 */
export function deriveSessionTitle(input: TurnInputItem[] | undefined): string | undefined {
  const firstUserMessage = input?.find(isAgentInputUserMessage);
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
  return trimmed.slice(0, MAX_SESSION_TITLE_LENGTH);
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
  return `agent:turn:${tenantId}:${sessionId}:${turnId}:stream`;
}

/**
 * Dual-write turn events to the resumable subscription registry, then optionally
 * forward each sequenced event (SSE path). Shared by streaming and non-streaming
 * create-turn; the HTTP response lifecycle does not own execution.
 */
export async function drainTurnEvents(input: {
  trackedStream: AsyncIterable<TurnStreamingEvent>;
  turnEventStream: EventSubscription<TurnStreamingEvent>;
  sessionId: string;
  turnId: string;
  maxExecutionTimer: NodeJS.Timeout;
  logger: Logger;
  onEvent?: (event: TurnStreamingEvent, sequenceNumber: number) => Promise<void>;
}): Promise<void> {
  const { trackedStream, turnEventStream, sessionId, turnId, maxExecutionTimer, logger, onEvent } = input;
  try {
    for await (const event of trackedStream) {
      // Dual-write before any client sink so subscribers can resume after disconnect.
      const sequenceNumber = await turnEventStream.put(event, {
        streamTTLSeconds: streamTTLSecondsFor(event),
      });
      await onEvent?.(event, sequenceNumber);
    }
  } catch (error) {
    if (error instanceof SessionStoreNotFoundError) {
      logger.warn('Turn stream ended after session/turn was removed', {
        sessionId,
        turnId,
        ...extractErrorLogFields(error),
      });
    } else {
      logger.error('Unexpected error in turn event drain', {
        sessionId,
        turnId,
        ...extractErrorLogFields(error),
      });
    }
  } finally {
    clearTimeout(maxExecutionTimer);
  }
}

/** Inputs for {@link drainTurnEvents} produced by {@link beginTurnExecution}. */
export interface TurnEventDrainInput {
  trackedStream: AsyncIterable<TurnStreamingEvent>;
  turnEventStream: EventSubscription<TurnStreamingEvent>;
  sessionId: string;
  turnId: string;
  maxExecutionTimer: NodeJS.Timeout;
  logger: Logger;
}

/**
 * Shared create-turn engine: persist the turn, start execution, and return the
 * drain inputs. Does not wait for events and does not write HTTP/SSE.
 */
export async function beginTurnExecution(params: {
  session: SessionHandle;
  input: TurnInputItem[] | undefined;
  previous_turn_id: string | undefined;
  userRef: string;
  deps: BeginTurnExecutionDeps;
}): Promise<{ turn: TurnHandle; drainInput: TurnEventDrainInput }> {
  const { session, input, previous_turn_id: previousTurnId, userRef, deps } = params;
  const sessionId = session.session_id;

  const abortController = new AbortController();
  const tenant_id = session.tenant_id;
  const resolver = createTurnResolver({
    mcpServerStore: deps.mcpServerStore,
    skillStore: deps.skillStore,
    sandboxProviderStore: deps.sandboxProviderStore,
    agentStore: deps.agentStore,
    modelProviderStore: deps.modelProviderStore,
    logger: deps.logger,
    signal: abortController.signal,
    tenant_id,
    userRef,
    sessionId,
  });

  // First turn only: derive the title from the first user message. The store
  // never overwrites an existing title.
  const title = session.record.last_turn_id ? undefined : deriveSessionTitle(input);

  const turn = await session.createTurn({
    turn_id: mintPeeredTurnId(configuration.EXECUTOR_ID),
    input,
    previous_turn_id: previousTurnId,
    signal: abortController.signal,
    resolver,
    update_session_title_if_not_exist: title,
  });

  const maxExecutionTimer = setTimeout(() => {
    if (!abortController.signal.aborted) {
      abortController.abort(CancellationReason.ServerExecutionTimeout);
    }
  }, configuration.SERVER_EXECUTION_TIMEOUT_SECONDS * 1000);
  maxExecutionTimer.unref();

  const trackedStream = deps.activeTurns.track({
    sessionId,
    turnId: turn.id,
    abortController,
    stream: turn.stream(),
  });

  // Held for the whole turn; the stream's sequence counter dies with it.
  const turnEventStream = deps.eventSubscriptions.get(turnStreamId(tenant_id, sessionId, turn.id));

  return {
    turn,
    drainInput: {
      trackedStream,
      turnEventStream,
      sessionId,
      turnId: turn.id,
      maxExecutionTimer,
      logger: deps.logger,
    },
  };
}

/**
 * Non-stream create-turn: begin execution and resolve once the first event is
 * dual-written so immediate subscribe cannot 412. Same as `stream: false`.
 */
export async function startTurnInProcess(params: {
  session: SessionHandle;
  input: TurnInputItem[] | undefined;
  previous_turn_id: string | undefined;
  userRef: string;
  deps: BeginTurnExecutionDeps;
}): Promise<TurnHandle> {
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
function checkTurnAccess({
  subject_id,
  created_by_subject,
}: {
  subject_id: string;
  created_by_subject: { subject_id: string };
}): boolean {
  return created_by_subject.subject_id === subject_id;
}

const FORBIDDEN_SESSION_ACCESS = 'Only the session creator can access this session';
const FORBIDDEN_CREATE_TURN = 'Only the session creator can create turns';

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
    if (
      !checkTurnAccess({
        subject_id: requestContext.subject.id,
        created_by_subject: session.record.created_by_subject,
      })
    ) {
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
        return c.json({ error: { message: error.message } }, 400);
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
    if (
      !checkTurnAccess({
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
    return c.json({ data: toWireTurn(turn.record) }, 200);
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
        !checkTurnAccess({
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
      sandboxId = turn.record.snapshot.sandbox_info?.sandbox_id;
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
        return c.json({ error: { message: error.message } }, error.statusCode);
      }
      deps.logger.error('Sandbox file download failed', {
        ...extractErrorLogFields(error),
        sessionId,
        turnId,
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
    if (
      !checkTurnAccess({
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
    try {
      const { data, pagination } = await turn.listEvents({
        limit: query.limit,
        page_token: query.page_token,
        order: query.order,
      });
      return c.json({ data, pagination }, 200);
    } catch (error) {
      if (error instanceof SessionStoreConflictError) {
        return c.json({ error: { message: error.message } }, 400);
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
      !checkTurnAccess({
        subject_id: requestContext.subject.id,
        created_by_subject: session.record.created_by_subject,
      })
    ) {
      return c.json({ error: { message: FORBIDDEN_CREATE_TURN } }, 403);
    }

    const turnParams = {
      session,
      input: body.input,
      previous_turn_id: body.previous_turn_id,
      userRef: requestContext.subject.id,
      deps: {
        ...deps,
        modelProviderStore: deps.resolveModelProviderStore(c),
        mcpServerStore: deps.resolveMcpServerStore(c),
        agentStore: deps.resolveAgentStore(c),
      },
    };

    try {
      // Non-stream: wait for first dual-write, return JSON (also used by schedule run-now).
      if (!body.stream) {
        const turn = await startTurnInProcess(turnParams);
        return c.json({ data: toWireTurn(turn.record) }, 200);
      }

      // Stream: same engine; HTTP handler owns writing each event to SSE.
      const { drainInput } = await beginTurnExecution(turnParams);
      let shouldWriteToSSEStream = true;
      return streamSSE(c, async stream => {
        stream.onAbort(() => {
          shouldWriteToSSEStream = false;
        });
        await drainTurnEvents({
          ...drainInput,
          onEvent: async (event, sequenceNumber) => {
            if (!stream.closed && !stream.aborted && shouldWriteToSSEStream) {
              try {
                await stream.writeSSE(turnEventSsePayload(event, sequenceNumber));
              } catch (error) {
                deps.logger.error('SSE stream write error', extractErrorLogFields(error));
                shouldWriteToSSEStream = false;
              }
            }
          },
        });
        await stream.close();
      });
    } catch (error) {
      const turnError = getTurnExecutionError(error);
      if (turnError) {
        return c.json({ error: { message: turnError.message } }, turnError.status);
      }
      throw error;
    }
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
    if (
      !checkTurnAccess({
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
        sessionId,
        turnId,
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
  router.openapi(subscribeTurnRoute, subscribeTurnHandler);
  return router;
}
