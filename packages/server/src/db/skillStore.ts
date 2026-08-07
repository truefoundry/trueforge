/**
 * DB-backed configured skills: one row per skill per tenant,
 * identity as columns plus a Zod-validated `SkillManifest` jsonb document.
 * Implementations: PostgresSkillStore and SqliteSkillStore.
 */
import type { ResourceName } from '../schemas/common';
import type { SkillManifest } from '../schemas/skill';

export interface SkillRecord {
  tenant_id: string;
  name: ResourceName;
  manifest: SkillManifest;
  /** ISO-8601 UTC instant. */
  created_at: string;
  /** ISO-8601 UTC instant. */
  updated_at: string;
}

export interface GetSkillInput {
  tenant_id: string;
  name: string;
}

export interface ListSkillsInput {
  tenant_id: string;
  /** `undefined` lists all; empty returns `[]` without querying; otherwise `WHERE name IN (...)`. */
  names: readonly string[] | undefined;
}

export interface UpsertSkillInput {
  tenant_id: string;
  name: ResourceName;
  manifest: SkillManifest;
}

export interface ISkillStore<TTransaction = never> {
  listSkills(input: ListSkillsInput, transaction?: TTransaction): Promise<SkillRecord[]>;
  getSkill(input: GetSkillInput, transaction?: TTransaction): Promise<SkillRecord | undefined>;
  /** Single-row write: creates the skill or replaces the whole manifest. */
  upsertSkill(input: UpsertSkillInput, transaction?: TTransaction): Promise<SkillRecord>;
}
