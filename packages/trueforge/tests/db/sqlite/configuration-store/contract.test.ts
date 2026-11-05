import { sql } from 'kysely';
import { SqliteConfigurationStore } from '../../../../src/db/sqlite/configuration-store/SqliteConfigurationStore';
import { runConfigurationStoreContractSuite } from '../../configurationStoreContractSuite';
import { createSqliteTestDatabase, type SqliteTestDatabase } from '../testDatabase';

describe('SqliteConfigurationStore (IConfigurationStore contract)', () => {
  let env: SqliteTestDatabase;

  beforeEach(async () => {
    env = await createSqliteTestDatabase();
  }, 120_000);

  afterEach(async () => {
    await env?.teardown();
  });

  runConfigurationStoreContractSuite(() => ({
    store: new SqliteConfigurationStore(env.db),
    insertRawManifest: async ({ tenant_id, manifest_json }) => {
      await sql`INSERT INTO configuration (tenant_id, manifest, updated_at)
        VALUES (${tenant_id}, jsonb(${manifest_json}), ${new Date().toISOString()})`.execute(env.db);
    },
    readRawManifest: async tenant_id => {
      // Aliased away from `manifest`, which the client parses on read.
      const result = await sql<{ raw: string }>`SELECT json(manifest) AS raw FROM configuration
        WHERE tenant_id = ${tenant_id}`.execute(env.db);
      return JSON.parse(result.rows[0]?.raw ?? 'null');
    },
  }));
});
