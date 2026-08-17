import { SqliteSandboxProviderStore } from '../../../../src/db/sqlite/sandbox-provider-store/SqliteSandboxProviderStore';
import { runSandboxProviderStoreContractSuite } from '../../sandboxProviderStoreContractSuite';
import { createSqliteTestDatabase, type SqliteTestDatabase } from '../testDatabase';

describe('SqliteSandboxProviderStore (ISandboxProviderStore contract)', () => {
  let env: SqliteTestDatabase;

  beforeEach(async () => {
    env = await createSqliteTestDatabase();
  }, 120_000);

  afterEach(async () => {
    await env?.teardown();
  });

  runSandboxProviderStoreContractSuite(() => new SqliteSandboxProviderStore(env.db));
});
