/**
 * Sandbox-provider domain + wire schemas: configured provider manifests (DB /
 * PUT body) and OpenAPI request/response shapes. Catalog file schemas live in
 * sandboxCatalog.ts.
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
  .openapi('DaytonaSandboxProviderAuth');

/**
 * Daytona-backed sandbox provider config. Wire PUT body and persisted
 * `sandbox_provider.manifest` document share this shape. Left unnamed for OpenAPI so
 * `SandboxProviderManifest` (its single-variant alias) is the one emitted component and the
 * response `manifest` field is a plain `$ref` instead of an `allOf` wrapper.
 */
export const DaytonaSandboxProviderSchema = z
  .object({
    type: z.literal('daytona').describe('Daytona sandbox provider.'),
    auth: DaytonaSandboxProviderAuthSchema.describe('Daytona authentication credentials.'),
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
 * Persisted jsonb + PUT body: the provider config only (no build status). Single variant today —
 * this alias carries the OpenAPI name so the spec emits one `SandboxProviderManifest` component.
 * Widen to `z.discriminatedUnion('type', [...])` when a second provider ships.
 */
export const SandboxProviderManifestSchema = DaytonaSandboxProviderSchema.openapi('SandboxProviderManifest');

/** Named enum so the generated SDK exposes a reusable `SandboxBuildStatus` type. */
export const SandboxBuildStatusSchema = z
  .enum(['pending', 'ready', 'failed'])
  .describe('Current build status.')
  .openapi('SandboxBuildStatus');

/** Provider-specific build identity, persisted alongside the status. */
export const SandboxBuildMetadataSchema = z
  .object({
    build_ref: z.string().describe('Provider build handle derived from the image digest (e.g. Daytona snapshot name).'),
    image_uri: z.string().describe('Full reference of the release sandbox image this build refers to.'),
  })
  .strict()
  .openapi('SandboxBuildMetadata');

/** Build status + identity, without the provider manifest. Persisted and refreshed on read. */
export const SandboxStatusSchema = z
  .object({
    status: SandboxBuildStatusSchema,
    status_reason: z.string().nullable().describe('Human-readable detail for the current status; null when ready.'),
    build_metadata: SandboxBuildMetadataSchema,
  })
  .strict();

/** GET/PUT response body: the stored provider manifest plus its build status. */
export const SandboxProviderResponseSchema = z
  .object({
    manifest: SandboxProviderManifestSchema,
    status: SandboxBuildStatusSchema,
    status_reason: z.string().nullable().describe('Human-readable detail for the current status; null when ready.'),
    build_metadata: SandboxBuildMetadataSchema,
  })
  .strict()
  .openapi('SandboxProviderResponse');

export const PutSandboxProviderRequestSchema = SandboxProviderManifestSchema;

export const PutSandboxProviderResponseSchema = z
  .object({
    data: SandboxProviderResponseSchema,
  })
  .openapi('PutSandboxProviderResponse');

export const GetSandboxProviderResponseSchema = z
  .object({
    data: SandboxProviderResponseSchema,
  })
  .openapi('GetSandboxProviderResponse');

/** Persisted jsonb — the provider config only (no build status). */
export type SandboxProviderManifest = z.infer<typeof SandboxProviderManifestSchema>;
export type DaytonaSandboxProvider = z.infer<typeof DaytonaSandboxProviderSchema>;
export type SandboxBuildStatus = z.infer<typeof SandboxBuildStatusSchema>;
export type SandboxBuildMetadata = z.infer<typeof SandboxBuildMetadataSchema>;
export type SandboxStatus = z.infer<typeof SandboxStatusSchema>;
export type SandboxProviderResponse = z.infer<typeof SandboxProviderResponseSchema>;
export type PutSandboxProviderRequest = z.infer<typeof PutSandboxProviderRequestSchema>;

/** Wire/persisted snake_case → Daytona client credentials + provider settings. */
export function toDaytonaSandboxProviderInput(manifest: SandboxProviderManifest): {
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
