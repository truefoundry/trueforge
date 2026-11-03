import { sql } from 'kysely';

import { isTrueFoundryModeEnabled } from '../../../../src/config';
import { down, up } from '../../../../src/db/postgres/migrations/20261103_000001_sandbox_environment_truefoundry_type';
import { createPostgresTestDatabase, type PostgresTestDatabase } from '../testDatabase';

jest.mock('../../../../src/config', () => {
  const actual = jest.requireActual<typeof import('../../../../src/config')>('../../../../src/config');
  return { __esModule: true, ...actual, isTrueFoundryModeEnabled: jest.fn(() => false) };
});

const describePg = process.env['PG_STORE_TESTS_ENABLED'] === '1' ? describe : describe.skip;
const PREVIOUS_MIGRATION = '20261030_000001_configuration';

describePg('Postgres sandbox environment truefoundry type migration', () => {
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

  beforeEach(async () => {
    if (env === undefined) {
      throw new Error('Postgres test environment not initialized');
    }
    await sql`TRUNCATE TABLE sandbox_environment_version, sandbox_environment CASCADE`.execute(env.db);
    await sql`
      INSERT INTO sandbox_environment (
        id, tenant_id, name, description, active_version, lifecycle_stage, created_by_subject, created_at, updated_at
      )
      VALUES (
        'env-1', 'tenant-1', 'custom-env', '', 1, 'active',
        '{"subject_id":"u","subject_type":"user","subject_display_name":"U"}'::jsonb, now(), now()
      )
    `.execute(env.db);
    await sql`
      INSERT INTO sandbox_environment_version (
        id, environment_id, version, manifest, status, status_reason, external_ref, internal_metadata,
        created_by_subject, created_at, updated_at
      )
      VALUES
        ('v1', 'env-1', 1,
          '{"name":"custom-env","resources":{"cpu":1,"memory":1,"disk":3},"type":"daytona","sandbox_provider":"daytona"}'::jsonb,
          'ready', NULL, 'ref-1', '{"secrets":[]}'::jsonb,
          '{"subject_id":"u","subject_type":"user","subject_display_name":"U"}'::jsonb, now(), now()),
        ('v2', 'env-1', 2,
          '{"name":"custom-env","resources":{"cpu":2,"memory":1,"disk":3},"type":"truefoundry","sandbox_provider":"daytona"}'::jsonb,
          'pending', NULL, 'ref-2', '{"secrets":[]}'::jsonb,
          '{"subject_id":"u","subject_type":"user","subject_display_name":"U"}'::jsonb, now(), now())
    `.execute(env.db);
  });

  async function identities(): Promise<Record<string, { type: string; sandbox_provider: string }>> {
    if (env === undefined) {
      throw new Error('Postgres test environment not initialized');
    }
    const { rows } = await sql<{ id: string; type: string; sandbox_provider: string }>`
      SELECT id, manifest->>'type' AS type, manifest->>'sandbox_provider' AS sandbox_provider
      FROM sandbox_environment_version
      ORDER BY id
    `.execute(env.db);
    return Object.fromEntries(rows.map(row => [row.id, { type: row.type, sandbox_provider: row.sandbox_provider }]));
  }

  it('is a no-op outside TrueFoundry mode', async () => {
    if (env === undefined) {
      throw new Error('Postgres test environment not initialized');
    }
    jest.mocked(isTrueFoundryModeEnabled).mockReturnValue(false);
    const before = await identities();

    await env.db.transaction().execute(transaction => up(transaction));

    expect(await identities()).toEqual(before);
  });

  it('relabels type to truefoundry without touching sandbox_provider in TrueFoundry mode, and rolls back', async () => {
    if (env === undefined) {
      throw new Error('Postgres test environment not initialized');
    }
    jest.mocked(isTrueFoundryModeEnabled).mockReturnValue(true);

    await env.db.transaction().execute(transaction => up(transaction));
    expect(await identities()).toEqual({
      v1: { type: 'truefoundry', sandbox_provider: 'daytona' },
      v2: { type: 'truefoundry', sandbox_provider: 'daytona' },
    });

    // Re-running is safe.
    await env.db.transaction().execute(transaction => up(transaction));
    expect((await identities())['v1']).toEqual({ type: 'truefoundry', sandbox_provider: 'daytona' });

    await env.db.transaction().execute(transaction => down(transaction));
    expect(await identities()).toEqual({
      v1: { type: 'daytona', sandbox_provider: 'daytona' },
      v2: { type: 'daytona', sandbox_provider: 'daytona' },
    });
  });
});
