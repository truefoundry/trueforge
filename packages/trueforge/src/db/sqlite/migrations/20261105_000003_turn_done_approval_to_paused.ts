import { sql, type Kysely } from 'kysely';

/**
 * Mirrors the PostgreSQL migration that converts resumable topology leaves
 * from the legacy done-with-action-required state to paused.
 *
 * Session totals already include this work and stay. Billable totals and the
 * closed duration move onto the checkpoint and the paused state. The session
 * tip in `last_turn_details` moves to `paused` with that turn.
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
        (
          SELECT
            CASE
              WHEN json_extract(turn.state, '$.metrics') IS NULL THEN jsonb('{"status":"paused"}')
              ELSE jsonb_set(
                jsonb('{"status":"paused"}'),
                '$.metrics',
                jsonb(json_extract(turn.state, '$.metrics'))
              )
            END
          FROM turn
          WHERE turn.session_id = session_event.session_id
            AND turn.turn_id = session_event.turn_id
        )
      )
      WHERE json_extract(event, '$.type') = 'turn.done'
        AND json_extract(event, '$.state.status') = 'done'
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
              WHERE json_extract(action.value, '$.type') IN (
                'tool.approval_required',
                'tool.response_required',
                'mcp.auth_required'
              )
            )
        )
    `.execute(trx);

    // The session tip is one leaf. Other branched leaves stay paused on their own rows.
    await sql`
      UPDATE session
      SET last_turn_details = jsonb_set(last_turn_details, '$.state.status', jsonb('"paused"'))
      WHERE EXISTS (
        SELECT 1
        FROM turn
        WHERE turn.session_id = session.session_id
          AND turn.turn_id = json_extract(session.last_turn_details, '$.id')
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
            WHERE json_extract(action.value, '$.type') IN (
              'tool.approval_required',
              'tool.response_required',
              'mcp.auth_required'
            )
          )
      )
    `.execute(trx);

    // Do this last: the preceding queries identify affected leaves from the legacy done state.
    // running_since is jsonb('null'): SQL NULL would delete the key instead of storing JSON null.
    await sql`
      UPDATE turn
      SET
        state = CASE
          WHEN json_extract(state, '$.metrics') IS NULL THEN jsonb('{"status":"paused"}')
          ELSE jsonb_set(
            jsonb('{"status":"paused"}'),
            '$.metrics',
            jsonb(json_extract(state, '$.metrics'))
          )
        END,
        checkpoint = jsonb_set(
          jsonb_set(
            jsonb_set(
              checkpoint,
              '$.metrics',
              jsonb(
                json_remove(
                  json_object(
                    'total_input_tokens', COALESCE(json_extract(state, '$.metrics.total_input_tokens'), 0),
                    'total_output_tokens', COALESCE(json_extract(state, '$.metrics.total_output_tokens'), 0),
                    'total_tokens', COALESCE(json_extract(state, '$.metrics.total_tokens'), 0),
                    'total_cache_read_tokens', json_extract(state, '$.metrics.total_cache_read_tokens'),
                    'total_cache_write_tokens', json_extract(state, '$.metrics.total_cache_write_tokens'),
                    'total_reasoning_tokens', json_extract(state, '$.metrics.total_reasoning_tokens'),
                    'total_cost_in_usd', json_extract(state, '$.metrics.total_cost_in_usd')
                  ),
                  CASE
                    WHEN json_extract(state, '$.metrics.total_cache_read_tokens') IS NULL
                      THEN '$.total_cache_read_tokens'
                    ELSE '$.__absent'
                  END,
                  CASE
                    WHEN json_extract(state, '$.metrics.total_cache_write_tokens') IS NULL
                      THEN '$.total_cache_write_tokens'
                    ELSE '$.__absent'
                  END,
                  CASE
                    WHEN json_extract(state, '$.metrics.total_reasoning_tokens') IS NULL
                      THEN '$.total_reasoning_tokens'
                    ELSE '$.__absent'
                  END,
                  CASE
                    WHEN json_extract(state, '$.metrics.total_cost_in_usd') IS NULL
                      THEN '$.total_cost_in_usd'
                    ELSE '$.__absent'
                  END
                )
              )
            ),
            '$.active_duration_ms',
            COALESCE(
              MAX(
                0,
                CAST(
                  ROUND(
                    (
                      unixepoch(json_extract(state, '$.completed_at'), 'subsec')
                        - unixepoch(created_at, 'subsec')
                    ) * 1000
                  ) AS INTEGER
                )
              ),
              0
            )
          ),
          '$.running_since',
          jsonb('null')
        ),
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE json_extract(state, '$.status') = 'done'
        AND EXISTS (
          SELECT 1
          FROM json_each(state, '$.required_actions') AS action
          WHERE json_extract(action.value, '$.type') IN (
            'tool.approval_required',
            'tool.response_required',
            'mcp.auth_required'
          )
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
  return Promise.reject(new Error('turn done-to-paused data migration is irreversible'));
}
