/**
 * Writes the server's OpenAPI document to `fern/openapi/openapi.json`, the
 * input Fern generates the SDK from.
 *
 * The app is built in-process and asked for its document — the same call
 * `GET /openapi.json` makes — so the committed spec cannot drift from what the
 */
import { InMemorySessionStore, Sessions } from '@truefoundry/utils/agent-session';
import { RequestReplyRouter } from '@truefoundry/utils/request-reply';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createClient, type RedisClientType } from 'redis';
import winston from 'winston';
import { createServerApp, openApiDocConfig } from '../src/app';
import { ActiveTurnRegistry } from '../src/runtime/activeTurns';
import { McpStore } from '../src/store/McpStore';
import { ModelStore } from '../src/store/ModelStore';
import { SkillStore } from '../src/store/SkillStore';

/** Operation keys of an OpenAPI path item, in the order Fern reads them. */
const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const;

const sessionStore = new InMemorySessionStore();

const redis: RedisClientType = createClient();
const app = createServerApp({
  modelStore: ModelStore.load(),
  mcpStore: McpStore.load(),
  skillStore: SkillStore.load(),
  sessionStore,
  sessions: new Sessions({ sessionStore }),
  activeTurns: new ActiveTurnRegistry(),
  redis,
  requestReplyRouter: new RequestReplyRouter(),
  logger: winston.createLogger({ silent: true }),
});

const document = app.getOpenAPIDocument(openApiDocConfig);

// Fern derives SDK method names from these extensions, not from operationId
// (which this server does not set). An unannotated operation would silently
// generate a method named after its path, so fail the build instead.
const unannotated: string[] = [];
for (const [routePath, pathItem] of Object.entries(document.paths)) {
  for (const method of HTTP_METHODS) {
    const operation: unknown = pathItem[method];
    if (typeof operation !== 'object' || operation === null) continue;
    if (!('x-fern-sdk-method-name' in operation) || !('x-fern-sdk-group-name' in operation)) {
      unannotated.push(`${method.toUpperCase()} ${routePath}`);
    }
  }
}
if (unannotated.length > 0) {
  throw new Error(
    `Operations are missing x-fern-sdk-group-name / x-fern-sdk-method-name:\n${unannotated
      .map(operation => `  - ${operation}`)
      .join('\n')}\nAdd them to the route definition so Fern names the SDK method.`,
  );
}

const outputPath = path.join(import.meta.dirname, '../../../fern/openapi/openapi.json');
mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(document, null, 2)}\n`);
console.log(`Wrote ${String(Object.keys(document.paths).length)} paths to ${outputPath}`);
