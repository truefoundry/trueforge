import type {
  CatalogServer,
  ConnectorAuth,
  ConnectorAuthPublic,
  ConnectorBase,
  ConnectorCatalogEntry,
  CreateSkillRequest,
  DefinedSkill,
  SkillCatalogEntry,
} from '@truefoundry/trueforge-ui';
import { TrueforgeUI } from '@truefoundry/trueforge-ui';

function MissingEnv({ missing }: { missing: string[] }) {
  return (
    <div className="missing-env">
      <h1>Missing environment variables</h1>
      <p>
        Copy <code>.env.example</code> to <code>.env</code> and set:
      </p>
      <ul>
        {missing.map(name => (
          <li key={name}>
            <code>{name}</code>
          </li>
        ))}
      </ul>
    </div>
  );
}

function toPublicAuth(auth: ConnectorAuth): ConnectorAuthPublic {
  if (auth.type === 'dcr') {
    return { type: 'dcr', authUrl: auth.authUrl ?? 'https://example.com/oauth' };
  }
  if (auth.type === 'header') {
    return { type: 'header', ...(auth.headerName != null ? { headerName: auth.headerName } : {}) };
  }
  return { type: 'none' };
}

const exampleConnectorCatalog: ConnectorCatalogEntry[] = [
  {
    id: 'connector-github',
    name: 'GitHub',
    description: 'Access repositories, pull requests, and issues.',
    url: 'https://mcp.example.com/github',
    auth: { type: 'dcr', authUrl: 'https://example.com/oauth/github' },
  },
  {
    id: 'connector-linear',
    name: 'Linear',
    description: 'Manage issues and projects.',
    url: 'https://mcp.example.com/linear',
    auth: { type: 'header', headerName: 'Authorization' },
  },
  {
    id: 'connector-filesystem',
    name: 'Filesystem',
    description: 'Read and write files without authentication.',
    url: 'https://mcp.example.com/filesystem',
    auth: { type: 'none' },
  },
];

/** In-memory connectors so connect / update / remove work in the example. */
let definedConnectors: ConnectorBase[] = [];

const exampleSkillCatalog: SkillCatalogEntry[] = [
  {
    id: 'cat-code-review',
    name: 'Code Review',
    description: 'Review a diff for correctness, risk, and style.',
    repoURL: 'https://github.com/truefoundry/skills',
    path: 'skills/code-review',
    ref: 'main',
  },
  {
    id: 'cat-release-notes',
    name: 'Release Notes',
    description: 'Draft release notes from merged PRs and commits.',
    repoURL: 'https://github.com/truefoundry/skills',
    path: 'skills/release-notes',
    ref: 'main',
  },
  {
    id: 'cat-incident-response',
    name: 'Incident Response',
    description: 'Triage production incidents and draft status updates.',
    repoURL: 'https://github.com/truefoundry/skills',
    path: 'skills/incident-response',
    ref: 'main',
  },
  {
    id: 'cat-sql-analyzer',
    name: 'SQL Analyzer',
    description: 'Explain and optimize SQL queries for Postgres.',
    repoURL: 'https://github.com/truefoundry/skills',
    path: 'skills/sql-analyzer',
    ref: 'main',
  },
];

/** In-memory defined skills so select / import / remove work in the example. */
let definedSkills: DefinedSkill[] = [
  {
    id: 'skill-code-review',
    name: 'Code Review',
    description: 'Review a diff for correctness, risk, and style.',
    catalogId: 'cat-code-review',
  },
  {
    id: 'skill-house-style',
    name: 'House Style',
    description: 'Writing rules and tone-of-voice for external copy.',
  },
];

/** Catalog stubs for local Settings testing. */
const emptyCatalog: CatalogServer = {
  modelCatalog: {
    getModelProviderCatalog: async () => [],
    listModelProviders: async () => [],
    createModelProvider: async req => ({
      id: `provider-${Date.now()}`,
      type: req.type,
      name: req.name,
      models: req.models,
      ...(req.baseUrl != null ? { baseUrl: req.baseUrl } : {}),
    }),
    updateModelProvider: async req => ({
      id: req.id,
      type: req.type,
      name: req.name,
      models: req.models,
      ...(req.baseUrl != null ? { baseUrl: req.baseUrl } : {}),
    }),
    deleteModelProvider: async () => undefined,
  },
  connectorCatalog: {
    getConnectorCatalog: async () => exampleConnectorCatalog,
    getConnector: async ({ id }) => {
      const connector = definedConnectors.find(item => item.id === id);
      if (!connector) throw new Error(`Connector ${id} was not found.`);
      return connector;
    },
    listConnectors: async () => definedConnectors,
    getToolsByConnectorId: async () => [],
    createConnector: async req => {
      const catalogEntry = exampleConnectorCatalog.find(entry => entry.url === req.url);
      const connector: ConnectorBase = {
        id: catalogEntry?.id ?? `connector-${Date.now()}`,
        name: req.name,
        description: catalogEntry?.description ?? 'Custom MCP server.',
        url: req.url,
        auth: toPublicAuth(req.auth),
        requiresAuth: req.auth.type === 'dcr',
        authenticated: req.auth.type === 'header',
      };
      definedConnectors = [...definedConnectors, connector];
      return connector;
    },
    updateConnector: async req => {
      const current = definedConnectors.find(connector => connector.id === req.id);
      const connector: ConnectorBase = {
        id: req.id,
        name: req.name,
        description: current?.description ?? 'Custom MCP server.',
        url: req.url,
        auth: toPublicAuth(req.auth),
        requiresAuth: req.auth.type === 'dcr',
        authenticated: req.auth.type === 'header',
      };
      definedConnectors = definedConnectors.map(item => (item.id === req.id ? connector : item));
      return connector;
    },
    authenticateConnector: async ({ id }) => {
      const connector = definedConnectors.find(item => item.id === id);
      if (!connector) throw new Error(`Connector ${id} was not found.`);
      const authenticated = { ...connector, authenticated: true, requiresAuth: false };
      definedConnectors = definedConnectors.map(item => (item.id === id ? authenticated : item));
      return authenticated;
    },
    disconnectConnector: async ({ id }) => {
      const connector = definedConnectors.find(item => item.id === id);
      if (!connector) throw new Error(`Connector ${id} was not found.`);
      const disconnected = { ...connector, requiresAuth: true, authenticated: false };
      definedConnectors = definedConnectors.map(item => (item.id === id ? disconnected : item));
      return disconnected;
    },
    deleteConnector: async ({ id }) => {
      definedConnectors = definedConnectors.filter(connector => connector.id !== id);
    },
  },
  skillCatalog: {
    getSkillCatalog: async () => exampleSkillCatalog,
    listSkills: async () => definedSkills,
    createSkill: async (req: CreateSkillRequest) => {
      const skill: DefinedSkill =
        'catalogId' in req
          ? {
              id: `skill-${Date.now()}`,
              name: req.name,
              description: req.description,
              catalogId: req.catalogId,
            }
          : {
              id: `skill-${Date.now()}`,
              name: req.name,
              description: req.description,
            };
      definedSkills = [...definedSkills, skill];
      return skill;
    },
    deleteSkill: async ({ id }) => {
      definedSkills = definedSkills.filter(skill => skill.id !== id);
    },
  },
  sandboxCatalog: {
    getSandboxProviderCatalog: async () => [],
    listSandboxProviders: async () => [],
    createSandboxProvider: async req => ({
      id: `sandbox-${Date.now()}`,
      name: req.name,
      catalogId: req.catalogId,
      isConnected: true,
      execTimeoutMs: req.execTimeoutMs,
      autoStopIntervalInMinutes: req.autoStopIntervalInMinutes,
      autoArchiveIntervalInMinutes: req.autoArchiveIntervalInMinutes,
      autoDeleteIntervalInMinutes: req.autoDeleteIntervalInMinutes,
    }),
    updateSandboxProvider: async req => ({
      id: req.id,
      name: req.id,
      catalogId: req.id,
      isConnected: true,
      execTimeoutMs: req.execTimeoutMs,
      autoStopIntervalInMinutes: req.autoStopIntervalInMinutes,
      autoArchiveIntervalInMinutes: req.autoArchiveIntervalInMinutes,
      autoDeleteIntervalInMinutes: req.autoDeleteIntervalInMinutes,
    }),
    deleteSandboxProvider: async () => undefined,
  },
};

export default function App() {
  const apiKey = import.meta.env.VITE_TFY_API_KEY?.trim() ?? '';
  const controlPlaneURL = import.meta.env.VITE_TFY_CONTROL_PLANE_URL?.trim() ?? '';
  const gatewayPlaneURL = import.meta.env.VITE_TFY_GATEWAY_URL?.trim() || undefined;

  const missing = [!apiKey && 'VITE_TFY_API_KEY', !controlPlaneURL && 'VITE_TFY_CONTROL_PLANE_URL'].filter(
    Boolean,
  ) as string[];

  if (missing.length > 0) {
    return <MissingEnv missing={missing} />;
  }

  return (
    <div className="flex h-dvh min-h-0 w-full flex-1 flex-col">
      <TrueforgeUI
        server={{
          type: 'truefoundry',
          apiKey,
          controlPlaneURL,
          ...(gatewayPlaneURL ? { gatewayPlaneURL } : {}),
          catalog: emptyCatalog,
        }}
        agentConfig={{ mode: 'AgentLibraryWithComposer' }}
        theme={{
          preset: 'claude',
          brand: {
            logo: {
              src: 'https://media.licdn.com/dms/image/v2/C560BAQGQ9Tfeof4MbA/company-logo_200_200/company-logo_200_200/0/1644494262340/truefoundry_logo?e=2147483647&v=beta&t=Xm6c1LGNbVPD2Ehtj21Z5OcuSCGLhYwlJ763oEYb92M',
            },
            name: 'TrueForge',
          },
        }}
        layout="sidebar"
        className="h-full min-h-0"
      />
    </div>
  );
}
