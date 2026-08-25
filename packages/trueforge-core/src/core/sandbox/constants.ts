/** Default port of the pod-local NATS WebSocket broker used by the sandbox→gateway MCP bridge. */
export const DEFAULT_SANDBOX_NATS_WS_PORT = 4444;

/**
 * Default lifetime of a Daytona signed preview URL for the NATS bridge.
 * Matches the gateway's default AGENT_RESPONSE_MAX_EXECUTION_TIME_MS (1 hour).
 */
export const DEFAULT_PREVIEW_URL_EXPIRY_SECONDS = 3600;
