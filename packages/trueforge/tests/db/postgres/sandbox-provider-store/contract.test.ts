import { sql } from 'kysely';

import { PostgresSandboxProviderStore } from '../../../../src/db/postgres/sandbox-provider-store/PostgresSandboxProviderStore';
import { runSandboxProviderStoreContractSuite } from '../../sandboxProviderStoreContractSuite';
import { createPostgresTestDatabase, type PostgresTestDatabase } from '../testDatabase';

const describePg = process.env['PG_STORE_TESTS_ENABLED'] === '1' ? describe : describe.skip;

describePg('PostgresSandboxProviderStore (ISandboxProviderStore contract)', () => {
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
      await sql`TRUNCATE TABLE sandbox_provider`.execute(env.db);
    }
  });

  runSandboxProviderStoreContractSuite(() => {
    if (env === undefined) {
      throw new Error('Postgres test environment not initialized');
    }
    return new PostgresSandboxProviderStore(env.db);
  });
});
