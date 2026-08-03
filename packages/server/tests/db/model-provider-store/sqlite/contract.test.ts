import { SqliteModelProviderStore } from '../../../../src/db/sqlite/model-provider-store/SqliteModelProviderStore';
import { runModelProviderStoreContractSuite } from '../contractSuite';
import { createSqliteTestDatabase, type SqliteTestDatabase } from './helpers';

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
