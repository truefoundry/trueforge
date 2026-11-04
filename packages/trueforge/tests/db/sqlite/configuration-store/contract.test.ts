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

  runConfigurationStoreContractSuite(() => new SqliteConfigurationStore(env.db));
});
