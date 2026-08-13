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
 * Daytona-backed sandbox provider. Wire PUT body and persisted
 * `sandbox_provider.manifest` document share this shape.
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
  .strict()
  .openapi('DaytonaSandboxProvider');

/** Named enum so the generated SDK exposes a reusable `SandboxBuildStatus` type. */
export const SandboxBuildStatusSchema = z
  .enum(['pending', 'ready', 'failed'])
  .describe('Current build status.')
  .openapi('SandboxBuildStatus');

export const SandboxStatusSchema = z
  .object({
    sandbox_status: z
      .object({
        status: SandboxBuildStatusSchema,
        reason: z.string().nullable().describe('Human-readable detail for the current status; null when ready.'),
      })
      .strict()
      .describe('Live build status of the sandbox image.'),
    build_metadata: z
      .object({
        build_ref: z.string().describe('Provider build handle derived from the image digest (e.g. Daytona snapshot name).'),
        image_uri: z.string().describe('Full reference of the release sandbox image this build refers to.'),
      })
      .strict()
      .describe('Provider-specific build identity.'),
  })
  .strict()
  .openapi('SandboxStatus');

/**
 * Wire + persisted sandbox provider. Single variant today — use this alias so
 * OpenAPI does not emit a one-member `oneOf` (Fern then invents ComponentsSchemas* types).
 * Widen to `z.discriminatedUnion('type', [...])` when a second provider ships.
 */
export const SandboxProviderSchema = DaytonaSandboxProviderSchema;

/** GET/PUT response body: the stored provider plus its live sandbox status. */
export const SandboxProviderResponseSchema = DaytonaSandboxProviderSchema.extend(SandboxStatusSchema.shape).openapi(
  'SandboxProviderResponse',
);

/** Persisted jsonb — the provider config only (no image status). */
export type SandboxProviderManifest = z.infer<typeof SandboxProviderSchema>;

export const PutSandboxProviderRequestSchema = SandboxProviderSchema;

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

export type DaytonaSandboxProvider = z.infer<typeof DaytonaSandboxProviderSchema>;
export type SandboxProvider = z.infer<typeof SandboxProviderSchema>;
export type SandboxBuildStatus = z.infer<typeof SandboxBuildStatusSchema>;
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
