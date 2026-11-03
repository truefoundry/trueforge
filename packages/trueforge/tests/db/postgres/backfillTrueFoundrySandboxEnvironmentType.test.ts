import { sql } from 'kysely';

import { isTrueFoundryModeEnabled } from '../../../src/config';
import { backfillTrueFoundrySandboxEnvironmentType, migrateToLatest } from '../../../src/db/migratePostgres';
import { createPostgresTestDatabase, type PostgresTestDatabase } from './testDatabase';

jest.mock('../../../src/config', () => {
  const actual = jest.requireActual<typeof import('../../../src/config')>('../../../src/config');
  return {
    __esModule: true,
    ...actual,
    isTrueFoundryModeEnabled: jest.fn(() => false),
  };
});

const describePg = process.env['PG_STORE_TESTS_ENABLED'] === '1' ? describe : describe.skip;
const SUBJECT = JSON.stringify({ subject_id: 'user-1', subject_type: 'user', subject_display_name: 'User' });

describePg('TrueFoundry sandbox environment type backfill', () => {
  let env: PostgresTestDatabase | undefined;

  function requireEnv(): PostgresTestDatabase {
    if (env === undefined) {
      throw new Error('Postgres test environment not initialized');
    }
    return env;
  }

  async function insertVersion({
    version,
    manifest,
  }: {
    version: number;
    manifest: Record<string, unknown>;
  }): Promise<void> {
    const { db } = requireEnv();
    await sql`
      INSERT INTO sandbox_environment_version (
        id, environment_id, version, manifest, status, status_reason, external_ref,
        internal_metadata, created_by_subject, created_at, updated_at
      )
      VALUES (
        ${`env-1-v${String(version)}`}, 'env-1', ${version}, ${JSON.stringify(manifest)}::jsonb, 'ready', NULL, 'ref-1',
        '{"secrets":[]}'::jsonb, ${SUBJECT}::jsonb, now(), now()
      )
    `.execute(db);
  }

  async function manifests(): Promise<Record<string, unknown>[]> {
    const { db } = requireEnv();
    const result = await sql<{ manifest: Record<string, unknown> }>`
      SELECT manifest FROM sandbox_environment_version ORDER BY version
    `.execute(db);
    return result.rows.map(row => row.manifest);
  }

  beforeAll(async () => {
    env = await createPostgresTestDatabase();
    if (env === undefined) {
      throw new Error('Postgres test environment unavailable despite globalSetup probe');
    }
  }, 120_000);

  beforeEach(async () => {
    const { db } = requireEnv();
    await sql`DELETE FROM sandbox_environment`.execute(db);
    await sql`
      INSERT INTO sandbox_environment (
        id, tenant_id, name, description, active_version, lifecycle_stage, created_by_subject, created_at, updated_at
      )
      VALUES ('env-1', 'tenant-1', 'pyjokes-env', '', 1, 'active', ${SUBJECT}::jsonb, now(), now())
    `.execute(db);
    await insertVersion({
      version: 1,
      manifest: {
        name: 'pyjokes-env',
        resources: { cpu: 1, memory: 1, disk: 3 },
        type: 'daytona',
        sandbox_provider: 'daytona',
      },
    });
    await insertVersion({
      version: 2,
      manifest: {
        name: 'pyjokes-env',
        resources: { cpu: 2, memory: 1, disk: 3 },
        type: 'truefoundry',
        sandbox_provider: 'daytona',
      },
    });
  });

  afterEach(() => {
    jest.mocked(isTrueFoundryModeEnabled).mockReturnValue(false);
  });

  afterAll(async () => {
    await env?.teardown();
  });

  it('relabels type to truefoundry without touching sandbox_provider, and is idempotent', async () => {
    const { db } = requireEnv();

    await expect(backfillTrueFoundrySandboxEnvironmentType(db)).resolves.toBe(1);
    await expect(manifests()).resolves.toEqual([
      {
        name: 'pyjokes-env',
        resources: { cpu: 1, memory: 1, disk: 3 },
        type: 'truefoundry',
        sandbox_provider: 'daytona',
      },
      {
        name: 'pyjokes-env',
        resources: { cpu: 2, memory: 1, disk: 3 },
        type: 'truefoundry',
        sandbox_provider: 'daytona',
      },
    ]);

    await expect(backfillTrueFoundrySandboxEnvironmentType(db)).resolves.toBe(0);
  });

  it('migrateToLatest only relabels in TrueFoundry mode', async () => {
    const { db } = requireEnv();

    await migrateToLatest(db);
    expect((await manifests()).map(manifest => manifest['type'])).toEqual(['daytona', 'truefoundry']);

    jest.mocked(isTrueFoundryModeEnabled).mockReturnValue(true);
    await migrateToLatest(db);
    expect((await manifests()).map(manifest => manifest['type'])).toEqual(['truefoundry', 'truefoundry']);
  });
});
