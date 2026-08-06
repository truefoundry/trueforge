/**
 * DB-backed turns API (mounted at /api/v1/sessions).
 */
import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import type { ISessionStore, Sessions, Turn, TurnStreamingEvent } from '@truefoundry/utils-core/agent-session';
import {
  CancellationReason,
  EventType,
  SessionStoreConflictError,
  SessionStoreNotFoundError,
  TurnHandle,
  TurnResourceResolver,
  type TurnInputItem,
  type TurnRecordWithoutSnapshot,
} from '@truefoundry/utils-core/agent-session';
import {
  AgentHarnessError,
  extractErrorLogFields,
  isAgentInputUserMessage,
  isFileContentPart,
  McpConnectionError,
  VercelAILLM,
  type VercelAIProviderConfig,
} from '@truefoundry/utils-core/core';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { streamSSE } from 'hono/streaming';
import type { Logger } from 'winston';
import configuration from '../config';
import type { IMcpServerStore } from '../db/mcpServerStore';
import type { IModelProviderStore } from '../db/modelProviderStore';
import type { ISandboxProviderStore } from '../db/sandboxProviderStore';
import type { ISkillStore } from '../db/skillStore';
import type { IOAuthTokenStore } from '../mcp/auth/types';
import {
  createAndExecuteTurnRoute,
  getTurnRoute,
  listTurnEventsRoute,
  listTurnsRoute,
  subscribeTurnRoute,
} from '../routes/turnRoutes';
import type { ActiveTurnRegistry } from '../runtime/activeTurns';
import { StreamGoneError, type EventSubscriptionRegistry } from '../runtime/event-subscription';
import { mintPeeredTurnId } from '../runtime/peeringIds';
import {
  buildTurnSandbox,
  getMcpConnection,
  getModelProviderConfig,
  resolveGitSkills,
  resolveSandboxProvider,
} from '../runtime/sessionResources';
import { TENANT_ID } from './sessions';

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

export interface TurnsRouterDeps {
  sessions: Sessions;
  sessionStore: ISessionStore;
  activeTurns: ActiveTurnRegistry;
  modelProviderStore: IModelProviderStore;
  mcpServerStore: IMcpServerStore;
  tokenStore: IOAuthTokenStore;
  skillStore: ISkillStore;
  /** Resumable live turn-event transport: create-turn writes, subscribe polls. */
  eventSubscriptions: EventSubscriptionRegistry<TurnStreamingEvent>;
  sandboxProviderStore: ISandboxProviderStore;
  logger: Logger;
}

/**
 * TurnResourceResolver requires a sync llm factory; preload the session model
 * config so the factory stays sync while the store read stays async.
 */
function createTurnResolver(deps: {
  mcpServerStore: IMcpServerStore;
  tokenStore: IOAuthTokenStore;
  skillStore: ISkillStore;
  sandboxProviderStore: ISandboxProviderStore;
  logger: Logger;
  signal: AbortSignal;
  modelName: string;
  providerConfig: VercelAIProviderConfig;
}): TurnResourceResolver {
  const { mcpServerStore, tokenStore, skillStore, sandboxProviderStore, logger, signal, modelName, providerConfig } =
    deps;
  return new TurnResourceResolver({
    llm: name => {
      if (name !== modelName) {
        throw new Error(`Model not registered: ${name}`);
      }
      return new VercelAILLM({
        providerConfig,
        logger,
        signal,
      });
    },
    mcp: async name => {
      const connection = await getMcpConnection({
        tenant_id: TENANT_ID,
        name,
        store: mcpServerStore,
        tokenStore,
        clientName: configuration.MCP_DCR_OAUTH_CLIENT_NAME,
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
        tenant_id: TENANT_ID,
        store: sandboxProviderStore,
        logger,
      });
      if (provider === undefined) {
        throw new HTTPException(422, {
          message: 'no sandbox provider configured — PUT /settings/sandbox-providers',
        });
      }
      const gitSkills = await resolveGitSkills({
        tenant_id: TENANT_ID,
        skills: spec.skills ?? [],
        store: skillStore,
      });
      return buildTurnSandbox({
        provider,
        logger,
        gitSkills,
        fileDownloadEnabled: spec.config.sandbox.file_downloads,
        existingSandboxId,
        tracing,
        tenantName: TENANT_ID,
      });
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

/** DB-backed turns (mounted at /api/v1/sessions). */
export function createTurnsRouter(deps: TurnsRouterDeps) {
  const listTurnsHandler: RouteHandler<typeof listTurnsRoute> = async c => {
    const { session_id: sessionId } = c.req.valid('param');
    const query = c.req.valid('query');
    const session = await deps.sessions.get({ tenant_id: TENANT_ID, session_id: sessionId });
    if (!session) {
      return c.json({ error: { message: `Session not found: ${sessionId}` } }, 404);
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
    const turn = await TurnHandle.get({
      store: deps.sessionStore,
      session_id: sessionId,
      turn_id: turnId,
    });
    if (!turn) {
      return c.json({ error: { message: `Turn not found: ${turnId}` } }, 404);
    }
    return c.json({ data: toWireTurn(turn.record) }, 200);
  };

  const listTurnEventsHandler: RouteHandler<typeof listTurnEventsRoute> = async c => {
    const { session_id: sessionId, turn_id: turnId } = c.req.valid('param');
    const query = c.req.valid('query');
    const turn = await TurnHandle.get({
      store: deps.sessionStore,
      session_id: sessionId,
      turn_id: turnId,
    });
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

    const session = await deps.sessions.get({ tenant_id: TENANT_ID, session_id: sessionId });
    if (!session) {
      return c.json({ error: { message: `Session not found: ${sessionId}` } }, 404);
    }

    const abortController = new AbortController();
    const modelName = session.agent_spec.model.name;
    const providerConfig = await getModelProviderConfig({
      tenant_id: TENANT_ID,
      name: modelName,
      store: deps.modelProviderStore,
    });
    const resolver = createTurnResolver({
      mcpServerStore: deps.mcpServerStore,
      tokenStore: deps.tokenStore,
      skillStore: deps.skillStore,
      sandboxProviderStore: deps.sandboxProviderStore,
      logger: deps.logger,
      signal: abortController.signal,
      modelName,
      providerConfig,
    });

    // First turn only: derive the title from the first user message. The store
    // never overwrites an existing title.
    const title = session.record.last_turn_id ? undefined : deriveSessionTitle(body.input);

    let turn;
    try {
      turn = await session.createTurn({
        turn_id: mintPeeredTurnId(configuration.EXECUTOR_ID),
        input: body.input,
        previous_turn_id: body.previous_turn_id,
        signal: abortController.signal,
        resolver,
        update_session_title_if_not_exist: title,
      });
    } catch (error) {
      if (error instanceof SessionStoreNotFoundError) {
        return c.json({ error: { message: error.message } }, 404);
      }
      if (error instanceof AgentHarnessError && !(error instanceof McpConnectionError)) {
        return c.json({ error: { message: error.message } }, 400);
      }
      throw error;
    }

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

    let shouldWriteToSSEStream = true;
    // Held for the whole turn; the stream's sequence counter dies with it.
    const turnEventStream = deps.eventSubscriptions.get(turnStreamId(TENANT_ID, sessionId, turn.id));
    return streamSSE(c, async stream => {
      stream.onAbort(() => {
        shouldWriteToSSEStream = false;
      });
      try {
        for await (const event of trackedStream) {
          // Dual-write before SSE so subscribers can resume even after the
          // creating client disconnects; the returned sequence is the SSE id.
          const sequenceNumber = await turnEventStream.put(event, {
            streamTTLSeconds: streamTTLSecondsFor(event),
          });
          if (!stream.closed && !stream.aborted && shouldWriteToSSEStream) {
            try {
              await stream.writeSSE(turnEventSsePayload(event, sequenceNumber));
            } catch (error) {
              deps.logger.error('SSE stream write error', extractErrorLogFields(error));
              shouldWriteToSSEStream = false;
            }
          }
        }
      } catch (error) {
        if (error instanceof SessionStoreNotFoundError) {
          deps.logger.warn('Turn stream ended after session/turn was removed', {
            sessionId,
            turnId: turn.id,
            ...extractErrorLogFields(error),
          });
        } else {
          deps.logger.error('Unexpected error in turn SSE stream loop', {
            sessionId,
            turnId: turn.id,
            ...extractErrorLogFields(error),
          });
        }
      } finally {
        clearTimeout(maxExecutionTimer);
        await stream.close();
      }
    });
  };

  const subscribeTurnHandler: RouteHandler<typeof subscribeTurnRoute> = async c => {
    const { session_id: sessionId, turn_id: turnId } = c.req.valid('param');
    const query = c.req.valid('query');
    const afterSequenceNumber = resolveAfterSequenceNumber(c, query.after_sequence_number);

    const session = await deps.sessions.get({ tenant_id: TENANT_ID, session_id: sessionId });
    if (!session) {
      return c.json({ error: { message: `Session not found: ${sessionId}` } }, 404);
    }
    const turn = await session.getTurn(turnId);
    if (!turn) {
      return c.json({ error: { message: `Turn not found: ${turnId}` } }, 404);
    }

    const turnEventStream = deps.eventSubscriptions.get(turnStreamId(TENANT_ID, sessionId, turnId));

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
  router.openapi(listTurnEventsRoute, listTurnEventsHandler);
  router.openapi(subscribeTurnRoute, subscribeTurnHandler);
  return router;
}
