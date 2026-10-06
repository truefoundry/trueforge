import { createOutboundFetch, type OutboundFetch, type OutboundFetchOptions } from './ssrfGuard';

/** Generic outbound undici headersTimeout. Env: `OUTBOUND_HTTP_HEADERS_TIMEOUT_MS`. */
export const DEFAULT_OUTBOUND_HTTP_HEADERS_TIMEOUT_MS = 5_000;
/** Generic outbound undici connect timeout. Env: `OUTBOUND_HTTP_CONNECT_TIMEOUT_MS`. */
export const DEFAULT_OUTBOUND_HTTP_CONNECT_TIMEOUT_MS = 5_000;
/** Generic outbound undici bodyTimeout. Env: `OUTBOUND_HTTP_BODY_TIMEOUT_MS`. */
export const DEFAULT_OUTBOUND_HTTP_BODY_TIMEOUT_MS = 5_000;
/** Generic outbound fetch retries. Env: `OUTBOUND_HTTP_MAX_RETRIES`. */
export const DEFAULT_OUTBOUND_HTTP_MAX_RETRIES = 2;

/** Model outbound undici headersTimeout. Env: `MODEL_HTTP_HEADERS_TIMEOUT_MS`. */
export const DEFAULT_MODEL_HTTP_HEADERS_TIMEOUT_MS = 5_000;
/** Model outbound undici connect timeout. Env: `MODEL_HTTP_CONNECT_TIMEOUT_MS`. */
export const DEFAULT_MODEL_HTTP_CONNECT_TIMEOUT_MS = 5_000;
/** Model outbound undici bodyTimeout. Env: `MODEL_HTTP_BODY_TIMEOUT_MS`. */
export const DEFAULT_MODEL_HTTP_BODY_TIMEOUT_MS = 60_000;
/** Model outbound fetch retries. Env: `MODEL_HTTP_MAX_RETRIES`. */
export const DEFAULT_MODEL_HTTP_MAX_RETRIES = 2;

/**
 * MCP outbound undici headersTimeout. Env: `MCP_HTTP_HEADERS_TIMEOUT_MS`.
 * Matches the default MCP request timeout: JSON-response servers send headers only after the tool finishes.
 */
export const DEFAULT_MCP_HTTP_HEADERS_TIMEOUT_MS = 2 * 60 * 1000;
/** MCP outbound undici connect timeout. Env: `MCP_HTTP_CONNECT_TIMEOUT_MS`. */
export const DEFAULT_MCP_HTTP_CONNECT_TIMEOUT_MS = 5_000;
/**
 * MCP outbound undici bodyTimeout. Env: `MCP_HTTP_BODY_TIMEOUT_MS`.
 * Default 30m so idle SSE/streamable-HTTP is not killed at undici's 300s.
 */
export const DEFAULT_MCP_HTTP_BODY_TIMEOUT_MS = 30 * 60 * 1000;
/** MCP outbound fetch retries. Env: `MCP_HTTP_MAX_RETRIES`. */
export const DEFAULT_MCP_HTTP_MAX_RETRIES = 2;

export function defaultOutboundFetchOptions(): OutboundFetchOptions {
  return {
    connectTimeoutMs: DEFAULT_OUTBOUND_HTTP_CONNECT_TIMEOUT_MS,
    headersTimeoutMs: DEFAULT_OUTBOUND_HTTP_HEADERS_TIMEOUT_MS,
    bodyTimeoutMs: DEFAULT_OUTBOUND_HTTP_BODY_TIMEOUT_MS,
    maxRetries: DEFAULT_OUTBOUND_HTTP_MAX_RETRIES,
    idempotent: true,
  };
}

export function defaultModelOutboundFetchOptions(): OutboundFetchOptions {
  return {
    connectTimeoutMs: DEFAULT_MODEL_HTTP_CONNECT_TIMEOUT_MS,
    headersTimeoutMs: DEFAULT_MODEL_HTTP_HEADERS_TIMEOUT_MS,
    bodyTimeoutMs: DEFAULT_MODEL_HTTP_BODY_TIMEOUT_MS,
    maxRetries: DEFAULT_MODEL_HTTP_MAX_RETRIES,
    idempotent: true,
  };
}

export function defaultMcpOutboundFetchOptions(): OutboundFetchOptions {
  return {
    connectTimeoutMs: DEFAULT_MCP_HTTP_CONNECT_TIMEOUT_MS,
    headersTimeoutMs: DEFAULT_MCP_HTTP_HEADERS_TIMEOUT_MS,
    bodyTimeoutMs: DEFAULT_MCP_HTTP_BODY_TIMEOUT_MS,
    maxRetries: DEFAULT_MCP_HTTP_MAX_RETRIES,
    // Tool calls are not safe to replay once upstream may have received them.
    idempotent: false,
  };
}

let outbound: OutboundFetch = createOutboundFetch(defaultOutboundFetchOptions());
let modelOutbound: OutboundFetch = createOutboundFetch(defaultModelOutboundFetchOptions());
let mcpOutbound: OutboundFetch = createOutboundFetch(defaultMcpOutboundFetchOptions());

/** Replace outbound Agents (timeouts/retries). Does not change SSRF allow/block lists. */
export function configureOutboundFetches(config: {
  outbound: OutboundFetchOptions;
  model: OutboundFetchOptions;
  mcp: OutboundFetchOptions;
}): void {
  const previousOutbound = outbound;
  const previousModel = modelOutbound;
  const previousMcp = mcpOutbound;
  outbound = createOutboundFetch(config.outbound);
  modelOutbound = createOutboundFetch(config.model);
  mcpOutbound = createOutboundFetch(config.mcp);
  void previousOutbound.close();
  void previousModel.close();
  void previousMcp.close();
}

/** Drop-in fetch for generic short-lived outbound HTTP (not model or MCP). */
export async function ssrfFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  return outbound.fetch(input, init);
}

/** Drop-in fetch for model-provider HTTP. */
export async function modelSsrfFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  return modelOutbound.fetch(input, init);
}

/** Drop-in fetch for remote MCP (long bodyTimeout; does not retry headers timeouts). */
export async function mcpSsrfFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  return mcpOutbound.fetch(input, init);
}
