import { sql } from 'kysely';

import { down, up } from '../../../../src/db/postgres/migrations/20260821_000001_agent_compaction';
import { createPostgresTestDatabase, type PostgresTestDatabase } from '../testDatabase';

const describePg = process.env['PG_STORE_TESTS_ENABLED'] === '1' ? describe : describe.skip;
const LARGE_THRESHOLD = 3_000_000_000;
const PREVIOUS_MIGRATION = '20260818_000001_mcp_pending_auth_return_to';

describePg('Postgres agent compaction migration', () => {
  let env: PostgresTestDatabase | undefined;

  beforeAll(async () => {
    env = await createPostgresTestDatabase(PREVIOUS_MIGRATION);
    if (env === undefined) {
      throw new Error('Postgres test environment unavailable despite globalSetup probe');
    }
  }, 120_000);

  afterAll(async () => {
    await env?.teardown();
  });

  it('preserves large thresholds for named and inline Agent Specs during upgrade and rollback', async () => {
    if (env === undefined) {
      throw new Error('Postgres test environment not initialized');
    }

    const legacySpecObject = {
      model: { name: 'provider/model' },
      config: {
        context_management: {
          compaction: { enabled: false, compaction_threshold_tokens: LARGE_THRESHOLD },
        },
      },
    };
    const legacySpec = JSON.stringify(legacySpecObject);

    await sql`
      INSERT INTO agent (id, tenant_id, name, manifest, created_at, updated_at)
      VALUES ('legacy-agent', 'tenant-1', 'legacy-agent', ${legacySpec}::jsonb, now(), now())
    `.execute(env.db);
    await sql`
      INSERT INTO session (
        tenant_id,
        session_id,
        created_by,
        agent_id,
        agent_name,
        agent_spec,
        title,
        last_turn_id,
        custom,
        last_activity_timestamp_ms,
        created_at,
        updated_at
      )
      VALUES (
        'tenant-1',
        'legacy-session',
        'user-1',
        NULL,
        NULL,
        ${legacySpec}::jsonb,
        NULL,
        NULL,
        NULL,
        0,
        now(),
        now()
      )
    `.execute(env.db);

    await env.db.transaction().execute(async transaction => {
      await up(transaction);
    });

    const migratedAgent = await sql<{ manifest: unknown }>`
      SELECT manifest FROM agent WHERE id = 'legacy-agent'
    `.execute(env.db);
    const migratedSession = await sql<{ agent_spec: unknown }>`
      SELECT agent_spec FROM session WHERE session_id = 'legacy-session'
    `.execute(env.db);
    const expectedMigratedSpec = {
      model: { name: 'provider/model' },
      config: {
        context_management: {
          compaction: {
            enabled: false,
            trigger: { type: 'input_tokens', value: LARGE_THRESHOLD },
          },
        },
      },
    };
    expect(migratedAgent.rows[0]?.manifest).toEqual(expectedMigratedSpec);
    expect(migratedSession.rows[0]?.agent_spec).toEqual(expectedMigratedSpec);

    await env.db.transaction().execute(async transaction => {
      await down(transaction);
    });

    const rolledBackAgent = await sql<{ manifest: unknown }>`
      SELECT manifest FROM agent WHERE id = 'legacy-agent'
    `.execute(env.db);
    const rolledBackSession = await sql<{ agent_spec: unknown }>`
      SELECT agent_spec FROM session WHERE session_id = 'legacy-session'
    `.execute(env.db);
    expect(rolledBackAgent.rows[0]?.manifest).toEqual(legacySpecObject);
    expect(rolledBackSession.rows[0]?.agent_spec).toEqual(legacySpecObject);
  });
});
