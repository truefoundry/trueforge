/**
 * Writes the server's OpenAPI document to `.github/fern/openapi/openapi.json`
 * (Fern) and `docs/openapi.json` (Mintlify). Both copies must stay identical;
 * CI's Generate SDK workflow commits both after this script runs.
 *
 * The real app is built in-process and asked for its document, so the committed
 * spec cannot drift from what the server serves. Nothing listens or dials out:
 * `.env.test` supplies dummy connection strings.
 */
import type { TurnStreamingEvent } from '@truefoundry/trueforge-core/agent-session';
import { InMemorySessionStore, Sessions } from '@truefoundry/trueforge-core/agent-session';
import { RequestReplyRouter } from '@truefoundry/trueforge-core/request-reply';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import winston from 'winston';
import { buildOpenApiDocument, createServerApp } from '../src/app';
import { McpCatalog } from '../src/catalog/McpCatalog';
import { ModelCatalog } from '../src/catalog/ModelCatalog';
import { SandboxCatalog } from '../src/catalog/SandboxCatalog';
import { SkillCatalog } from '../src/catalog/SkillCatalog';
import configuration from '../src/config';
import { McpServerWithAuthStore } from '../src/db/McpServerWithAuthStore';
import { SqliteAgentStore } from '../src/db/sqlite/agent-store/SqliteAgentStore';
import { createSqliteDb } from '../src/db/sqlite/client';
import { SqliteMcpServerStore } from '../src/db/sqlite/mcp-server-store/SqliteMcpServerStore';
import { SqliteModelProviderStore } from '../src/db/sqlite/model-provider-store/SqliteModelProviderStore';
import { SqliteSandboxProviderStore } from '../src/db/sqlite/sandbox-provider-store/SqliteSandboxProviderStore';
import { SqliteScheduleStore } from '../src/db/sqlite/schedule-store/SqliteScheduleStore';
import { SqliteSessionMetricsStore } from '../src/db/sqlite/session-metrics/SqliteSessionMetricsStore';
import { SqliteSkillStore } from '../src/db/sqlite/skill-store/SqliteSkillStore';
import { SqliteOAuthTokenStore } from '../src/db/sqlite/token-store/SqliteOAuthTokenStore';
import { ActiveTurnRegistry } from '../src/runtime/activeTurns';
import { EventSubscriptionRegistry } from '../src/runtime/event-subscription';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Sorts object keys so the committed document depends only on the API, not on
 * the order Zod happened to register schemas in. Arrays keep their order, since
 * position carries meaning in `required`, `enum` and `anyOf`.
 */
function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalise);
  }
  if (!isRecord(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map(key => [key, canonicalise(value[key])]),
  );
}

// Unconnected stand-ins suffice: route registration never reads a dependency.
const sessionStore = new InMemorySessionStore();
const db = createSqliteDb(':memory:');
const tokenStore = new SqliteOAuthTokenStore(db);
const app = createServerApp({
  modelCatalog: ModelCatalog.load(),
  resolveModelProviderStore: () => new SqliteModelProviderStore(db),
  withTransaction: callback => db.transaction().execute(callback),
  mcpCatalog: McpCatalog.load(),
  resolveMcpServerStore: () =>
    new McpServerWithAuthStore({
      store: new SqliteMcpServerStore(db),
      tokenStore,
      clientName: configuration.MCP_DCR_OAUTH_CLIENT_NAME,
    }),
  tokenStore,
  skillCatalog: SkillCatalog.load(),
  skillStore: new SqliteSkillStore(db),
  sandboxCatalog: SandboxCatalog.load(),
  sandboxProviderStore: new SqliteSandboxProviderStore(db),
  agentStore: new SqliteAgentStore(db),
  scheduleStore: new SqliteScheduleStore(db),
  sessionStore,
  sessionMetricsStore: new SqliteSessionMetricsStore(db),
  sessions: new Sessions({ sessionStore }),
  activeTurns: new ActiveTurnRegistry(),
  requestReplyRouter: new RequestReplyRouter(),
  eventSubscriptions: new EventSubscriptionRegistry<TurnStreamingEvent>(undefined),
  logger: winston.createLogger({ silent: true }),
  oidcClient: undefined,
});

// Runtime apps only advertise BearerAuth when OIDC is configured. The committed
// Fern OpenAPI still documents optional Bearer so the SDK keeps `token` support
// (`buildOpenApiDocument` registers the scheme when authEnabled).
const document = buildOpenApiDocument(app, { authEnabled: true });
const sdkOutputPath = path.join(import.meta.dirname, '../../../.github/fern/openapi/openapi.json');
mkdirSync(path.dirname(sdkOutputPath), { recursive: true });
writeFileSync(sdkOutputPath, `${JSON.stringify(canonicalise(document), null, 2)}\n`);
console.log(`Wrote ${String(Object.keys(document.paths ?? {}).length)} paths to ${sdkOutputPath}`);

// Mintlify cannot consume the Fern path; keep a second identical copy for docs.
const docsOutputPath = path.join(import.meta.dirname, '../../../docs/openapi.json');
mkdirSync(path.dirname(docsOutputPath), { recursive: true });
writeFileSync(docsOutputPath, `${JSON.stringify(canonicalise(document), null, 2)}\n`);
console.log(`Wrote ${String(Object.keys(document.paths ?? {}).length)} paths to ${docsOutputPath}`);
