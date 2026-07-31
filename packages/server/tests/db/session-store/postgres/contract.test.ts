import type { ISessionStore } from '@truefoundry/utils/agent-session/store/ISessionStore';

import { runStoreContractSuite } from '../../../../../harness/tests/agent-session/store/storeContractSuite';
import { createPostgresStoreEnvironment } from './helpers';

const describePg = process.env['PG_STORE_TESTS_ENABLED'] === '1' ? describe : describe.skip;

describePg('PostgresSessionStore (ISessionStore contract)', () => {
  let env: Awaited<ReturnType<typeof createPostgresStoreEnvironment>>;

  beforeAll(async () => {
    env = await createPostgresStoreEnvironment();
    if (env === undefined) {
      throw new Error('Postgres test environment unavailable despite globalSetup probe');
    }
  }, 120_000);

  afterAll(async () => {
    await env?.teardown();
  });

  beforeEach(async () => {
    await env?.reset();
  });

  runStoreContractSuite((): ISessionStore => {
    if (env === undefined) {
      throw new Error('Postgres test environment not initialized');
    }
    return env.store;
  });
});
