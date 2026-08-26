/**
 * Sandbox-provider domain + wire schemas: configured provider jsonb and OpenAPI
 * request/response shapes. Catalog file schemas live in sandboxCatalog.ts.
 *
 * Singleton per tenant — no identity `name` (unlike model providers / skills).
 */
import { z } from '@hono/zod-openapi';
import type { DaytonaSandboxProviderOptions, OpenSandboxProviderOptions } from '@truefoundry/trueforge-core/core';

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
 * Left unnamed for OpenAPI so `SandboxProviderManifest` is the emitted union component
 * used by the response `manifest` field.
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
  .strict();

const OpenSandboxProviderAuthSchema = z
  .object({
    api_key: z
      .string()
      .min(1)
      .describe(
        'OpenSandbox API key. Responses are redacted; on PUT, a real value sets/rotates and a redacted value keeps the stored key.',
      ),
  })
  .strict()
  .describe('OpenSandbox authentication credentials.')
  .openapi('OpenSandboxProviderAuth');

/** OpenSandbox-backed sandbox provider configuration. */
export const OpenSandboxProviderSchema = z
  .object({
    type: z.literal('opensandbox').describe('OpenSandbox sandbox provider.'),
    auth: OpenSandboxProviderAuthSchema,
    domain: z.string().min(1).describe('OpenSandbox API host, optionally including a port, without a URL scheme.'),
    protocol: z.enum(['http', 'https']).default('https').describe('Protocol used to reach the OpenSandbox API.'),
    exec_timeout_ms: z.number().int().positive().describe('Default sandbox command exec timeout in milliseconds.'),
  })
  .strict();

/**
 * Persisted jsonb: the provider configuration only (no build status).
 */
export const SandboxProviderManifestSchema = z
  .discriminatedUnion('type', [DaytonaSandboxProviderSchema, OpenSandboxProviderSchema])
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
export type OpenSandboxProvider = z.infer<typeof OpenSandboxProviderSchema>;
export type SandboxBuildStatus = z.infer<typeof SandboxBuildStatusSchema>;
export type SandboxBuildMetadata = z.infer<typeof SandboxBuildMetadataSchema>;
export type SandboxStatus = z.infer<typeof SandboxStatusSchema>;
export type ConfiguredSandboxProvider = z.infer<typeof ConfiguredSandboxProviderSchema>;
export type UpdateSandboxProviderRequest = z.infer<typeof UpdateSandboxProviderRequestSchema>;

/** Wire/persisted snake_case → Daytona client credentials + provider settings. */
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

/** Wire/persisted snake_case → OpenSandbox client credentials + provider settings. */
export function toOpenSandboxProviderInput(
  manifest: OpenSandboxProvider,
): Pick<OpenSandboxProviderOptions, 'apiKey' | 'domain' | 'protocol' | 'timeoutMs'> {
  return {
    apiKey: manifest.auth.api_key,
    domain: manifest.domain,
    protocol: manifest.protocol,
    timeoutMs: manifest.exec_timeout_ms,
  };
}
