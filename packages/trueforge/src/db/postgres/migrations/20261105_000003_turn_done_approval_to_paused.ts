import { sql, type Kysely } from 'kysely';

/**
 * Action-required turns used to finish as `done`. Only topology leaves can
 * still be resumed, so convert those turn rows and their terminal lifecycle
 * events to the current paused representation.
 *
 * Session totals already include this work. A later resume folds only the new
 * running interval, so the totals stay. The turn's billable totals and closed
 * duration move onto the checkpoint, which is what a later pause, finish, or
 * freeze reads, and onto the paused state so clients still see them.
 * `last_turn_details` for a migrated tip moves to `paused` with the turn.
 *
 * This data migration is intentionally irreversible: the legacy terminal
 * state fields are not part of a paused state and cannot be reconstructed.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);

  // Rewrite the terminal lifecycle event for each affected leaf so event history
  // agrees with the non-terminal turn state clients will read after migration.
  await sql`
    UPDATE session_event AS event_row
    SET event =
      (event_row.event - 'type' - 'state')
      || jsonb_build_object(
        'type', 'turn.update',
        'state', jsonb_strip_nulls(jsonb_build_object(
          'status', 'paused',
          'metrics', turn.state->'metrics'
        ))
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
        FROM jsonb_array_elements(turn.state->'required_actions') AS action
        WHERE action->>'type' IN (
          'tool.approval_required',
          'tool.response_required',
          'mcp.auth_required'
        )
      )
  `.execute(db);

  // The session tip is one leaf. Other branched leaves stay paused on their own rows.
  await sql`
    UPDATE session
    SET last_turn_details = jsonb_set(last_turn_details, '{state,status}', '"paused"'::jsonb)
    WHERE EXISTS (
      SELECT 1
      FROM turn
      WHERE turn.session_id = session.session_id
        AND turn.turn_id = session.last_turn_details->>'id'
        AND turn.state->>'status' = 'done'
        AND NOT EXISTS (
          SELECT 1
          FROM turn AS child
          WHERE child.session_id = turn.session_id
            AND child.previous_turn_id = turn.turn_id
        )
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(turn.state->'required_actions') AS action
          WHERE action->>'type' IN (
            'tool.approval_required',
            'tool.response_required',
            'mcp.auth_required'
          )
        )
    )
  `.execute(db);

  // Do this last: the preceding queries identify affected leaves from the legacy done state.
  // running_since is written with jsonb_set after the merge, not inside the object, so it is an explicit null.
  await sql`
    UPDATE turn
    SET
      state = jsonb_strip_nulls(jsonb_build_object(
        'status', 'paused',
        'metrics', turn.state->'metrics'
      )),
      checkpoint = jsonb_set(
        turn.checkpoint || jsonb_build_object(
          'metrics', jsonb_strip_nulls(jsonb_build_object(
            'total_input_tokens', COALESCE((turn.state->'metrics'->>'total_input_tokens')::bigint, 0),
            'total_output_tokens', COALESCE((turn.state->'metrics'->>'total_output_tokens')::bigint, 0),
            'total_tokens', COALESCE((turn.state->'metrics'->>'total_tokens')::bigint, 0),
            'total_cache_read_tokens', (turn.state->'metrics'->>'total_cache_read_tokens')::bigint,
            'total_cache_write_tokens', (turn.state->'metrics'->>'total_cache_write_tokens')::bigint,
            'total_reasoning_tokens', (turn.state->'metrics'->>'total_reasoning_tokens')::bigint,
            'total_cost_in_usd', (turn.state->'metrics'->>'total_cost_in_usd')::double precision
          )),
          'active_duration_ms', COALESCE(
            GREATEST(
              0,
              TRUNC(
                EXTRACT(EPOCH FROM ((turn.state->>'completed_at')::timestamptz - turn.created_at)) * 1000
              )::bigint
            ),
            0
          )
        ),
        '{running_since}',
        'null'::jsonb
      ),
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
        WHERE action->>'type' IN (
          'tool.approval_required',
          'tool.response_required',
          'mcp.auth_required'
        )
      )
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  throw new Error('turn done-to-paused data migration is irreversible');
}
