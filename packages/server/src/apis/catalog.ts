import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import { SUPPORTED_REASONING_EFFORTS } from '@truefoundry/trueforge-core/core';
import type { McpCatalog } from '../catalog/McpCatalog';
import type { ModelCatalog } from '../catalog/ModelCatalog';
import type { SandboxCatalog } from '../catalog/SandboxCatalog';
import type { SkillCatalog } from '../catalog/SkillCatalog';
import {
  listMcpServerCatalogRoute,
  listModelProviderCatalogRoute,
  listSandboxProviderCatalogRoute,
  listSkillCatalogRoute,
} from '../routes/catalogRoutes';
import type { CatalogModelProvider } from '../schemas/modelCatalog';

export interface CatalogRouterDeps {
  modelCatalog: ModelCatalog;
  mcpCatalog: McpCatalog;
  skillCatalog: SkillCatalog;
  sandboxCatalog: SandboxCatalog;
}

export function createCatalogRouter(deps: CatalogRouterDeps) {
  const listModelProvidersHandler: RouteHandler<typeof listModelProviderCatalogRoute> = c => {
    const loadedProvidersCatalog = deps.modelCatalog.list();
    // make a copy of the loaded providers catalog and add the custom provider sentinel
    const providersCatalog: CatalogModelProvider[] = [...loadedProvidersCatalog];
    providersCatalog.push({
      type: 'custom',
      supported_reasoning_efforts: [...SUPPORTED_REASONING_EFFORTS],
    });
    return c.json({ data: providersCatalog }, 200);
  };

  const listMcpServersHandler: RouteHandler<typeof listMcpServerCatalogRoute> = c => {
    return c.json({ data: [...deps.mcpCatalog.list()] }, 200);
  };

  const listSkillsHandler: RouteHandler<typeof listSkillCatalogRoute> = c => {
    return c.json({ data: [...deps.skillCatalog.list()] }, 200);
  };

  const listSandboxProvidersHandler: RouteHandler<typeof listSandboxProviderCatalogRoute> = c => {
    return c.json({ data: [...deps.sandboxCatalog.list()] }, 200);
  };

  const router = new OpenAPIHono();
  router.openapi(listModelProviderCatalogRoute, listModelProvidersHandler);
  router.openapi(listMcpServerCatalogRoute, listMcpServersHandler);
  router.openapi(listSkillCatalogRoute, listSkillsHandler);
  router.openapi(listSandboxProviderCatalogRoute, listSandboxProvidersHandler);
  return router;
}
