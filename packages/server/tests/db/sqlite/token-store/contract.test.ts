import { jsonbBind, nowIso } from '../../../../src/db/sqlite/sqlExpressions';
import { SqliteOAuthTokenStore } from '../../../../src/db/sqlite/token-store/SqliteOAuthTokenStore';
import { runOAuthTokenStoreContractSuite, type OAuthTokenStoreHarness } from '../../oauthTokenStoreContractSuite';
import { createSqliteTestDatabase, type SqliteTestDatabase } from '../testDatabase';

describe('SqliteOAuthTokenStore (IOAuthTokenStore contract)', () => {
  let env: SqliteTestDatabase;

  beforeEach(async () => {
    env = await createSqliteTestDatabase();
  }, 120_000);

  afterEach(async () => {
    await env?.teardown();
  });

  runOAuthTokenStoreContractSuite((): OAuthTokenStoreHarness => ({
    store: new SqliteOAuthTokenStore(env.db),
    async seedResource(id) {
      await env.db
        .insertInto('mcp_server')
        .values({
          id,
          tenant_id: 'default',
          name: id,
          manifest: jsonbBind({}),
          oauth_server: null,
          oauth_client: null,
          created_at: nowIso(),
          updated_at: nowIso(),
        })
        .execute();
    },
    async expirePending(state) {
      await env.db
        .updateTable('oauth_pending_authorization')
        .set({ created_at: new Date(Date.now() - 3_600_000).toISOString() })
        .where('id', '=', state)
        .execute();
    },
  }));
});
