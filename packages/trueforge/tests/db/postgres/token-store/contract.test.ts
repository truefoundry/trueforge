import { sql } from 'kysely';

import { json, now } from '../../../../src/db/postgres/sqlExpressions';
import { PostgresOAuthTokenStore } from '../../../../src/db/postgres/token-store/PostgresOAuthTokenStore';
import type { McpServerManifest } from '../../../../src/schemas/mcpServer';
import { runOAuthTokenStoreContractSuite, type OAuthTokenStoreHarness } from '../../oauthTokenStoreContractSuite';
import { createPostgresTestDatabase, type PostgresTestDatabase } from '../testDatabase';

const describePg = process.env['PG_STORE_TESTS_ENABLED'] === '1' ? describe : describe.skip;

describePg('PostgresOAuthTokenStore (IOAuthTokenStore contract)', () => {
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
      await sql`TRUNCATE TABLE mcp_server, oauth_token, oauth_pending_authorization CASCADE`.execute(env.db);
    }
  });

  runOAuthTokenStoreContractSuite((): OAuthTokenStoreHarness => {
    if (env === undefined) {
      throw new Error('Postgres test environment not initialized');
    }
    const db = env.db;
    return {
      store: new PostgresOAuthTokenStore(db),
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
            manifest: json(manifest),
            oauth_server: null,
            oauth_client: null,
            created_at: now(),
            updated_at: now(),
          })
          .execute();
      },
      async expirePending(state) {
        await db
          .updateTable('oauth_pending_authorization')
          .set({ created_at: sql`now() - interval '1 hour'` })
          .where('id', '=', state)
          .execute();
      },
    };
  });
});
