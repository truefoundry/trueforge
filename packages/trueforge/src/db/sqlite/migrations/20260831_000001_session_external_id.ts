import { type Kysely, sql } from 'kysely';
import { SESSION_EXTERNAL_ID_UQ } from '../../indexes';

/**
 * Optional session `external_id`, unique within a tenant when set.
 * NULLs are excluded so sessions without an external id do not collide.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`ALTER TABLE session ADD COLUMN external_id TEXT`.execute(trx);
    await sql`
      CREATE UNIQUE INDEX ${sql.raw(SESSION_EXTERNAL_ID_UQ)}
        ON session (tenant_id, external_id)
        WHERE external_id IS NOT NULL
    `.execute(trx);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`DROP INDEX IF EXISTS ${sql.raw(SESSION_EXTERNAL_ID_UQ)}`.execute(trx);
    await sql`ALTER TABLE session DROP COLUMN external_id`.execute(trx);
  });
}
