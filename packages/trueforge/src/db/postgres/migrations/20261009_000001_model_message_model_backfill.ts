import { sql, type Kysely } from 'kysely';

/**
 * Backfill `model` on model.message session events and turn state.output for each
 * session's latest tip turn only (`session.last_turn_id`).
 *
 * Prefers `thread.created.agent_info.model` for sub-agent threads when present;
 * otherwise the session agent FQN (`provider/model`) as `{ name: fqn }`.
 */
export async function up<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);

  await sql`
    UPDATE session_event e
    SET event = jsonb_set(
      e.event,
      '{model}',
      jsonb_build_object('name', resolved.model_name),
      true
    )
    FROM session s
    LEFT JOIN agent a
      ON a.tenant_id = s.tenant_id
     AND a.id = s.agent_id
    CROSS JOIN LATERAL (
      SELECT COALESCE(
        (
          SELECT tc.event #>> '{agent_info,model}'
          FROM session_event tc
          WHERE tc.session_id = e.session_id
            AND tc.event->>'type' = 'thread.created'
            AND tc.event->>'thread_id' = e.event->>'thread_id'
          LIMIT 1
        ),
        s.agent_spec #>> '{model,name}',
        a.manifest #>> '{model,name}'
      ) AS model_name
    ) resolved
    WHERE e.session_id = s.session_id
      AND s.last_turn_id IS NOT NULL
      AND e.turn_id = s.last_turn_id
      AND e.event->>'type' = 'model.message'
      AND e.event->'model' IS NULL
      AND resolved.model_name IS NOT NULL
  `.execute(db);

  await sql`
    UPDATE turn t
    SET state = jsonb_set(
      t.state,
      '{output,model}',
      jsonb_build_object('name', resolved.model_name),
      true
    )
    FROM session s
    LEFT JOIN agent a
      ON a.tenant_id = s.tenant_id
     AND a.id = s.agent_id
    CROSS JOIN LATERAL (
      SELECT COALESCE(
        (
          SELECT tc.event #>> '{agent_info,model}'
          FROM session_event tc
          WHERE tc.session_id = t.session_id
            AND tc.event->>'type' = 'thread.created'
            AND tc.event->>'thread_id' = t.state->'output'->>'thread_id'
          LIMIT 1
        ),
        s.agent_spec #>> '{model,name}',
        a.manifest #>> '{model,name}'
      ) AS model_name
    ) resolved
    WHERE t.session_id = s.session_id
      AND s.last_turn_id IS NOT NULL
      AND t.turn_id = s.last_turn_id
      AND t.state->'output'->>'type' = 'model.message'
      AND t.state->'output'->'model' IS NULL
      AND resolved.model_name IS NOT NULL
  `.execute(db);
}

/** Data backfill — not reversed. */
export function down(db: Kysely<unknown>): Promise<void> {
  void db;
  return Promise.reject(new Error('20261009_000001_model_message_model_backfill is irreversible'));
}
