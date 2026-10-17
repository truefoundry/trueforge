import type { Skill as SkillMount } from '@truefoundry/trueforge-core/core';
import { HTTPException } from 'hono/http-exception';
import { resolveGitTurnSkills, validateGitAgentSkills } from '../db/gitSkillMounts';
import type {
  AgentSkillsInput,
  CreateSkillInput,
  DeleteSkillInput,
  ISkillStore,
  ListSkillsInput,
  SkillRecord,
  UpsertSkillInput,
} from '../db/skillStore';
import type { GitSkill, SkillVersion } from '../schemas/skill';
import type { InlineSkills } from './inlineResources';
import { X_TFG_SKILLS } from './inlineResources';

/**
 * Closed set of git skills from `x-tfg-skills`. Every requested name must be in the header map;
 * there is no registry fallthrough. Unfiltered lists stay empty so request-scoped skills never
 * appear in tenant settings. Writes are unsupported.
 */
export class InlineSkillStore<TTransaction = never> implements ISkillStore<TTransaction> {
  readonly #inline: InlineSkills;

  constructor(input: { inline: InlineSkills }) {
    this.#inline = input.inline;
  }

  listSkills(input: ListSkillsInput, _transaction?: TTransaction): Promise<SkillRecord[]> {
    void _transaction;
    if (input.names === undefined) {
      return Promise.resolve([]);
    }
    if (input.names.length === 0) {
      return Promise.resolve([]);
    }
    const names = input.names;
    // Reject via the Promise without `async` (require-await).
    return Promise.resolve().then(() => names.map(name => this.#toRecord({ tenant_id: input.tenant_id, name })));
  }

  createSkill(_input: CreateSkillInput, _transaction?: TTransaction): Promise<SkillRecord> {
    void _input;
    void _transaction;
    return unsupportedInlineSkillWrite();
  }

  upsertSkill(_input: UpsertSkillInput, _transaction?: TTransaction): Promise<SkillRecord> {
    void _input;
    void _transaction;
    return unsupportedInlineSkillWrite();
  }

  deleteSkill(_input: DeleteSkillInput, _transaction?: TTransaction): Promise<boolean> {
    void _input;
    void _transaction;
    return unsupportedInlineSkillWrite();
  }

  listSkillVersions(input: { name: string }): Promise<SkillVersion[]> {
    return Promise.resolve().then(() => {
      this.#require(input.name);
      return [];
    });
  }

  async validateAgentSkills(input: AgentSkillsInput, _transaction?: TTransaction): Promise<void> {
    void _transaction;
    this.#assertNamesInInline(input.skills.map(skill => skill.name));
    await validateGitAgentSkills(this, { tenant_id: input.tenant_id, skills: input.skills });
  }

  async resolveTurnSkills(input: AgentSkillsInput): Promise<SkillMount[]> {
    this.#assertNamesInInline(input.skills.map(skill => skill.name));
    return resolveGitTurnSkills(this, { tenant_id: input.tenant_id, skills: input.skills });
  }

  #assertNamesInInline(names: readonly string[]): void {
    for (const name of names) {
      this.#require(name);
    }
  }

  #require(name: string): GitSkill {
    const manifest = this.#inline[name];
    if (manifest === undefined) {
      throw new HTTPException(422, {
        message: `Unknown skill "${name}" — not present in ${X_TFG_SKILLS}`,
      });
    }
    return manifest;
  }

  #toRecord(input: { tenant_id: string; name: string }): SkillRecord {
    const manifest = this.#require(input.name);
    const now = new Date().toISOString();
    return {
      tenant_id: input.tenant_id,
      name: manifest.name,
      manifest,
      created_at: now,
      updated_at: now,
    };
  }
}

function unsupportedInlineSkillWrite(): Promise<never> {
  return Promise.reject(
    new HTTPException(400, { message: `Request-scoped skills from ${X_TFG_SKILLS} do not support writes` }),
  );
}
