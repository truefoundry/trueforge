import { type Kysely, sql } from 'kysely';

/**
 * Replace the legacy compaction token threshold with an input-token trigger.
 * Mirrors db/postgres/migrations/20260821_000001_agent_compaction.ts.
 */
export async function up<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await db.transaction().execute(async transaction => {
    await sql`
    UPDATE agent
    SET manifest = jsonb_set(
      jsonb_remove(manifest, '$.config.context_management.compaction.compaction_threshold_tokens'),
      '$.config.context_management.compaction.trigger',
      coalesce(
        jsonb_extract(manifest, '$.config.context_management.compaction.trigger'),
        jsonb(json_object(
          'type', 'input_tokens',
          'value', cast(
            json_extract(manifest, '$.config.context_management.compaction.compaction_threshold_tokens') AS INTEGER
          )
        ))
      )
    )
    WHERE json_extract(manifest, '$.config.context_management.compaction.compaction_threshold_tokens') IS NOT NULL
  `.execute(transaction);
    await sql`
    UPDATE session
    SET agent_spec = jsonb_set(
      jsonb_remove(agent_spec, '$.config.context_management.compaction.compaction_threshold_tokens'),
      '$.config.context_management.compaction.trigger',
      coalesce(
        jsonb_extract(agent_spec, '$.config.context_management.compaction.trigger'),
        jsonb(json_object(
          'type', 'input_tokens',
          'value', cast(
            json_extract(agent_spec, '$.config.context_management.compaction.compaction_threshold_tokens') AS INTEGER
          )
        ))
      )
    )
    WHERE json_extract(agent_spec, '$.config.context_management.compaction.compaction_threshold_tokens') IS NOT NULL
  `.execute(transaction);
  });
}

/** Restore the legacy token threshold for rollback compatibility. */
export async function down<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await db.transaction().execute(async transaction => {
    await sql`
    UPDATE agent
    SET manifest = jsonb_set(
      jsonb_remove(manifest, '$.config.context_management.compaction.trigger'),
      '$.config.context_management.compaction.compaction_threshold_tokens',
      cast(json_extract(manifest, '$.config.context_management.compaction.trigger.value') AS INTEGER)
    )
    WHERE json_extract(manifest, '$.config.context_management.compaction.trigger.type') = 'input_tokens'
      AND json_extract(manifest, '$.config.context_management.compaction.trigger.value') IS NOT NULL
  `.execute(transaction);
    await sql`
    UPDATE session
    SET agent_spec = jsonb_set(
      jsonb_remove(agent_spec, '$.config.context_management.compaction.trigger'),
      '$.config.context_management.compaction.compaction_threshold_tokens',
      cast(json_extract(agent_spec, '$.config.context_management.compaction.trigger.value') AS INTEGER)
    )
    WHERE json_extract(agent_spec, '$.config.context_management.compaction.trigger.type') = 'input_tokens'
      AND json_extract(agent_spec, '$.config.context_management.compaction.trigger.value') IS NOT NULL
  `.execute(transaction);
  });
}
