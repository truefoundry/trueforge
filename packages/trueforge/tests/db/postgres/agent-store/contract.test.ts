import { sql } from 'kysely';

import { PostgresAgentStore } from '../../../../src/db/postgres/agent-store/PostgresAgentStore';
import { runAgentStoreContractSuite } from '../../agentStoreContractSuite';
import { createPostgresTestDatabase, type PostgresTestDatabase } from '../testDatabase';

const describePg = process.env['PG_STORE_TESTS_ENABLED'] === '1' ? describe : describe.skip;

describePg('PostgresAgentStore (IAgentStore contract)', () => {
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
      await sql`TRUNCATE TABLE agent CASCADE`.execute(env.db);
    }
  });

  runAgentStoreContractSuite(() => {
    if (env === undefined) {
      throw new Error('Postgres test environment not initialized');
    }
    return new PostgresAgentStore(env.db);
  });
});
