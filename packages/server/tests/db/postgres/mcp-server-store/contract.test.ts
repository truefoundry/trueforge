import { sql } from 'kysely';

import { PostgresMcpServerStore } from '../../../../src/db/postgres/mcp-server-store/PostgresMcpServerStore';
import { runMcpServerStoreContractSuite } from '../../mcpServerStoreContractSuite';
import { createPostgresTestDatabase, type PostgresTestDatabase } from '../testDatabase';

const describePg = process.env['PG_STORE_TESTS_ENABLED'] === '1' ? describe : describe.skip;

describePg('PostgresMcpServerStore (IMcpServerStore contract)', () => {
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
      await sql`TRUNCATE TABLE mcp_server CASCADE`.execute(env.db);
    }
  });

  runMcpServerStoreContractSuite(() => {
    if (env === undefined) {
      throw new Error('Postgres test environment not initialized');
    }
    return new PostgresMcpServerStore(env.db);
  });
});
