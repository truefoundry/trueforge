import { sql, type Kysely } from 'kysely';

/**
 * Mirrors the PostgreSQL migration that converts resumable topology leaves
 * from the legacy done-with-approval state to paused.
 *
 * This data migration is intentionally irreversible: the legacy terminal
 * state fields are not part of a paused state and cannot be reconstructed.
 */
export async function up<DB>(db: Kysely<DB>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`
      UPDATE session_event
      SET event = jsonb_set(
        jsonb_set(event, '$.type', jsonb('"turn.update"')),
        '$.state',
        jsonb('{"status":"paused"}')
      )
      WHERE json_extract(event, '$.type') = 'turn.done'
        AND json_extract(event, '$.state.status') = 'done'
        AND EXISTS (
          SELECT 1
          FROM json_each(event, '$.state.required_actions') AS action
          WHERE json_extract(action.value, '$.type') = 'tool.approval_required'
        )
        AND EXISTS (
          SELECT 1
          FROM turn
          WHERE turn.session_id = session_event.session_id
            AND turn.turn_id = session_event.turn_id
            AND json_extract(turn.state, '$.status') = 'done'
            AND NOT EXISTS (
              SELECT 1
              FROM turn AS child
              WHERE child.session_id = turn.session_id
                AND child.previous_turn_id = turn.turn_id
            )
            AND EXISTS (
              SELECT 1
              FROM json_each(turn.state, '$.required_actions') AS action
              WHERE json_extract(action.value, '$.type') = 'tool.approval_required'
            )
        )
    `.execute(trx);

    await sql`
      UPDATE turn
      SET
        state = jsonb('{"status":"paused"}'),
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE json_extract(state, '$.status') = 'done'
        AND EXISTS (
          SELECT 1
          FROM json_each(state, '$.required_actions') AS action
          WHERE json_extract(action.value, '$.type') = 'tool.approval_required'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM turn AS child
          WHERE child.session_id = turn.session_id
            AND child.previous_turn_id = turn.turn_id
        )
    `.execute(trx);
  });
}

export async function down<DB>(_db: Kysely<DB>): Promise<void> {}
