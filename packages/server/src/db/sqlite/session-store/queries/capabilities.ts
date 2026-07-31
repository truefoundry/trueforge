import type { PatchThreadCapabilityStateInput } from '@truefoundry/utils/agent-session/store/ISessionStore';
import { sql, type Kysely } from 'kysely';
import type { Database } from '../../types';
import { jsonbBind, nowIso } from '../sqlExpressions';
import { classifyTurnFenceWriteFailure, type TurnKeys } from './turns';

/**
 * patchThreadCapabilityState — single-statement fenced upsert on the PER-TURN PK.
 * Does NOT bump turn.updated_at.
 * State is bound as SQL NULL when input.state is null (matches Postgres contract).
 */
export async function patchThreadCapabilityState(
  db: Kysely<Database>,
  input: PatchThreadCapabilityStateInput,
): Promise<void> {
  const keys: TurnKeys = {
    tenant_id: input.tenant_id,
    session_id: input.session_id,
    turn_id: input.turn_id,
  };

  await db.transaction().execute(async trx => {
    // Fence inside IMMEDIATE transaction: verify turn is still running.
    const fenceRow = await trx
      .selectFrom('turn')
      .select(sql`1`.as('one'))
      .where('tenant_id', '=', keys.tenant_id)
      .where('session_id', '=', keys.session_id)
      .where('turn_id', '=', keys.turn_id)
      .where(sql<boolean>`state->>'status' = 'running'`)
      .executeTakeFirst();

    if (!fenceRow) {
      await classifyTurnFenceWriteFailure(trx, keys);
    }

    const now = nowIso();
    const stateValue = input.state !== null ? jsonbBind(input.state) : null;

    await trx
      .insertInto('thread_capability_state')
      .values({
        tenant_id: input.tenant_id,
        session_id: input.session_id,
        turn_id: input.turn_id,
        thread_id: input.thread_id,
        key: input.key,
        state: stateValue,
        updated_at: now,
      })
      .onConflict(oc =>
        oc.columns(['tenant_id', 'session_id', 'turn_id', 'thread_id', 'key']).doUpdateSet({
          state: sql`excluded.state`,
          updated_at: sql`excluded.updated_at`,
        }),
      )
      .execute();
  });
}
