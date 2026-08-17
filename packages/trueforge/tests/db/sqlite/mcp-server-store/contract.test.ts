import { SqliteMcpServerStore } from '../../../../src/db/sqlite/mcp-server-store/SqliteMcpServerStore';
import { runMcpServerStoreContractSuite } from '../../mcpServerStoreContractSuite';
import { createSqliteTestDatabase, type SqliteTestDatabase } from '../testDatabase';

describe('SqliteMcpServerStore (IMcpServerStore contract)', () => {
  let env: SqliteTestDatabase;

  beforeEach(async () => {
    env = await createSqliteTestDatabase();
  }, 120_000);

  afterEach(async () => {
    await env?.teardown();
  });

  runMcpServerStoreContractSuite(() => new SqliteMcpServerStore(env.db));
});
