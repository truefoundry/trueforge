import { jsonbBind, nowIso } from '../../../../src/db/sqlite/sqlExpressions';
import { SqliteOAuthTokenStore } from '../../../../src/db/sqlite/token-store/SqliteOAuthTokenStore';
import type { McpServerManifest } from '../../../../src/schemas/mcpServer';
import { runOAuthTokenStoreContractSuite, type OAuthTokenStoreHarness } from '../../oauthTokenStoreContractSuite';
import { createSqliteTestDatabase, type SqliteTestDatabase } from '../testDatabase';

describe('SqliteOAuthTokenStore (IOAuthTokenStore contract)', () => {
  let env: SqliteTestDatabase | undefined;

  beforeEach(async () => {
    env = await createSqliteTestDatabase();
  }, 120_000);

  afterEach(async () => {
    await env?.teardown();
    env = undefined;
  });

  runOAuthTokenStoreContractSuite((): OAuthTokenStoreHarness => {
    if (env === undefined) {
      throw new Error('SQLite test database not initialized');
    }
    const db = env.db;
    return {
      store: new SqliteOAuthTokenStore(db),
      async seedResource(id) {
        const manifest: McpServerManifest = {
          type: 'remote',
          name: id,
          url: 'https://mcp.example.com/sse',
          description: 'Test MCP server.',
        };
        await db
          .insertInto('mcp_server')
          .values({
            id,
            tenant_id: 'default',
            name: id,
            manifest: jsonbBind(manifest),
            oauth_server: null,
            oauth_client: null,
            created_at: nowIso(),
            updated_at: nowIso(),
          })
          .execute();
      },
      async expirePending(state) {
        await db
          .updateTable('oauth_pending_authorization')
          .set({ created_at: new Date(Date.now() - 3_600_000).toISOString() })
          .where('id', '=', state)
          .execute();
      },
    };
  });
});
