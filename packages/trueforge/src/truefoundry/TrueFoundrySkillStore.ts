import type { Logger } from 'winston';
import type { RequestContext } from '../auth/identity';
import type { AgentRecord } from '../db/agentStore';
import type {
  CreateSkillInput,
  GetSkillInput,
  ISkillStore,
  ListSkillsInput,
  SkillRecord,
  UpsertSkillInput,
} from '../db/skillStore';
import type { RegistrySkillManifest, SkillVersion } from '../schemas/skill';
import { accessTokenForRequest, asTrueFoundryRequestContext, type ResolveAccessToken } from './accessToken';
import { trueFoundryManaged } from './errors';
import { mapSfyRegistrySkills, mapSfyRegistrySkillVersions, type SfyRegistrySkill } from './mapSfyAgentSkills';
import type { TrueFoundryServiceFoundryServerClient } from './TrueFoundryServiceFoundryServerClient';

export type TrueFoundrySkillApiClient = Pick<
  TrueFoundryServiceFoundryServerClient,
  'listAgentSkills' | 'listAgentSkillVersions' | 'vendToken'
>;

function toRegistryRecord(tenant_id: string, skill: SfyRegistrySkill): SkillRecord {
  const now = new Date().toISOString();
  const manifest: RegistrySkillManifest = {
    type: 'registry',
    name: skill.name,
    description: skill.description,
    fqn: skill.fqn,
    skill_repo_name: skill.skill_repo_name,
    version: skill.version,
  };
  return {
    tenant_id,
    name: skill.fqn,
    manifest,
    created_at: now,
    updated_at: now,
  };
}

/** Read-only TrueFoundry registry skill catalog; writes are managed by TrueFoundry.
 * Pass `agent` on turn/cron paths so catalog reads use the same vend token as models and MCP.
 */
export class TrueFoundrySkillStore<TTransaction = never> implements ISkillStore<TTransaction> {
  readonly #client: TrueFoundrySkillApiClient;
  readonly #resolveAccessToken: ResolveAccessToken;

  constructor(input: {
    client: TrueFoundrySkillApiClient;
    context: RequestContext;
    agent: AgentRecord | undefined;
    logger: Logger;
  }) {
    this.#client = input.client;
    this.#resolveAccessToken = accessTokenForRequest({
      client: input.client,
      context: asTrueFoundryRequestContext(input.context),
      agent: input.agent,
      logger: input.logger,
    });
  }

  async listSkills(input: ListSkillsInput, transaction?: TTransaction): Promise<SkillRecord[]> {
    void transaction;
    return (await this.#listRegistrySkills(input)).map(skill => toRegistryRecord(input.tenant_id, skill));
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
    return mapSfyRegistrySkillVersions(rows);
  }

  async #listRegistrySkills(input: ListSkillsInput): Promise<SfyRegistrySkill[]> {
    if (input.names?.length === 0) {
      return [];
    }
    const accessToken = await this.#resolveAccessToken();
    const skills = mapSfyRegistrySkills(await this.#client.listAgentSkills(accessToken));
    const names = input.names;
    return names === undefined ? skills : skills.filter(skill => names.includes(skill.fqn));
  }
}
