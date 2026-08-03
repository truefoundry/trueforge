import { sql } from 'kysely';

import { PostgresModelProviderStore } from '../../../../src/db/postgres/model-provider-store/PostgresModelProviderStore';
import { runModelProviderStoreContractSuite } from '../../modelProviderStoreContractSuite';
import { createPostgresTestDatabase, type PostgresTestDatabase } from '../testDatabase';

const describePg = process.env['PG_STORE_TESTS_ENABLED'] === '1' ? describe : describe.skip;

describePg('PostgresModelProviderStore (IModelProviderStore contract)', () => {
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
      await sql`TRUNCATE TABLE model_provider`.execute(env.db);
    }
  });

  runModelProviderStoreContractSuite(() => {
    if (env === undefined) {
      throw new Error('Postgres test environment not initialized');
    }
    return new PostgresModelProviderStore(env.db);
  });
});
