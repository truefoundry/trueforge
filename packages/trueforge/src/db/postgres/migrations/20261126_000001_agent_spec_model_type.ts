import { sql, type Kysely, type RawBuilder } from 'kysely';

function typedModel({ column }: { column: 'manifest' | 'agent_spec' }): RawBuilder<unknown> {
  const spec = sql.id(column);
  return sql`CASE
    WHEN ${spec} #>> '{model,name}' = 'auto'
      THEN jsonb_build_object('type', 'auto', 'candidate_models', '[]'::jsonb)
    ELSE jsonb_build_object('type', 'fixed', 'name', ${spec} #>> '{model,name}')
      || CASE WHEN ${spec} -> 'model' ? 'params'
           THEN jsonb_build_object('params', ${spec} #> '{model,params}')
           ELSE '{}'::jsonb END
  END`;
}

/**
 * Agent specs name their model as `{ type: 'fixed', name, params? }` or `{ type: 'auto', candidate_models }`.
 * A named model becomes fixed. A model named `auto` (only inline sessions have one) becomes an auto model with no
 * candidates, which means the tenant's Auto models.
 * Saved agents live on `agent.manifest`; inline sessions live on `session.agent_spec`.
 */
export async function up<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);

  await sql`
    UPDATE agent
    SET manifest = jsonb_set(manifest, '{model}', ${typedModel({ column: 'manifest' })})
    WHERE NOT (manifest -> 'model' ? 'type')
  `.execute(db);

  await sql`
    UPDATE session
    SET agent_spec = jsonb_set(agent_spec, '{model}', ${typedModel({ column: 'agent_spec' })})
    WHERE agent_spec IS NOT NULL AND NOT (agent_spec -> 'model' ? 'type')
  `.execute(db);
}

/** Lossy for Auto: its candidates are dropped and the model name becomes `auto` again. */
export async function down<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);

  for (const [table, column] of [
    ['agent', 'manifest'],
    ['session', 'agent_spec'],
  ] as const) {
    const t = sql.id(table);
    const spec = sql.id(column);
    await sql`
      UPDATE ${t}
      SET ${spec} = jsonb_set(
        ${spec},
        '{model}',
        CASE
          WHEN ${spec} #>> '{model,type}' = 'auto' THEN jsonb_build_object('name', 'auto')
          ELSE jsonb_build_object('name', ${spec} #>> '{model,name}')
            || CASE WHEN ${spec} -> 'model' ? 'params'
                 THEN jsonb_build_object('params', ${spec} #> '{model,params}')
                 ELSE '{}'::jsonb END
        END
      )
      WHERE ${spec} -> 'model' ? 'type'
    `.execute(db);
  }
}
