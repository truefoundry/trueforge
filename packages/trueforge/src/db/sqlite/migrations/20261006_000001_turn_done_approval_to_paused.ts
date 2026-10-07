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
    // Rewrite the terminal lifecycle event for each affected leaf so event history
    // agrees with the non-terminal turn state clients will read after migration.
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

    // Terminal writes already folded these turns into their session totals.
    // Reverse that duration and cost now so a later terminal write folds them once.
    await sql`
      UPDATE session
      SET metrics = (
        SELECT
          CASE
            WHEN migrated.total_cost_in_usd IS NULL THEN
              jsonb_set(
                session.metrics,
                '$.total_duration_ms',
                jsonb(MAX(0, json_extract(session.metrics, '$.total_duration_ms') - migrated.total_duration_ms))
              )
            ELSE
              jsonb_set(
                jsonb_set(
                  session.metrics,
                  '$.total_duration_ms',
                  jsonb(MAX(0, json_extract(session.metrics, '$.total_duration_ms') - migrated.total_duration_ms))
                ),
                '$.total_cost_in_usd',
                jsonb(
                  MAX(
                    0,
                    COALESCE(json_extract(session.metrics, '$.total_cost_in_usd'), 0)
                      - migrated.total_cost_in_usd
                  )
                )
              )
          END
        FROM (
          SELECT
            SUM(
              MAX(
                0,
                CAST(
                  ROUND(
                    (
                      unixepoch(json_extract(turn.state, '$.completed_at'), 'subsec')
                        - unixepoch(turn.created_at, 'subsec')
                    ) * 1000
                  ) AS INTEGER
                )
              )
            ) AS total_duration_ms,
            SUM(json_extract(turn.state, '$.metrics.total_cost_in_usd')) AS total_cost_in_usd
          FROM turn
          WHERE turn.session_id = session.session_id
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
        ) AS migrated
      )
      WHERE EXISTS (
        SELECT 1
        FROM turn
        WHERE turn.session_id = session.session_id
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

    // Do this last: the preceding queries use the legacy done state to identify
    // affected leaves and recover the metrics that need to be reversed.
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

export function down(): Promise<void> {
  return Promise.resolve();
}
