import { sql, type Kysely } from 'kysely';

/**
 * Backfill `model` on model.message session events and turn state.output from
 * the session agent model FQN (`provider/model`) as `{ name: fqn }`.
 */
export async function up<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);

  await sql`
    UPDATE session_event e
    SET event = jsonb_set(
      e.event,
      '{model}',
      jsonb_build_object('name', m.model_name),
      true
    )
    FROM session s
    LEFT JOIN agent a
      ON a.tenant_id = s.tenant_id
     AND a.id = s.agent_id
    CROSS JOIN LATERAL (
      SELECT COALESCE(s.agent_spec #>> '{model,name}', a.manifest #>> '{model,name}') AS model_name
    ) m
    WHERE e.session_id = s.session_id
      AND e.event->>'type' = 'model.message'
      AND e.event->'model' IS NULL
      AND m.model_name IS NOT NULL
  `.execute(db);

  await sql`
    UPDATE turn t
    SET state = jsonb_set(
      t.state,
      '{output,model}',
      jsonb_build_object('name', m.model_name),
      true
    )
    FROM session s
    LEFT JOIN agent a
      ON a.tenant_id = s.tenant_id
     AND a.id = s.agent_id
    CROSS JOIN LATERAL (
      SELECT COALESCE(s.agent_spec #>> '{model,name}', a.manifest #>> '{model,name}') AS model_name
    ) m
    WHERE t.session_id = s.session_id
      AND t.state->'output'->>'type' = 'model.message'
      AND t.state->'output'->'model' IS NULL
      AND m.model_name IS NOT NULL
  `.execute(db);
}

/** Data backfill — not reversed. */
export async function down<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
}
