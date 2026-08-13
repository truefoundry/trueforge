import type { PatchThreadCapabilityStateInput } from '@truefoundry/trueforge-core/agent-session/store/ISessionStore';
import { sql, type Kysely } from 'kysely';
import { json } from '../../sqlExpressions';
import type { Database } from '../../types';
import { values } from '../sqlExpressions';
import { classifyTurnFenceWriteFailure, turnRunningFence } from './turns';

/**
 * patchThreadCapabilityState — single-statement fenced upsert on the PER-TURN PK;
 * does NOT bump turn.updated_at.
 */
export async function patchThreadCapabilityState(
  db: Kysely<Database>,
  input: PatchThreadCapabilityStateInput,
): Promise<void> {
  const keys = {
    session_id: input.session_id,
    turn_id: input.turn_id,
  };

  const rows = await db
    .with('turn_fence', qb => turnRunningFence(qb, keys))
    .insertInto('thread_capability_state')
    .columns(['session_id', 'turn_id', 'thread_id', 'key', 'state', 'updated_at'])
    .expression(eb =>
      eb
        .selectFrom(values([{ one: 1 }], 'src'))
        .select([
          sql<string>`${input.session_id}`.as('session_id'),
          sql<string>`${input.turn_id}`.as('turn_id'),
          sql<string>`${input.thread_id}`.as('thread_id'),
          sql<string>`${input.key}`.as('key'),
          json(input.state).as('state'),
          sql<Date>`now()`.as('updated_at'),
        ])
        .where(wb => wb.exists(wb.selectFrom('turn_fence').select(sql`1`.as('one')))),
    )
    .onConflict(oc =>
      oc.columns(['session_id', 'turn_id', 'thread_id', 'key']).doUpdateSet({
        state: sql`excluded.state`,
        updated_at: sql`now()`,
      }),
    )
    .returning('thread_id')
    .execute();

  if (rows.length === 0) {
    await classifyTurnFenceWriteFailure(db, keys);
  }
}
