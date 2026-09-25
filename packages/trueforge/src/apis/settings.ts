/**
 * Admin/settings API surface under /api/v1/settings.
 * Sub-routers (model-providers, mcp-servers, skills, sandbox-providers) mount here.
 * Auth is applied at the /api/v1/settings mount boundary in app.ts (admin when auth is enabled).
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { Logger } from 'winston';
import type { ResolveRequestContext } from '../auth/identity';
import type { IAgentStore } from '../db/agentStore';
import type { IMcpServerWithAuthStore } from '../db/mcpServerStore';
import type { IModelProviderStore } from '../db/modelProviderStore';
import type { ISandboxProviderStore } from '../db/sandboxProviderStore';
import type { WithTransaction } from '../db/transaction';
import type { IWebSearchProviderStore } from '../db/webSearchProviderStore';
import type { IOAuthTokenStore } from '../mcp/auth/types';
import { createSettingsMcpServersRouter } from './mcpServers';
import { createModelProvidersRouter } from './modelProviders';
import { createSandboxProvidersRouter } from './sandboxProviders';
import { createSkillsRouter, type ResolveSkillStore } from './skills';
import { createWebSearchProvidersRouter } from './webSearchProviders';

export interface SettingsRouterDeps<TTransaction> {
  resolveModelProviderStore: (c: Context) => IModelProviderStore<TTransaction>;
  resolveMcpServerStore: (c: Context) => IMcpServerWithAuthStore<TTransaction>;
  tokenStore: IOAuthTokenStore<TTransaction>;
  resolveSkillStore: ResolveSkillStore<TTransaction>;
  resolveSandboxProviderStore: (c: Context) => ISandboxProviderStore<TTransaction>;
  resolveWebSearchProviderStore: (c: Context) => IWebSearchProviderStore<TTransaction>;
  /** Delete routes refuse to remove a catalog entry an agent still references. */
  resolveAgentStore: (c: Context) => IAgentStore<TTransaction>;
  withTransaction: WithTransaction<TTransaction>;
  logger: Logger;
  resolveRequestContext: ResolveRequestContext;
}

export function createSettingsRouter<TTransaction>(deps: SettingsRouterDeps<TTransaction>) {
  const router = new OpenAPIHono();
  router.route(
    '/model-providers',
    createModelProvidersRouter({
      resolveModelProviderStore: deps.resolveModelProviderStore,
      resolveAgentStore: deps.resolveAgentStore,
      withTransaction: deps.withTransaction,
      resolveRequestContext: deps.resolveRequestContext,
    }),
  );
  router.route(
    '/mcp-servers',
    createSettingsMcpServersRouter({
      resolveMcpServerStore: deps.resolveMcpServerStore,
      resolveAgentStore: deps.resolveAgentStore,
      tokenStore: deps.tokenStore,
      withTransaction: deps.withTransaction,
      logger: deps.logger,
      resolveRequestContext: deps.resolveRequestContext,
    }),
  );
  router.route(
    '/skills',
    createSkillsRouter({
      resolveSkillStore: deps.resolveSkillStore,
      resolveAgentStore: deps.resolveAgentStore,
      withTransaction: deps.withTransaction,
      resolveRequestContext: deps.resolveRequestContext,
    }),
  );
  router.route(
    '/sandbox-providers',
    createSandboxProvidersRouter({
      resolveSandboxProviderStore: deps.resolveSandboxProviderStore,
      withTransaction: deps.withTransaction,
      logger: deps.logger,
      resolveRequestContext: deps.resolveRequestContext,
    }),
  );
  router.route(
    '/web-search-providers',
    createWebSearchProvidersRouter({
      resolveWebSearchProviderStore: deps.resolveWebSearchProviderStore,
      resolveRequestContext: deps.resolveRequestContext,
    }),
  );
  return router;
}
