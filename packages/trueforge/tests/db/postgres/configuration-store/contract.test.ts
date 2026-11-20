import { sql } from 'kysely';

import { PostgresConfigurationStore } from '../../../../src/db/postgres/configuration-store/PostgresConfigurationStore';
import { runConfigurationStoreContractSuite } from '../../configurationStoreContractSuite';
import { createPostgresTestDatabase, type PostgresTestDatabase } from '../testDatabase';

const describePg = process.env['PG_STORE_TESTS_ENABLED'] === '1' ? describe : describe.skip;

describePg('PostgresConfigurationStore (IConfigurationStore contract)', () => {
  let env: PostgresTestDatabase | undefined;

  beforeAll(async () => {
    env = await createPostgresTestDatabase();
    if (env === undefined) {
      throw new Error('Postgres test environment unavailable despite globalSetup probe');
    }
  }, 120_000);

  afterAll(async () => {
    await env?.teardown();
  });

  beforeEach(async () => {
    if (env !== undefined) {
      await sql`TRUNCATE TABLE configuration`.execute(env.db);
    }
  });

  runConfigurationStoreContractSuite(() => {
    if (env === undefined) {
      throw new Error('Postgres test environment not initialized');
    }
    const db = env.db;
    return {
      store: new PostgresConfigurationStore(db),
      insertRawManifest: async ({ tenant_id, manifest_json }) => {
        await sql`INSERT INTO configuration (tenant_id, manifest, updated_at)
          VALUES (${tenant_id}, ${manifest_json}::jsonb, now())`.execute(db);
      },
      readRawManifest: async tenant_id => {
        const result = await sql<{ raw: string }>`SELECT manifest::text AS raw FROM configuration
          WHERE tenant_id = ${tenant_id}`.execute(db);
        return JSON.parse(result.rows[0]?.raw ?? 'null');
      },
    };
  });
});
