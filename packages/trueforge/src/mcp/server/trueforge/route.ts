/**
 * Authenticated, stateless Streamable HTTP endpoint for the TrueForge MCP (mounted at /mcp).
 *
 * Each request: authenticate → build a request-scoped SDK client + stateless MCP server → hand the Web
 * Request to the transport. Nothing is retained across requests.
 */
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { TrueForge } from '@truefoundry/trueforge-sdk';
import { Hono } from 'hono';
import type { ResolveRequestContext } from '../../../auth/identity';
import configuration from '../../../config';
import { createTlsFetch, normalizeTlsUrl } from '../../../http/tls';
import type { McpToolDescriptor } from './openApiTools';
import { createWireApiClient } from './wireApiClient';

const baseUrl = normalizeTlsUrl({ url: configuration.SERVER_URL, enabled: configuration.MTLS_ENABLED });
const internalFetch = createTlsFetch({
  enabled: configuration.MTLS_ENABLED,
  dir: configuration.MTLS_CERTS_DIR,
});
const trustedMcpUrls = [
  new URL(baseUrl),
  ...(configuration.PUBLIC_BASE_URL === '' ? [] : [new URL(configuration.PUBLIC_BASE_URL)]),
];
const allowedMcpHosts = [...new Set(trustedMcpUrls.map(url => url.host))];
const allowedMcpOrigins = [...new Set(trustedMcpUrls.map(url => url.origin))];
const MAX_MCP_REQUEST_BODY_BYTES = 1024 * 1024;

export interface TrueForgeMcpRouterDeps {
  resolveRequestContext: ResolveRequestContext;
  resolveTools: () => readonly McpToolDescriptor[];
  version: string;
}

export function createTrueForgeMcpRouter(deps: TrueForgeMcpRouterDeps): Hono {
  const router = new Hono();
  router.all('/', async c => {
    // No standalone event stream. 405 tells the client this server has nothing to listen for.
    if (c.req.method === 'GET') {
      c.header('Allow', 'POST, DELETE');
      return c.body(null, 405);
    }
    const requestContext = deps.resolveRequestContext(c);

    // Built per request: the server's tools close over this caller's credential, and stateless
    // Streamable HTTP wants a fresh server+transport per request to isolate concurrent callers.
    const apiClient = new TrueForge({
      baseUrl,
      timeoutInSeconds: 60,
      maxRetries: 0,
      ...(requestContext.user_credential === null ? { auth: false } : { token: requestContext.user_credential }),
      fetch: internalFetch,
    });
    const client = createWireApiClient(apiClient);
    const { createTrueForgeMcpServer } = await import('./server');
    const server = createTrueForgeMcpServer({ client, version: deps.version, tools: deps.resolveTools() });
    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: true,
      enableDnsRebindingProtection: true,
      allowedHosts: allowedMcpHosts,
      allowedOrigins: allowedMcpOrigins,
      maxRequestBodySize: MAX_MCP_REQUEST_BODY_BYTES,
    });
    await server.connect(transport);
    try {
      return await transport.handleRequest(c.req.raw);
    } finally {
      void server.close();
    }
  });
  return router;
}
