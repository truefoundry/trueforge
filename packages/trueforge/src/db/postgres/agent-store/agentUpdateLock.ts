import type { Kysely, Transaction } from 'kysely';
import { sql } from 'kysely';

import type { WithAgentUpdateLock } from '../../agentUpdateLock';
import type { Database } from '../types';

/** Transaction-scoped advisory lock held for the whole callback (including SF HTTP). */
export function createPostgresAgentUpdateLock(db: Kysely<Database>): WithAgentUpdateLock<Transaction<Database>> {
  return async (input, fn) =>
    db.transaction().execute(async trx => {
      const key = `tf:agent:${input.tenant_id}:${input.id}`;
      await sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`.execute(trx);
      return fn(trx);
    });
}
