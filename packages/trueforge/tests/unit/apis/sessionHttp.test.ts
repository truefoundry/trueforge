import { OpenAPIHono } from '@hono/zod-openapi';
import { AgentSpecSchema, Sessions } from '@truefoundry/trueforge-core/agent-session';
import { RequestReplyRouter } from '@truefoundry/trueforge-core/request-reply';
import { createClient } from 'redis';
import { createLogger } from 'winston';
import { createInternalMetricsRouter } from '../../../src/apis/sessionMetrics';
import {
  createInternalSessionsRouter,
  createSessionsRouter,
  type SessionsRouterDeps,
} from '../../../src/apis/sessions';
import { STANDALONE_REQUEST_CONTEXT } from '../../../src/auth/identity';
import { migrateSqliteToLatest } from '../../../src/db/migrateSqlite';
import { SqliteAgentStore } from '../../../src/db/sqlite/agent-store/SqliteAgentStore';
import { createSqliteDb } from '../../../src/db/sqlite/client';
import { SqliteMcpServerStore } from '../../../src/db/sqlite/mcp-server-store/SqliteMcpServerStore';
import { SqliteModelProviderStore } from '../../../src/db/sqlite/model-provider-store/SqliteModelProviderStore';
import { SqliteSandboxProviderStore } from '../../../src/db/sqlite/sandbox-provider-store/SqliteSandboxProviderStore';
import { SqliteSessionMetricsStore } from '../../../src/db/sqlite/session-metrics/SqliteSessionMetricsStore';
import { SqliteSessionStore } from '../../../src/db/sqlite/session-store/SqliteSessionStore';
import { SqliteSkillStore } from '../../../src/db/sqlite/skill-store/SqliteSkillStore';
import { ActiveTurnRegistry } from '../../../src/runtime/activeTurns';
import {
  GetSessionMetricsChartDataResponseSchema,
  GetSessionMetricsChartResponseSchema,
  GetSessionMetricsMeterResponseSchema,
} from '../../../src/schemas/sessionMetrics';

const inlineSpec = AgentSpecSchema.parse({
  model: { name: 'anthropic/claude-sonnet-4-6' },
  instructions: 'inline',
});

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

describe('sessions HTTP agent binding', () => {
  let app: OpenAPIHono;
  let agentStore: SqliteAgentStore;
  let sessionStore: SqliteSessionStore;

  beforeEach(async () => {
    const db = createSqliteDb(':memory:');
    await migrateSqliteToLatest(db);
    sessionStore = new SqliteSessionStore(db);
    const sessionMetricsStore = new SqliteSessionMetricsStore(db);
    const sessions = new Sessions({ sessionStore });
    const modelProviderStore = new SqliteModelProviderStore(db);
    const mcpServerStore = new SqliteMcpServerStore(db);
    const skillStore = new SqliteSkillStore(db);
    const sandboxProviderStore = new SqliteSandboxProviderStore(db);
    agentStore = new SqliteAgentStore(db);

    await modelProviderStore.upsertProvider({
      tenant_id: 'default',
      name: 'anthropic',
      manifest: {
        type: 'anthropic',
        base_url: 'https://api.anthropic.com/v1',
        auth: { api_key: 'sk-ant-secret' },
        models: [
          {
            model_id: 'claude-sonnet-4-6',
            name: 'claude-sonnet-4-6',
            properties: { context_length: 200000, max_output_tokens: 32768 },
          },
        ],
      },
    });

    app = new OpenAPIHono();
    const deps: SessionsRouterDeps = {
      sessions,
      sessionStore,
      activeTurns: new ActiveTurnRegistry(),
      resolveModelProviderStore: () => modelProviderStore,
      resolveMcpServerStore: () => mcpServerStore,
      skillStore,
      agentStore,
      sandboxProviderStore,
      redis: createClient(),
      requestReplyRouter: new RequestReplyRouter(),
      resolveRequestContext: () => STANDALONE_REQUEST_CONTEXT,
      logger: createLogger({ silent: true }),
    };
    app.route('/', createSessionsRouter(deps));
    app.route('/api/internal/sessions', createInternalSessionsRouter(deps));
    app.route(
      '/api/internal/metrics',
      createInternalMetricsRouter({
        sessionMetricsStore,
        resolveRequestContext: deps.resolveRequestContext,
      }),
    );
  });

  it('creates a session from an inline AgentSpec', async () => {
    const res = await app.request('/', jsonInit('POST', { agent: { spec: inlineSpec } }));
    expect(res.status).toBe(201);
    const json = (await res.json()) as {
      data: {
        id: string;
        created_by: string;
        agent: { type: 'inline'; spec: { instructions?: string } };
        metrics: unknown;
      };
    };
    expect(json.data.agent.type).toBe('inline');
    expect(json.data.agent.spec.instructions).toBe('inline');
    expect(json.data.created_by).toBe(STANDALONE_REQUEST_CONTEXT.subject.id);
    expect(json.data.metrics).toEqual({ total_cost_in_usd: 0, total_duration_ms: 0, total_turns: 0 });
  });

  it('returns 404 when creating a session for an unknown agent name', async () => {
    const missing = await app.request('/', jsonInit('POST', { agent: { name: 'does-not-exist' } }));
    expect(missing.status).toBe(404);
  });

  it('creates a named session and filters list by agent_id', async () => {
    const agent = await agentStore.createAgent({
      tenant_id: 'default',
      name: 'named-agent',
      manifest: AgentSpecSchema.parse({
        model: { name: 'anthropic/claude-sonnet-4-6' },
        instructions: 'from-registry',
      }),
      external_id: null,
    });

    const created = await app.request('/', jsonInit('POST', { agent: { name: agent.name } }));
    expect(created.status).toBe(201);
    const json = (await created.json()) as {
      data: { id: string; agent: { type: 'reference'; id: string; name: string | null } };
    };
    expect(json.data.agent).toEqual({ type: 'reference', id: agent.id, name: agent.name });

    const listed = await app.request(`/?agent_id=${encodeURIComponent(agent.id)}`);
    expect(listed.status).toBe(200);
    const listJson = (await listed.json()) as {
      data: Array<{ id: string; agent: { type: 'reference'; id: string; name: string | null } }>;
    };
    expect(listJson.data.every(row => row.agent.id === agent.id)).toBe(true);
    expect(listJson.data.some(row => row.id === json.data.id)).toBe(true);
  });

  it('returns caller-scoped metrics for a named agent', async () => {
    const agent = await agentStore.createAgent({
      tenant_id: 'default',
      name: 'metrics-agent',
      manifest: inlineSpec,
      external_id: null,
    });
    await sessionStore.createSession({
      tenant_id: 'default',
      session_id: 'my-metrics-session',
      created_by: STANDALONE_REQUEST_CONTEXT.subject.id,
      agent: { type: 'reference', id: agent.id, name: agent.name },
      custom: null,
      metadata: {},
      external_id: null,
    });
    await sessionStore.createSession({
      tenant_id: 'default',
      session_id: 'other-user-metrics-session',
      created_by: 'someone-else',
      agent: { type: 'reference', id: agent.id, name: agent.name },
      custom: null,
      metadata: {},
      external_id: null,
    });
    const start = new Date(Date.now() - 60 * 60 * 1000);
    const end = new Date(Date.now() + 60 * 60 * 1000);
    const query = new URLSearchParams({
      agent_id: agent.id,
      start_timestamp: start.toISOString(),
      end_timestamp: end.toISOString(),
    });

    const response = await app.request(`/api/internal/metrics/meters?${query.toString()}`);

    expect(response.status).toBe(200);
    const meters = GetSessionMetricsMeterResponseSchema.parse(await response.json());
    expect(meters.data.meters).toHaveLength(12);
    expect(meters.data.meters.find(meter => meter.name === 'total_sessions')?.aggregate_value).toBe(1);
    expect(meters.data.meters.find(meter => meter.name === 'total_turns')?.aggregate_value).toBe(0);
    expect(meters.data.meters.find(meter => meter.name === 'total_cost_in_usd')?.aggregate_value).toBe(0);
    expect(meters.data.meters.find(meter => meter.name === 'avg_turns_per_session')?.aggregate_value).toBe(0);
    expect(meters.data.meters.find(meter => meter.name === 'p95_session_duration_ms')?.aggregate_value).toBe(0);

    const sessionsChartResponse = await app.request(
      `/api/internal/metrics/charts-data?${query.toString()}&chart_name=sessions_over_time`,
    );
    expect(sessionsChartResponse.status).toBe(200);
    const sessionsChart = GetSessionMetricsChartDataResponseSchema.parse(await sessionsChartResponse.json());
    expect(sessionsChart.data.graphs[0]?.graph_lines[0]?.values.reduce((sum, point) => sum + point.value, 0)).toBe(1);
  });

  it('returns the static session metrics charts', async () => {
    const response = await app.request('/api/internal/metrics/charts');

    expect(response.status).toBe(200);
    const payload = GetSessionMetricsChartResponseSchema.parse(await response.json());
    expect(payload.data.charts).toHaveLength(3);
    expect(payload.data.charts.map(chart => chart.name)).toEqual([
      'sessions_over_time',
      'sessions_cost_over_time',
      'turns_over_time',
    ]);
  });

  it('rejects session metrics windows longer than 30 days', async () => {
    const query = new URLSearchParams({
      agent_id: 'agent-1',
      start_timestamp: '2026-01-01T00:00:00.000Z',
      end_timestamp: '2026-02-01T00:00:00.000Z',
    });

    const response = await app.request(`/api/internal/metrics/meters?${query.toString()}`);

    expect(response.status).toBe(400);
  });

  it("rejects access to another user's session on get/update/delete/cancel/events and scopes list", async () => {
    await sessionStore.createSession({
      tenant_id: 'default',
      session_id: 'other-user-session',
      created_by: 'someone-else',
      agent: { type: 'inline', spec: inlineSpec },
      custom: null,
      metadata: {},
      external_id: null,
    });

    const created = await app.request('/', jsonInit('POST', { agent: { spec: inlineSpec } }));
    expect(created.status).toBe(201);
    const json = (await created.json()) as { data: { id: string; created_by: string } };
    expect(json.data.created_by).toBe(STANDALONE_REQUEST_CONTEXT.subject.id);

    const listed = await app.request('/');
    expect(listed.status).toBe(200);
    const listedJson = (await listed.json()) as { data: Array<{ id: string; created_by: string }> };
    expect(listedJson.data.map(row => row.id)).toEqual([json.data.id]);
    expect(listedJson.data.every(row => row.created_by === STANDALONE_REQUEST_CONTEXT.subject.id)).toBe(true);

    const forbiddenBody = { error: { message: 'Only the session creator can access this session' } };

    const getForbidden = await app.request('/other-user-session');
    expect(getForbidden.status).toBe(403);
    expect(await getForbidden.json()).toEqual(forbiddenBody);

    const patchForbidden = await app.request('/other-user-session', jsonInit('PATCH', {}));
    expect(patchForbidden.status).toBe(403);
    expect(await patchForbidden.json()).toEqual(forbiddenBody);

    const deleteForbidden = await app.request('/other-user-session', { method: 'DELETE' });
    expect(deleteForbidden.status).toBe(403);
    expect(await deleteForbidden.json()).toEqual(forbiddenBody);

    const cancelForbidden = await app.request('/other-user-session/cancel', { method: 'POST' });
    expect(cancelForbidden.status).toBe(403);
    expect(await cancelForbidden.json()).toEqual(forbiddenBody);

    const eventsForbidden = await app.request('/other-user-session/events');
    expect(eventsForbidden.status).toBe(403);
    expect(await eventsForbidden.json()).toEqual(forbiddenBody);

    const allowed = await app.request(`/${json.data.id}`);
    expect(allowed.status).toBe(200);
  });

  it('rejects PATCH agent on a named session', async () => {
    const agent = await agentStore.createAgent({
      tenant_id: 'default',
      name: 'named-agent',
      manifest: AgentSpecSchema.parse({
        model: { name: 'anthropic/claude-sonnet-4-6' },
        instructions: 'from-registry',
      }),
      external_id: null,
    });

    const created = await app.request('/', jsonInit('POST', { agent: { name: agent.name } }));
    expect(created.status).toBe(201);
    const json = (await created.json()) as { data: { id: string } };

    const patchNamed = await app.request(
      `/${json.data.id}`,
      jsonInit('PATCH', { agent: { spec: { ...inlineSpec, instructions: 'nope' } } }),
    );
    expect(patchNamed.status).toBe(422);
  });

  it('allows PATCH agent.spec on inline sessions', async () => {
    const created = await app.request('/', jsonInit('POST', { agent: { spec: inlineSpec } }));
    expect(created.status).toBe(201);
    const { data } = (await created.json()) as { data: { id: string } };

    const patched = await app.request(
      `/${data.id}`,
      jsonInit('PATCH', { agent: { spec: { ...inlineSpec, instructions: 'updated' } } }),
    );
    expect(patched.status).toBe(200);
    const patchedJson = (await patched.json()) as {
      data: { agent: { type: 'inline'; spec: { instructions?: string } } };
    };
    expect(patchedJson.data.agent.spec.instructions).toBe('updated');
  });

  it('create and PATCH round-trip session metadata', async () => {
    const created = await app.request(
      '/',
      jsonInit('POST', { agent: { spec: inlineSpec }, metadata: { env: 'dev', ticket: 'T-1' } }),
    );
    expect(created.status).toBe(201);
    const createdJson = (await created.json()) as {
      data: { id: string; metadata: Record<string, string> };
    };
    expect(createdJson.data.metadata).toEqual({ env: 'dev', ticket: 'T-1' });

    const omitPatch = await app.request(`/${createdJson.data.id}`, jsonInit('PATCH', {}));
    expect(omitPatch.status).toBe(200);
    const omitJson = (await omitPatch.json()) as { data: { metadata: Record<string, string> } };
    expect(omitJson.data.metadata).toEqual({ env: 'dev', ticket: 'T-1' });

    const replace = await app.request(`/${createdJson.data.id}`, jsonInit('PATCH', { metadata: { env: 'prod' } }));
    expect(replace.status).toBe(200);
    const replaceJson = (await replace.json()) as { data: { metadata: Record<string, string> } };
    expect(replaceJson.data.metadata).toEqual({ env: 'prod' });

    const clear = await app.request(`/${createdJson.data.id}`, jsonInit('PATCH', { metadata: {} }));
    expect(clear.status).toBe(200);
    const clearJson = (await clear.json()) as { data: { metadata: Record<string, string> } };
    expect(clearJson.data.metadata).toEqual({});

    const omittedCreate = await app.request('/', jsonInit('POST', { agent: { spec: inlineSpec } }));
    expect(omittedCreate.status).toBe(201);
    const omittedJson = (await omittedCreate.json()) as { data: { metadata: Record<string, string> } };
    expect(omittedJson.data.metadata).toEqual({});
  });

  it('rejects invalid session metadata on create', async () => {
    const tooLongKey = await app.request(
      '/',
      jsonInit('POST', {
        agent: { spec: inlineSpec },
        metadata: { ['k'.repeat(33)]: 'v' },
      }),
    );
    expect(tooLongKey.status).toBe(400);

    const tooLongValue = await app.request(
      '/',
      jsonInit('POST', {
        agent: { spec: inlineSpec },
        metadata: { k: 'v'.repeat(129) },
      }),
    );
    expect(tooLongValue.status).toBe(400);
  });

  it('POST get-or-create-by-external-id is idempotent and 403s for another creator', async () => {
    const publicPath = await app.request(
      '/get-or-create-by-external-id',
      jsonInit('POST', { external_id: 'run-abc', agent: { spec: inlineSpec } }),
    );
    expect(publicPath.status).toBe(404);

    const created = await app.request(
      '/api/internal/sessions/get-or-create-by-external-id',
      jsonInit('POST', { external_id: 'run-abc', agent: { spec: inlineSpec } }),
    );
    expect(created.status).toBe(201);
    const createdJson = (await created.json()) as {
      data: { id: string; agent: { type: 'inline'; spec: { instructions?: string } } };
    };
    expect(createdJson.data.agent.spec.instructions).toBe('inline');

    const again = await app.request(
      '/api/internal/sessions/get-or-create-by-external-id',
      jsonInit('POST', {
        external_id: 'run-abc',
        agent: { spec: { ...inlineSpec, instructions: 'ignored-on-get' } },
      }),
    );
    expect(again.status).toBe(200);
    const againJson = (await again.json()) as {
      data: { id: string; agent: { type: 'inline'; spec: { instructions?: string } } };
    };
    expect(againJson.data.id).toBe(createdJson.data.id);
    expect(againJson.data.agent.spec.instructions).toBe('inline');

    await sessionStore.createSession({
      tenant_id: 'default',
      session_id: 'someone-elses-session',
      created_by: 'someone-else',
      agent: { type: 'inline', spec: inlineSpec },
      custom: null,
      metadata: {},
      external_id: 'run-theirs',
    });
    const forbidden = await app.request(
      '/api/internal/sessions/get-or-create-by-external-id',
      jsonInit('POST', { external_id: 'run-theirs', agent: { spec: inlineSpec } }),
    );
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({
      error: { message: 'Only the session creator can access this session' },
    });
  });

  it('rejects create bodies that mix name and AgentSpec fields', async () => {
    const both = await app.request('/', jsonInit('POST', { agent: { name: 'named-agent', ...inlineSpec } }));
    expect(both.status).toBe(400);
  });
});
