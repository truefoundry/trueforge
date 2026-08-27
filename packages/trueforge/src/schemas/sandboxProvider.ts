/**
 * Sandbox-provider domain + wire schemas: configured provider jsonb and OpenAPI
 * request/response shapes. Catalog file schemas live in sandboxCatalog.ts.
 *
 * Singleton per tenant — no identity `name` (unlike model providers / skills).
 */
import { z } from '@hono/zod-openapi';
import type { DaytonaSandboxProviderOptions } from '@truefoundry/trueforge-core/core';

const DaytonaSandboxProviderAuthSchema = z
  .object({
    api_key: z
      .string()
      .min(1)
      .describe(
        'Daytona API key. Responses are redacted; on PUT, a real value sets/rotates and a redacted value keeps the stored key.',
      ),
  })
  .strict()
  .describe('Daytona authentication credentials.')
  .openapi('DaytonaSandboxProviderAuth');

/**
 * Daytona-backed sandbox provider config. Persisted as `sandbox_provider.manifest`.
 * Named for OpenAPI because `SandboxProviderManifest` is now a discriminated union
 * and each variant needs its own emitted component.
 */
export const DaytonaSandboxProviderSchema = z
  .object({
    type: z.literal('daytona').describe('Daytona sandbox provider.'),
    auth: DaytonaSandboxProviderAuthSchema,
    exec_timeout_ms: z.number().int().positive().describe('Default sandbox command exec timeout in milliseconds.'),
    auto_stop_interval_in_minutes: z
      .number()
      .int()
      .nonnegative()
      .describe('Minutes of idle time before Daytona auto-stops the sandbox (0 disables).'),
    auto_archive_interval_in_minutes: z
      .number()
      .int()
      .nonnegative()
      .describe('Minutes before Daytona auto-archives the sandbox (0 disables).'),
    auto_delete_interval_in_minutes: z
      .number()
      .int()
      .nonnegative()
      .describe('Minutes before Daytona auto-deletes the sandbox (0 disables).'),
  })
  .strict()
  .openapi('DaytonaSandboxProvider');

/**
 * Container-backed sandbox provider config. Unlike Daytona there are no
 * credentials: the runtime is a local socket, so authorization is whatever the
 * host grants the server process.
 *
 * A GPU is opt-in. Attaching one to a sandbox that does not need it wastes a
 * scarce device and slows container start, so the default is no GPU.
 */
export const DockerSandboxProviderSchema = z
  .object({
    type: z.literal('docker').describe('Container-backed sandbox provider (Docker or Podman).'),
    image: z.string().min(1).describe('Image the sandbox runs. Must provide a POSIX shell and python3.'),
    exec_timeout_ms: z.number().int().positive().describe('Default sandbox command exec timeout in milliseconds.'),
    docker_binary: z
      .string()
      .min(1)
      .optional()
      .describe('Container CLI to invoke. Defaults to `docker`; set to `podman` or an absolute path.'),
    gpus: z.string().min(1).optional().describe('Value passed to `--gpus`, e.g. `all` or `device=0`. Omit for no GPU.'),
    extra_run_args: z
      .array(z.string())
      .optional()
      .describe(
        'Additional `docker run` arguments, e.g. a read-only host mount of a CUDA toolkit so the image can stay small. Never passed through a shell.',
      ),
  })
  .strict()
  .openapi('DockerSandboxProvider');

/**
 * Persisted jsonb: the provider config only (no build status). Discriminated on
 * `type`; every variant is emitted as its own OpenAPI component.
 */
export const SandboxProviderManifestSchema = z
  .discriminatedUnion('type', [DaytonaSandboxProviderSchema, DockerSandboxProviderSchema])
  .openapi('SandboxProviderManifest');

/** Named enum so the generated SDK exposes a reusable `SandboxBuildStatus` type. */
export const SandboxBuildStatusSchema = z
  .enum(['pending', 'ready', 'failed'])
  .describe('Current build status.')
  .openapi('SandboxBuildStatus');

/** Provider-specific opaque build metadata (string map), persisted alongside the status — not on the wire. */
export const SandboxBuildMetadataSchema = z
  .record(z.string(), z.string())
  .describe('Provider-specific build metadata (opaque string map).');

/** Build status persisted and refreshed on read (includes opaque metadata for the provider). */
export const SandboxStatusSchema = z
  .object({
    status: SandboxBuildStatusSchema,
    status_reason: z.string().nullable().describe('Human-readable detail for the current status; null when ready.'),
    build_metadata: SandboxBuildMetadataSchema.nullable().describe(
      'Provider-specific build metadata; null when the provider has none.',
    ),
  })
  .strict();

/** Settings wire item: nested manifest plus build status (no build_metadata). */
export const ConfiguredSandboxProviderSchema = z
  .object({
    manifest: SandboxProviderManifestSchema,
    status: SandboxBuildStatusSchema,
    status_reason: z.string().nullable().describe('Human-readable detail for the current status; null when ready.'),
  })
  .strict()
  .openapi('ConfiguredSandboxProvider');

export const UpdateSandboxProviderRequestSchema = z
  .object({
    manifest: SandboxProviderManifestSchema,
  })
  .strict()
  .openapi('UpdateSandboxProviderRequest');

export const GetSandboxProviderResponseSchema = z
  .object({
    data: ConfiguredSandboxProviderSchema,
  })
  .openapi('GetSandboxProviderResponse');

/** Persisted jsonb — the provider config only (no build status). */
export type SandboxProviderManifest = z.infer<typeof SandboxProviderManifestSchema>;
export type DaytonaSandboxProvider = z.infer<typeof DaytonaSandboxProviderSchema>;
export type DockerSandboxProvider = z.infer<typeof DockerSandboxProviderSchema>;
export type SandboxBuildStatus = z.infer<typeof SandboxBuildStatusSchema>;
export type SandboxBuildMetadata = z.infer<typeof SandboxBuildMetadataSchema>;
export type SandboxStatus = z.infer<typeof SandboxStatusSchema>;
export type ConfiguredSandboxProvider = z.infer<typeof ConfiguredSandboxProviderSchema>;
export type UpdateSandboxProviderRequest = z.infer<typeof UpdateSandboxProviderRequestSchema>;

/**
 * Wire/persisted snake_case → Daytona client credentials + provider settings.
 * Takes the narrowed variant, not the union: the caller has already discriminated
 * on `type`, and accepting the union here would push an unchecked cast inward.
 */
export function toDaytonaSandboxProviderInput(manifest: DaytonaSandboxProvider): {
  apiKey: string;
} & Pick<
  DaytonaSandboxProviderOptions,
  'timeoutMs' | 'autoStopIntervalInMinutes' | 'autoArchiveIntervalInMinutes' | 'autoDeleteIntervalInMinutes'
> {
  return {
    apiKey: manifest.auth.api_key,
    timeoutMs: manifest.exec_timeout_ms,
    autoStopIntervalInMinutes: manifest.auto_stop_interval_in_minutes,
    autoArchiveIntervalInMinutes: manifest.auto_archive_interval_in_minutes,
    autoDeleteIntervalInMinutes: manifest.auto_delete_interval_in_minutes,
  };
}

/** Wire/persisted snake_case → container provider constructor options. */
export function toDockerSandboxProviderInput(manifest: DockerSandboxProvider): {
  image: string;
  execTimeoutSeconds: number;
  dockerBinary?: string;
  gpus?: string;
  extraRunArgs?: readonly string[];
} {
  return {
    image: manifest.image,
    // The wire field is milliseconds for symmetry with Daytona; the provider
    // takes seconds because that is what `docker exec` timeouts are reasoned in.
    execTimeoutSeconds: Math.max(1, Math.round(manifest.exec_timeout_ms / 1000)),
    ...(manifest.docker_binary === undefined ? {} : { dockerBinary: manifest.docker_binary }),
    ...(manifest.gpus === undefined ? {} : { gpus: manifest.gpus }),
    ...(manifest.extra_run_args === undefined ? {} : { extraRunArgs: manifest.extra_run_args }),
  };
}
