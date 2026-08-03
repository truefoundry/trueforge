import { OpenAPIHono } from '@hono/zod-openapi';
import { InMemorySessionStore, Sessions } from '@truefoundry/utils/agent-session';
import { RequestReplyRouter } from '@truefoundry/utils/request-reply';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createClient } from 'redis';
import { createLogger } from 'winston';
import { ActiveTurnRegistry } from '../runtime/activeTurns';
import { McpStore } from '../store/McpStore';
import { ModelStore } from '../store/ModelStore';
import { createSessionsRouter, TENANT_ID } from './sessions';
import { createTurnsRouter } from './turns';

describe('public CRUD after session deletion', () => {
  it('returns not found for session and turn operations', async () => {
    const sessionStore = new InMemorySessionStore();
    const sessions = new Sessions({ sessionStore });
    const activeTurns = new ActiveTurnRegistry();
    const modelStore = new ModelStore('http://localhost', []);
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
        activeTurns,
        modelStore,
        mcpStore,
        logger: createLogger({ silent: true }),
      }),
    );

    await sessionStore.createSession({
      tenant_id: TENANT_ID,
      session_id: 'deleted',
      agent_spec: {
        model: { name: 'test-model' },
        instructions: 'test',
      },
      custom: null,
    });
    assert.equal((await app.request('/deleted', { method: 'DELETE' })).status, 204);

    const requests = [
      app.request('/deleted'),
      app.request('/deleted', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
      app.request('/deleted/events'),
      app.request('/deleted/cancel', { method: 'POST' }),
      app.request('/deleted/turns'),
      app.request('/deleted/turns/turn-1'),
      app.request('/deleted/turns/turn-1/events'),
      app.request('/deleted/turns', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
    ];

    for (const response of await Promise.all(requests)) {
      assert.equal(response.status, 404);
    }

    const listed = await app.request('/');
    assert.equal(listed.status, 200);
    assert.deepEqual((await listed.json()).data, []);
    assert.equal((await app.request('/deleted', { method: 'DELETE' })).status, 204);
  });
});
