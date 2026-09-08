import type { RequestContext } from '../auth/identity';
import type {
  CreateSkillInput,
  GetSkillInput,
  ISkillStore,
  ListSkillsInput,
  SkillRecord,
  UpsertSkillInput,
} from '../db/skillStore';
import type { RegistrySkillManifest, SkillVersion } from '../schemas/skill';
import { callerAccessToken, type ResolveAccessToken } from './accessToken';
import { trueFoundryManaged } from './errors';
import { mapSfyAgentSkills, mapSfyAgentSkillVersions, type SfyAvailableSkill } from './mapSfyAgentSkills';
import type { TrueFoundryServiceFoundryServerClient } from './TrueFoundryServiceFoundryServerClient';

export type TrueFoundrySkillApiClient = Pick<
  TrueFoundryServiceFoundryServerClient,
  'listAgentSkills' | 'listAgentSkillVersions'
>;

function toRegistryRecord(tenant_id: string, skill: SfyAvailableSkill): SkillRecord {
  const now = new Date().toISOString();
  const manifest: RegistrySkillManifest = {
    type: 'registry',
    name: skill.name,
    description: skill.description,
    id: skill.id,
    fqn: skill.fqn,
    skill_repo_name: skill.skill_repo_name,
    version: skill.version,
  };
  return {
    tenant_id,
    name: skill.name,
    manifest,
    created_at: now,
    updated_at: now,
  };
}

/** Read-only SFY skill catalog; writes are managed by TrueFoundry. */
export class TrueFoundrySkillStore<TTransaction = never> implements ISkillStore<TTransaction> {
  readonly #client: TrueFoundrySkillApiClient;
  readonly #resolveAccessToken: ResolveAccessToken;

  constructor(input: { client: TrueFoundrySkillApiClient; context: RequestContext }) {
    this.#client = input.client;
    this.#resolveAccessToken = callerAccessToken(input.context);
  }

  async listSkills(input: ListSkillsInput, transaction?: TTransaction): Promise<SkillRecord[]> {
    void transaction;
    return (await this.#listAgentSkills(input)).map(skill => toRegistryRecord(input.tenant_id, skill));
  }

  async getSkill(input: GetSkillInput, transaction?: TTransaction): Promise<SkillRecord | undefined> {
    const records = await this.listSkills({ tenant_id: input.tenant_id, names: [input.name] }, transaction);
    return records[0];
  }

  createSkill(input: CreateSkillInput, transaction?: TTransaction): Promise<SkillRecord> {
    void input;
    void transaction;
    return trueFoundryManaged();
  }

  upsertSkill(input: UpsertSkillInput, transaction?: TTransaction): Promise<SkillRecord> {
    void input;
    void transaction;
    return trueFoundryManaged();
  }

  async listSkillVersions(input: { name: string }): Promise<SkillVersion[]> {
    const accessToken = await this.#resolveAccessToken();
    const rows = await this.#client.listAgentSkillVersions({
      accessToken,
      fqn: input.name,
    });
    return mapSfyAgentSkillVersions(rows);
  }

  async #listAgentSkills(input: ListSkillsInput): Promise<SfyAvailableSkill[]> {
    if (input.names?.length === 0) {
      return [];
    }
    const accessToken = await this.#resolveAccessToken();
    const skills = mapSfyAgentSkills(await this.#client.listAgentSkills(accessToken));
    const names = input.names;
    return names === undefined ? skills : skills.filter(skill => names.includes(skill.name));
  }
}
