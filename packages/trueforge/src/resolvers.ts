import type { Kysely, Transaction } from 'kysely';
import type { Logger } from 'winston';
import type { ResolveTurnExecutionStoresInput, TurnExecutionStores } from './apis/turns';
import {
  type ResolveMcpServerStoreInput,
  type ResolveModelProviderStoreInput,
  type ResolveSkillStoreInput,
  type ResolveTurnSkillsStoreInput,
} from './app';
import { resolveRequestContext, type RequestContext } from './auth/identity';
import configuration from './config';
import type { AgentRecord, IAgentStore } from './db/agentStore';
import { EmptyCapabilitiesStore } from './db/capabilitiesStore';
import type { IMcpServerStore, IMcpServerWithAuthStore } from './db/mcpServerStore';
import { McpServerWithAuthStore } from './db/McpServerWithAuthStore';
import type { IModelProviderStore } from './db/modelProviderStore';
import type { PostgresAgentStore } from './db/postgres/agent-store/PostgresAgentStore';
import type { Database as PostgresDatabase } from './db/postgres/types';
import type { ISandboxProviderStore } from './db/sandboxProviderStore';
import type { ISkillStore } from './db/skillStore';
import type { IWebSearchProviderStore } from './db/webSearchProviderStore';
import type { IOAuthTokenStore } from './mcp/auth/types';
import { headerValue } from './truefoundry/gatewayMetadata';
import { InlineMcpServerStore } from './truefoundry/InlineMcpServerStore';
import { InlineModelProviderStore } from './truefoundry/InlineModelProviderStore';
import {
  assertInlineResourceHeadersAllowed,
  parseInlineMcpServers,
  parseInlineModelProviders,
  parseInlineSkills,
  parseInlineTools,
  X_TFG_MCP,
  X_TFG_MODELS,
  X_TFG_SKILLS,
  X_TFG_TOOLS,
  type InlineMcpServers,
  type InlineModelProviders,
  type InlineSkills,
} from './truefoundry/inlineResources';
import { InlineSkillStore } from './truefoundry/InlineSkillStore';
import { InlineCapabilitiesStore } from './truefoundry/inlineTools';
import {
  parsePerServerMcpHeaders,
  X_TFG_MCP_HEADERS,
  type PerServerMcpHeaders,
} from './truefoundry/perServerMcpHeaders';
import { TrueFoundryAgentStore } from './truefoundry/TrueFoundryAgentStore';
import { TrueFoundryMcpServerStore } from './truefoundry/TrueFoundryMcpServerStore';
import { TrueFoundryModelProviderStore } from './truefoundry/TrueFoundryModelProviderStore';
import type { TrueFoundryServiceFoundryServerClient } from './truefoundry/TrueFoundryServiceFoundryServerClient';
import { TrueFoundryAdminSkillStore, TrueFoundrySkillStore } from './truefoundry/TrueFoundrySkillStore';

/** ------------------------------------------------------------------------
 * Persistence-layer model store resolve (RequestContext, not Hono Context)
 * -------------------------------------------------------------------------
 */
export type ResolveModelProviderStore<TTransaction> = (input: {
  rc: RequestContext;
  runAsAgent?: AgentRecord;
  inlineModelProviders?: InlineModelProviders;
}) => IModelProviderStore<TTransaction>;

/** Persistence-layer MCP store resolve (RequestContext, not Hono Context). */
export type ResolveMcpServerStore<TTransaction> = (input: {
  rc: RequestContext;
  runAsAgent?: AgentRecord;
  perServerHeaders?: PerServerMcpHeaders;
  inlineMcpServers?: InlineMcpServers;
}) => IMcpServerWithAuthStore<TTransaction>;

/** Turn skill mounts: closed-set `x-tfg-skills`, else the registry/DB store. */
export type ResolveSkillStore<TTransaction> = (rc: RequestContext) => ISkillStore<TTransaction>;

/** Turn skill mounts: closed-set `x-tfg-skills`, else the registry/DB store. */
export type ResolveTurnSkillsStore<TTransaction> = (input: {
  inlineSkills?: InlineSkills;
}) => Pick<ISkillStore<TTransaction>, 'resolveTurnSkills'>;

/** Per-request agent store decorator over DB persistence, else the persistence store. */
export type ResolveAgentStore<TTransaction> = (rc: RequestContext) => IAgentStore<TTransaction>;

/**
 * Per-request model-provider store over a shared ServiceFoundry client, else the persistence store.
 * `runAsAgent` is set only when a turn should use a saved agent's token.
 */
export function buildResolveModelProviderStore<TTransaction>(options: {
  persistenceStore: IModelProviderStore<TTransaction>;
  client: TrueFoundryServiceFoundryServerClient | undefined;
  logger: Logger;
}): ResolveModelProviderStore<TTransaction> {
  return input => {
    const { persistenceStore, client } = options;
    if (client) {
      const store = new TrueFoundryModelProviderStore<TTransaction>({
        client,
        requestContext: input.rc,
        agent: input.runAsAgent,
        logger: options.logger,
      });
      if (input.inlineModelProviders) {
        return new InlineModelProviderStore({ inner: store, inline: input.inlineModelProviders });
      }
      return store;
    }
    return persistenceStore;
  };
}

/**
 * Per-request MCP store over ServiceFoundry. `runAsAgent` selects a saved agent's token for turns.
 */
export function buildResolveMcpServerStore<TTransaction>(options: {
  persistenceStore: IMcpServerStore<TTransaction>;
  tokenStore: IOAuthTokenStore<TTransaction>;
  client: TrueFoundryServiceFoundryServerClient | undefined;
  logger: Logger;
}): ResolveMcpServerStore<TTransaction> {
  const withAuthMcpPersistenceStore = new McpServerWithAuthStore<TTransaction>({
    store: options.persistenceStore,
    tokenStore: options.tokenStore,
    clientName: configuration.MCP_DCR_OAUTH_CLIENT_NAME,
  });
  return input => {
    const { client } = options;
    if (client) {
      const store = new TrueFoundryMcpServerStore<TTransaction>({
        client,
        requestContext: input.rc,
        agent: input.runAsAgent,
        logger: options.logger,
        ...(input.perServerHeaders === undefined ? {} : { perServerHeaders: input.perServerHeaders }),
      });
      if (input.inlineMcpServers) {
        return new InlineMcpServerStore({ inner: store, inline: input.inlineMcpServers });
      }
      return store;
    }
    return withAuthMcpPersistenceStore;
  };
}

/** Per-request SFY skill catalog; otherwise the persistence store. Caller JWT for list/validate. */
export function buildResolveSkillStore<TTransaction>(options: {
  persistenceStore: ISkillStore<TTransaction>;
  client: TrueFoundryServiceFoundryServerClient | undefined;
}): ResolveSkillStore<TTransaction> {
  const { persistenceStore, client } = options;
  if (client) {
    return requestContext =>
      new TrueFoundrySkillStore<TTransaction>({
        client,
        requestContext,
      });
  }
  return () => persistenceStore;
}

/**
 * Turn skill mounts. Registry path uses the service API key; `inlineSkills` is a closed set from
 * `x-tfg-skills` with no registry lookup.
 */
export function buildResolveTurnSkillsStore<TTransaction>(options: {
  persistenceStore: ISkillStore<TTransaction>;
  client: TrueFoundryServiceFoundryServerClient | undefined;
}): ResolveTurnSkillsStore<TTransaction> {
  const { persistenceStore, client } = options;
  return input => {
    if (input.inlineSkills !== undefined) {
      return new InlineSkillStore({ inline: input.inlineSkills });
    }
    if (client) {
      return new TrueFoundryAdminSkillStore({ client });
    }
    return persistenceStore;
  };
}

/** Per-request agent store decorator over DB persistence, else the persistence store. */
export function buildResolveAgentStore(options: {
  persistenceStore: PostgresAgentStore;
  db: Kysely<PostgresDatabase>;
  client: TrueFoundryServiceFoundryServerClient | undefined;
  logger: Logger;
}): ResolveAgentStore<Transaction<PostgresDatabase>> {
  const { persistenceStore, client, db, logger } = options;
  return requestContext => {
    if (client) {
      return new TrueFoundryAgentStore({
        inner: persistenceStore,
        client,
        requestContext,
        db,
        logger,
      });
    }
    return persistenceStore;
  };
}

/** Catalog skill store: caller JWT, plus a closed `x-tfg-skills` set when inline resources are allowed. */
interface SkillStoreForInput {
  requestContext: RequestContext;
  headers?: Record<string, string> | undefined;
  allowInlineResources?: boolean;
}

/** Turn skill mounts. No request context: registry, or a closed `x-tfg-skills` set. */
interface TurnSkillStoreForInput {
  headers?: Record<string, string> | undefined;
  allowInlineResources?: boolean;
}

/** Turn capabilities. No request context: empty, or a closed `x-tfg-tools` set. */
interface CapabilitiesStoreForInput {
  headers?: Record<string, string> | undefined;
  allowInlineResources?: boolean;
}

/**
 * HTTP and peer entrypoints share these. HTTP passes Hono `Context`; a peered send passes the
 * forwarded request context and headers.
 */
export function createRequestStoreResolvers<TTransaction>(input: {
  isTrueFoundryMode: boolean;
  mcpOAuthStore: IMcpServerWithAuthStore<TTransaction>;
  resolveAgentStore: ResolveAgentStore<TTransaction>;
  resolveMcpServerStore: ResolveMcpServerStore<TTransaction>;
  resolveModelProviderStore: ResolveModelProviderStore<TTransaction>;
  resolveSkillStore: ResolveSkillStore<TTransaction>;
  resolveTurnSkillsStore: ResolveTurnSkillsStore<TTransaction>;
  sandboxProviderStore: ISandboxProviderStore<TTransaction>;
  webSearchProviderStore: IWebSearchProviderStore<TTransaction>;
}): {
  resolveMcpServerStore: (mcpInput: ResolveMcpServerStoreInput) => IMcpServerWithAuthStore<TTransaction>;
  resolveModelProviderStore: (modelInput: ResolveModelProviderStoreInput) => IModelProviderStore<TTransaction>;
  resolveSkillStore: (skillInput: ResolveSkillStoreInput) => ISkillStore<TTransaction>;
  resolveTurnExecutionStores: (
    turnInput: ResolveTurnExecutionStoresInput<TTransaction>,
  ) => Promise<TurnExecutionStores<TTransaction>>;
  resolveTurnSkillsStore: (
    skillsInput: ResolveTurnSkillsStoreInput,
  ) => Pick<ISkillStore<TTransaction>, 'resolveTurnSkills'>;
} {
  const { isTrueFoundryMode, mcpOAuthStore, sandboxProviderStore, webSearchProviderStore } = input;

  // x-tfg-skills / x-tfg-mcp / x-tfg-models are rejected unless allowInlineResources
  // (inline session create or spec replace, or a turn for an inline session).
  // x-tfg-mcp-headers is separate (per-server invoke headers).
  const inlineHeader = (headerInput: {
    headers: Record<string, string> | undefined;
    name: string;
    allowInlineResources: boolean;
  }): string | undefined => {
    const raw = headerValue(headerInput.headers, headerInput.name);
    if (raw === undefined) {
      return undefined;
    }
    assertInlineResourceHeadersAllowed({
      headerNames: [headerInput.name],
      isTrueFoundryMode,
      allowInlineResources: headerInput.allowInlineResources,
    });
    return raw;
  };
  const modelProviderStoreFor = (storeInput: {
    requestContext: RequestContext;
    headers?: Record<string, string> | undefined;
    allowInlineResources?: boolean;
    runAsAgent?: AgentRecord;
  }) => {
    const { requestContext, headers, allowInlineResources, runAsAgent } = storeInput;
    const rawInlineModelsHeader = inlineHeader({
      headers,
      name: X_TFG_MODELS,
      allowInlineResources: allowInlineResources ?? false,
    });
    return input.resolveModelProviderStore({
      rc: requestContext,
      ...(runAsAgent !== undefined ? { runAsAgent } : {}),
      ...(rawInlineModelsHeader !== undefined
        ? { inlineModelProviders: parseInlineModelProviders(rawInlineModelsHeader) }
        : {}),
    });
  };
  const mcpServerStoreFor = (storeInput: {
    requestContext: RequestContext;
    headers?: Record<string, string> | undefined;
    allowInlineResources?: boolean;
    runAsAgent?: AgentRecord;
  }) => {
    const { requestContext, headers, allowInlineResources, runAsAgent } = storeInput;
    const rawInlineMcpHeader = inlineHeader({
      headers,
      name: X_TFG_MCP,
      allowInlineResources: allowInlineResources ?? false,
    });
    const rawPerServerHeaders = headerValue(headers, X_TFG_MCP_HEADERS);
    return input.resolveMcpServerStore({
      rc: requestContext,
      ...(runAsAgent !== undefined ? { runAsAgent } : {}),
      ...(rawPerServerHeaders !== undefined ? { perServerHeaders: parsePerServerMcpHeaders(rawPerServerHeaders) } : {}),
      ...(rawInlineMcpHeader !== undefined ? { inlineMcpServers: parseInlineMcpServers(rawInlineMcpHeader) } : {}),
    });
  };
  const skillStoreFor = (storeInput: SkillStoreForInput) => {
    const { requestContext, headers, allowInlineResources } = storeInput;
    const rawInlineSkillsHeader = inlineHeader({
      headers,
      name: X_TFG_SKILLS,
      allowInlineResources: allowInlineResources ?? false,
    });
    if (rawInlineSkillsHeader === undefined) {
      return input.resolveSkillStore(requestContext);
    }
    return new InlineSkillStore({ inline: parseInlineSkills(rawInlineSkillsHeader) });
  };
  const turnSkillStoreFor = (storeInput: TurnSkillStoreForInput) => {
    const { headers, allowInlineResources } = storeInput;
    const rawInlineSkillsHeader = inlineHeader({
      headers,
      name: X_TFG_SKILLS,
      allowInlineResources: allowInlineResources ?? false,
    });
    return input.resolveTurnSkillsStore(
      rawInlineSkillsHeader === undefined ? {} : { inlineSkills: parseInlineSkills(rawInlineSkillsHeader) },
    );
  };
  const capabilitiesStoreFor = (storeInput: CapabilitiesStoreForInput) => {
    const { headers, allowInlineResources } = storeInput;
    const rawInlineToolsHeader = inlineHeader({
      headers,
      name: X_TFG_TOOLS,
      allowInlineResources: allowInlineResources ?? false,
    });
    if (rawInlineToolsHeader === undefined) {
      return new EmptyCapabilitiesStore();
    }
    return new InlineCapabilitiesStore({ inline: parseInlineTools(rawInlineToolsHeader) });
  };
  const resolveModelProviderStore = (modelInput: ResolveModelProviderStoreInput) => {
    const { c, allowInlineResources, runAsAgent } = modelInput;
    return modelProviderStoreFor({
      requestContext: resolveRequestContext(c),
      headers: c.req.header(),
      ...(allowInlineResources !== undefined ? { allowInlineResources } : {}),
      ...(runAsAgent !== undefined ? { runAsAgent } : {}),
    });
  };
  const resolveMcpServerStore = (mcpInput: ResolveMcpServerStoreInput) => {
    const { c, allowInlineResources, runAsAgent } = mcpInput;
    if (c === undefined) {
      return mcpOAuthStore;
    }
    return mcpServerStoreFor({
      requestContext: resolveRequestContext(c),
      headers: c.req.header(),
      ...(allowInlineResources !== undefined ? { allowInlineResources } : {}),
      ...(runAsAgent !== undefined ? { runAsAgent } : {}),
    });
  };
  // Catalog and agent saves reject x-tfg-skills. Inline session create and spec replace opt in and get a
  // closed-set store for validation only; the header is not persisted.
  const resolveSkillStore = (skillInput: ResolveSkillStoreInput) => {
    const { c, allowInlineResources } = skillInput;
    return skillStoreFor({
      requestContext: resolveRequestContext(c),
      headers: c.req.header(),
      ...(allowInlineResources !== undefined ? { allowInlineResources } : {}),
    });
  };
  // Turn mounts: registry (API key), or closed-set header skills when `c` + allowInlineResources.
  // Schedules omit `c` and always get the registry/DB store.
  const resolveTurnSkillsStore = (skillsInput: ResolveTurnSkillsStoreInput) => {
    const { c, allowInlineResources } = skillsInput;
    if (c === undefined) {
      return input.resolveTurnSkillsStore({});
    }
    return turnSkillStoreFor({
      headers: c.req.header(),
      ...(allowInlineResources !== undefined ? { allowInlineResources } : {}),
    });
  };
  const resolveTurnExecutionStores = (turnInput: ResolveTurnExecutionStoresInput<TTransaction>) => {
    const { runAsAgent } = turnInput;
    const allowInlineResources = turnInput.session.record.agent.type === 'inline';
    // x-tfg-tools is per turn and is not stored. Schedules omit headers and mount nothing.
    return Promise.resolve({
      agentStore: input.resolveAgentStore(turnInput.requestContext),
      capabilitiesStore: capabilitiesStoreFor({
        headers: turnInput.requestHeaders,
        allowInlineResources,
      }),
      modelProviderStore: modelProviderStoreFor({
        requestContext: turnInput.requestContext,
        headers: turnInput.requestHeaders,
        allowInlineResources,
        ...(runAsAgent !== undefined ? { runAsAgent } : {}),
      }),
      mcpServerStore: mcpServerStoreFor({
        requestContext: turnInput.requestContext,
        headers: turnInput.requestHeaders,
        allowInlineResources,
        ...(runAsAgent !== undefined ? { runAsAgent } : {}),
      }),
      skillStore: turnSkillStoreFor({ headers: turnInput.requestHeaders, allowInlineResources }),
      sandboxProviderStore,
      webSearchProviderStore,
    });
  };

  return {
    resolveMcpServerStore,
    resolveModelProviderStore,
    resolveSkillStore,
    resolveTurnExecutionStores,
    resolveTurnSkillsStore,
  };
}
