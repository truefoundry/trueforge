import { SqliteModelProviderStore } from '../../../../src/db/sqlite/model-provider-store/SqliteModelProviderStore';
import { createSqliteTestDatabase, type SqliteTestDatabase } from '../../sqlite/testDatabase';
import { runModelProviderStoreContractSuite } from '../contractSuite';

describe('SqliteModelProviderStore (IModelProviderStore contract)', () => {
  let env: SqliteTestDatabase;

  beforeEach(async () => {
    env = await createSqliteTestDatabase();
  }, 120_000);

  afterEach(async () => {
    await env?.teardown();
  });

  runModelProviderStoreContractSuite(() => new SqliteModelProviderStore(env.db));
});
