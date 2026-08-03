import { createRoute, z } from '@hono/zod-openapi';
import { SkillEntrySchema } from '../legacy-registry-store/schemas';

const ListSkillsResponseSchema = z
  .object({
    data: z.array(SkillEntrySchema),
  })
  .openapi('ListSkillsResponse');

export const listSkillsRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Legacy Skills'],
  summary: 'List skills',
  'x-fern-sdk-group-name': ['legacy', 'skills'],
  'x-fern-sdk-method-name': 'list',
  description: 'Agent skills declared in skills.yaml.',
  responses: {
    200: {
      content: { 'application/json': { schema: ListSkillsResponseSchema } },
      description: 'All configured skills.',
    },
  },
});
