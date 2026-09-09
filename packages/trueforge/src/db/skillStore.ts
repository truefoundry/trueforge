/**
 * DB-backed configured skills: one row per skill per tenant,
 * identity as columns plus a Zod-validated `SkillManifest` jsonb document.
 * Implementations: PostgresSkillStore and SqliteSkillStore.
 */
import type { SkillManifest, SkillVersion } from '../schemas/skill';

export interface SkillRecord {
  tenant_id: string;
  /**
   * Store identity: git ResourceName in standalone, registry version FQN in TrueFoundry.
   * Same string as AgentSpec `skills[].name`, list filters, and AvailableSkill `name`.
   */
  name: string;
  manifest: SkillManifest;
  /** ISO-8601 UTC instant. */
  created_at: string;
  /** ISO-8601 UTC instant. */
  updated_at: string;
}

export interface ListSkillsInput {
  tenant_id: string;
  /** `undefined` lists all; empty returns `[]` without querying; otherwise `WHERE name IN (...)`. */
  names: readonly string[] | undefined;
}

export interface CreateSkillInput {
  tenant_id: string;
  name: string;
  manifest: SkillManifest;
}

/** Same shape as create for now; kept as a distinct name for the upsert path. */
export type UpsertSkillInput = CreateSkillInput;

/** Unique `(tenant_id, name)` violation on create. */
export class SkillNameConflictError extends Error {
  readonly tenant_id: string;
  readonly skill_name: string;

  constructor({ tenant_id, name }: { tenant_id: string; name: string }, options?: ErrorOptions) {
    super(`Skill name already exists: ${name}`, options);
    this.name = 'SkillNameConflictError';
    this.tenant_id = tenant_id;
    this.skill_name = name;
  }
}

export interface ISkillStore<TTransaction = never> {
  listSkills(input: ListSkillsInput, transaction?: TTransaction): Promise<SkillRecord[]>;
  /** Inserts a new skill. Throws SkillNameConflictError on name clash. */
  createSkill(input: CreateSkillInput, transaction?: TTransaction): Promise<SkillRecord>;
  /** Single-row write: creates the skill or replaces the whole manifest. */
  upsertSkill(input: UpsertSkillInput, transaction?: TTransaction): Promise<SkillRecord>;
  listSkillVersions(input: { name: string }): Promise<SkillVersion[]>;
}
