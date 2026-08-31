import { sql, type Kysely } from 'kysely';

/** Replace the legacy compaction token threshold with an input-token trigger. */
export async function up<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`
    UPDATE agent
    SET manifest = jsonb_set(
      manifest #- '{config,context_management,compaction,compaction_threshold_tokens}',
      '{config,context_management,compaction,trigger}',
      coalesce(
        manifest #> '{config,context_management,compaction,trigger}',
        jsonb_build_object(
          'type', 'input_tokens',
          'value', (manifest #>> '{config,context_management,compaction,compaction_threshold_tokens}')::numeric
        )
      )
    )
    WHERE manifest #>> '{config,context_management,compaction,compaction_threshold_tokens}' IS NOT NULL
  `.execute(db);
  await sql`
    UPDATE session
    SET agent_spec = jsonb_set(
      agent_spec #- '{config,context_management,compaction,compaction_threshold_tokens}',
      '{config,context_management,compaction,trigger}',
      coalesce(
        agent_spec #> '{config,context_management,compaction,trigger}',
        jsonb_build_object(
          'type', 'input_tokens',
          'value', (agent_spec #>> '{config,context_management,compaction,compaction_threshold_tokens}')::numeric
        )
      )
    )
    WHERE agent_spec #>> '{config,context_management,compaction,compaction_threshold_tokens}' IS NOT NULL
  `.execute(db);
}

/** Restore the legacy token threshold for rollback compatibility. */
export async function down<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`
    UPDATE agent
    SET manifest = jsonb_set(
      manifest #- '{config,context_management,compaction,trigger}',
      '{config,context_management,compaction,compaction_threshold_tokens}',
      to_jsonb((manifest #>> '{config,context_management,compaction,trigger,value}')::numeric)
    )
    WHERE manifest #>> '{config,context_management,compaction,trigger,type}' = 'input_tokens'
      AND manifest #>> '{config,context_management,compaction,trigger,value}' IS NOT NULL
  `.execute(db);
  await sql`
    UPDATE session
    SET agent_spec = jsonb_set(
      agent_spec #- '{config,context_management,compaction,trigger}',
      '{config,context_management,compaction,compaction_threshold_tokens}',
      to_jsonb((agent_spec #>> '{config,context_management,compaction,trigger,value}')::numeric)
    )
    WHERE agent_spec #>> '{config,context_management,compaction,trigger,type}' = 'input_tokens'
      AND agent_spec #>> '{config,context_management,compaction,trigger,value}' IS NOT NULL
  `.execute(db);
}
