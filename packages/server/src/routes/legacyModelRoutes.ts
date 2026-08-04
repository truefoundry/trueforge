import { createRoute, z } from '@hono/zod-openapi';
import { ModelEntrySchema } from '../legacy-registry-store/schemas';

const ListLegacyModelsResponseSchema = z
  .object({
    data: z.array(ModelEntrySchema),
  })
  .openapi('ListLegacyModelsResponse');

/** YAML-backed registry list; runtime still uses ModelStore for turns. */
export const listLegacyModelsRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Legacy Models'],
  summary: 'List models (models.yaml)',
  'x-fern-sdk-group-name': ['legacy', 'models'],
  'x-fern-sdk-method-name': 'list',
  description: 'Models declared in models.yaml — the registry the runtime still uses for turns.',
  responses: {
    200: {
      content: { 'application/json': { schema: ListLegacyModelsResponseSchema } },
      description: 'All configured models.',
    },
  },
});
