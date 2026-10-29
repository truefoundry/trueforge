import { sql, type Kysely } from 'kysely';

/**
 * Action-required turns used to finish as `done`. Only topology leaves can
 * still be resumed, so convert those turn rows and their terminal lifecycle
 * events to the current paused representation. A session may have multiple
 * leaves after branching; `session.last_turn_id` identifies only one of them.
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
        FROM jsonb_array_elements(turn.state->'required_actions') AS action
        WHERE action->>'type' IN (
          'tool.approval_required',
          'tool.response_required',
          'mcp.auth_required'
        )
      )
  `.execute(db);

  // Terminal writes already folded these turns into their session totals.
  // Reverse that duration and cost now so a later terminal write folds them once.
  // This is best effort for old sessions: metrics introduced after some turns
  // had already completed, so those session aggregates may already be incomplete.
  await sql`
    WITH migrated_turn_metrics AS (
      SELECT
        turn.session_id,
        SUM(
          GREATEST(
            0,
            TRUNC(
              EXTRACT(EPOCH FROM ((turn.state->>'completed_at')::timestamptz - turn.created_at)) * 1000
            )::bigint
          )
        ) AS total_duration_ms,
        SUM((turn.state->'metrics'->>'total_cost_in_usd')::double precision) AS total_cost_in_usd
      FROM turn
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
      GROUP BY turn.session_id
    ),
    metrics_with_duration_reversed AS (
      SELECT
        session.session_id,
        migrated_turn_metrics.total_cost_in_usd,
        jsonb_set(
          session.metrics,
          '{total_duration_ms}',
          to_jsonb(
            GREATEST(
              0,
              (session.metrics->>'total_duration_ms')::bigint - migrated_turn_metrics.total_duration_ms
            )
          )
        ) AS metrics
      FROM session
      JOIN migrated_turn_metrics USING (session_id)
    )
    UPDATE session
    SET metrics =
      CASE
        WHEN reversed.total_cost_in_usd IS NULL THEN reversed.metrics
        ELSE jsonb_set(
          reversed.metrics,
          '{total_cost_in_usd}',
          to_jsonb(
            GREATEST(
              0::double precision,
              COALESCE((session.metrics->>'total_cost_in_usd')::double precision, 0)
                - reversed.total_cost_in_usd
            )
          )
        )
      END
    FROM metrics_with_duration_reversed AS reversed
    WHERE session.session_id = reversed.session_id
  `.execute(db);

  // Do this last: the preceding queries use the legacy done state to identify
  // affected leaves and recover the metrics that need to be reversed.
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
