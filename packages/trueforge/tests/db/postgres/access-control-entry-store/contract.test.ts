import { sql } from 'kysely';

import { PostgresAccessControlEntryStore } from '../../../../src/db/postgres/access-control-entry-store/PostgresAccessControlEntryStore';
import { PostgresSessionStore } from '../../../../src/db/postgres/session-store/PostgresSessionStore';
import { runAccessControlEntryStoreContractSuite, sessionSeeding } from '../../accessControlEntryStoreContractSuite';
import { createPostgresTestDatabase, type PostgresTestDatabase } from '../testDatabase';

const describePg = process.env['PG_STORE_TESTS_ENABLED'] === '1' ? describe : describe.skip;

describePg('PostgresAccessControlEntryStore (IAccessControlEntryStore contract)', () => {
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
      await sql`TRUNCATE TABLE access_control_entry, session RESTART IDENTITY CASCADE`.execute(env.db);
    }
  });

  runAccessControlEntryStoreContractSuite(() => {
    if (env === undefined) {
      throw new Error('Postgres test environment not initialized');
    }
    return {
      store: new PostgresAccessControlEntryStore(env.db),
      ...sessionSeeding(new PostgresSessionStore(env.db)),
    };
  });
});
