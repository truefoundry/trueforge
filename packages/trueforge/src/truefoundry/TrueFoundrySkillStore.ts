import type { Logger } from 'winston';
import type { RequestContext } from '../auth/identity';
import type { AgentRecord } from '../db/agentStore';
import type {
  CreateSkillInput,
  ISkillStore,
  ListSkillsInput,
  SkillRecord,
  UpsertSkillInput,
  ValidateSkillsAccessInput,
} from '../db/skillStore';
import type { SkillVersion, TrueFoundryRegistrySkill } from '../schemas/skill';
import { accessTokenForRequest, asTrueFoundryRequestContext, type ResolveAccessToken } from './accessToken';
import { trueFoundryManaged } from './errors';
import { mapSfyRegistrySkills, mapSfyRegistrySkillVersions, type SfyRegistrySkill } from './mapSfyAgentSkills';
import type { TrueFoundryServiceFoundryServerClient } from './TrueFoundryServiceFoundryServerClient';

export type TrueFoundrySkillApiClient = Pick<
  TrueFoundryServiceFoundryServerClient,
  'listAgentSkills' | 'listAgentSkillVersions' | 'resolveAgentSkillVersions' | 'vendToken'
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
    let skills = mapSfyRegistrySkills(await this.#client.listAgentSkills({ accessToken }));
    const names = input.names;
    if (names !== undefined) {
      // TrueFoundry callers do not pass names: catalog list is unfiltered; save checks use validateAccess.
      // SFY list has no multi-name IN (only optional skill-level fqn).
      // so filter locally if names is set.
      skills = skills.filter(skill => names.includes(skill.name));
    }
    return skills.map(skill => toRegistryRecord(input.tenant_id, skill));
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

  /** Check that each version FQN exists and is readable (SFY resolve; failures → 424). */
  async validateAccess(input: ValidateSkillsAccessInput, transaction?: TTransaction): Promise<string | undefined> {
    void input.tenant_id;
    void transaction;
    if (input.names.length === 0) {
      return undefined;
    }
    const accessToken = await this.#resolveAccessToken();
    const resolved = await this.#client.resolveAgentSkillVersions({
      accessToken,
      skills: input.names.map(fqn => ({ fqn })),
    });
    const known = new Set(resolved.map(skill => skill.fqn));
    return input.names.find(name => !known.has(name));
  }
}
