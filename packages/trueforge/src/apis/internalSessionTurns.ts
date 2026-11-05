/**
 * Internal create-turn API (mounted at /api/internal/sessions/{session_id}/turns).
 * Authenticated with TRUEFORGE_API_KEY; runs as the session creator with a saved agent token
 * (same pattern as schedule execution — no live user JWT).
 */
import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import type { Sessions, TurnStreamingEvent } from '@truefoundry/trueforge-core/agent-session';
import type { Context } from 'hono';
import type { Logger } from 'winston';
import type {
  ResolveCapabilitiesStoreInput,
  ResolveMcpServerStoreInput,
  ResolveModelProviderStoreInput,
  ResolveTurnSkillsStoreInput,
} from '../app';
import { requestContextFromCreatedBySubject } from '../auth/identity';
import type { IAgentStore } from '../db/agentStore';
import type { IConfigurationStore } from '../db/configurationStore';
import type { IMcpServerWithAuthStore } from '../db/mcpServerStore';
import type { IMemoryProviderStore } from '../db/memoryProviderStore';
import type { IModelProviderStore } from '../db/modelProviderStore';
import type { ISandboxEnvironmentStore } from '../db/sandboxEnvironmentStore';
import type { ISandboxProviderStore } from '../db/sandboxProviderStore';
import type { ISkillStore } from '../db/skillStore';
import type { IWebSearchProviderStore } from '../db/webSearchProviderStore';
import { updateLogContext } from '../logger';
import type { MemoryProviderCache } from '../memory/providers';
import { createInternalSessionTurnRoute } from '../routes/turnRoutes';
import type { ActiveTurnRegistry } from '../runtime/activeTurns';
import type { EventSubscriptionRegistry } from '../runtime/event-subscription';
import type { ICapabilitiesStore } from '../truefoundry/inlineTools';
import { getTurnExecutionError, startTurnInProcess, toWireTurn } from './turns';

export interface InternalSessionTurnsDeps {
  sessions: Sessions;
  agentStore: IAgentStore;
  activeTurns: ActiveTurnRegistry;
  eventSubscriptions: EventSubscriptionRegistry<TurnStreamingEvent>;
  logger: Logger;
  resolveModelProviderStore: (input: ResolveModelProviderStoreInput) => IModelProviderStore;
  resolveMcpServerStore: (input: ResolveMcpServerStoreInput) => IMcpServerWithAuthStore;
  resolveSandboxProviderStore: (c: Context) => ISandboxProviderStore;
  sandboxEnvironmentStore: ISandboxEnvironmentStore;
  resolveWebSearchProviderStore: (c: Context) => IWebSearchProviderStore;
  resolveTurnSkillsStore: (input: ResolveTurnSkillsStoreInput) => Pick<ISkillStore, 'resolveTurnSkills'>;
  resolveCapabilitiesStore: (input: ResolveCapabilitiesStoreInput) => ICapabilitiesStore;
  resolveMemoryProviderStore: (c: Context) => IMemoryProviderStore;
  resolveConfigurationStore: (c: Context) => IConfigurationStore;
  memoryProviders: MemoryProviderCache;
}

/** Register internal create-turn on a shared `/api/internal/sessions` router. */
export function registerInternalSessionTurnRoutes(router: OpenAPIHono, deps: InternalSessionTurnsDeps): void {
  const handler: RouteHandler<typeof createInternalSessionTurnRoute> = async c => {
    const { session_id: sessionId } = c.req.valid('param');
    const body = c.req.valid('json');

    if (body.stream) {
      return c.json({ error: { message: 'Internal create-turn does not support stream: true' } }, 400);
    }

    // Same as schedule getRunById: session_id is the only trusted input.
    const session = await deps.sessions.getById({ session_id: sessionId });
    if (session === undefined) {
      return c.json({ error: { message: `Session not found: ${sessionId}` } }, 404);
    }

    const tenantId = session.record.tenant_id;

    // Saved-agent token exchange needs a named agent; inline sessions have no agent id to vend.
    if (session.record.agent.type !== 'reference') {
      return c.json(
        {
          error: {
            message: 'Internal create-turn requires a session bound to a named agent (not an inline agent spec)',
          },
        },
        422,
      );
    }

    const agent = await deps.agentStore.getAgent({
      tenant_id: tenantId,
      id: session.record.agent.id,
    });
    if (agent === undefined) {
      return c.json({ error: { message: `Agent not found: ${session.record.agent.id}` } }, 422);
    }

    c.set(
      'request_context',
      requestContextFromCreatedBySubject({
        tenant_id: tenantId,
        created_by_subject: session.record.created_by_subject,
      }),
    );
    updateLogContext({ tenant_id: tenantId, session_id: sessionId });

    try {
      const turn = await startTurnInProcess({
        session,
        input: body.input,
        previous_turn_id: body.previous_turn_id,
        userRef: session.record.created_by_subject.subject_id,
        deps: {
          activeTurns: deps.activeTurns,
          eventSubscriptions: deps.eventSubscriptions,
          agentStore: deps.agentStore,
          modelProviderStore: deps.resolveModelProviderStore({ c, runAsAgent: agent }),
          mcpServerStore: deps.resolveMcpServerStore({ c, runAsAgent: agent }),
          sandboxProviderStore: deps.resolveSandboxProviderStore(c),
          sandboxEnvironmentStore: deps.sandboxEnvironmentStore,
          webSearchProviderStore: deps.resolveWebSearchProviderStore(c),
          // Registry resolve uses the service API key (same as schedules); omit `c`.
          skillStore: deps.resolveTurnSkillsStore({}),
          capabilitiesStore: deps.resolveCapabilitiesStore({}),
          memory: {
            memoryProviderStore: deps.resolveMemoryProviderStore(c),
            configurationStore: deps.resolveConfigurationStore(c),
            providers: deps.memoryProviders,
          },
          logger: deps.logger,
        },
      });
      return c.json({ data: toWireTurn(turn.record) }, 200);
    } catch (error) {
      const mapped = getTurnExecutionError(error);
      if (mapped !== undefined) {
        return c.json({ error: { message: mapped.message } }, mapped.status);
      }
      throw error;
    }
  };

  router.openapi(createInternalSessionTurnRoute, handler);
}

/** Create a turn from a trusted service caller (codeforge webhooks, etc.). */
export function createInternalSessionTurnsRouter(deps: InternalSessionTurnsDeps): OpenAPIHono {
  const router = new OpenAPIHono();
  registerInternalSessionTurnRoutes(router, deps);
  return router;
}
