import { OpenAPIHono } from '@hono/zod-openapi';
import type { SkillStore } from '../legacy-registry-store/SkillStore';
import { listSkillsRoute } from '../routes/legacySkillRoutes';

export function createLegacySkillsRouter(store: SkillStore) {
  const router = new OpenAPIHono();
  router.openapi(listSkillsRoute, c => c.json({ data: store.list() }, 200));
  return router;
}
