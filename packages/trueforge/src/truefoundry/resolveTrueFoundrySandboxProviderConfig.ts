import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import configuration, { type ServerConfiguration } from '../config';
import { KubernetesSandboxResourcesSchema } from '../schemas/sandboxProvider';

export const SANDBOX_DEFAULT_SETTINGS = {
  timeoutMs: 60_000,
  autoStopIntervalInMinutes: 5,
  autoArchiveIntervalInMinutes: 60,
  autoDeleteIntervalInMinutes: 43_200,
} as const;

/** Daytona settings JSON in `TRUEFOUNDRY_SANDBOX_SETTINGS`*/
export const DaytonaSandboxSettingsSchema = z.object({
  snapshotName: z.string().min(1, 'snapshotName is required'),
  autoStopIntervalInMinutes: z.number().default(SANDBOX_DEFAULT_SETTINGS.autoStopIntervalInMinutes),
  autoArchiveIntervalInMinutes: z.number().default(SANDBOX_DEFAULT_SETTINGS.autoArchiveIntervalInMinutes),
  autoDeleteIntervalInMinutes: z.number().default(SANDBOX_DEFAULT_SETTINGS.autoDeleteIntervalInMinutes),
  timeoutMs: z.number().default(SANDBOX_DEFAULT_SETTINGS.timeoutMs),
});

export type DaytonaSandboxSettings = z.infer<typeof DaytonaSandboxSettingsSchema>;

/** TrueFoundry on-prem settings JSON in `TRUEFOUNDRY_SANDBOX_SETTINGS`. */
export const TrueFoundrySandboxSettingsSchema = z.object({
  nats_bridge_url: z.string().min(1, 'nats_bridge_url is required'),
});

export type TrueFoundrySandboxSettings = z.infer<typeof TrueFoundrySandboxSettingsSchema>;

export const KubernetesSandboxSettingsSchema = z
  .object({
    resources: KubernetesSandboxResourcesSchema.optional(),
  })
  .strict();

export type KubernetesSandboxSettings = z.infer<typeof KubernetesSandboxSettingsSchema>;

/**
 * Shared sandbox provider selected by env in TrueFoundry mode.
 * Settings come from static `TRUEFOUNDRY_SANDBOX_SETTINGS` JSON.
 */
export type TrueFoundrySandboxProviderConfig =
  | { type: 'daytona'; apiKey: string; settings: DaytonaSandboxSettings }
  | { type: 'truefoundry'; serverUrl: string; natsBridgeUrl: string }
  | {
      type: 'kubernetes';
      namespace: string;
      serviceAccountName: string | undefined;
      imagePullSecretName: string | undefined;
      resources: KubernetesSandboxSettings['resources'];
      execTimeoutMs: number;
      pollIntervalMs: number;
      createTimeoutMs: number;
      inCluster: boolean;
    };

function parseSettingsJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error('TRUEFOUNDRY_SANDBOX_SETTINGS must be valid JSON', { cause: error });
  }
}

/**
 * Returns the configured shared sandbox provider when enabled, or undefined when disabled.
 * Must only be called outside standalone (TrueFoundry wiring).
 */
export function resolveTrueFoundrySandboxProviderConfig(
  config: ServerConfiguration = configuration,
): TrueFoundrySandboxProviderConfig | undefined {
  if (config.STANDALONE) {
    throw new HTTPException(500, {
      message: 'TrueFoundry sandbox provider config is not available in standalone mode',
    });
  }
  if (!config.TRUEFOUNDRY_SANDBOX_ENABLED) {
    return undefined;
  }
  if (config.TRUEFOUNDRY_SANDBOX_PROVIDER !== undefined) {
    const settingsJson = parseSettingsJson(config.TRUEFOUNDRY_SANDBOX_SETTINGS ?? '{}');
    switch (config.TRUEFOUNDRY_SANDBOX_PROVIDER) {
      case 'daytona': {
        if (config.TRUEFOUNDRY_SANDBOX_API_KEY === undefined) {
          throw new Error('TRUEFOUNDRY_SANDBOX_API_KEY is required when TRUEFOUNDRY_SANDBOX_PROVIDER is daytona');
        }
        return {
          type: 'daytona',
          apiKey: config.TRUEFOUNDRY_SANDBOX_API_KEY,
          settings: DaytonaSandboxSettingsSchema.parse(settingsJson),
        };
      }
      case 'truefoundry': {
        if (config.TRUEFOUNDRY_SANDBOX_SERVER_URL === undefined) {
          throw new Error(
            'TRUEFOUNDRY_SANDBOX_SERVER_URL is required when TRUEFOUNDRY_SANDBOX_PROVIDER is truefoundry',
          );
        }
        const settings = TrueFoundrySandboxSettingsSchema.parse(settingsJson);
        return {
          type: 'truefoundry',
          serverUrl: config.TRUEFOUNDRY_SANDBOX_SERVER_URL,
          natsBridgeUrl: settings.nats_bridge_url,
        };
      }
      case 'kubernetes': {
        const settings = KubernetesSandboxSettingsSchema.parse(settingsJson);
        const resources = config.KUBERNETES_SANDBOX_RESOURCES;
        let envResources: KubernetesSandboxSettings['resources'];
        if (resources !== undefined) {
          try {
            envResources = KubernetesSandboxSettingsSchema.parse({ resources: parseSettingsJson(resources) }).resources;
          } catch (error) {
            throw new Error('KUBERNETES_SANDBOX_RESOURCES must be valid JSON resource settings', { cause: error });
          }
        }
        return {
          type: 'kubernetes',
          namespace: config.KUBERNETES_SANDBOX_NAMESPACE,
          serviceAccountName: config.KUBERNETES_SANDBOX_SERVICE_ACCOUNT_NAME,
          imagePullSecretName: config.KUBERNETES_SANDBOX_IMAGE_PULL_SECRET_NAME,
          resources: envResources ?? settings.resources,
          execTimeoutMs: config.KUBERNETES_SANDBOX_EXEC_TIMEOUT_MS,
          pollIntervalMs: config.KUBERNETES_SANDBOX_POLL_INTERVAL_MS,
          createTimeoutMs: config.KUBERNETES_SANDBOX_CREATE_TIMEOUT_MS,
          inCluster: config.KUBERNETES_SANDBOX_IN_CLUSTER,
        };
      }
    }
  }
  return undefined;
}
