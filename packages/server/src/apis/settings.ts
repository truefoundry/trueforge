/**
 * Admin/settings API surface under /api/v1/settings.
 * Sub-routers (model-providers, mcp-servers, skills, sandbox-providers) mount here.
 * Auth is applied at the /api/v1/settings mount boundary in app.ts (admin when auth is enabled).
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import type { Logger } from 'winston';
import type { ResolveUserContext } from '../auth/identity';
import type { IMcpServerStore } from '../db/mcpServerStore';
import type { IModelProviderStore } from '../db/modelProviderStore';
import type { ISandboxProviderStore } from '../db/sandboxProviderStore';
import type { ISkillStore } from '../db/skillStore';
import type { WithTransaction } from '../db/transaction';
import type { IOAuthTokenStore } from '../mcp/auth/types';
import { createSettingsMcpServersRouter } from './mcpServers';
import { createModelProvidersRouter } from './modelProviders';
import { createSandboxProvidersRouter } from './sandboxProviders';
import { createSkillsRouter } from './skills';

export interface SettingsRouterDeps<TTransaction> {
  modelProviderStore: IModelProviderStore<TTransaction>;
  mcpServerStore: IMcpServerStore<TTransaction>;
  tokenStore: IOAuthTokenStore<TTransaction>;
  skillStore: ISkillStore<TTransaction>;
  sandboxProviderStore: ISandboxProviderStore<TTransaction>;
  withTransaction: WithTransaction<TTransaction>;
  logger: Logger;
  resolveUserContext: ResolveUserContext;
}

export function createSettingsRouter<TTransaction>(deps: SettingsRouterDeps<TTransaction>) {
  const router = new OpenAPIHono();
  router.route(
    '/model-providers',
    createModelProvidersRouter({
      modelProviderStore: deps.modelProviderStore,
      withTransaction: deps.withTransaction,
    }),
  );
  router.route(
    '/mcp-servers',
    createSettingsMcpServersRouter({
      mcpServerStore: deps.mcpServerStore,
      tokenStore: deps.tokenStore,
      withTransaction: deps.withTransaction,
      logger: deps.logger,
      resolveUserContext: deps.resolveUserContext,
    }),
  );
  router.route(
    '/skills',
    createSkillsRouter({
      skillStore: deps.skillStore,
      withTransaction: deps.withTransaction,
    }),
  );
  router.route(
    '/sandbox-providers',
    createSandboxProvidersRouter({
      sandboxProviderStore: deps.sandboxProviderStore,
      withTransaction: deps.withTransaction,
      logger: deps.logger,
    }),
  );
  return router;
}
