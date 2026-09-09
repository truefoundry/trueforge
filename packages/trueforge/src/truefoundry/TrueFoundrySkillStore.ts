import type { Logger } from 'winston';
import type { RequestContext } from '../auth/identity';
import type { AgentRecord } from '../db/agentStore';
import type { CreateSkillInput, ISkillStore, ListSkillsInput, SkillRecord, UpsertSkillInput } from '../db/skillStore';
import type { SkillVersion, TrueFoundryRegistrySkill } from '../schemas/skill';
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
  const manifest: TrueFoundryRegistrySkill = {
    type: 'truefoundry',
    name: skill.name,
    display_name: skill.display_name,
    description: skill.description,
    repository_name: skill.repository_name,
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
    if (input.names?.length === 0) {
      return [];
    }
    const accessToken = await this.#resolveAccessToken();
    const skills = mapSfyRegistrySkills(await this.#client.listAgentSkills({ accessToken }));
    const names = input.names;
    // SFY list accepts at most one skill-level `fqn` (no multi-name IN, no version FQN), so filter locally.
    // TODO: Add a support for multi-name/fqn IN filter in SFY ServiceFoundryServerClient.
    const filtered = names === undefined ? skills : skills.filter(skill => names.includes(skill.name));
    return filtered.map(skill => toRegistryRecord(input.tenant_id, skill));
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
}
