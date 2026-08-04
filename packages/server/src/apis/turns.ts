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
  type TurnSandboxFactory,
} from '@truefoundry/utils-core/agent-session';
import {
  AgentHarnessError,
  extractErrorLogFields,
  isAgentInputUserMessage,
  isFileContentPart,
  McpConnectionError,
  VercelAILLM,
} from '@truefoundry/utils-core/core';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { streamSSE } from 'hono/streaming';
import type { Logger } from 'winston';
import configuration from '../config';
import type { McpStore } from '../legacy-registry-store/McpStore';
import type { ModelStore } from '../legacy-registry-store/ModelStore';
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
import { TENANT_ID } from './sessions';

function toWireTurn(record: TurnRecordWithoutSnapshot): Turn {
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
  modelStore: ModelStore;
  mcpStore: McpStore;
  /** Resumable live turn-event transport: create-turn writes, subscribe polls. */
  eventSubscriptions: EventSubscriptionRegistry<TurnStreamingEvent>;
  /** Built at boot from SANDBOX_SETTINGS; undefined = sandbox unsupported. */
  sandboxFactory?: TurnSandboxFactory;
  logger: Logger;
}

/**
 * Per-run resource wiring: maps the YAML catalogs onto the agentSession
 * TurnResourceResolver. Each model carries its own provider config from
 * models.yaml; MCP servers resolve to url + env-configured headers;
 * the sandbox factory (when configured) creates/reattaches the run's Sandbox.
 */
function createTurnResolver(deps: {
  modelStore: ModelStore;
  mcpStore: McpStore;
  sandboxFactory?: TurnSandboxFactory | undefined;
  logger: Logger;
  signal: AbortSignal;
}): TurnResourceResolver {
  const { modelStore, mcpStore, logger, signal } = deps;
  return new TurnResourceResolver({
    llm: name =>
      new VercelAILLM({
        providerConfig: modelStore.getProviderConfig(name),
        logger,
        signal,
      }),
    mcp: name => {
      const entry = mcpStore.get(name);
      if (!entry) {
        throw new Error(`MCP server not declared in mcp.yaml: ${name}`);
      }
      return Promise.resolve({ url: entry.url, headers: mcpStore.getHeaders(name) });
    },
    ...(deps.sandboxFactory ? { sandboxProvider: deps.sandboxFactory } : {}),
    logger,
  });
}

const MAX_SESSION_TITLE_LENGTH = 50;

/**
 * Derives a session title from the first user message of the first turn. Returns the
 * trimmed text (capped at {@link MAX_SESSION_TITLE_LENGTH}) or `undefined` when no usable
 * text is present (e.g. file-only or tool-approval input).
 */
function deriveSessionTitle(input: TurnInputItem[] | undefined): string | undefined {
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

/** SSE payload: `id` carries the per-stream sequence number; the body is not numbered. */
function turnEventSsePayload(event: TurnStreamingEvent, sequenceNumber: number): { id: string; data: string } {
  return {
    id: String(sequenceNumber),
    data: JSON.stringify(event),
  };
}

/**
 * turn.created arms the active-run TTL, turn.done shortens it to the
 * post-completion drain window; mid-run events leave the TTL untouched.
 */
function streamTTLSecondsFor(event: TurnStreamingEvent): number | undefined {
  if (event.type === EventType.TURN_CREATED) {
    return configuration.TURN_STREAM_TTL_SECONDS;
  }
  if (event.type === EventType.TURN_DONE) {
    return configuration.TURN_STREAM_POST_COMPLETION_TTL_SECONDS;
  }
  return undefined;
}

/** Redis/in-memory key for one turn's resumable event stream. */
function turnStreamId(tenantId: string, sessionId: string, turnId: string): string {
  return `agent:turn:${tenantId}:${sessionId}:${turnId}:stream`;
}

/**
 * Resume cursor: `Last-Event-ID` header wins over the body value because the
 * header is updated by the SDK on every reconnect to reflect the last delivered
 * event, whereas the body is the original caller-supplied cursor and never
 * changes between reconnect attempts.
 */
function resolveAfterSequenceNumber(c: Context, bodyAfterSequenceNumber?: number): number | undefined {
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

export function createTurnsRouter(deps: TurnsRouterDeps) {
  const listTurnsHandler: RouteHandler<typeof listTurnsRoute> = async c => {
    const { sessionId } = c.req.valid('param');
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
    const { sessionId, turnId } = c.req.valid('param');
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
    const { sessionId, turnId } = c.req.valid('param');
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
    const { sessionId } = c.req.valid('param');
    const body = c.req.valid('json');

    const session = await deps.sessions.get({ tenant_id: TENANT_ID, session_id: sessionId });
    if (!session) {
      return c.json({ error: { message: `Session not found: ${sessionId}` } }, 404);
    }

    const abortController = new AbortController();
    const resolver = createTurnResolver({
      modelStore: deps.modelStore,
      mcpStore: deps.mcpStore,
      sandboxFactory: deps.sandboxFactory,
      logger: deps.logger,
      signal: abortController.signal,
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
      // Unknown previous_turn_id (nothing was persisted).
      if (error instanceof SessionStoreNotFoundError) {
        return c.json({ error: { message: error.message } }, 404);
      }
      // Input/spec validation failures from the harness. MCP failures carry
      // their own status but the wire contract only declares 400 here.
      if (error instanceof AgentHarnessError && !(error instanceof McpConnectionError)) {
        return c.json({ error: { message: error.message } }, 400);
      }
      throw error;
    }

    // Long timer not tied to any await; without unref() it would keep the process alive.
    // Armed only after createTurn succeeds so a 4xx path never leaks a pending timer.
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
      // On client disconnect stop writing but keep draining, so the turn
      // completes and its events persist.
      stream.onAbort(() => {
        shouldWriteToSSEStream = false;
      });
      try {
        // Slow SSE writes backpressure turn.stream() (and thus agent execution /
        // persistence). Acceptable for now; reintroduce an eager buffer if clients
        // stall turns in practice.
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
        // Session delete can cascade mid-stream; store misses leave the DB clean but end SSE here.
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
    const { sessionId, turnId } = c.req.valid('param');
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
  router.openapi(listTurnsRoute, listTurnsHandler);
  router.openapi(getTurnRoute, getTurnHandler);
  router.openapi(listTurnEventsRoute, listTurnEventsHandler);
  router.openapi(createAndExecuteTurnRoute, createAndExecuteTurnHandler);
  router.openapi(subscribeTurnRoute, subscribeTurnHandler);
  return router;
}
