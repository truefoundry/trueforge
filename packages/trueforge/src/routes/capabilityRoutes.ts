import { createRoute, z } from '@hono/zod-openapi';
import { RequestErrorResponseSchema } from '../schemas/errors';
import { OpenApiTag } from './openapiTags';

const SandboxEnvironmentsCapabilitySchema = z
  .object({
    enabled: z
      .boolean()
      .describe('Whether sandbox environments (snapshots / Environments UI) are available for this tenant.'),
  })
  .openapi('SandboxEnvironmentsCapability');

const SandboxCapabilitySchema = z
  .object({
    enabled: z.boolean().describe('Whether a sandbox provider is configured for this tenant.'),
    environments: SandboxEnvironmentsCapabilitySchema,
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

const SettingsCapabilitySectionSchema = z
  .object({
    enabled: z.boolean().describe('Whether this settings section is available to the caller.'),
    manage_providers: z
      .boolean()
      .describe('Whether the caller may add or edit providers in this section. False when the platform owns them.'),
  })
  .openapi('SettingsCapabilitySection');

const SettingsCapabilitySchema = z
  .object({
    model_providers: SettingsCapabilitySectionSchema,
    mcp_servers: SettingsCapabilitySectionSchema,
    skills: SettingsCapabilitySectionSchema,
    sandbox_providers: SettingsCapabilitySectionSchema,
    web_search: SettingsCapabilitySectionSchema,
    memory: SettingsCapabilitySectionSchema,
  })
  .openapi('SettingsCapability');

const WebSearchCapabilitySchema = z
  .object({
    enabled: z
      .boolean()
      .describe('Whether new chats may use web search: the tenant allows it and a provider is configured.'),
    reason: z.string().optional().describe('Present when web search is unavailable. Explains why.'),
  })
  .openapi('WebSearchCapability');

const SessionSharingCapabilitySchema = z
  .object({
    enabled: z
      .boolean()
      .describe(
        'Whether sessions can be shared with specific users. Sharing with the whole tenant is always available.',
      ),
  })
  .openapi('SessionSharingCapability');

const CapabilitiesDataSchema = z
  .object({
    sandbox: SandboxCapabilitySchema,
    skill: SkillCapabilitySchema,
    settings: SettingsCapabilitySchema,
    web_search: WebSearchCapabilitySchema,
    session_sharing: SessionSharingCapabilitySchema,
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
