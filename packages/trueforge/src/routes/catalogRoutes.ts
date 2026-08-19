/**
 * Discovery catalog routes (mounted at /api/v1/catalogs).
 * Readable by any authenticated user — not under admin /settings.
 */
import { createRoute } from '@hono/zod-openapi';
import { RequestErrorResponseSchema } from '../schemas/errors';
import { GetMcpServerCatalogResponseSchema } from '../schemas/mcpCatalog';
import { GetModelProviderCatalogResponseSchema } from '../schemas/modelCatalog';
import { GetSandboxProviderCatalogResponseSchema } from '../schemas/sandboxCatalog';
import { GetSkillCatalogResponseSchema } from '../schemas/skillCatalog';
import { OpenApiTag } from './openapiTags';

export const listModelProviderCatalogRoute = createRoute({
  method: 'get',
  path: '/model-providers',
  tags: [OpenApiTag.MODELS],
  summary: 'Get the model catalog',
  description:
    'Shipped model-provider presets (discovery-only). Copy into PUT /settings/model-providers to configure. ' +
    'Includes a `custom` sentinel with `supported_reasoning_efforts`.',
  'x-fern-sdk-group-name': ['catalogs', 'modelProviders'],
  'x-fern-sdk-method-name': 'list',
  responses: {
    200: {
      content: { 'application/json': { schema: GetModelProviderCatalogResponseSchema } },
      description: 'Shipped model-provider presets.',
    },
    401: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Not authenticated.',
    },
  },
});

export const listMcpServerCatalogRoute = createRoute({
  method: 'get',
  path: '/mcp-servers',
  tags: [OpenApiTag.MCP_SERVERS],
  summary: 'Get the MCP catalog',
  description: 'Shipped MCP server presets (discovery-only). Copy into PUT /settings/mcp-servers to configure.',
  'x-fern-sdk-group-name': ['catalogs', 'mcpServers'],
  'x-fern-sdk-method-name': 'list',
  responses: {
    200: {
      content: { 'application/json': { schema: GetMcpServerCatalogResponseSchema } },
      description: 'Shipped MCP server presets.',
    },
    401: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Not authenticated.',
    },
  },
});

export const listSkillCatalogRoute = createRoute({
  method: 'get',
  path: '/skills',
  tags: [OpenApiTag.SKILLS],
  summary: 'Get the skill catalog',
  description: 'Shipped skill presets (discovery-only). Copy into PUT /settings/skills to configure.',
  'x-fern-sdk-group-name': ['catalogs', 'skills'],
  'x-fern-sdk-method-name': 'list',
  responses: {
    200: {
      content: { 'application/json': { schema: GetSkillCatalogResponseSchema } },
      description: 'Shipped skill presets.',
    },
    401: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Not authenticated.',
    },
  },
});

export const listSandboxProviderCatalogRoute = createRoute({
  method: 'get',
  path: '/sandbox-providers',
  tags: [OpenApiTag.SANDBOXES],
  summary: 'Get the sandbox provider catalog',
  description:
    'Shipped sandbox-provider presets (discovery-only). Copy into PUT /settings/sandbox-providers to configure.',
  'x-fern-sdk-group-name': ['catalogs', 'sandboxProviders'],
  'x-fern-sdk-method-name': 'list',
  responses: {
    200: {
      content: { 'application/json': { schema: GetSandboxProviderCatalogResponseSchema } },
      description: 'Shipped sandbox-provider presets.',
    },
    401: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Not authenticated.',
    },
  },
});
