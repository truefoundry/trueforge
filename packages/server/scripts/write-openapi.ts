/**
 * Writes the server's OpenAPI document to `fern/openapi/openapi.json` for Fern.
 *
 * The real app is built in-process and asked for its document, so the committed
 * spec cannot drift from what the server serves. Nothing listens or dials out:
 * `.env.test` supplies dummy connection strings and the registry fixtures.
 */
import { InMemorySessionStore, Sessions } from '@truefoundry/utils/agent-session';
import { RequestReplyRouter } from '@truefoundry/utils/request-reply';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import winston from 'winston';
import { buildOpenApiDocument, createServerApp } from '../src/app';
import { McpCatalog } from '../src/catalog/McpCatalog';
import { ModelCatalog } from '../src/catalog/ModelCatalog';
import { SkillCatalog } from '../src/catalog/SkillCatalog';
import { createSqliteDb } from '../src/db/sqlite/client';
import { SqliteMcpServerStore } from '../src/db/sqlite/mcp-server-store/SqliteMcpServerStore';
import { SqliteModelProviderStore } from '../src/db/sqlite/model-provider-store/SqliteModelProviderStore';
import { SqliteSkillStore } from '../src/db/sqlite/skill-store/SqliteSkillStore';
import { McpStore } from '../src/legacy-registry-store/McpStore';
import { ModelStore } from '../src/legacy-registry-store/ModelStore';
import { SkillStore } from '../src/legacy-registry-store/SkillStore';
import { ActiveTurnRegistry } from '../src/runtime/activeTurns';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Sorts object keys so the committed document depends only on the API, not on
 * the order Zod happened to register schemas in. Arrays keep their order, since
 * position carries meaning in `required`, `enum` and `anyOf`.
 */
function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalise);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map(key => [key, canonicalise(value[key])]),
  );
}

// Unconnected stand-ins suffice: route registration never reads a dependency.
const sessionStore = new InMemorySessionStore();
const db = createSqliteDb(':memory:');
const app = createServerApp({
  modelStore: ModelStore.load(),
  modelCatalog: ModelCatalog.load(),
  modelProviderStore: new SqliteModelProviderStore(db),
  mcpCatalog: McpCatalog.load(),
  mcpServerStore: new SqliteMcpServerStore(db),
  mcpStore: McpStore.load(),
  skillCatalog: SkillCatalog.load(),
  skillStore: new SqliteSkillStore(db),
  legacySkillStore: SkillStore.load(),
  sessionStore,
  sessions: new Sessions({ sessionStore }),
  activeTurns: new ActiveTurnRegistry(),
  requestReplyRouter: new RequestReplyRouter(),
  logger: winston.createLogger({ silent: true }),
});

const document = buildOpenApiDocument(app);
const outputPath = path.join(import.meta.dirname, '../../../fern/openapi/openapi.json');
mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(canonicalise(document), null, 2)}\n`);
console.log(`Wrote ${String(Object.keys(document.paths ?? {}).length)} paths to ${outputPath}`);
