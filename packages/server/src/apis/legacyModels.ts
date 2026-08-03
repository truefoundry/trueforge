import { OpenAPIHono } from '@hono/zod-openapi';
import type { ModelStore } from '../legacy-registry-store/ModelStore';
import { listLegacyModelsRoute } from '../routes/legacyModelRoutes';

/** YAML-backed registry list (mounted at /api/v1/legacy/models). */
export function createLegacyModelsRouter(store: ModelStore) {
  const router = new OpenAPIHono();
  router.openapi(listLegacyModelsRoute, c => c.json({ data: store.list() }, 200));
  return router;
}
