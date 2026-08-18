/** Mintlify API Reference groups — the only OpenAPI `tags` values. */
export enum OpenApiTag {
  AUTH = 'Auth',
  CAPABILITIES = 'Capabilities',
  MODELS = 'Models',
  MCP_SERVERS = 'MCP Servers',
  SKILLS = 'Skills',
  AGENTS = 'Agents',
  SESSIONS = 'Sessions',
}

/** Document-level tag order for `/api/v1/docs` and Mintlify. */
export const OPENAPI_DOCUMENT_TAGS: { name: OpenApiTag }[] = [
  { name: OpenApiTag.AUTH },
  { name: OpenApiTag.CAPABILITIES },
  { name: OpenApiTag.MODELS },
  { name: OpenApiTag.MCP_SERVERS },
  { name: OpenApiTag.SKILLS },
  { name: OpenApiTag.AGENTS },
  { name: OpenApiTag.SESSIONS },
];
