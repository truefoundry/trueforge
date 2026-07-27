/**
 * Live app schema for the runtime Kysely client / future Postgres-backed store.
 * Migrations must not use this type — use `Kysely<unknown>` instead.
 */
// TODO: Replace with an interface whose keys are tables when the first table is added.
export type Database = Record<string, never>;
