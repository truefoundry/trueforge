import { sql, type Kysely } from 'kysely';

/**
 * SQLite mirror of postgres/migrations/20261009_000001_model_message_model_backfill.ts.
 */
export async function up<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`
      UPDATE session_event
      SET event = jsonb_set(
        event,
        '$.model',
        jsonb(json_object('name', m.model_name))
      )
      FROM (
        SELECT
          s.session_id AS sid,
          COALESCE(
            json_extract(s.agent_spec, '$.model.name'),
            json_extract(a.manifest, '$.model.name')
          ) AS model_name
        FROM session s
        LEFT JOIN agent a
          ON a.tenant_id = s.tenant_id
         AND a.id = s.agent_id
      ) m
      WHERE session_event.session_id = m.sid
        AND json_extract(session_event.event, '$.type') = 'model.message'
        AND json_extract(session_event.event, '$.model') IS NULL
        AND m.model_name IS NOT NULL
    `.execute(trx);

    await sql`
      UPDATE turn
      SET state = jsonb_set(
        state,
        '$.output.model',
        jsonb(json_object('name', m.model_name))
      )
      FROM (
        SELECT
          s.session_id AS sid,
          COALESCE(
            json_extract(s.agent_spec, '$.model.name'),
            json_extract(a.manifest, '$.model.name')
          ) AS model_name
        FROM session s
        LEFT JOIN agent a
          ON a.tenant_id = s.tenant_id
         AND a.id = s.agent_id
      ) m
      WHERE turn.session_id = m.sid
        AND json_extract(turn.state, '$.output.type') = 'model.message'
        AND json_extract(turn.state, '$.output.model') IS NULL
        AND m.model_name IS NOT NULL
    `.execute(trx);
  });
}

/** Data backfill — not reversed. */
export async function down(db: Kysely<unknown>): Promise<void> {
  void db;
}
