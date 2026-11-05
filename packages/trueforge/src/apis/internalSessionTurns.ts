/**
 * Internal create-turn API (mounted at /api/internal/sessions).
 * Authenticated with TRUEFORGE_API_KEY; runs as the session creator.
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
import type { AgentRecord, IAgentStore } from '../db/agentStore';
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
import { createInternalSessionTurnRoute } from '../routes/sessionRoutes';
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
  resolveTurnSkillsStore: (input: ResolveTurnSkillsStoreInput) => ISkillStore;
  resolveCapabilitiesStore: (input: ResolveCapabilitiesStoreInput) => ICapabilitiesStore;
  resolveMemoryProviderStore: (c: Context) => IMemoryProviderStore;
  resolveConfigurationStore: (c: Context) => IConfigurationStore;
  memoryProviders: MemoryProviderCache;
}

/** Create a turn from a trusted service caller (codeforge webhooks, etc.). */
export function createInternalSessionTurnsRouter(deps: InternalSessionTurnsDeps): OpenAPIHono {
  const router = new OpenAPIHono();

  const handler: RouteHandler<typeof createInternalSessionTurnRoute> = async c => {
    const { session_id: sessionId } = c.req.valid('param');
    const body = c.req.valid('json');

    const session = await deps.sessions.get({
      tenant_id: body.tenant_id,
      session_id: sessionId,
    });
    if (session === undefined) {
      return c.json({ error: { message: `Session not found: ${sessionId}` } }, 404);
    }

    c.set(
      'request_context',
      requestContextFromCreatedBySubject({
        tenant_id: body.tenant_id,
        created_by_subject: session.record.created_by_subject,
      }),
    );
    updateLogContext({ tenant_id: body.tenant_id, session_id: sessionId });

    let referencedAgent: AgentRecord | undefined;
    if (session.record.agent.type === 'reference') {
      const agent = await deps.agentStore.getAgent({
        tenant_id: body.tenant_id,
        id: session.record.agent.id,
      });
      if (agent === undefined) {
        return c.json({ error: { message: `Agent not found: ${session.record.agent.id}` } }, 422);
      }
      referencedAgent = agent;
    }

    const allowInlineResources = session.record.agent.type === 'inline';

    try {
      const turn = await startTurnInProcess({
        session,
        input: [{ type: 'user.message', content: body.message }],
        previous_turn_id: 'auto',
        userRef: session.record.created_by_subject.subject_id,
        deps: {
          activeTurns: deps.activeTurns,
          eventSubscriptions: deps.eventSubscriptions,
          agentStore: deps.agentStore,
          modelProviderStore: deps.resolveModelProviderStore({
            c,
            allowInlineResources,
            ...(referencedAgent !== undefined ? { runAsAgent: referencedAgent } : {}),
          }),
          mcpServerStore: deps.resolveMcpServerStore({
            c,
            allowInlineResources,
            ...(referencedAgent !== undefined ? { runAsAgent: referencedAgent } : {}),
          }),
          sandboxProviderStore: deps.resolveSandboxProviderStore(c),
          sandboxEnvironmentStore: deps.sandboxEnvironmentStore,
          webSearchProviderStore: deps.resolveWebSearchProviderStore(c),
          skillStore: deps.resolveTurnSkillsStore({ c, allowInlineResources }),
          capabilitiesStore: deps.resolveCapabilitiesStore({ c }),
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
  return router;
}
