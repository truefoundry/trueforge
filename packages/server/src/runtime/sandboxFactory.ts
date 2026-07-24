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
import type { TurnSandboxFactory } from '@truefoundry/utils/agent-session';
import { createSandboxProvider, Sandbox, SandboxProviderSettingsSchema } from '@truefoundry/utils/core';
import type { Logger } from 'winston';
import { ZodError } from 'zod';
import { TENANT_NAME } from '../apis/sessions';
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
 * Builds the per-run sandbox factory from the environment, or undefined when
 * sandbox is not configured. Throws on any misconfiguration.
 */
export function createServerSandboxFactory(deps: { logger: Logger }): TurnSandboxFactory | undefined {
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
    tenantName: TENANT_NAME,
    fileMaxBytes: configuration.SANDBOX_FILE_MAX_BYTES,
    previewUrlExpirySeconds: configuration.SANDBOX_PREVIEW_URL_EXPIRY_SECONDS,
    logger,
  });

  // TODO(skills): wire public-server skill specs to an ISkillMounter (e.g. the git-based
  // SkillMounter). Until then, public-server sandbox sessions run without skills.
  return ({ spec, existingSandboxId, tracing }) =>
    Promise.resolve(
      new Sandbox({
        provider,
        existingSandboxId,
        fileDownloadEnabled: spec.config?.sandbox?.file_downloads ?? false,
        blockDestructiveToolsInCodeMode: true,
        // Sandbox reads its tenant from TFY_TENANT_NAME (see Sandbox constructor)
        // for the ownership check against provider-created sandbox ids
        // (`<tenant>.<uuid>`). Must match the tenantName given to the provider.
        execExtraEnv: { TFY_TENANT_NAME: TENANT_NAME },
        tracing,
        logger,
      }),
    );
}
