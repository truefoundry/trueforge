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
    FROM (
      SELECT
        se.session_id,
        se.turn_id,
        se.event_id,
        COALESCE(
          (
            SELECT tc.event #>> '{agent_info,model}'
            FROM session_event tc
            WHERE tc.session_id = se.session_id
              AND tc.event->>'type' = 'thread.created'
              AND tc.event->>'thread_id' = se.event->>'thread_id'
            LIMIT 1
          ),
          s.agent_spec #>> '{model,name}',
          a.manifest #>> '{model,name}'
        ) AS model_name
      FROM session_event se
      JOIN session s
        ON s.session_id = se.session_id
      LEFT JOIN agent a
        ON a.tenant_id = s.tenant_id
       AND a.id = s.agent_id
      WHERE s.last_turn_id IS NOT NULL
        AND se.turn_id = s.last_turn_id
        AND se.event->>'type' = 'model.message'
        AND se.event->'model' IS NULL
    ) resolved
    WHERE e.session_id = resolved.session_id
      AND e.turn_id = resolved.turn_id
      AND e.event_id = resolved.event_id
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
    FROM (
      SELECT
        tu.session_id,
        tu.turn_id,
        COALESCE(
          (
            SELECT tc.event #>> '{agent_info,model}'
            FROM session_event tc
            WHERE tc.session_id = tu.session_id
              AND tc.event->>'type' = 'thread.created'
              AND tc.event->>'thread_id' = tu.state->'output'->>'thread_id'
            LIMIT 1
          ),
          s.agent_spec #>> '{model,name}',
          a.manifest #>> '{model,name}'
        ) AS model_name
      FROM turn tu
      JOIN session s
        ON s.session_id = tu.session_id
      LEFT JOIN agent a
        ON a.tenant_id = s.tenant_id
       AND a.id = s.agent_id
      WHERE s.last_turn_id IS NOT NULL
        AND tu.turn_id = s.last_turn_id
        AND tu.state->'output'->>'type' = 'model.message'
        AND tu.state->'output'->'model' IS NULL
    ) resolved
    WHERE t.session_id = resolved.session_id
      AND t.turn_id = resolved.turn_id
      AND resolved.model_name IS NOT NULL
  `.execute(db);
}

/** Data backfill — not reversed. */
export function down(db: Kysely<unknown>): Promise<void> {
  void db;
  return Promise.reject(new Error('20261009_000001_model_message_model_backfill is irreversible'));
}
