import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import type { Sessions, Turn, TurnRecord, TurnStreamingEvent } from '@truefoundry/utils/agent-session';
import {
  SessionStoreConflictError,
  SessionStoreNotFoundError,
  TurnResourceResolver,
  type TurnInputItem,
  type TurnSandboxFactory,
} from '@truefoundry/utils/agent-session';
import {
  AgentHarnessError,
  extractErrorLogFields,
  isAgentInputUserMessage,
  isFileContentPart,
  McpConnectionError,
  OpenAILLM,
} from '@truefoundry/utils/core';
import { streamSSE } from 'hono/streaming';
import { Readable } from 'stream';
import type { Logger } from 'winston';
import { createTurnRoute, getTurnRoute, listTurnEventsRoute, listTurnsRoute } from '../routes/turnRoutes';
import type { ActiveTurnRegistry } from '../runtime/activeTurns';
import type { McpStore } from '../store/McpStore';
import type { ModelStore } from '../store/ModelStore';
import { TENANT_NAME } from './sessions';

function toWireTurn(record: TurnRecord): Turn {
  return {
    id: record.turn_id,
    session_id: record.session_id,
    previous_turn_id: record.previous_turn_id ?? null,
    input: record.input,
    state: record.state,
    created_at: record.created_at,
  };
}

export interface TurnsRouterDeps {
  sessions: Sessions;
  activeTurns: ActiveTurnRegistry;
  modelStore: ModelStore;
  mcpStore: McpStore;
  /** Built at boot from SANDBOX_SETTINGS; undefined = sandbox unsupported. */
  sandboxFactory?: TurnSandboxFactory;
  logger: Logger;
}

/**
 * Per-run resource wiring: maps the YAML catalogs onto the agentSession
 * TurnResourceResolver. Models are served by one OpenAI-compatible API
 * (models.yaml base_url); MCP servers resolve to url + env-configured headers;
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
      new OpenAILLM({
        baseURL: modelStore.baseUrl,
        apiKey: modelStore.getApiKey(name),
        headers: modelStore.getHeaders(name),
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

/**
 * SSE payload for one turn event. The `id` field carries the per-stream
 * sequence number; the event body itself is not numbered (yield order is
 * persist order, so the transport boundary stamps).
 */
function turnEventSsePayload(event: TurnStreamingEvent, sequenceNumber: number): { id: string; data: string } {
  return {
    id: String(sequenceNumber),
    data: JSON.stringify(event),
  };
}

export function createTurnsRouter(deps: TurnsRouterDeps) {
  const listTurnsHandler: RouteHandler<typeof listTurnsRoute> = async c => {
    const { sessionId } = c.req.valid('param');
    const query = c.req.valid('query');
    const session = await deps.sessions.get({ tenant_name: TENANT_NAME, session_id: sessionId });
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
    const session = await deps.sessions.get({ tenant_name: TENANT_NAME, session_id: sessionId });
    if (!session) {
      return c.json({ error: { message: `Session not found: ${sessionId}` } }, 404);
    }
    const turn = await session.getTurn(turnId);
    if (!turn) {
      return c.json({ error: { message: `Turn not found: ${turnId}` } }, 404);
    }
    return c.json({ data: toWireTurn(turn.record) }, 200);
  };

  const listTurnEventsHandler: RouteHandler<typeof listTurnEventsRoute> = async c => {
    const { sessionId, turnId } = c.req.valid('param');
    const query = c.req.valid('query');
    const session = await deps.sessions.get({ tenant_name: TENANT_NAME, session_id: sessionId });
    if (!session) {
      return c.json({ error: { message: `Session not found: ${sessionId}` } }, 404);
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

  const createTurnHandler: RouteHandler<typeof createTurnRoute> = async c => {
    const { sessionId } = c.req.valid('param');
    const body = c.req.valid('json');

    const session = await deps.sessions.get({ tenant_name: TENANT_NAME, session_id: sessionId });
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
      turn = await session.run({
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

    deps.activeTurns.register({ sessionId, turnId: turn.id, abortController });

    // Buffer the run behind a Readable so a slow or disconnected client cannot
    // stall execution; the SSE loop below drains it independently.
    const generator = Readable.from(turn.stream(), { objectMode: true, highWaterMark: 128000 });

    let shouldWriteToSSEStream = true;
    let sequenceNumber = -1;
    return streamSSE(c, async stream => {
      // On client disconnect stop writing but keep draining, so the turn
      // completes and its events persist.
      stream.onAbort(() => {
        shouldWriteToSSEStream = false;
      });
      try {
        for await (const event of generator as AsyncIterable<TurnStreamingEvent>) {
          sequenceNumber += 1;
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
        deps.logger.error('Unexpected error in turn SSE stream loop', extractErrorLogFields(error));
      } finally {
        deps.activeTurns.finish({ sessionId, turnId: turn.id });
        await stream.close();
      }
    });
  };

  const router = new OpenAPIHono();
  router.openapi(listTurnsRoute, listTurnsHandler);
  router.openapi(getTurnRoute, getTurnHandler);
  router.openapi(listTurnEventsRoute, listTurnEventsHandler);
  router.openapi(createTurnRoute, createTurnHandler);
  // subscribeTurnRoute (routes/turnRoutes.ts) is defined but not registered:
  // re-subscribing to a running turn needs a live-stream registry that this
  // single-process server does not have yet.
  return router;
}
