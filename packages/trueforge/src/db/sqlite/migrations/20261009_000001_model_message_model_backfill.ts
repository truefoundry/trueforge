import { sql, type Kysely } from 'kysely';

/**
 * SQLite mirror of postgres/migrations/20261009_000001_model_message_model_backfill.ts.
 * Backfills only each session's tip turn (`last_turn_id`).
 * Prefers `thread.created.agent_info.model` when the event's thread has one.
 */
export async function up<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`
      UPDATE session_event
      SET event = jsonb_set(
        event,
        '$.model',
        jsonb(json_object('name', resolved.model_name))
      )
      FROM (
        SELECT
          se.session_id AS sid,
          se.turn_id AS tid,
          se.event_id AS eid,
          COALESCE(
            (
              SELECT json_extract(tc.event, '$.agent_info.model')
              FROM session_event tc
              WHERE tc.session_id = se.session_id
                AND json_extract(tc.event, '$.type') = 'thread.created'
                AND json_extract(tc.event, '$.thread_id') = json_extract(se.event, '$.thread_id')
            ),
            json_extract(s.agent_spec, '$.model.name'),
            json_extract(a.manifest, '$.model.name')
          ) AS model_name
        FROM session_event se
        JOIN session s
          ON s.session_id = se.session_id
        LEFT JOIN agent a
          ON a.tenant_id = s.tenant_id
         AND a.id = s.agent_id
        WHERE s.last_turn_id IS NOT NULL
          AND se.turn_id = s.last_turn_id
          AND json_extract(se.event, '$.type') = 'model.message'
          AND json_extract(se.event, '$.model') IS NULL
      ) resolved
      WHERE session_event.session_id = resolved.sid
        AND session_event.turn_id = resolved.tid
        AND session_event.event_id = resolved.eid
        AND resolved.model_name IS NOT NULL
    `.execute(trx);

    await sql`
      UPDATE turn
      SET state = jsonb_set(
        state,
        '$.output.model',
        jsonb(json_object('name', resolved.model_name))
      )
      FROM (
        SELECT
          t.session_id AS sid,
          t.turn_id AS tid,
          COALESCE(
            (
              SELECT json_extract(tc.event, '$.agent_info.model')
              FROM session_event tc
              WHERE tc.session_id = t.session_id
                AND json_extract(tc.event, '$.type') = 'thread.created'
                AND json_extract(tc.event, '$.thread_id') = json_extract(t.state, '$.output.thread_id')
            ),
            json_extract(s.agent_spec, '$.model.name'),
            json_extract(a.manifest, '$.model.name')
          ) AS model_name
        FROM turn t
        JOIN session s
          ON s.session_id = t.session_id
        LEFT JOIN agent a
          ON a.tenant_id = s.tenant_id
         AND a.id = s.agent_id
        WHERE s.last_turn_id IS NOT NULL
          AND t.turn_id = s.last_turn_id
          AND json_extract(t.state, '$.output.type') = 'model.message'
          AND json_extract(t.state, '$.output.model') IS NULL
      ) resolved
      WHERE turn.session_id = resolved.sid
        AND turn.turn_id = resolved.tid
        AND resolved.model_name IS NOT NULL
    `.execute(trx);
  });
}

/** Data backfill — not reversed. */
export function down(db: Kysely<unknown>): Promise<void> {
  void db;
  return Promise.reject(new Error('20261009_000001_model_message_model_backfill is irreversible'));
}
