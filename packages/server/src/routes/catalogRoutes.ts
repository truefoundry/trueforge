/**
 * Discovery catalog routes (mounted at /api/v1/catalog).
 * Readable by any authenticated user — not under admin /settings.
 */
import { createRoute } from '@hono/zod-openapi';
import { RequestErrorResponseSchema } from '../schemas/errors';
import { GetModelProviderCatalogResponseSchema } from '../schemas/modelCatalog';

const CATALOG_TAG = 'Catalog';

export const listModelProviderCatalogRoute = createRoute({
  method: 'get',
  path: '/model-providers',
  tags: [CATALOG_TAG],
  summary: 'Get the model provider catalog',
  description:
    'Provider and model presets shipped with the server (model-catalog.yaml). Discovery-only: an entry becomes a ' +
    'PUT /settings/model-providers body once the catalog-only `logo` and `name` are dropped and `auth` is added. ' +
    'Includes a `custom` sentinel with `supported_reasoning_efforts` for the custom-provider form (not configurable from catalog).',
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
