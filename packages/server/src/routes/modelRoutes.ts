import { createRoute, z } from '@hono/zod-openapi';
import { ModelEntrySchema } from '../legacy-registry-store/schemas';
import { ListModelsResponseSchema } from '../schemas/modelProvider';

export const listModelsRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Models'],
  summary: 'List models',
  'x-fern-sdk-group-name': ['models'],
  'x-fern-sdk-method-name': 'list',
  description:
    'Models across all configured model providers, addressed by fully qualified name `provider_name/model_name`.',
  responses: {
    200: {
      content: { 'application/json': { schema: ListModelsResponseSchema } },
      description: 'All models of all configured providers.',
    },
  },
});

const ListOldModelsResponseSchema = z
  .object({
    data: z.array(ModelEntrySchema),
  })
  .openapi('ListOldModelsResponse');

/** The YAML-backed flow the runtime still uses; superseded by GET /models. */
export const listOldModelsRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Models'],
  summary: 'List models (models.yaml)',
  'x-fern-sdk-group-name': ['old', 'models'],
  'x-fern-sdk-method-name': 'list',
  description: "Models declared in models.yaml, reachable through the OpenAI-compatible API at the file's base_url.",
  responses: {
    200: {
      content: { 'application/json': { schema: ListOldModelsResponseSchema } },
      description: 'All configured models.',
    },
  },
});
