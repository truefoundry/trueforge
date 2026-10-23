import type { PatchThreadsMCPAuthInput } from '@truefoundry/trueforge-core/agent-session/store/ISessionStore';
import { SessionStoreInvariantError } from '@truefoundry/trueforge-core/agent-session/store/SessionStoreErrors';
import { sql, type Kysely, type Transaction } from 'kysely';
import { isTransaction } from '../../../transaction';
import { jsonbSet, nowIso } from '../../sqlExpressions';
import type { Database } from '../../types';
import { assertOwnedNonTerminalTurn } from './turns';

type DbOrTrx = Kysely<Database> | Transaction<Database>;

async function assertThreadsExist(
  db: Transaction<Database>,
  keys: { session_id: string; turn_id: string },
  threadIds: readonly string[],
): Promise<void> {
  const rows = await db
    .selectFrom('turn_thread')
    .select('thread_id')
    .where('session_id', '=', keys.session_id)
    .where('turn_id', '=', keys.turn_id)
    .where('thread_id', 'in', [...threadIds])
    .execute();
  const found = new Set(rows.map(row => row.thread_id));
  const missing = threadIds.filter(threadId => !found.has(threadId));
  if (missing.length > 0) {
    throw new SessionStoreInvariantError(`Thread(s) not found: ${missing.join(', ')}`);
  }
}

export async function patchThreadsMCPAuth(db: DbOrTrx, input: PatchThreadsMCPAuthInput): Promise<void> {
  const execute = async (db: Transaction<Database>): Promise<void> => {
    const threadIds = [...new Set(input.thread_ids)];
    const keys = {
      session_id: input.session_id,
      turn_id: input.turn_id,
      active_executor_id: input.active_executor_id,
    };
    await assertOwnedNonTerminalTurn(db, keys);
    if (threadIds.length === 0) {
      return;
    }
    await assertThreadsExist(db, keys, threadIds);
    await db
      .updateTable('turn_thread')
      .set({
        checkpoint: jsonbSet(sql.ref('checkpoint'), '$.pending_mcp_auth', input.pending_mcp_auth),
        updated_at: nowIso(),
      })
      .where('session_id', '=', input.session_id)
      .where('turn_id', '=', input.turn_id)
      .where('thread_id', 'in', threadIds)
      .execute();
  };

  if (isTransaction<Database>(db)) {
    await execute(db);
    return;
  }
  await db.transaction().execute(execute);
}
