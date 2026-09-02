import { OpenAPIHono } from '@hono/zod-openapi';
import {
  AgentSpecSchema,
  Sessions,
  TurnNotFoundError,
  type TurnStreamingEvent,
} from '@truefoundry/trueforge-core/agent-session';
import { createLogger } from 'winston';
import { TENANT_ID } from '../../../src/apis/sessions';
import { createTurnsRouter, turnStreamId } from '../../../src/apis/turns';
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

describe('turns', () => {
  describe('turn ownership', () => {
    it('returns 403 for all turn routes when the caller is not the session creator', async () => {
      const db = createSqliteDb(':memory:');
      await migrateSqliteToLatest(db);
      const sessionStore = new SqliteSessionStore(db);
      const sessions = new Sessions({ sessionStore });

      await sessionStore.createSession({
        tenant_id: TENANT_ID,
        session_id: 's1',
        created_by: 'someone-else',
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

      const app = new OpenAPIHono();
      app.route(
        '/',
        createTurnsRouter({
          sessions,
          sessionStore,
          activeTurns: new ActiveTurnRegistry(),
          resolveModelProviderStore: () => new SqliteModelProviderStore(db),
          mcpServerStore: new SqliteMcpServerStore(db),
          tokenStore: new SqliteOAuthTokenStore(db),
          skillStore: new SqliteSkillStore(db),
          agentStore: new SqliteAgentStore(db),
          eventSubscriptions: new EventSubscriptionRegistry(undefined),
          sandboxProviderStore: new SqliteSandboxProviderStore(db),
          logger: createLogger({ silent: true }),
          resolveUserContext: () => LOCAL_USER_CONTEXT,
        }),
      );

      const forbiddenAccess = { error: { message: 'Only the session creator can access this session' } };

      const createResponse = await app.request('/s1/turns', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ stream: false }),
      });
      expect(createResponse.status).toBe(403);
      expect(await createResponse.json()).toEqual({
        error: { message: 'Only the session creator can create turns' },
      });

      const listResponse = await app.request('/s1/turns');
      expect(listResponse.status).toBe(403);
      expect(await listResponse.json()).toEqual(forbiddenAccess);

      const getResponse = await app.request('/s1/turns/any-turn');
      expect(getResponse.status).toBe(403);
      expect(await getResponse.json()).toEqual(forbiddenAccess);

      const eventsResponse = await app.request('/s1/turns/any-turn/events');
      expect(eventsResponse.status).toBe(403);
      expect(await eventsResponse.json()).toEqual(forbiddenAccess);

      const subscribeResponse = await app.request('/s1/turns/any-turn/subscribe');
      expect(subscribeResponse.status).toBe(403);
      expect(await subscribeResponse.json()).toEqual(forbiddenAccess);

      const downloadResponse = await app.request(
        `/s1/turns/any-turn/download-sandbox-file?path=${encodeURIComponent('/workspace/report.pdf')}`,
      );
      expect(downloadResponse.status).toBe(403);
      expect(await downloadResponse.json()).toEqual(forbiddenAccess);
    });
  });

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
          // Caller-named, so `custom` is the only type it can be.
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

      let releaseRest: (() => void) | undefined;
      const restParked = new Promise<void>(resolve => {
        releaseRest = resolve;
      });

      const sessions = {
        get: () =>
          Promise.resolve({
            session_id: 's1',
            spec: AgentSpecSchema.parse({ model: { name: 'test-provider/test-model' } }),
            record: { last_turn_id: null, created_by: LOCAL_USER_CONTEXT.userRef },
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
          resolveModelProviderStore: () => modelProviderStore,
          agentStore: new SqliteAgentStore(db),
          mcpServerStore: new SqliteMcpServerStore(db),
          tokenStore: new SqliteOAuthTokenStore(db),
          skillStore: new SqliteSkillStore(db),
          eventSubscriptions,
          sandboxProviderStore: new SqliteSandboxProviderStore(db),
          logger,
          resolveUserContext: () => LOCAL_USER_CONTEXT,
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
          // Caller-named, so `custom` is the only type it can be.
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

      const agentSpec = AgentSpecSchema.parse({ model: { name: 'test-provider/test-model' } });
      const sessions = {
        get: () =>
          Promise.resolve({
            spec: agentSpec,
            record: {
              session_id: 's1',
              last_turn_id: null,
              created_by: LOCAL_USER_CONTEXT.userRef,
              agent: { type: 'inline', spec: agentSpec },
            },
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
          resolveModelProviderStore: () => modelProviderStore,
          mcpServerStore: new SqliteMcpServerStore(db),
          tokenStore: new SqliteOAuthTokenStore(db),
          skillStore: new SqliteSkillStore(db),
          agentStore: new SqliteAgentStore(db),
          eventSubscriptions: new EventSubscriptionRegistry(undefined),
          sandboxProviderStore: new SqliteSandboxProviderStore(db),
          logger,
          resolveUserContext: () => LOCAL_USER_CONTEXT,
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
          message =>
            typeof message === 'string' && message.includes('Turn stream ended after session/turn was removed'),
        ),
      ).toBe(true);
    });
  });
});
