import { OpenAPIHono } from '@hono/zod-openapi';
import { InMemorySessionStore, Sessions } from '@truefoundry/utils-core/agent-session';
import { RequestReplyRouter } from '@truefoundry/utils-core/request-reply';
import { createClient } from 'redis';
import { createLogger } from 'winston';
import { createSessionsRouter, TENANT_ID } from '../../../src/apis/sessions';
import { createTurnsRouter } from '../../../src/apis/turns';
import { McpStore } from '../../../src/legacy-registry-store/McpStore';
import { ModelStore } from '../../../src/legacy-registry-store/ModelStore';
import { ActiveTurnRegistry } from '../../../src/runtime/activeTurns';
import { EventSubscriptionRegistry } from '../../../src/runtime/event-subscription/index.js';
import { ListSessionsResponseSchema } from '../../../src/schemas/session';

describe('public CRUD after session deletion', () => {
  it('returns not found for session and turn operations', async () => {
    const sessionStore = new InMemorySessionStore();
    const sessions = new Sessions({ sessionStore });
    const activeTurns = new ActiveTurnRegistry();
    const modelStore = new ModelStore([]);
    const mcpStore = new McpStore([]);
    const app = new OpenAPIHono();

    app.route(
      '/',
      createSessionsRouter({
        sessions,
        sessionStore,
        activeTurns,
        modelStore,
        mcpStore,
        sandboxSupported: false,
        redis: createClient(),
        requestReplyRouter: new RequestReplyRouter(),
      }),
    );
    app.route(
      '/',
      createTurnsRouter({
        sessions,
        sessionStore,
        activeTurns,
        modelStore,
        mcpStore,
        eventSubscriptions: new EventSubscriptionRegistry(undefined),
        logger: createLogger({ silent: true }),
      }),
    );

    await sessionStore.createSession({
      tenant_id: TENANT_ID,
      session_id: 's1',
      agent_spec: {
        model: { name: 'test-model' },
        instructions: 'test',
      },
      custom: null,
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
