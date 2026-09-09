import type { Skill as SkillMount } from '@truefoundry/trueforge-core/core';
import { HTTPException } from 'hono/http-exception';
import type { Logger } from 'winston';
import type { RequestContext } from '../auth/identity';
import type { AgentRecord } from '../db/agentStore';
import type {
  AgentSkillsInput,
  CreateSkillInput,
  ISkillStore,
  ListSkillsInput,
  SkillRecord,
  UpsertSkillInput,
} from '../db/skillStore';
import type { RegistrySkill, SkillVersion } from '../schemas/skill';
import { accessTokenForRequest, asTrueFoundryRequestContext, type ResolveAccessToken } from './accessToken';
import { trueFoundryManaged } from './errors';
import { mapSfyRegistrySkills, mapSfyRegistrySkillVersions, type SfyRegistrySkill } from './mapSfyAgentSkills';
import type { TrueFoundryServiceFoundryServerClient } from './TrueFoundryServiceFoundryServerClient';

export type TrueFoundrySkillApiClient = Pick<
  TrueFoundryServiceFoundryServerClient,
  'listAgentSkills' | 'listAgentSkillVersions' | 'vendToken' | 'resolveAgentSkillVersions' | 'apiKey'
>;

function toRegistryRecord(tenant_id: string, skill: SfyRegistrySkill): SkillRecord {
  const now = new Date().toISOString();
  const manifest: RegistrySkill = {
    type: 'registry',
    name: skill.name,
    display_name: skill.display_name,
    description: skill.description,
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

/** Read-only TrueFoundry registry skill catalog; writes are managed by TrueFoundry.
 * Pass `agent` on turn/cron paths so catalog reads use the same vend token as models and MCP.
 * Save validate uses the caller JWT; turn mounts pass the service API key.
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

  async validateAgentSkills(input: AgentSkillsInput): Promise<void> {
    const { skills } = input;
    if (skills.length === 0) {
      return;
    }

    const seenFqns = new Set<string>();
    for (const skill of skills) {
      if (seenFqns.has(skill.name)) {
        throw new HTTPException(422, {
          message: `Duplicate skill FQN "${skill.name}"`,
        });
      }
      seenFqns.add(skill.name);
    }

    const accessToken = await this.#resolveAccessToken();
    const resolved = await this.#client.resolveAgentSkillVersions({
      accessToken,
      skills: skills.map(skill => ({ fqn: skill.name })),
    });

    const byFqn = new Map(resolved.map(row => [row.fqn, row]));
    for (const skill of skills) {
      if (!byFqn.has(skill.name)) {
        throw new HTTPException(422, {
          message: `Unknown skill "${skill.name}" — not configured`,
        });
      }
    }

    const seenNames = new Set<string>();
    for (const row of resolved) {
      if (seenNames.has(row.name)) {
        throw new HTTPException(422, {
          message: `Agent skills must have unique names; duplicate skill name(s): ${row.name}`,
        });
      }
      seenNames.add(row.name);
    }
  }

  async resolveTurnSkills(input: AgentSkillsInput): Promise<SkillMount[]> {
    const { skills } = input;
    if (skills.length === 0) {
      return [];
    }

    // Runtime resolve uses the service API key, not the caller token.
    const resolved = await this.#client.resolveAgentSkillVersions({
      accessToken: this.#client.apiKey,
      skills: skills.map(skill => ({
        fqn: skill.name,
        include_skill_md_content: skill.preload,
        include_presigned_url: true,
      })),
    });

    const byFqn = new Map(resolved.map(row => [row.fqn, row]));
    return skills.map(skill => {
      const row = byFqn.get(skill.name);
      if (row === undefined) {
        throw new HTTPException(422, {
          message: `Unknown skill "${skill.name}" — not configured`,
        });
      }
      if (row.presigned_url === undefined) {
        throw new HTTPException(422, {
          message: `Skill "${skill.name}" did not return a presigned URL`,
        });
      }
      const skillMdContent = skill.preload ? (row.skill_md_content ?? null) : null;
      if (skill.preload && (skillMdContent === null || skillMdContent.length === 0)) {
        throw new HTTPException(422, {
          message: `Skill "${skill.name}" did not return SKILL.md for preload`,
        });
      }
      return {
        type: 'registry' as const,
        name: row.name,
        description: row.description,
        fqn: row.fqn,
        preload: skill.preload,
        skillMdContent,
        presignedUrl: row.presigned_url,
      };
    });
  }

  async #listRegistrySkills(input: ListSkillsInput): Promise<SfyRegistrySkill[]> {
    if (input.names?.length === 0) {
      return [];
    }
    const accessToken = await this.#resolveAccessToken();
    const skills = mapSfyRegistrySkills(await this.#client.listAgentSkills(accessToken));
    const names = input.names;
    return names === undefined ? skills : skills.filter(skill => names.includes(skill.name));
  }
}
