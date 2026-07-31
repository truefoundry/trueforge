import type { ISessionStore } from '@truefoundry/utils/agent-session/store/ISessionStore';

import { runStoreContractSuite } from '../../../../../harness/tests/agent-session/store/storeContractSuite';
import { createSqliteStoreEnvironment } from './helpers';

describe('SqliteSessionStore (ISessionStore contract)', () => {
  let env: Awaited<ReturnType<typeof createSqliteStoreEnvironment>>;

  beforeEach(async () => {
    env = await createSqliteStoreEnvironment();
  }, 120_000);

  afterEach(async () => {
    await env?.teardown();
  });

  runStoreContractSuite((): ISessionStore => env.store);
});
