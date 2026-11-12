import { sql } from 'kysely';

import { PostgresSandboxEnvironmentStore } from '../../../../src/db/postgres/sandbox-environment-store/PostgresSandboxEnvironmentStore';
import { runSandboxEnvironmentStoreContractSuite } from '../../sandboxEnvironmentStoreContractSuite';
import { createPostgresTestDatabase, type PostgresTestDatabase } from '../testDatabase';

const describePg = process.env['PG_STORE_TESTS_ENABLED'] === '1' ? describe : describe.skip;

describePg('PostgresSandboxEnvironmentStore (ISandboxEnvironmentStore contract)', () => {
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
      await sql`TRUNCATE TABLE sandbox_environment, sandbox_environment_version, sandbox_environment_secret`.execute(
        env.db,
      );
    }
  });

  runSandboxEnvironmentStoreContractSuite(() => {
    if (env === undefined) {
      throw new Error('Postgres test environment not initialized');
    }
    return new PostgresSandboxEnvironmentStore(env.db);
  });
});
