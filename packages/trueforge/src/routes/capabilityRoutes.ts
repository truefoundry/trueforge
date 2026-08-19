import { createRoute, z } from '@hono/zod-openapi';
import { RequestErrorResponseSchema } from '../schemas/errors';
import { OpenApiTag } from './openapiTags';

const SandboxCapabilitySchema = z
  .object({
    enabled: z.boolean().describe('Whether a sandbox provider is configured for this tenant.'),
  })
  .openapi('SandboxCapability');

const SkillCapabilitySchema = z
  .object({
    enabled: z
      .boolean()
      .describe('Whether skills are available. False when sandbox is not enabled (skills require a sandbox).'),
    reason: z.string().optional().describe('Present when skills are disabled. Explains why.'),
  })
  .openapi('SkillCapability');

const SettingsCapabilitySchema = z
  .object({
    enabled: z.boolean().describe('Whether the settings UI/API is enabled.'),
  })
  .openapi('SettingsCapability');

const CapabilitiesDataSchema = z
  .object({
    sandbox: SandboxCapabilitySchema,
    skill: SkillCapabilitySchema,
    settings: SettingsCapabilitySchema,
  })
  .openapi('CapabilitiesData');

const GetCapabilitiesResponseSchema = z
  .object({
    data: CapabilitiesDataSchema,
  })
  .openapi('GetCapabilitiesResponse');

export const getCapabilitiesRoute = createRoute({
  method: 'get',
  path: '/',
  tags: [OpenApiTag.CAPABILITIES],
  summary: 'Get server capabilities',
  'x-fern-sdk-group-name': ['server'],
  'x-fern-sdk-method-name': 'get_capabilities',
  description: 'Report optional runtime capabilities available for this tenant.',
  responses: {
    200: {
      content: { 'application/json': { schema: GetCapabilitiesResponseSchema } },
      description: 'Server capabilities.',
    },
    401: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'OIDC is configured and the request has no valid session cookie.',
    },
  },
});
