import { OpenAPIHono } from '@hono/zod-openapi';
import type { Sessions } from '@truefoundry/utils-core/agent-session';
import { TurnNotFoundError } from '@truefoundry/utils-core/agent-session';
import { createLogger } from 'winston';
import { createTurnsRouter } from '../../../src/apis/turns';
import { migrateSqliteToLatest } from '../../../src/db/migrateSqlite';
import { createSqliteDb } from '../../../src/db/sqlite/client';
import { SqliteMcpServerStore } from '../../../src/db/sqlite/mcp-server-store/SqliteMcpServerStore';
import { SqliteModelProviderStore } from '../../../src/db/sqlite/model-provider-store/SqliteModelProviderStore';
import { SqliteSessionStore } from '../../../src/db/sqlite/session-store/SqliteSessionStore';
import { SqliteSkillStore } from '../../../src/db/sqlite/skill-store/SqliteSkillStore';
import { SqliteOAuthTokenStore } from '../../../src/db/sqlite/token-store/SqliteOAuthTokenStore';
import { ActiveTurnRegistry } from '../../../src/runtime/activeTurns';
import { EventSubscriptionRegistry } from '../../../src/runtime/event-subscription/index.js';

describe('turn SSE after session deletion', () => {
  it('warns when the stream ends because the session/turn was removed', async () => {
    const warnings: unknown[] = [];
    const logger = createLogger({ silent: true });
    logger.warn = ((message: unknown) => {
      warnings.push(message);
      return logger;
    }) as typeof logger.warn;

    const db = createSqliteDb(':memory:');
    await migrateSqliteToLatest(db);
    const modelProviderStore = new SqliteModelProviderStore(db);
    await modelProviderStore.upsertProvider({
      tenant_id: 'default',
      name: 'test-provider',
      manifest: {
        type: 'openai',
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
          agent_spec: { model: { name: 'test-provider/test-model' } },
          record: { last_turn_id: null },
          createTurn: () =>
            Promise.resolve({
              id: 'turn-gone',
              stream: async function* stream() {
                throw new TurnNotFoundError('turn-gone');
              },
            }),
        }),
    } as unknown as Sessions;

    const app = new OpenAPIHono();
    app.route(
      '/',
      createTurnsRouter({
        sessions,
        sessionStore: new SqliteSessionStore(db),
        activeTurns: new ActiveTurnRegistry(),
        modelProviderStore,
        mcpServerStore: new SqliteMcpServerStore(db),
        tokenStore: new SqliteOAuthTokenStore(db),
        skillStore: new SqliteSkillStore(db),
        eventSubscriptions: new EventSubscriptionRegistry(undefined),
        logger,
      }),
    );

    const response = await app.request('/s1/turns', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(response.status).toBe(200);
    await response.text();

    expect(
      warnings.some(
        message => typeof message === 'string' && message.includes('Turn stream ended after session/turn was removed'),
      ),
    ).toBe(true);
  });
});
