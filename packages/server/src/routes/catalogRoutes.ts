/**
 * Discovery catalog routes (mounted at /api/v1/catalog).
 * Readable by any authenticated user — not under admin /settings.
 */
import { createRoute } from '@hono/zod-openapi';
import { RequestErrorResponseSchema } from '../schemas/errors';
import { GetMcpServerCatalogResponseSchema } from '../schemas/mcpCatalog';
import { GetModelProviderCatalogResponseSchema } from '../schemas/modelCatalog';
import { GetSandboxProviderCatalogResponseSchema } from '../schemas/sandboxCatalog';
import { GetSkillCatalogResponseSchema } from '../schemas/skillCatalog';

const CATALOG_TAG = 'Catalog';

export const listModelProviderCatalogRoute = createRoute({
  method: 'get',
  path: '/model-providers',
  tags: [CATALOG_TAG],
  summary: 'Get the model catalog',
  description:
    'Shipped model-provider presets (discovery-only). Copy into PUT /settings/model-providers to configure. ' +
    'Includes a `custom` sentinel with `supported_reasoning_efforts`.',
  'x-fern-sdk-group-name': ['catalog', 'modelProviders'],
  'x-fern-sdk-method-name': 'list',
  responses: {
    200: {
      content: { 'application/json': { schema: GetModelProviderCatalogResponseSchema } },
      description: 'The shipped catalog, verbatim.',
    },
    401: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'OIDC is configured and the request has no valid session cookie.',
    },
  },
});

export const listMcpServerCatalogRoute = createRoute({
  method: 'get',
  path: '/mcp-servers',
  tags: [CATALOG_TAG],
  summary: 'Get the MCP catalog',
  description: 'Shipped MCP server presets (discovery-only). Copy into PUT /settings/mcp-servers to configure.',
  'x-fern-sdk-group-name': ['catalog', 'mcpServers'],
  'x-fern-sdk-method-name': 'list',
  responses: {
    200: {
      content: { 'application/json': { schema: GetMcpServerCatalogResponseSchema } },
      description: 'The shipped catalog, verbatim.',
    },
    401: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'OIDC is configured and the request has no valid session cookie.',
    },
  },
});

export const listSkillCatalogRoute = createRoute({
  method: 'get',
  path: '/skills',
  tags: [CATALOG_TAG],
  summary: 'Get the skill catalog',
  description: 'Shipped skill presets (discovery-only). Copy into PUT /settings/skills to configure.',
  'x-fern-sdk-group-name': ['catalog', 'skills'],
  'x-fern-sdk-method-name': 'list',
  responses: {
    200: {
      content: { 'application/json': { schema: GetSkillCatalogResponseSchema } },
      description: 'The shipped catalog, verbatim.',
    },
    401: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'OIDC is configured and the request has no valid session cookie.',
    },
  },
});

export const listSandboxProviderCatalogRoute = createRoute({
  method: 'get',
  path: '/sandbox-providers',
  tags: [CATALOG_TAG],
  summary: 'Get the sandbox provider catalog',
  description:
    'Shipped sandbox-provider presets (discovery-only). Copy into PUT /settings/sandbox-providers to configure.',
  'x-fern-sdk-group-name': ['catalog', 'sandboxProviders'],
  'x-fern-sdk-method-name': 'list',
  responses: {
    200: {
      content: { 'application/json': { schema: GetSandboxProviderCatalogResponseSchema } },
      description: 'The shipped catalog, verbatim.',
    },
    401: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'OIDC is configured and the request has no valid session cookie.',
    },
  },
});
