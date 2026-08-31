/**
 * Built-in Harness → AgentUIServer factory for `<TrueForgeUI server={{ type: "trueforge", … }} />`.
 */
import { createTrueFoundryServer } from '../../server/createTrueFoundryServer.js';
import type { CatalogServer } from '../../server/types.js';
import { createHarnessAgentSessionsServer } from './agentSessionsServer.js';
import { createHarnessBuilderServer } from './builderServer.js';
import { createConnectorCatalog } from './catalogs/connectorCatalog.js';
import { createModelProviderCatalog } from './catalogs/modelProviderCatalog.js';
import { createSandboxProviderCatalog } from './catalogs/sandboxProviderCatalog.js';
import { createSkillCatalog } from './catalogs/skillCatalog.js';
import { createHarnessChatServer } from './chatServer.js';
import { createTrueForgeClient, type CreateTrueForgeClientOptions } from './client.js';
import type { HarnessAgentSpec } from './types.js';

export {
  createHarnessAgentSessionsServer,
  type CreateHarnessAgentSessionsServerOptions,
} from './agentSessionsServer.js';
export {
  createHarnessBuilderServer,
  modelProviderLogosByName,
  toModelSelection,
  type CreateHarnessBuilderServerOptions,
} from './builderServer.js';
export {
  createConnectorCatalog,
  toHarnessAuth,
  toHarnessManifest as toHarnessConnectorManifest,
  toUiConnector,
  toUiConnectorFromReadEntry,
} from './catalogs/connectorCatalog.js';
export {
  createModelProviderCatalog,
  toHarnessModelProvider,
  toUiCatalogModelProviderEntry,
  toUiModelProvider,
} from './catalogs/modelProviderCatalog.js';
export {
  configFromHarness,
  createSandboxProviderCatalog,
  filterUiSandboxProviders,
  toHarnessManifest as toHarnessSandboxManifest,
  toUiSandboxProvider,
  toUiSandboxProviderListEntry,
} from './catalogs/sandboxProviderCatalog.js';
export { createSkillCatalog, toHarnessManifest as toHarnessSkillManifest, toUiSkill } from './catalogs/skillCatalog.js';
export {
  createHarnessChatServer,
  toHarnessAgentSpec,
  toUiAgentSpec,
  type CreateHarnessChatServerOptions,
} from './chatServer.js';
export { createTrueForgeClient } from './client.js';
export type { CreateTrueForgeClientOptions } from './client.js';
export { getCapabilities, listConfiguredMcpServers, listModels, listSkills } from './lists.js';
export type { HarnessAgentSpec, HarnessMcpServerMount, HarnessSkillMount } from './types.js';

export type CreateTrueForgeAgentUIServerOptions = CreateTrueForgeClientOptions & {
  /** Override the default Harness settings catalogs. */
  catalog?: CatalogServer;
};

/**
 * Compose chat + builder + agent sessions + default settings catalogs into an `AgentUIServer`.
 */
export function createTrueForgeAgentUIServer(options: CreateTrueForgeAgentUIServerOptions = {}) {
  const { catalog: catalogOverride, ...clientOptions } = options;
  const client = createTrueForgeClient(clientOptions);
  const catalog =
    catalogOverride ??
    ({
      modelCatalog: createModelProviderCatalog(client),
      connectorCatalog: createConnectorCatalog(client),
      skillCatalog: createSkillCatalog(client),
      sandboxCatalog: createSandboxProviderCatalog(client),
    } satisfies CatalogServer);

  return createTrueFoundryServer<HarnessAgentSpec>({
    chatServer: createHarnessChatServer({ client }),
    ...createHarnessBuilderServer({ client }),
    catalog,
    sessions: createHarnessAgentSessionsServer({ ...clientOptions, client }),
  });
}
