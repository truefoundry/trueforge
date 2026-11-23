import { sql, type Kysely } from 'kysely';

/** Drop artifact.slug and its (tenant_id, slug) unique constraint; artifacts are addressed by id. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`ALTER TABLE artifact DROP CONSTRAINT IF EXISTS artifact_tenant_slug_uq`.execute(db);
  await sql`ALTER TABLE artifact DROP COLUMN IF EXISTS slug`.execute(db);
}

/** Original slugs are not recoverable; the id is unique, so it backfills the restored constraint. */
export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`ALTER TABLE artifact ADD COLUMN slug text`.execute(db);
  await sql`UPDATE artifact SET slug = id`.execute(db);
  await sql`ALTER TABLE artifact ALTER COLUMN slug SET NOT NULL`.execute(db);
  await sql`ALTER TABLE artifact ADD CONSTRAINT artifact_tenant_slug_uq UNIQUE (tenant_id, slug)`.execute(db);
}
