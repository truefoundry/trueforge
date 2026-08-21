/**
 * Sandbox-provider domain + wire schemas: configured provider jsonb and OpenAPI
 * request/response shapes. Catalog file schemas live in sandboxCatalog.ts.
 *
 * Singleton per tenant — no identity `name` (unlike model providers / skills).
 */
import { z } from '@hono/zod-openapi';
import type { DaytonaSandboxProviderOptions, E2BSandboxProviderOptions } from '@truefoundry/trueforge-core/core';

export const DaytonaSandboxProviderAuthSchema = z
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

/** Canonical Daytona settings shared by configured and catalog wire variants. */
export const DaytonaSandboxProviderConfigSchema = z
  .object({
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

/**
 * Daytona-backed sandbox provider config. Persisted as `sandbox_provider.manifest`.
 * Named independently so the manifest discriminated union emits direct component members.
 */
export const DaytonaSandboxProviderSchema = z
  .object({
    type: z.literal('daytona').describe('Daytona sandbox provider.'),
    auth: DaytonaSandboxProviderAuthSchema,
    ...DaytonaSandboxProviderConfigSchema.shape,
  })
  .strict()
  .openapi('DaytonaSandboxProvider');

export const E2BSandboxProviderAuthSchema = z
  .object({
    api_key: z
      .string()
      .min(1)
      .describe('E2B API key. Responses are redacted; on PUT, a real value sets/rotates the stored key.'),
  })
  .strict()
  .describe('E2B authentication credentials.')
  .openapi('E2BSandboxProviderAuth');

/** Canonical E2B settings shared by configured and catalog wire variants. */
export const E2BSandboxProviderConfigSchema = z
  .object({
    exec_timeout_ms: z.number().int().positive().describe('Default sandbox command exec timeout in milliseconds.'),
    sandbox_timeout_ms: z
      .number()
      .int()
      .positive()
      .describe('Milliseconds before E2B pauses an inactive sandbox; subsequent access resumes it.'),
  })
  .strict();

/** E2B-backed sandbox config persisted in `sandbox_provider.manifest`. */
export const E2BSandboxProviderSchema = z
  .object({
    type: z.literal('e2b').describe('E2B sandbox provider.'),
    auth: E2BSandboxProviderAuthSchema,
    ...E2BSandboxProviderConfigSchema.shape,
  })
  .strict()
  .openapi('E2BSandboxProvider');

/**
 * Persisted jsonb: provider config only (no build status).
 */
export const SandboxProviderManifestSchema = z
  .discriminatedUnion('type', [DaytonaSandboxProviderSchema, E2BSandboxProviderSchema])
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
export type E2BSandboxProvider = z.infer<typeof E2BSandboxProviderSchema>;
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

/** Wire/persisted snake_case → E2B provider settings. */
export function toE2BSandboxProviderInput(manifest: E2BSandboxProvider): {
  apiKey: string;
} & Pick<E2BSandboxProviderOptions, 'execTimeoutMs' | 'sandboxTimeoutMs'> {
  return {
    apiKey: manifest.auth.api_key,
    execTimeoutMs: manifest.exec_timeout_ms,
    sandboxTimeoutMs: manifest.sandbox_timeout_ms,
  };
}
