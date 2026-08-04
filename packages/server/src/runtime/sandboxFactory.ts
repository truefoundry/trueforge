/**
 * Boot-time sandbox provider from `SANDBOX_SETTINGS`, plus a shared Sandbox
 * builder that takes already-resolved git skill mounts (no skill store).
 *
 * Called from main.ts so a malformed SANDBOX_SETTINGS aborts startup instead
 * of failing mid-turn. Skill expansion stays in the DB turn resolvers.
 */
import {
  createSandboxProvider,
  Sandbox,
  SandboxProviderSettingsSchema,
  SkillMounter,
  type AgentTracing,
  type GitSkill,
  type SandboxProvider,
} from '@truefoundry/utils-core/core';
import type { Logger } from 'winston';
import { ZodError } from 'zod';
import { TENANT_ID } from '../apis/sessions';
import configuration from '../config';

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

/**
 * Builds a Sandbox for one turn from resolved git mounts. Callers expand
 * skills from ISkillStore before invoking this.
 */
export function buildTurnSandbox(input: {
  provider: SandboxProvider;
  logger: Logger;
  gitSkills: readonly GitSkill[];
  fileDownloadEnabled: boolean;
  existingSandboxId?: string | undefined;
  tracing: AgentTracing;
}): Sandbox {
  const skillMounter = input.gitSkills.length > 0 ? new SkillMounter([...input.gitSkills]) : undefined;
  return new Sandbox({
    provider: input.provider,
    existingSandboxId: input.existingSandboxId,
    fileDownloadEnabled: input.fileDownloadEnabled,
    blockDestructiveToolsInCodeMode: true,
    // Sandbox reads its tenant from TFY_TENANT_NAME (see Sandbox constructor)
    // for the ownership check against provider-created sandbox ids
    // (`<tenant>.<uuid>`). Must match the tenantName given to the provider.
    execExtraEnv: { TFY_TENANT_NAME: TENANT_ID },
    ...(skillMounter ? { skillMounter } : {}),
    tracing: input.tracing,
    logger: input.logger,
  });
}

/**
 * Builds the shared SandboxProvider, or undefined when sandbox is not configured.
 * Throws on any misconfiguration.
 */
export function createServerSandboxProvider(deps: { logger: Logger }): SandboxProvider | undefined {
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
  return createSandboxProvider({
    settings,
    tenantName: TENANT_ID,
    fileMaxBytes: configuration.SANDBOX_FILE_MAX_BYTES,
    previewUrlExpirySeconds: configuration.SANDBOX_PREVIEW_URL_EXPIRY_SECONDS,
    logger,
  });
}
