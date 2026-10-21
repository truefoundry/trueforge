/**
 * Authenticated, stateless Streamable HTTP endpoint for the TrueForge MCP (mounted at /mcp).
 *
 * Each request: authenticate → build a request-scoped SDK client + stateless MCP server → hand the Web
 * Request to the transport. Nothing is retained across requests.
 */
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { RemoteMcpHeaders } from '@truefoundry/trueforge-core/core';
import { TrueForge } from '@truefoundry/trueforge-sdk';
import { Hono } from 'hono';
import type { RequestContext, ResolveRequestContext } from '../../../auth/identity';
import configuration from '../../../config';
import type { GetMcpServerInput, McpServerRecord } from '../../../db/mcpServerStore';
import { internalTlsFetch, normalizeTlsUrl } from '../../../http/tls';
import type {
  AuthorizeMcpServerInput,
  DeleteMcpAuthorizationInput,
  IMcpServerResolver,
  ResolveMcpAuthStatusesInput,
  ResolveMcpInvokeHeadersInput,
} from '../../../runtime/McpServerResolver';
import type { McpAuthStatus } from '../../../schemas/mcpServer';
import { createTrueForgeMcpServer, TRUEFORGE_CONNECTOR_NAME } from './server';

const baseUrl = normalizeTlsUrl({ url: configuration.SERVER_URL, enabled: configuration.MTLS_ENABLED });
const internalFetch = internalTlsFetch(configuration);
const trueForgeMcpUrl = new URL('/mcp', baseUrl).href;

export const TRUEFORGE_CLIENT_HEADER = 'x-trueforge-client';
export const TRUEFORGE_BROWSER_CLIENT = 'browser';

/**
 * Request-scoped SDK client carrying the draft caller's credential. The service API key is
 * intentionally never used here.
 */
function createTrueForgeSDKClient(input: { userCredential: string | null }): TrueForge {
  return new TrueForge({
    baseUrl,
    timeoutInSeconds: 60,
    ...(input.userCredential === null ? { auth: false } : { token: input.userCredential }),
    fetch: internalFetch,
  });
}

/** Canonical self-origin MCP endpoint with its trusted mTLS-aware network policy. */
export const trueForgeMcpEndpoint = {
  url: trueForgeMcpUrl,
  headers: {},
  networkPolicy: {
    type: 'trusted-internal' as const,
    endpoint: trueForgeMcpUrl,
    fetch: internalFetch,
  },
};

/** Request-scoped virtual MCP definition and auth behavior layered over configured MCPs. */
export class TrueForgeMcpServerResolver implements IMcpServerResolver {
  readonly #inner: IMcpServerResolver;
  readonly #requestContext: RequestContext;

  constructor(input: { inner: IMcpServerResolver; requestContext: RequestContext }) {
    this.#inner = input.inner;
    this.#requestContext = input.requestContext;
  }

  getServer(input: GetMcpServerInput): Promise<McpServerRecord | undefined> {
    if (input.name !== TRUEFORGE_CONNECTOR_NAME) {
      return this.#inner.getServer(input);
    }
    const now = new Date().toISOString();
    return Promise.resolve({
      id: TRUEFORGE_CONNECTOR_NAME,
      tenant_id: input.tenant_id,
      name: TRUEFORGE_CONNECTOR_NAME,
      manifest: {
        type: 'remote',
        name: TRUEFORGE_CONNECTOR_NAME,
        url: trueForgeMcpEndpoint.url,
        description:
          'Create, update, and read agents, schedules, and sandbox environments in this deployment. Read configured models, MCP servers, and skills. Does not run agents or turns.',
      },
      created_at: now,
      updated_at: now,
    });
  }

  resolveInvokeHeaders(input: ResolveMcpInvokeHeadersInput): RemoteMcpHeaders {
    if (input.record.name !== TRUEFORGE_CONNECTOR_NAME) {
      return this.#inner.resolveInvokeHeaders(input);
    }
    const trueForgeHeaders = Object.fromEntries(
      Object.entries(input.turnMetadata?.requestHeaders ?? {}).filter(([header]) =>
        header.toLowerCase().startsWith('x-trueforge-'),
      ),
    );
    return {
      ...trueForgeHeaders,
      ...(this.#requestContext.user_credential === null
        ? {}
        : { Authorization: `Bearer ${this.#requestContext.user_credential}` }),
    };
  }

  async resolveAuthStatuses(input: ResolveMcpAuthStatusesInput): Promise<ReadonlyMap<string, McpAuthStatus>> {
    const trueForgeRecords = input.records.filter(record => record.name === TRUEFORGE_CONNECTOR_NAME);
    const otherRecords = input.records.filter(record => record.name !== TRUEFORGE_CONNECTOR_NAME);
    const statuses = new Map(
      otherRecords.length === 0 ? [] : await this.#inner.resolveAuthStatuses({ ...input, records: otherRecords }),
    );
    for (const record of trueForgeRecords) {
      statuses.set(record.name, { status: 'authenticated' });
    }
    return statuses;
  }

  authorize(input: AuthorizeMcpServerInput): Promise<McpAuthStatus> {
    if (input.name === TRUEFORGE_CONNECTOR_NAME) {
      return Promise.resolve({ status: 'authenticated' });
    }
    return this.#inner.authorize(input);
  }

  deleteAuthorization(input: DeleteMcpAuthorizationInput): Promise<void> {
    if (input.name === TRUEFORGE_CONNECTOR_NAME) {
      return Promise.resolve();
    }
    return this.#inner.deleteAuthorization(input);
  }
}

export interface TrueForgeMcpRouterDeps {
  resolveRequestContext: ResolveRequestContext;
  version: string;
}

export function createTrueForgeMcpRouter(deps: TrueForgeMcpRouterDeps): Hono {
  const router = new Hono();
  router.all('/', async c => {
    if (c.req.header(TRUEFORGE_CLIENT_HEADER) !== TRUEFORGE_BROWSER_CLIENT) {
      return c.json({ error: { message: 'TrueForge MCP is available only to browser draft sessions' } }, 403);
    }
    // No standalone event stream. 405 tells the client this server has nothing to listen for.
    if (c.req.method === 'GET') {
      c.header('Allow', 'POST, DELETE');
      return c.body(null, 405);
    }
    const requestContext = deps.resolveRequestContext(c);

    // Built per request: the server's tools close over this caller's credential, and stateless
    // Streamable HTTP wants a fresh server+transport per request to isolate concurrent callers.
    const client = createTrueForgeSDKClient({ userCredential: requestContext.user_credential });
    const server = createTrueForgeMcpServer({ client, version: deps.version });
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    await server.connect(transport);
    try {
      return await transport.handleRequest(c.req.raw);
    } finally {
      void server.close();
    }
  });
  return router;
}
