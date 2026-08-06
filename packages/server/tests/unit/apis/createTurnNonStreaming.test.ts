import { OpenAPIHono } from '@hono/zod-openapi';
import type { Sessions, TurnStreamingEvent } from '@truefoundry/utils-core/agent-session';
import { AgentSpecSchema } from '@truefoundry/utils-core/agent-session';
import { createLogger } from 'winston';
import { TENANT_ID } from '../../../src/apis/sessions';
import { createTurnsRouter, turnStreamId } from '../../../src/apis/turns';
import { migrateSqliteToLatest } from '../../../src/db/migrateSqlite';
import { createSqliteDb } from '../../../src/db/sqlite/client';
import { SqliteMcpServerStore } from '../../../src/db/sqlite/mcp-server-store/SqliteMcpServerStore';
import { SqliteModelProviderStore } from '../../../src/db/sqlite/model-provider-store/SqliteModelProviderStore';
import { SqliteSandboxProviderStore } from '../../../src/db/sqlite/sandbox-provider-store/SqliteSandboxProviderStore';
import { SqliteSessionStore } from '../../../src/db/sqlite/session-store/SqliteSessionStore';
import { SqliteSkillStore } from '../../../src/db/sqlite/skill-store/SqliteSkillStore';
import { SqliteOAuthTokenStore } from '../../../src/db/sqlite/token-store/SqliteOAuthTokenStore';
import { ActiveTurnRegistry } from '../../../src/runtime/activeTurns';
import { EventSubscriptionRegistry } from '../../../src/runtime/event-subscription/index.js';

describe('create turn non-streaming', () => {
  it('returns the running turn JSON after dual-writing turn.created so subscribe can attach', async () => {
    const logger = createLogger({ silent: true });
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

    let releaseRest: (() => void) | undefined;
    const restParked = new Promise<void>(resolve => {
      releaseRest = resolve;
    });

    const sessions = {
      get: () =>
        Promise.resolve({
          agent_spec: AgentSpecSchema.parse({ model: { name: 'test-provider/test-model' } }),
          record: { last_turn_id: null },
          createTurn: () =>
            Promise.resolve({
              id: 'turn-non-stream',
              record: {
                turn_id: 'turn-non-stream',
                session_id: 's1',
                previous_turn_id: null,
                input: [],
                state: { status: 'running' },
                created_at: new Date('2026-01-01T00:00:00.000Z'),
              },
              stream: async function* stream() {
                yield {
                  type: 'turn.created',
                  id: 'evt_created',
                  turn_id: 'turn-non-stream',
                  previous_turn_id: null,
                  state: { status: 'running' },
                  created_at: '2026-01-01T00:00:00.000Z',
                  thread_id: null,
                };
                await restParked;
              },
            }),
        }),
    } as unknown as Sessions;

    const eventSubscriptions = new EventSubscriptionRegistry<TurnStreamingEvent>(undefined);
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
        eventSubscriptions,
        sandboxProviderStore: new SqliteSandboxProviderStore(db),
        logger,
      }),
    );

    const response = await app.request('/s1/turns', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stream: false }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type') ?? '').toContain('application/json');
    const body: unknown = await response.json();
    expect(body).toEqual({
      data: {
        id: 'turn-non-stream',
        session_id: 's1',
        previous_turn_id: null,
        input: [],
        state: { status: 'running' },
        created_at: '2026-01-01T00:00:00.000Z',
      },
    });

    // Resumable stream must exist before the JSON response returns.
    await expect(
      eventSubscriptions.get(turnStreamId(TENANT_ID, 's1', 'turn-non-stream')).assertSubscribable(),
    ).resolves.toBeUndefined();

    releaseRest?.();
  });
});
