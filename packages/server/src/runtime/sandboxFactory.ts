/**
 * Boot-time sandbox composition: parses `SANDBOX_SETTINGS` into the harness's
 * provider-settings union, builds the provider once, and returns the per-run
 * {@link TurnSandboxFactory} handed to TurnResourceResolver. Returns undefined
 * when the server has no sandbox configuration — admission then rejects specs
 * with `config.sandbox.enabled`.
 *
 * Called from main.ts so a malformed SANDBOX_SETTINGS aborts startup instead
 * of failing mid-turn.
 */
import type { SkillMount, TurnSandboxFactory } from '@truefoundry/utils/agent-session';
import {
  createSandboxProvider,
  Sandbox,
  SandboxProviderSettingsSchema,
  SkillMounter,
  type SandboxProvider,
} from '@truefoundry/utils/core';
import type { Logger } from 'winston';
import { ZodError } from 'zod';
import { TENANT_ID } from '../apis/sessions';
import configuration from '../config';
import type { ISkillStore } from '../db/skillStore';
import { resolveDbGitSkills } from './dbSessionResources';

function parseSandboxSettings(rawJson: string) {
  let raw: unknown;
  try {
    raw = JSON.parse(rawJson);
  } catch (error) {
    throw new Error(
      `Environment variable SANDBOX_SETTINGS must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  // SANDBOX_API_KEY overrides an inline `apiKey` so the credential can stay out
  // of the settings blob (mirrors the gateway's SANDBOX_API_KEY + SANDBOX_SETTINGS split).
  const merged =
    typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      ? { ...raw, ...(configuration.SANDBOX_API_KEY !== undefined ? { apiKey: configuration.SANDBOX_API_KEY } : {}) }
      : raw;
  try {
    return SandboxProviderSettingsSchema.parse(merged);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new Error(`Environment variable SANDBOX_SETTINGS is invalid: ${error.message}`, { cause: error });
    }
    throw error;
  }
}

function isGitSkillMount(skill: { name: string }): skill is SkillMount {
  return 'type' in skill && skill.type === 'git' && 'url' in skill && 'description' in skill;
}

function createTurnSandboxFactory(deps: {
  provider: SandboxProvider;
  logger: Logger;
  skillStore?: ISkillStore | undefined;
}): TurnSandboxFactory {
  const { provider, logger, skillStore } = deps;
  return async ({ spec, existingSandboxId, tracing }) => {
    const skills = spec.skills ?? [];
    const gitSkills =
      skillStore !== undefined
        ? await resolveDbGitSkills({ tenant_id: TENANT_ID, skills, store: skillStore })
        : skills.map(skill => {
            if (!isGitSkillMount(skill)) {
              throw new Error(
                `Skill "${skill.name}" must be a full git mount on the legacy sessions path (type, url, description, ref)`,
              );
            }
            return {
              name: skill.name,
              description: skill.description,
              url: skill.url,
              path: skill.path ?? '',
              ref: skill.ref,
            };
          });
    const skillMounter = gitSkills.length > 0 ? new SkillMounter(gitSkills) : undefined;
    return new Sandbox({
      provider,
      existingSandboxId,
      fileDownloadEnabled: spec.config?.sandbox?.file_downloads ?? false,
      blockDestructiveToolsInCodeMode: true,
      // Sandbox reads its tenant from TFY_TENANT_NAME (see Sandbox constructor)
      // for the ownership check against provider-created sandbox ids
      // (`<tenant>.<uuid>`). Must match the tenantName given to the provider.
      execExtraEnv: { TFY_TENANT_NAME: TENANT_ID },
      ...(skillMounter ? { skillMounter } : {}),
      tracing,
      logger,
    });
  };
}

export interface ServerSandboxFactories {
  /** Legacy YAML sessions: skill mounts taken from inline agent_spec. */
  sandboxFactory: TurnSandboxFactory;
  /** DB sessions: skill mounts expanded from ISkillStore by name. */
  dbSandboxFactory: TurnSandboxFactory;
}

/**
 * Builds legacy + DB per-run sandbox factories sharing one provider, or
 * undefined when sandbox is not configured. Throws on any misconfiguration.
 */
export function createServerSandboxFactories(deps: {
  logger: Logger;
  skillStore: ISkillStore;
}): ServerSandboxFactories | undefined {
  if (configuration.SANDBOX_SETTINGS === undefined) {
    if (configuration.SANDBOX_API_KEY !== undefined) {
      throw new Error(
        'SANDBOX_API_KEY is set but SANDBOX_SETTINGS is missing. ' +
          'Set SANDBOX_SETTINGS (e.g. {"type":"daytona","snapshotName":"..."}) or unset SANDBOX_API_KEY.',
      );
    }
    return undefined;
  }

  const settings = parseSandboxSettings(configuration.SANDBOX_SETTINGS);
  const logger = deps.logger.child({ module: 'sandboxFactory' });
  const provider = createSandboxProvider({
    settings,
    tenantName: TENANT_ID,
    fileMaxBytes: configuration.SANDBOX_FILE_MAX_BYTES,
    previewUrlExpirySeconds: configuration.SANDBOX_PREVIEW_URL_EXPIRY_SECONDS,
    logger,
  });

  return {
    sandboxFactory: createTurnSandboxFactory({ provider, logger }),
    dbSandboxFactory: createTurnSandboxFactory({ provider, logger, skillStore: deps.skillStore }),
  };
}
