/**
 * Sandbox environment domain + wire schemas: identity columns plus a nested
 * SandboxEnvironmentManifest document (JSON key `manifest`).
 *
 * `type` / `sandbox_provider` are backend-only on the stored jsonb — omitted from
 * request and response wire shapes.
 */
import { z } from '@hono/zod-openapi';
import { CreatedBySubjectSchema, TokenPaginationSchema } from '@truefoundry/trueforge-core/agent-session';
import { NameSchema } from './common';

export const SANDBOX_ENVIRONMENT_DESCRIPTION_MAX_LENGTH = 1024;

const BUILD_SCRIPT_EXAMPLE = 'set -ex\npip install httpx\n';

export const SandboxEnvironmentDescriptionSchema = z
  .string()
  .trim()
  .max(SANDBOX_ENVIRONMENT_DESCRIPTION_MAX_LENGTH)
  .describe('Optional human-readable description.');

export const SandboxEnvironmentLifecycleStageSchema = z
  .enum(['active', 'deleted'])
  .describe('Soft-delete lifecycle stage.')
  .openapi('SandboxEnvironmentLifecycleStage');

export const SandboxEnvironmentVersionStatusSchema = z
  .enum(['pending', 'active', 'failed'])
  .describe('Build/activation status of the environment (active version under the hood).')
  .openapi('SandboxEnvironmentVersionStatus');

/** Single image variant today; widen with discriminatedUnion when another type lands. */
export const SandboxEnvironmentImageSchema = z
  .object({
    type: z.literal('build').describe('Build a snapshot from a script.'),
    build_script: z.string().min(1).optional().openapi({
      description: 'Shell script used to build the snapshot.',
      example: BUILD_SCRIPT_EXAMPLE,
    }),
  })
  .strict()
  .openapi('SandboxEnvironmentImage');

export const SandboxEnvironmentResourcesSchema = z
  .object({
    cpu: z.number().positive().default(1).describe('CPU allocation in cores.'),
    memory: z.number().positive().default(1).describe('Memory allocation in GiB.'),
    disk: z.number().positive().default(3).describe('Disk allocation in GiB.'),
  })
  .strict()
  .openapi('SandboxEnvironmentResources');

export const SandboxEnvironmentSecretSchema = z
  .object({
    env: z.string().min(1).describe('Environment variable name injected into the sandbox.'),
    value: z.string().min(1).describe('Secret value; GET responses use a redacted stand-in.'),
    hosts: z.array(z.string().min(1)).describe('Hosts this secret may be sent to.'),
  })
  .strict()
  .openapi('SandboxEnvironmentSecret');

export const SandboxEnvironmentNetworkingSchema = z
  .object({
    network_block_all: z
      .boolean()
      .optional()
      .describe('Block all outbound network access. When true, domain_allow_list and secrets are not used.'),
    domain_allow_list: z.string().min(1).optional().describe('Comma-separated allowed domains.'),
    secrets: z.array(SandboxEnvironmentSecretSchema).optional().describe('Network-scoped secrets.'),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.network_block_all !== true) {
      return;
    }
    if (value.domain_allow_list !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['domain_allow_list'],
        message: 'domain_allow_list is not allowed when network_block_all is true',
      });
    }
    if (value.secrets !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['secrets'],
        message: 'secrets is not allowed when network_block_all is true',
      });
    }
  })
  .openapi('SandboxEnvironmentNetworking');

/** Wire + request/response document — no `type` / `sandbox_provider`. */
export const SandboxEnvironmentManifestSchema = z
  .object({
    name: NameSchema.refine(name => name !== 'default', {
      message: 'name "default" is reserved',
    }),
    description: SandboxEnvironmentDescriptionSchema.optional(),
    image: SandboxEnvironmentImageSchema.optional(),
    resources: SandboxEnvironmentResourcesSchema.default({ cpu: 1, memory: 1, disk: 3 }),
    environment_variables: z.record(z.string().min(1), z.string()).optional(),
    networking: SandboxEnvironmentNetworkingSchema.optional(),
  })
  .strict()
  .openapi('SandboxEnvironmentManifest');

/**
 * Persisted version jsonb — wire fields plus backend-resolved provider identity.
 * `truefoundry` = TrueFoundry platform mode label; runtime still uses Daytona for envs.
 * Not exposed on request/response wire types.
 */
export const StoredSandboxEnvironmentManifestSchema = z
  .object({
    ...SandboxEnvironmentManifestSchema.shape,
    type: z.enum(['daytona', 'truefoundry']),
    sandbox_provider: z.enum(['daytona', 'truefoundry']),
  })
  .strict();

export const SandboxEnvironmentVersionSecretSchema = z
  .object({
    key: z.string().min(1).describe('Env var name.'),
    id: z.string().min(1).describe('Secret store reference id.'),
  })
  .strict();

/** Version jsonb column only — not on CRUD wire responses. */
export const SandboxEnvironmentVersionInternalMetadataSchema = z
  .object({
    secrets: z
      .array(SandboxEnvironmentVersionSecretSchema)
      .default([])
      .describe('Resolved secret refs for this version.'),
  })
  .strict();

/** PUT create-or-update body (single write API). */
export const UpdateSandboxEnvironmentRequestSchema = z
  .object({
    manifest: SandboxEnvironmentManifestSchema,
  })
  .strict()
  .openapi('UpdateSandboxEnvironmentRequest');

const IsoTimestamp = z.iso.datetime().openapi({ type: 'string', format: 'date-time' });

export const SandboxEnvironmentSchema = z
  .object({
    id: z.string().min(1).describe('Immutable server-generated environment identifier.'),
    name: NameSchema,
    description: z.string().describe('Human-readable description; empty when unset.'),
    lifecycle_stage: SandboxEnvironmentLifecycleStageSchema,
    status: SandboxEnvironmentVersionStatusSchema.describe('Readiness of the environment.'),
    status_reason: z.string().nullable().describe('Failure detail when status is failed; null otherwise.'),
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

export type SandboxEnvironmentLifecycleStage = z.infer<typeof SandboxEnvironmentLifecycleStageSchema>;
export type SandboxEnvironmentVersionStatus = z.infer<typeof SandboxEnvironmentVersionStatusSchema>;
export type SandboxEnvironmentManifest = z.infer<typeof SandboxEnvironmentManifestSchema>;
export type StoredSandboxEnvironmentManifest = z.infer<typeof StoredSandboxEnvironmentManifestSchema>;
export type SandboxEnvironmentVersionInternalMetadata = z.infer<typeof SandboxEnvironmentVersionInternalMetadataSchema>;
export type UpdateSandboxEnvironmentRequest = z.infer<typeof UpdateSandboxEnvironmentRequestSchema>;
export type SandboxEnvironment = z.infer<typeof SandboxEnvironmentSchema>;
