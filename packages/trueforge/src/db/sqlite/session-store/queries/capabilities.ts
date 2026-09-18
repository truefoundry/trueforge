import type { PatchThreadCapabilityStateInput } from '@truefoundry/trueforge-core/agent-session/store/ISessionStore';
import { sql, type Kysely } from 'kysely';
import { jsonbBind, nowIso } from '../../sqlExpressions';
import type { Database } from '../../types';
import { classifyTurnProgressFenceFailure } from './turns';

/**
 * patchThreadCapabilityState — single-statement fenced upsert on the PER-TURN PK.
 * Does NOT bump turn.updated_at.
 * State is bound as SQL NULL when input.state is null (matches Postgres contract).
 */
export async function patchThreadCapabilityState(
  db: Kysely<Database>,
  input: PatchThreadCapabilityStateInput,
): Promise<void> {
  await db.transaction().execute(async trx => {
    // Fence inside IMMEDIATE transaction: verify turn is still running and owned.
    const fenceRow = await trx
      .selectFrom('turn')
      .select(sql`1`.as('one'))
      .where('session_id', '=', input.session_id)
      .where('turn_id', '=', input.turn_id)
      .where(sql<boolean>`state->>'status' = 'running'`)
      .where('active_executor_id', '=', input.expected_active_executor_id)
      .executeTakeFirst();

    if (!fenceRow) {
      await classifyTurnProgressFenceFailure(trx, input);
    }

    const now = nowIso();
    const stateValue = input.state !== null ? jsonbBind(input.state) : null;

    await trx
      .insertInto('thread_capability_state')
      .values({
        session_id: input.session_id,
        turn_id: input.turn_id,
        thread_id: input.thread_id,
        key: input.key,
        state: stateValue,
        updated_at: now,
      })
      .onConflict(oc =>
        oc.columns(['session_id', 'turn_id', 'thread_id', 'key']).doUpdateSet({
          state: sql`excluded.state`,
          updated_at: sql`excluded.updated_at`,
        }),
      )
      .execute();
  });
}
