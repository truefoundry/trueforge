import { OpenAPIHono } from '@hono/zod-openapi';
import type { Sessions } from '@truefoundry/trueforge-core/agent-session';
import { AgentHarnessError } from '@truefoundry/trueforge-core/core';
import { createLogger } from 'winston';
import { createTurnsRouter } from '../../../src/apis/turns';
import { STANDALONE_REQUEST_CONTEXT } from '../../../src/auth/identity';
import { McpServerWithAuthStore } from '../../../src/db/McpServerWithAuthStore';
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

async function postTurnRejectingWith(error: AgentHarnessError): Promise<Response> {
  const db = createSqliteDb(':memory:');
  await migrateSqliteToLatest(db);
  const modelProviderStore = new SqliteModelProviderStore(db);
  const tokenStore = new SqliteOAuthTokenStore(db);
  await modelProviderStore.upsertProvider({
    tenant_id: 'default',
    name: 'test-provider',
    manifest: {
      type: 'custom',
      name: 'test-provider',
      base_url: 'https://llm.test.example.com/v1',
      auth: { api_key: 'sk-test' },
      models: [
        {
          model_id: 'test-model',
          name: 'test-model',
          properties: { context_length: 128000, max_output_tokens: 4096 },
        },
      ],
    },
  });

  const sessions = {
    get: () =>
      Promise.resolve({
        session_id: 's1',
        tenant_id: STANDALONE_REQUEST_CONTEXT.tenant_id,
        agent_spec: { model: { name: 'test-provider/test-model' } },
        record: {
          last_turn_id: null,
          created_by_subject: {
            subject_id: STANDALONE_REQUEST_CONTEXT.subject.id,
            subject_type: STANDALONE_REQUEST_CONTEXT.subject.type,
            subject_display_name: STANDALONE_REQUEST_CONTEXT.subject.display_name,
          },
        },
        createTurn: () => Promise.reject(error),
      }),
  } as unknown as Sessions;

  const app = new OpenAPIHono();
  app.onError((_error, c) => c.json({ error: { message: 'Internal server error' } }, 500));
  app.route(
    '/',
    createTurnsRouter({
      sessions,
      sessionStore: new SqliteSessionStore(db),
      activeTurns: new ActiveTurnRegistry(),
      resolveModelProviderStore: () => modelProviderStore,
      resolveMcpServerStore: () =>
        new McpServerWithAuthStore({
          store: new SqliteMcpServerStore(db),
          tokenStore,
          clientName: 'test-client',
        }),
      skillStore: new SqliteSkillStore(db),
      resolveAgentStore: () => new SqliteAgentStore(db),
      eventSubscriptions: new EventSubscriptionRegistry(undefined),
      sandboxProviderStore: new SqliteSandboxProviderStore(db),
      logger: createLogger({ silent: true }),
      resolveRequestContext: () => STANDALONE_REQUEST_CONTEXT,
    }),
  );

  return app.request('/s1/turns', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
}

describe('harness rejections on POST /{session_id}/turns', () => {
  it.each([
    ['agent_sandbox_required', 422],
    ['invalid_send_input', 422],
    ['tool_name_collision', 422],
    ['invalid_file_input', 400],
  ] as const)('maps %s to %i', async (code, status) => {
    const response = await postTurnRejectingWith(new AgentHarnessError(code, 'rejected'));
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: { message: 'rejected' } });
  });

  it('keeps capability state failures as internal errors', async () => {
    const response = await postTurnRejectingWith(new AgentHarnessError('capability_state_error', 'rejected'));
    expect(response.status).toBe(500);
  });
});
