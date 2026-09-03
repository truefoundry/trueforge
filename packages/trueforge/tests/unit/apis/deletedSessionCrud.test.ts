import { OpenAPIHono } from '@hono/zod-openapi';
import { AgentSpecSchema, Sessions } from '@truefoundry/trueforge-core/agent-session';
import { RequestReplyRouter } from '@truefoundry/trueforge-core/request-reply';
import { createClient } from 'redis';
import { createLogger } from 'winston';
import { createSessionsRouter, TENANT_ID } from '../../../src/apis/sessions';
import { createTurnsRouter } from '../../../src/apis/turns';
import { LOCAL_USER_CONTEXT } from '../../../src/auth/identity';
import { migrateSqliteToLatest } from '../../../src/db/migrateSqlite';
import { SqliteAgentStore } from '../../../src/db/sqlite/agent-store/SqliteAgentStore';
import { createSqliteDb } from '../../../src/db/sqlite/client';
import { SqliteMcpServerStore } from '../../../src/db/sqlite/mcp-server-store/SqliteMcpServerStore';
import { SqliteModelProviderStore } from '../../../src/db/sqlite/model-provider-store/SqliteModelProviderStore';
import { SqliteSandboxProviderStore } from '../../../src/db/sqlite/sandbox-provider-store/SqliteSandboxProviderStore';
import { SqliteSessionStore } from '../../../src/db/sqlite/session-store/SqliteSessionStore';
import { SqliteSkillStore } from '../../../src/db/sqlite/skill-store/SqliteSkillStore';
import { SqliteOAuthTokenStore } from '../../../src/db/sqlite/token-store/SqliteOAuthTokenStore';
import { ActiveTurnRegistry } from '../../../src/runtime/activeTurns';
import { EventSubscriptionRegistry } from '../../../src/runtime/event-subscription/index.js';
import { ListSessionsResponseSchema } from '../../../src/schemas/session';

describe('public CRUD after session deletion', () => {
  it('returns not found for session and turn operations', async () => {
    const db = createSqliteDb(':memory:');
    await migrateSqliteToLatest(db);
    const sessionStore = new SqliteSessionStore(db);
    const sessions = new Sessions({ sessionStore });
    const activeTurns = new ActiveTurnRegistry();
    const modelProviderStore = new SqliteModelProviderStore(db);
    const mcpServerStore = new SqliteMcpServerStore(db);
    const tokenStore = new SqliteOAuthTokenStore(db);
    const skillStore = new SqliteSkillStore(db);
    const agentStore = new SqliteAgentStore(db);
    const sandboxProviderStore = new SqliteSandboxProviderStore(db);
    const app = new OpenAPIHono();

    app.route(
      '/',
      createSessionsRouter({
        sessions,
        sessionStore,
        activeTurns,
        resolveModelProviderStore: () => modelProviderStore,
        resolveMcpServerStore: () => mcpServerStore,
        skillStore,
        agentStore,
        sandboxProviderStore,
        redis: createClient(),
        requestReplyRouter: new RequestReplyRouter(),
        resolveUserContext: () => LOCAL_USER_CONTEXT,
        logger: createLogger({ silent: true }),
      }),
    );
    app.route(
      '/',
      createTurnsRouter({
        sessions,
        sessionStore,
        activeTurns,
        resolveModelProviderStore: () => modelProviderStore,
        resolveMcpServerStore: () => mcpServerStore,
        tokenStore,
        skillStore,
        agentStore,
        eventSubscriptions: new EventSubscriptionRegistry(undefined),
        sandboxProviderStore,
        logger: createLogger({ silent: true }),
        resolveUserContext: () => LOCAL_USER_CONTEXT,
      }),
    );

    await sessionStore.createSession({
      tenant_id: TENANT_ID,
      session_id: 's1',
      created_by: LOCAL_USER_CONTEXT.userRef,
      agent: {
        type: 'inline',
        spec: AgentSpecSchema.parse({
          model: { name: 'test-provider/test-model' },
          instructions: 'test',
        }),
      },
      custom: null,
      metadata: {},
      external_id: null,
    });
    expect((await app.request('/s1', { method: 'DELETE' })).status).toBe(204);

    const requests = [
      app.request('/s1'),
      app.request('/s1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
      app.request('/s1/events'),
      app.request('/s1/cancel', { method: 'POST' }),
      app.request('/s1/turns'),
      app.request('/s1/turns/turn-1'),
      app.request('/s1/turns/turn-1/events'),
      app.request('/s1/turns', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
    ];

    for (const response of await Promise.all(requests)) {
      expect(response.status).toBe(404);
    }

    const listed = await app.request('/');
    expect(listed.status).toBe(200);
    expect(ListSessionsResponseSchema.parse(await listed.json()).data).toEqual([]);
    expect((await app.request('/s1', { method: 'DELETE' })).status).toBe(204);
  });
});
