/**
 * Sandbox-provider domain + wire schemas: configured provider manifests (DB /
 * PUT body) and OpenAPI request/response shapes. Catalog file schemas live in
 * sandboxCatalog.ts.
 *
 * Singleton per tenant — no identity `name` (unlike model providers / skills).
 */
import { z } from '@hono/zod-openapi';
import type { DaytonaSandboxProviderOptions } from '@truefoundry/utils-core/core';

const DaytonaSandboxProviderAuthSchema = z
  .object({
    api_key: z.string().min(1),
  })
  .strict()
  .openapi('DaytonaSandboxProviderAuth');

/**
 * Daytona-backed sandbox provider. Wire PUT body and persisted
 * `sandbox_provider.manifest` document share this shape.
 */
export const DaytonaSandboxProviderSchema = z
  .object({
    type: z.literal('daytona'),
    snapshot_name: z.string().min(1).describe('Daytona snapshot used when creating sandboxes.'),
    auth: DaytonaSandboxProviderAuthSchema,
    exec_timeout_ms: z.number().int().positive().describe('Default sandbox command exec timeout in milliseconds.'),
    auto_stop_interval_in_minutes: z.number().int().nonnegative(),
    auto_archive_interval_in_minutes: z.number().int().nonnegative(),
    auto_delete_interval_in_minutes: z.number().int().nonnegative(),
  })
  .strict()
  .openapi('DaytonaSandboxProvider');

/**
 * Wire + persisted sandbox provider. Single variant today — use this alias so
 * OpenAPI does not emit a one-member `oneOf` (Fern then invents ComponentsSchemas* types).
 * Widen to `z.discriminatedUnion('type', [...])` when a second provider ships.
 */
export const SandboxProviderSchema = DaytonaSandboxProviderSchema;

/** Persisted jsonb — same fields as the wire SandboxProvider. */
export type SandboxProviderManifest = z.infer<typeof SandboxProviderSchema>;

export const PutSandboxProviderRequestSchema = SandboxProviderSchema;

export const PutSandboxProviderResponseSchema = z
  .object({
    data: SandboxProviderSchema,
  })
  .openapi('PutSandboxProviderResponse');

export const GetSandboxProviderResponseSchema = z
  .object({
    data: SandboxProviderSchema,
  })
  .openapi('GetSandboxProviderResponse');

export type DaytonaSandboxProvider = z.infer<typeof DaytonaSandboxProviderSchema>;
export type SandboxProvider = z.infer<typeof SandboxProviderSchema>;
export type PutSandboxProviderRequest = SandboxProvider;

/** Wire/persisted snake_case → Daytona client credentials + provider settings. */
export function toDaytonaSandboxProviderInput(manifest: SandboxProviderManifest): {
  apiKey: string;
} & Pick<
  DaytonaSandboxProviderOptions,
  | 'snapshotName'
  | 'timeoutMs'
  | 'autoStopIntervalInMinutes'
  | 'autoArchiveIntervalInMinutes'
  | 'autoDeleteIntervalInMinutes'
> {
  return {
    apiKey: manifest.auth.api_key,
    snapshotName: manifest.snapshot_name,
    timeoutMs: manifest.exec_timeout_ms,
    autoStopIntervalInMinutes: manifest.auto_stop_interval_in_minutes,
    autoArchiveIntervalInMinutes: manifest.auto_archive_interval_in_minutes,
    autoDeleteIntervalInMinutes: manifest.auto_delete_interval_in_minutes,
  };
}
