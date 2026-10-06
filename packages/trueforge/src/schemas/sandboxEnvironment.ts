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
export const SANDBOX_ENVIRONMENT_VARIABLE_NAME_MAX_LENGTH = 128;
export const SANDBOX_ENVIRONMENT_VARIABLE_VALUE_MAX_LENGTH = 4096;

/** Reserved system environment name (tenant default; not creatable via public CRUD). */
export const DEFAULT_SANDBOX_ENVIRONMENT_NAME = 'default';

export const DEFAULT_SANDBOX_ENVIRONMENT_RESOURCES = { cpu: 1, memory: 1, disk: 3 } as const;
export const SANDBOX_ENVIRONMENT_RESOURCE_LIMITS = {
  cpu: { min: 1, max: 4 },
  memory: { min: 1, max: 8 },
  disk: { min: 1, max: 10 },
} as const;

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
  .enum(['pending', 'ready', 'failed'])
  .describe('Build readiness of the environment version.')
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
    cpu: z
      .number()
      .min(SANDBOX_ENVIRONMENT_RESOURCE_LIMITS.cpu.min)
      .max(SANDBOX_ENVIRONMENT_RESOURCE_LIMITS.cpu.max)
      .default(DEFAULT_SANDBOX_ENVIRONMENT_RESOURCES.cpu)
      .describe('CPU allocation in cores (1–4).'),
    memory: z
      .number()
      .min(SANDBOX_ENVIRONMENT_RESOURCE_LIMITS.memory.min)
      .max(SANDBOX_ENVIRONMENT_RESOURCE_LIMITS.memory.max)
      .default(DEFAULT_SANDBOX_ENVIRONMENT_RESOURCES.memory)
      .describe('Memory allocation in GiB (1–8).'),
    disk: z
      .number()
      .min(SANDBOX_ENVIRONMENT_RESOURCE_LIMITS.disk.min)
      .max(SANDBOX_ENVIRONMENT_RESOURCE_LIMITS.disk.max)
      .default(DEFAULT_SANDBOX_ENVIRONMENT_RESOURCES.disk)
      .describe('Disk allocation in GiB (1–10).'),
  })
  .strict()
  .openapi('SandboxEnvironmentResources');

const SandboxEnvironmentVariableNameSchema = z
  .string()
  .min(1)
  .max(SANDBOX_ENVIRONMENT_VARIABLE_NAME_MAX_LENGTH)
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'must be a valid environment variable name');

const SandboxEnvironmentVariableValueSchema = z.string().max(SANDBOX_ENVIRONMENT_VARIABLE_VALUE_MAX_LENGTH);

export const SandboxEnvironmentSecretSchema = z
  .object({
    env: SandboxEnvironmentVariableNameSchema.describe('Environment variable name injected into the sandbox.'),
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

/**
 * Manifest fields shared by wire and storage. Responses may use name `"default"`;
 * create/update requests reject it (reserved system env).
 */
const SandboxEnvironmentManifestFieldsSchema = z
  .object({
    name: NameSchema,
    description: SandboxEnvironmentDescriptionSchema.optional(),
    image: SandboxEnvironmentImageSchema.optional(),
    resources: SandboxEnvironmentResourcesSchema.default(DEFAULT_SANDBOX_ENVIRONMENT_RESOURCES),
    environment_variables: z
      .record(SandboxEnvironmentVariableNameSchema, SandboxEnvironmentVariableValueSchema)
      .optional(),
    networking: SandboxEnvironmentNetworkingSchema.optional(),
  })
  .strict();

/** Wire document (list/get/response) — no `type` / `sandbox_provider`; name `"default"` allowed. */
export const SandboxEnvironmentManifestSchema =
  SandboxEnvironmentManifestFieldsSchema.openapi('SandboxEnvironmentManifest');

/** PUT body manifest — rejects reserved name `"default"`. */
const SandboxEnvironmentManifestRequestSchema = SandboxEnvironmentManifestFieldsSchema.refine(
  manifest => manifest.name !== DEFAULT_SANDBOX_ENVIRONMENT_NAME,
  { message: 'name "default" is reserved', path: ['name'] },
).openapi('SandboxEnvironmentManifestRequest');

/**
 * Persisted version jsonb — wire fields plus backend-resolved provider identity.
 * `truefoundry` = TrueFoundry platform mode label; runtime still uses Daytona for envs.
 * Not exposed on request/response wire types. Allows name `"default"`.
 */
export const StoredSandboxEnvironmentManifestSchema = z
  .object({
    ...SandboxEnvironmentManifestFieldsSchema.shape,
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
    manifest: SandboxEnvironmentManifestRequestSchema,
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
export type SandboxEnvironmentSecret = z.infer<typeof SandboxEnvironmentSecretSchema>;
export type SandboxEnvironmentManifest = z.infer<typeof SandboxEnvironmentManifestSchema>;
export type StoredSandboxEnvironmentManifest = z.infer<typeof StoredSandboxEnvironmentManifestSchema>;
export type SandboxEnvironmentVersionInternalMetadata = z.infer<typeof SandboxEnvironmentVersionInternalMetadataSchema>;
export type UpdateSandboxEnvironmentRequest = z.infer<typeof UpdateSandboxEnvironmentRequestSchema>;
export type SandboxEnvironment = z.infer<typeof SandboxEnvironmentSchema>;
