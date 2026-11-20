import { sql } from 'kysely';

import { isTrueFoundryModeEnabled } from '../../../../src/config';
import { down, up } from '../../../../src/db/postgres/migrations/20261103_000001_sandbox_environment_type_truefoundry';
import { createPostgresTestDatabase, type PostgresTestDatabase } from '../testDatabase';

jest.mock('../../../../src/config', () => {
  const actual = jest.requireActual<typeof import('../../../../src/config')>('../../../../src/config');
  return {
    __esModule: true,
    ...actual,
    isTrueFoundryModeEnabled: jest.fn(() => false),
  };
});

const describePg = process.env['PG_STORE_TESTS_ENABLED'] === '1' ? describe : describe.skip;
const PREVIOUS_MIGRATION = '20261030_000001_configuration';
const SUBJECT = JSON.stringify({ subject_id: 'u', subject_type: 'user', subject_display_name: 'U' });

describePg('Postgres sandbox environment type truefoundry migration', () => {
  let env: PostgresTestDatabase | undefined;

  beforeEach(async () => {
    env = await createPostgresTestDatabase(PREVIOUS_MIGRATION);
    if (env === undefined) {
      throw new Error('Postgres test environment unavailable despite globalSetup probe');
    }
    await sql`
      INSERT INTO sandbox_environment (
        id, tenant_id, name, description, active_version, lifecycle_stage, created_by_subject, created_at, updated_at
      ) VALUES ('env-1', 'tenant-1', 'custom-env', '', 1, 'active', ${SUBJECT}::jsonb, now(), now())
    `.execute(env.db);
    for (const version of [1, 2]) {
      const manifest = JSON.stringify({
        name: 'custom-env',
        resources: { cpu: 1, memory: 1, disk: 3 },
        type: 'daytona',
        sandbox_provider: 'daytona',
      });
      await sql`
        INSERT INTO sandbox_environment_version (
          id, environment_id, version, manifest, status, status_reason, external_ref,
          internal_metadata, created_by_subject, created_at, updated_at
        ) VALUES (
          ${`env-1-v${String(version)}`}, 'env-1', ${version}, ${manifest}::jsonb, 'ready', NULL, 'ref',
          '{"secrets":[]}'::jsonb, ${SUBJECT}::jsonb, now(), now()
        )
      `.execute(env.db);
    }
  }, 120_000);

  afterEach(async () => {
    jest.mocked(isTrueFoundryModeEnabled).mockReturnValue(false);
    await env?.teardown();
  });

  async function readIdentities(): Promise<{ type: string; sandbox_provider: string }[]> {
    if (env === undefined) {
      throw new Error('Postgres test environment not initialized');
    }
    const result = await sql<{ type: string; sandbox_provider: string }>`
      SELECT manifest->>'type' AS type, manifest->>'sandbox_provider' AS sandbox_provider
      FROM sandbox_environment_version
      ORDER BY version
    `.execute(env.db);
    return result.rows;
  }

  async function migrate(direction: 'up' | 'down'): Promise<void> {
    if (env === undefined) {
      throw new Error('Postgres test environment not initialized');
    }
    await env.db.transaction().execute(async transaction => {
      if (direction === 'up') {
        await up(transaction);
      } else {
        await down(transaction);
      }
    });
  }

  it('leaves rows untouched outside TrueFoundry mode', async () => {
    await migrate('up');
    expect(await readIdentities()).toEqual([
      { type: 'daytona', sandbox_provider: 'daytona' },
      { type: 'daytona', sandbox_provider: 'daytona' },
    ]);
  });

  it('sets type truefoundry on every version in TrueFoundry mode, keeps sandbox_provider, and is idempotent', async () => {
    jest.mocked(isTrueFoundryModeEnabled).mockReturnValue(true);
    await migrate('up');
    await migrate('up');
    expect(await readIdentities()).toEqual([
      { type: 'truefoundry', sandbox_provider: 'daytona' },
      { type: 'truefoundry', sandbox_provider: 'daytona' },
    ]);

    await migrate('down');
    expect(await readIdentities()).toEqual([
      { type: 'daytona', sandbox_provider: 'daytona' },
      { type: 'daytona', sandbox_provider: 'daytona' },
    ]);
  });
});
