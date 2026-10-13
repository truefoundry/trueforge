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
import type { SkillVersion } from '../schemas/skill';
import type { InlineSkills } from './inlineResources';

/**
 * Serves the skills a request brought with it, and delegates everything else.
 *
 * Mirrors {@link InlineMcpServerStore}: name-filtered list and validate/resolve are overlaid, an
 * unfiltered list passes through so request-scoped skills stay out of the tenant's settings, and
 * writes delegate because there is no row to write.
 */
export class InlineSkillStore<TTransaction = never> implements ISkillStore<TTransaction> {
  readonly #inner: ISkillStore<TTransaction>;
  readonly #inline: InlineSkills;

  constructor(input: { inner: ISkillStore<TTransaction>; inline: InlineSkills }) {
    this.#inner = input.inner;
    this.#inline = input.inline;
  }

  async listSkills(input: ListSkillsInput, transaction?: TTransaction): Promise<SkillRecord[]> {
    if (input.names === undefined) {
      return this.#inner.listSkills(input, transaction);
    }
    if (input.names.length === 0) {
      return [];
    }

    const inlineRecords = input.names
      .map(name => this.#toRecord({ tenant_id: input.tenant_id, name }))
      .filter((record): record is SkillRecord => record !== undefined);
    const registryNames = input.names.filter(name => this.#inline[name] === undefined);
    const registryRecords =
      registryNames.length > 0 ? await this.#inner.listSkills({ ...input, names: registryNames }, transaction) : [];

    return [...inlineRecords, ...registryRecords];
  }

  createSkill(input: CreateSkillInput, transaction?: TTransaction): Promise<SkillRecord> {
    return this.#inner.createSkill(input, transaction);
  }

  upsertSkill(input: UpsertSkillInput, transaction?: TTransaction): Promise<SkillRecord> {
    return this.#inner.upsertSkill(input, transaction);
  }

  deleteSkill(input: DeleteSkillInput, transaction?: TTransaction): Promise<boolean> {
    return this.#inner.deleteSkill(input, transaction);
  }

  listSkillVersions(input: { name: string }): Promise<SkillVersion[]> {
    if (this.#inline[input.name] !== undefined) {
      return Promise.resolve([]);
    }
    return this.#inner.listSkillVersions(input);
  }

  async validateAgentSkills(input: AgentSkillsInput, transaction?: TTransaction): Promise<void> {
    const { inlineSkills, registrySkills } = this.#partition(input.skills);
    if (inlineSkills.length > 0) {
      await validateGitAgentSkills(this, { tenant_id: input.tenant_id, skills: inlineSkills });
    }
    // Cross-source uniqueness needs registry short names from resolveTurnSkills; keep that out of
    // validate so mixed specs are not failed for API-key / presigned-URL requirements.
    if (registrySkills.length > 0) {
      await this.#inner.validateAgentSkills({ tenant_id: input.tenant_id, skills: registrySkills }, transaction);
    }
  }

  async resolveTurnSkills(input: AgentSkillsInput): Promise<SkillMount[]> {
    const { inlineSkills, registrySkills } = this.#partition(input.skills);
    const inlineMounts =
      inlineSkills.length > 0
        ? await resolveGitTurnSkills(this, { tenant_id: input.tenant_id, skills: inlineSkills })
        : [];
    const registryMounts =
      registrySkills.length > 0
        ? await this.#inner.resolveTurnSkills({ tenant_id: input.tenant_id, skills: registrySkills })
        : [];
    const mounts = [...inlineMounts, ...registryMounts];
    // Inline key and registry short name share the sandbox dir — reject collisions here.
    const seen = new Set<string>();
    for (const mount of mounts) {
      if (seen.has(mount.name)) {
        throw new HTTPException(422, {
          message: `Agent skills must have unique names; duplicate skill name(s): ${mount.name}`,
        });
      }
      seen.add(mount.name);
    }
    return mounts;
  }

  #partition(skills: AgentSkillsInput['skills']): {
    inlineSkills: AgentSkillsInput['skills'];
    registrySkills: AgentSkillsInput['skills'];
  } {
    const inlineSkills = skills.filter(skill => this.#inline[skill.name] !== undefined);
    const registrySkills = skills.filter(skill => this.#inline[skill.name] === undefined);
    return { inlineSkills, registrySkills };
  }

  #toRecord(input: { tenant_id: string; name: string }): SkillRecord | undefined {
    const manifest = this.#inline[input.name];
    if (manifest === undefined) {
      return undefined;
    }
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
