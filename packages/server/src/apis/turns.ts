/**
 * DB-backed turns API (mounted at /api/v1/sessions).
 * Shared wire/SSE helpers are also used by the legacy turns router.
 */
import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import type { Sessions, Turn, TurnStreamingEvent } from '@truefoundry/utils/agent-session';
import {
  CancellationReason,
  SessionStoreConflictError,
  SessionStoreNotFoundError,
  TurnResourceResolver,
  type TurnInputItem,
  type TurnRecordWithoutSnapshot,
} from '@truefoundry/utils/agent-session';
import {
  AgentHarnessError,
  extractErrorLogFields,
  isAgentInputUserMessage,
  isFileContentPart,
  McpConnectionError,
  VercelAILLM,
  type SandboxProvider,
  type VercelAIProviderConfig,
} from '@truefoundry/utils/core';
import { streamSSE } from 'hono/streaming';
import type { Logger } from 'winston';
import configuration from '../config';
import type { IMcpServerStore } from '../db/mcpServerStore';
import type { IModelProviderStore } from '../db/modelProviderStore';
import type { ISkillStore } from '../db/skillStore';
import { createAndExecuteTurnRoute, getTurnRoute, listTurnEventsRoute, listTurnsRoute } from '../routes/turnRoutes';
import type { ActiveTurnRegistry } from '../runtime/activeTurns';
import { getDbMcpConnection, getDbProviderConfig, resolveDbGitSkills } from '../runtime/dbSessionResources';
import { mintPeeredTurnId } from '../runtime/peeringIds';
import { buildTurnSandbox } from '../runtime/sandboxFactory';
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
  activeTurns: ActiveTurnRegistry;
  modelProviderStore: IModelProviderStore;
  mcpServerStore: IMcpServerStore;
  skillStore: ISkillStore;
  /** Shared provider from SANDBOX_SETTINGS; undefined = sandbox unsupported. */
  sandboxProvider?: SandboxProvider;
  logger: Logger;
}

/**
 * TurnResourceResolver requires a sync llm factory; preload the session model
 * config so the factory stays sync while the store read stays async.
 */
function createTurnResolver(deps: {
  mcpServerStore: IMcpServerStore;
  skillStore: ISkillStore;
  sandboxProvider?: SandboxProvider | undefined;
  logger: Logger;
  signal: AbortSignal;
  modelName: string;
  providerConfig: VercelAIProviderConfig;
}): TurnResourceResolver {
  const { mcpServerStore, skillStore, logger, signal, modelName, providerConfig } = deps;
  const sandboxProvider = deps.sandboxProvider;
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
    mcp: async name =>
      getDbMcpConnection({
        tenant_id: TENANT_ID,
        name,
        store: mcpServerStore,
      }),
    ...(sandboxProvider
      ? {
          sandboxProvider: async ({ spec, existingSandboxId, tracing }) => {
            const gitSkills = await resolveDbGitSkills({
              tenant_id: TENANT_ID,
              skills: spec.skills ?? [],
              store: skillStore,
            });
            return buildTurnSandbox({
              provider: sandboxProvider,
              logger,
              gitSkills,
              fileDownloadEnabled: spec.config?.sandbox?.file_downloads ?? false,
              existingSandboxId,
              tracing,
            });
          },
        }
      : {}),
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

/** DB-backed turns (mounted at /api/v1/sessions). */
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

  const listTurnEventsHandler: RouteHandler<typeof listTurnEventsRoute> = async c => {
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

  const createAndExecuteTurnHandler: RouteHandler<typeof createAndExecuteTurnRoute> = async c => {
    const { sessionId } = c.req.valid('param');
    const body = c.req.valid('json');

    const session = await deps.sessions.get({ tenant_id: TENANT_ID, session_id: sessionId });
    if (!session) {
      return c.json({ error: { message: `Session not found: ${sessionId}` } }, 404);
    }

    const abortController = new AbortController();
    const modelName = session.agent_spec.model.name;
    const providerConfig = await getDbProviderConfig({
      tenant_id: TENANT_ID,
      name: modelName,
      store: deps.modelProviderStore,
    });
    const resolver = createTurnResolver({
      mcpServerStore: deps.mcpServerStore,
      skillStore: deps.skillStore,
      sandboxProvider: deps.sandboxProvider,
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
  router.openapi(listTurnsRoute, listTurnsHandler);
  router.openapi(getTurnRoute, getTurnHandler);
  router.openapi(listTurnEventsRoute, listTurnEventsHandler);
  router.openapi(createAndExecuteTurnRoute, createAndExecuteTurnHandler);
  // subscribeTurnRoute (routes/turnRoutes.ts) is defined but not registered:
  // re-subscribing to a running turn needs a live-stream registry that this
  // single-process server does not have yet.
  return router;
}
