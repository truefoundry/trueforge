/**
 * YAML-backed turns API (mounted at /api/v1/legacy/sessions).
 */
import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import type { Sessions } from '@truefoundry/utils/agent-session';
import {
  CancellationReason,
  SessionStoreConflictError,
  SessionStoreNotFoundError,
  TurnResourceResolver,
  type TurnSandboxFactory,
} from '@truefoundry/utils/agent-session';
import { AgentHarnessError, extractErrorLogFields, McpConnectionError, VercelAILLM } from '@truefoundry/utils/core';
import { streamSSE } from 'hono/streaming';
import type { Logger } from 'winston';
import configuration from '../config';
import type { McpStore } from '../legacy-registry-store/McpStore';
import type { ModelStore } from '../legacy-registry-store/ModelStore';
import {
  legacyCreateAndExecuteTurnRoute,
  legacyGetTurnRoute,
  legacyListTurnEventsRoute,
  legacyListTurnsRoute,
} from '../routes/legacyTurnRoutes';
import type { ActiveTurnRegistry } from '../runtime/activeTurns';
import { mintPeeredTurnId } from '../runtime/peeringIds';
import { TENANT_ID } from './sessions';
import { deriveSessionTitle, toWireTurn, turnEventSsePayload } from './turns';

export interface LegacyTurnsRouterDeps {
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
 * TurnResourceResolver.
 */
function createLegacyTurnResolver(deps: {
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

/** YAML-backed turns (mounted at /api/v1/legacy/sessions). */
export function createLegacyTurnsRouter(deps: LegacyTurnsRouterDeps) {
  const listTurnsHandler: RouteHandler<typeof legacyListTurnsRoute> = async c => {
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

  const getTurnHandler: RouteHandler<typeof legacyGetTurnRoute> = async c => {
    const { sessionId, turnId } = c.req.valid('param');
    const session = await deps.sessions.get({ tenant_id: TENANT_ID, session_id: sessionId });
    if (!session) {
      return c.json({ error: { message: `Session not found: ${sessionId}` } }, 404);
    }
    const turn = await session.getTurn(turnId);
    if (!turn) {
      return c.json({ error: { message: `Turn not found: ${turnId}` } }, 404);
    }
    return c.json({ data: toWireTurn(turn.record) }, 200);
  };

  const listTurnEventsHandler: RouteHandler<typeof legacyListTurnEventsRoute> = async c => {
    const { sessionId, turnId } = c.req.valid('param');
    const query = c.req.valid('query');
    const session = await deps.sessions.get({ tenant_id: TENANT_ID, session_id: sessionId });
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

  const createAndExecuteTurnHandler: RouteHandler<typeof legacyCreateAndExecuteTurnRoute> = async c => {
    const { sessionId } = c.req.valid('param');
    const body = c.req.valid('json');

    const session = await deps.sessions.get({ tenant_id: TENANT_ID, session_id: sessionId });
    if (!session) {
      return c.json({ error: { message: `Session not found: ${sessionId}` } }, 404);
    }

    const abortController = new AbortController();
    const resolver = createLegacyTurnResolver({
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
    let sequenceNumber = -1;
    return streamSSE(c, async stream => {
      stream.onAbort(() => {
        shouldWriteToSSEStream = false;
      });
      try {
        for await (const event of trackedStream) {
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

  const router = new OpenAPIHono();
  router.openapi(legacyListTurnsRoute, listTurnsHandler);
  router.openapi(legacyGetTurnRoute, getTurnHandler);
  router.openapi(legacyListTurnEventsRoute, listTurnEventsHandler);
  router.openapi(legacyCreateAndExecuteTurnRoute, createAndExecuteTurnHandler);
  return router;
}
