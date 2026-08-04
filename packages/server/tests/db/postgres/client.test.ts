import { sql } from 'kysely';

import { createDb } from '../../../src/db/postgres/client';

const describePg = process.env['PG_STORE_TESTS_ENABLED'] === '1' ? describe : describe.skip;

describePg('createDb postgres session timeouts', () => {
  it('applies statement_timeout and idle_in_transaction_session_timeout on connect', async () => {
    const connectionString = process.env['PG_STORE_TESTS_ADMIN_URL'];
    if (connectionString === undefined || connectionString === '') {
      throw new Error('PG_STORE_TESTS_ADMIN_URL unset despite globalSetup probe');
    }

    // Non-default values so a passing assertion cannot match server defaults (0).
    const statementTimeoutMs = 45_000;
    const idleInTransactionSessionTimeoutMs = 50_000;
    const db = createDb({
      connectionString,
      poolMax: 1,
      statementTimeoutMs,
      idleInTransactionSessionTimeoutMs,
    });
    try {
      const { rows } = await sql<{ name: string; setting: string }>`
        SELECT name, setting
        FROM pg_settings
        WHERE name IN ('statement_timeout', 'idle_in_transaction_session_timeout')
      `.execute(db);

      const byName = new Map(rows.map(row => [row.name, row.setting]));
      expect(byName.get('statement_timeout')).toBe(String(statementTimeoutMs));
      expect(byName.get('idle_in_transaction_session_timeout')).toBe(String(idleInTransactionSessionTimeoutMs));
    } finally {
      await db.destroy();
    }
  });
});
