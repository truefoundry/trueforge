import { sql, type Kysely, type RawBuilder } from 'kysely';

function typedModel({
  table,
  column,
}: {
  table: 'agent' | 'session';
  column: 'manifest' | 'agent_spec';
}): RawBuilder<unknown> {
  const spec = sql.id(column);
  const adminList = sql`coalesce((
    SELECT json_extract(c.manifest, '$.auto_model_routing.candidate_models')
    FROM configuration c
    WHERE c.tenant_id = ${sql.id(table, 'tenant_id')}
      AND json_type(c.manifest, '$.auto_model_routing.candidate_models') = 'array'
  ), '[]')`;
  return sql`CASE
    WHEN json_extract(${spec}, '$.model.name') = 'auto'
      THEN json_object('type', 'auto', 'candidate_models', json(${adminList}))
    WHEN json_type(${spec}, '$.model.params') IS NOT NULL
      THEN json_object(
        'type', 'fixed',
        'name', json_extract(${spec}, '$.model.name'),
        'params', json(json_extract(${spec}, '$.model.params'))
      )
    ELSE json_object('type', 'fixed', 'name', json_extract(${spec}, '$.model.name'))
  END`;
}

/**
 * Mirrors db/postgres/migrations/20261126_000001_agent_spec_model_type.ts.
 * A named model becomes fixed. Auto copies `candidate_models` from the tenant's configuration.
 * Saved agents live on `agent.manifest`; inline sessions live on `session.agent_spec`.
 */
export async function up<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`
      UPDATE agent
      SET manifest = jsonb_set(manifest, '$.model', jsonb(${typedModel({ table: 'agent', column: 'manifest' })}))
      WHERE json_type(manifest, '$.model.type') IS NULL
    `.execute(trx);

    await sql`
      UPDATE session
      SET agent_spec = jsonb_set(agent_spec, '$.model', jsonb(${typedModel({ table: 'session', column: 'agent_spec' })}))
      WHERE agent_spec IS NOT NULL AND json_type(agent_spec, '$.model.type') IS NULL
    `.execute(trx);
  });
}

/** Lossy for Auto: its candidates are dropped and the model name becomes `auto` again. */
export async function down<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await db.transaction().execute(async trx => {
    for (const [table, column] of [
      ['agent', 'manifest'],
      ['session', 'agent_spec'],
    ] as const) {
      const spec = sql.id(column);
      await sql`
        UPDATE ${sql.id(table)}
        SET ${spec} = jsonb_set(
          ${spec},
          '$.model',
          jsonb(CASE
            WHEN json_extract(${spec}, '$.model.type') = 'auto' THEN json_object('name', 'auto')
            WHEN json_type(${spec}, '$.model.params') IS NOT NULL
              THEN json_object(
                'name', json_extract(${spec}, '$.model.name'),
                'params', json(json_extract(${spec}, '$.model.params'))
              )
            ELSE json_object('name', json_extract(${spec}, '$.model.name'))
          END)
        )
        WHERE json_type(${spec}, '$.model.type') IS NOT NULL
      `.execute(trx);
    }
  });
}
