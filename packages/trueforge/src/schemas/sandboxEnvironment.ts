/**
 * Sandbox environment domain + wire schemas: identity columns plus a nested
 * DaytonaSandboxEnvironmentManifest document (JSON key `manifest`).
 *
 * Wire `SandboxEnvironmentManifest` is Daytona-only for now (avoid one-member oneOf).
 * Store jsonb may widen to a type-discriminated union when another provider ships.
 */
import { GpuType } from '@daytona/sdk';
import { z } from '@hono/zod-openapi';
import { CreatedBySubjectSchema, TokenPaginationSchema } from '@truefoundry/trueforge-core/agent-session';
import { NameSchema } from './common';

// random things in sdk:)
const DAYTONA_GPU_TYPE_VALUES = Object.values(GpuType).filter(value => value !== GpuType.UNKNOWN_DEFAULT_OPEN_API) as [
  string,
  ...string[],
];

export const DaytonaGpuTypeSchema = z
  .enum(DAYTONA_GPU_TYPE_VALUES)
  .describe('Preferred Daytona GPU type.')
  .openapi('DaytonaGpuType');

const DaytonaTrueforgeDefaultImageSchema = z
  .object({
    type: z.literal('trueforge-default').describe('Use the tenant provider TrueForge release snapshot.'),
  })
  .strict()
  .openapi('DaytonaTrueforgeDefaultImage');

const DaytonaSnapshotImageSchema = z
  .object({
    type: z.literal('snapshot').describe('Clone an existing Daytona snapshot by name.'),
    name: z.string().min(1).describe('Daytona snapshot name.'),
  })
  .strict()
  .openapi('DaytonaSnapshotImage');

const DaytonaDockerImageSchema = z
  .object({
    type: z.literal('docker').describe('Build/create from a container image reference.'),
    ref: z.string().min(1).describe('Container image reference passed to Daytona create-from-image.'),
  })
  .strict()
  .openapi('DaytonaDockerImage');

export const DaytonaSandboxEnvironmentImageSchema = z
  .discriminatedUnion('type', [
    DaytonaTrueforgeDefaultImageSchema,
    DaytonaSnapshotImageSchema,
    DaytonaDockerImageSchema,
  ])
  .openapi('DaytonaSandboxEnvironmentImage');

export const DaytonaSandboxEnvironmentResourcesSchema = z
  .object({
    cpu: z.number().positive().optional().describe('CPU allocation in cores.'),
    memory: z.number().positive().optional().describe('Memory allocation in GiB.'),
    disk: z.number().positive().optional().describe('Disk allocation in GiB.'),
    gpu: z.number().nonnegative().optional().describe('GPU allocation in Daytona GPU units.'),
    gpu_type: z
      .union([DaytonaGpuTypeSchema, z.array(DaytonaGpuTypeSchema).min(1)])
      .optional()
      .describe('Preferred GPU type, or an ordered fallback list.'),
  })
  .strict()
  .openapi('DaytonaSandboxEnvironmentResources');

export const DaytonaSandboxEnvironmentNetworkingSchema = z
  .object({
    network_block_all: z.boolean().optional().describe('Block all outbound network access.'),
    network_allow_list: z.string().min(1).optional().describe('Comma-separated allowed CIDR network addresses.'),
    domain_allow_list: z.string().min(1).optional().describe('Comma-separated allowed domains.'),
    outbound_proxy_url: z.string().min(1).optional().describe('Outbound HTTP(S) proxy URL.'),
  })
  .strict()
  .superRefine((value, ctx) => {
    const modes = [value.network_block_all === true, !!value.network_allow_list, !!value.domain_allow_list].filter(
      Boolean,
    ).length;
    if (modes > 1) {
      ctx.addIssue({
        code: 'custom',
        message: 'At most one of network_block_all, network_allow_list, or domain_allow_list may be set',
      });
    }
  })
  .openapi('DaytonaSandboxEnvironmentNetworking');

export const DaytonaSandboxEnvironmentLifecycleSchema = z
  .object({
    auto_stop_interval_in_minutes: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe('Minutes of idle time before Daytona auto-stops the sandbox (0 disables).'),
    auto_archive_interval_in_minutes: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe('Minutes before Daytona auto-archives the sandbox (0 disables).'),
    auto_delete_interval_in_minutes: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe('Minutes before Daytona auto-deletes the sandbox (0 disables).'),
  })
  .strict()
  .openapi('DaytonaSandboxEnvironmentLifecycle');

export const DaytonaSandboxEnvironmentManifestSchema = z
  .object({
    type: z.literal('daytona').describe('Daytona sandbox environment.'),
    provider: z.literal('daytona').describe('Must match the configured sandbox provider name/type.'),
    image: DaytonaSandboxEnvironmentImageSchema,
    resources: DaytonaSandboxEnvironmentResourcesSchema.optional(),
    secrets: z
      .record(z.string().min(1), z.string().min(1))
      .optional()
      .describe('Map of sandbox env var name to an existing Daytona organization secret name.'),
    networking: DaytonaSandboxEnvironmentNetworkingSchema.optional(),
    lifecycle: DaytonaSandboxEnvironmentLifecycleSchema.optional(),
  })
  .strict()
  .openapi('DaytonaSandboxEnvironmentManifest');

/** Settings / OpenAPI — Daytona only until a second provider ships. */
export const SandboxEnvironmentManifestSchema =
  DaytonaSandboxEnvironmentManifestSchema.openapi('SandboxEnvironmentManifest');

/** Store jsonb — Daytona today; widen with discriminatedUnion when another type lands. */
export const StoredSandboxEnvironmentManifestSchema = DaytonaSandboxEnvironmentManifestSchema;

export const SandboxEnvironmentDescriptionSchema = z
  .string()
  .trim()
  .max(1024)
  .describe('Optional human-readable description.');

export const CreateSandboxEnvironmentRequestSchema = z
  .object({
    name: NameSchema,
    description: SandboxEnvironmentDescriptionSchema.optional(),
    manifest: SandboxEnvironmentManifestSchema,
  })
  .strict()
  .openapi('CreateSandboxEnvironmentRequest');

export const UpdateSandboxEnvironmentRequestSchema = z
  .object({
    description: SandboxEnvironmentDescriptionSchema.nullable().optional(),
    manifest: SandboxEnvironmentManifestSchema,
  })
  .strict()
  .openapi('UpdateSandboxEnvironmentRequest');

const IsoTimestamp = z.iso.datetime().openapi({ type: 'string', format: 'date-time' });

export const SandboxEnvironmentSchema = z
  .object({
    id: z.string().min(1).describe('Immutable server-generated environment identifier.'),
    name: NameSchema,
    description: z.string().nullable().describe('Optional human-readable description.'),
    manifest: SandboxEnvironmentManifestSchema,
    created_by_subject: CreatedBySubjectSchema,
    created_at: IsoTimestamp.describe('ISO-8601 create time.'),
    updated_at: IsoTimestamp.describe('ISO-8601 last update time.'),
  })
  .strict()
  .openapi('SandboxEnvironment');

export const GetSandboxEnvironmentResponseSchema = z
  .object({ data: SandboxEnvironmentSchema })
  .openapi('GetSandboxEnvironmentResponse');

export const ListSandboxEnvironmentsResponseSchema = z
  .object({
    data: z.array(SandboxEnvironmentSchema),
    pagination: TokenPaginationSchema,
  })
  .openapi('ListSandboxEnvironmentsResponse');

export const DeleteSandboxEnvironmentResponseSchema = z.object({}).openapi('DeleteSandboxEnvironmentResponse');

export type DaytonaGpuType = z.infer<typeof DaytonaGpuTypeSchema>;
export type DaytonaSandboxEnvironmentManifest = z.infer<typeof DaytonaSandboxEnvironmentManifestSchema>;
export type SandboxEnvironmentManifest = z.infer<typeof SandboxEnvironmentManifestSchema>;
export type StoredSandboxEnvironmentManifest = z.infer<typeof StoredSandboxEnvironmentManifestSchema>;
export type CreateSandboxEnvironmentRequest = z.infer<typeof CreateSandboxEnvironmentRequestSchema>;
export type UpdateSandboxEnvironmentRequest = z.infer<typeof UpdateSandboxEnvironmentRequestSchema>;
export type SandboxEnvironment = z.infer<typeof SandboxEnvironmentSchema>;
