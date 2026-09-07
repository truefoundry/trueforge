import { sql, type Kysely } from 'kysely';
import { SESSION_METADATA_GIN } from '../../indexes';

/** GIN index for list-sessions metadata containment (`metadata @> …`). */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`
    CREATE INDEX ${sql.raw(SESSION_METADATA_GIN)}
      ON session
      USING GIN (metadata jsonb_path_ops)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`DROP INDEX IF EXISTS ${sql.raw(SESSION_METADATA_GIN)}`.execute(db);
}
