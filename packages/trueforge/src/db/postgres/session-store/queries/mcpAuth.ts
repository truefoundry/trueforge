import type { PatchThreadsMCPAuthInput } from '@truefoundry/trueforge-core/agent-session/store/ISessionStore';
import { SessionStoreInvariantError } from '@truefoundry/trueforge-core/agent-session/store/SessionStoreErrors';
import { sql, type Kysely, type Transaction } from 'kysely';
import { json, jsonbSet } from '../../sqlExpressions';
import type { Database, TurnThreadCheckpoint } from '../../types';
import { assertTurnNonTerminal, type TurnKeys } from './turns';

async function assertThreadsExist(
  trx: Transaction<Database>,
  keys: TurnKeys,
  threadIds: readonly string[],
): Promise<void> {
  const rows = await trx
    .selectFrom('turn_thread')
    .select('thread_id')
    .where('session_id', '=', keys.session_id)
    .where('turn_id', '=', keys.turn_id)
    .where('thread_id', 'in', [...threadIds])
    .execute();
  const found = new Set(rows.map(row => row.thread_id));
  const missing = threadIds.filter(threadId => !found.has(threadId));
  if (missing.length > 0) {
    throw new SessionStoreInvariantError(`Thread not found: ${missing.join(', ')}`);
  }
}

export async function patchThreadsMCPAuth(db: Kysely<Database>, input: PatchThreadsMCPAuthInput): Promise<void> {
  const threadIds = [...new Set(input.thread_ids)];
  const keys: TurnKeys = { session_id: input.session_id, turn_id: input.turn_id };
  await db.transaction().execute(async trx => {
    await assertTurnNonTerminal(trx, keys);
    if (threadIds.length === 0) {
      return;
    }
    await assertThreadsExist(trx, keys, threadIds);
    await trx
      .updateTable('turn_thread')
      .set({
        checkpoint: jsonbSet<TurnThreadCheckpoint>(
          sql`checkpoint`,
          sql`'{pending_mcp_auth}'`,
          json(input.pending_mcp_auth),
        ),
        updated_at: sql`now()`,
      })
      .where('session_id', '=', input.session_id)
      .where('turn_id', '=', input.turn_id)
      .where('thread_id', 'in', threadIds)
      .execute();
  });
}
