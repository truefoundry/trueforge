import { sql, type Kysely } from 'kysely';

/**
 * Approval-required turns used to finish as `done`. Only topology leaves can
 * still be resumed, so convert those turn rows and their terminal lifecycle
 * events to the current paused representation. A session may have multiple
 * leaves after branching; `session.last_turn_id` identifies only one of them.
 *
 * This data migration is intentionally irreversible: the legacy terminal
 * state fields are not part of a paused state and cannot be reconstructed.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);

  await sql`
    UPDATE session_event AS event_row
    SET event =
      (event_row.event - 'type' - 'state')
      || jsonb_build_object(
        'type', 'turn.update',
        'state', jsonb_build_object('status', 'paused')
      )
    FROM turn
    WHERE event_row.session_id = turn.session_id
      AND event_row.turn_id = turn.turn_id
      AND event_row.event->>'type' = 'turn.done'
      AND event_row.event->'state'->>'status' = 'done'
      AND turn.state->>'status' = 'done'
      AND NOT EXISTS (
        SELECT 1
        FROM turn AS child
        WHERE child.session_id = turn.session_id
          AND child.previous_turn_id = turn.turn_id
      )
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(event_row.event->'state'->'required_actions') AS action
        WHERE action->>'type' = 'tool.approval_required'
      )
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(turn.state->'required_actions') AS action
        WHERE action->>'type' = 'tool.approval_required'
      )
  `.execute(db);

  await sql`
    UPDATE turn
    SET
      state = jsonb_build_object('status', 'paused'),
      updated_at = NOW()
    WHERE turn.state->>'status' = 'done'
      AND NOT EXISTS (
        SELECT 1
        FROM turn AS child
        WHERE child.session_id = turn.session_id
          AND child.previous_turn_id = turn.turn_id
      )
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(turn.state->'required_actions') AS action
        WHERE action->>'type' = 'tool.approval_required'
      )
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
}
