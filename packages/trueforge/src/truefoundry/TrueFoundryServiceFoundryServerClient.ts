// TODO(mcp):
// 1. List + auth status — `GET v1/mcp` is expensive when SFY attaches per-caller
//    authorization / auth-status work. Stop requesting/using auth status on list in
//    TrueForge, or fix servicefoundry-server so list is a lean registry read (auth status
//    only on `/auth/status` / authorize).
// 2. Name → id — `getMcpServerByName` relies on list `name EQUAL` then a full-list
//    fallback; no dedicated get-by-name. Prefer a stable SFY lookup (or accept filter as
//    canonical and drop the fallback) so authorize/status/revoke do not re-list.
// 5. Subject model — interactive auth should key off the caller Bearer / SFY session;
//    `subjectId`/`subjectType` on status/delete are unfinished. Schedules, virtual
//    accounts, and agent-identity MCP auth are out of scope for the POC.
import { extractErrorLogFields } from '@truefoundry/trueforge-core/core';
import { HTTPException } from 'hono/http-exception';
import { fetch as undiciFetch, type Dispatcher } from 'undici';
import type { Logger } from 'winston';
import { z } from 'zod';

import { createInternalTlsDispatcher, normalizeInternalTlsUrl, type InternalTlsOptions } from './internalTls';
import type { SfyMcpAuthorizeOrStatusResponse } from './mapMcpAuth';

const INTEGRATIONS_PATH = 'v1/provider-integrations';
const INSTALLATIONS_PATH = 'v1/llm-gateway/installations';
const MCP_SERVERS_PATH = 'v1/mcp';
const INTEGRATIONS_PAGE_SIZE = 1000;
const MCP_SERVERS_PAGE_SIZE = 100;

/** Placeholder in SFY `proxyUrl` replaced with the tenant gateway base URL. */
export const MCP_PROXY_BASE_URL_TEMPLATE = '{{mcpProxyBaseURL}}';

const ListResponseSchema = z.union([
  z.array(z.unknown()),
  z.object({
    data: z.array(z.unknown()).catch([]),
    pagination: z.object({ total: z.number().optional() }).optional(),
  }),
]);

const ServiceFoundryErrorSchema = z.object({
  message: z.union([z.string(), z.array(z.string())]).optional(),
});

async function readServiceFoundryErrorMessage(
  response: Awaited<ReturnType<typeof undiciFetch>>,
): Promise<string | undefined> {
  const body = await response.json().catch(() => undefined);
  const parsed = ServiceFoundryErrorSchema.safeParse(body);
  const message = parsed.success ? parsed.data.message : undefined;
  return Array.isArray(message) ? message.join(', ') : message;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Normalize SFY `createdAt` / `updatedAt` (ISO string or Date) to ISO-8601 UTC. */
function readIsoTimestamp(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
  }
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString();
  }
  return undefined;
}

function readDataArray(payload: unknown): unknown[] {
  const parsed = ListResponseSchema.safeParse(payload);
  if (!parsed.success) {
    return [];
  }
  return Array.isArray(parsed.data) ? parsed.data : parsed.data.data;
}

function readPaginationTotal(payload: unknown): number | undefined {
  const parsed = ListResponseSchema.safeParse(payload);
  if (!parsed.success || Array.isArray(parsed.data)) {
    return undefined;
  }
  return parsed.data.pagination?.total;
}

/** Fields TrueForge needs from a ServiceFoundry MCP server list/get row. */
export interface SfyMcpServerSummary {
  id: string;
  name: string;
  tenantName: string;
  description: string;
  // TODO(mcp): often still contains `{{mcpProxyBaseURL}}` until callers run
  // `resolveMcpProxyUrl`; easy to misuse if treated as a dialable URL.
  /** Template URL with `{{mcpProxyBaseURL}}`, or an already-absolute proxy URL. */
  proxyUrl: string;
  /** Manifest `auth.type` when present (e.g. `oauth2`, `header`). */
  authType: string | undefined;
  /** ISO-8601 UTC from SFY `createdAt`. */
  createdAt: string;
  /** ISO-8601 UTC from SFY `updatedAt`. */
  updatedAt: string;
}

export interface SfyMcpAuthorizeParams {
  gatewayBaseURL?: string | undefined;
  redirectURL?: string | undefined;
}

export interface SfyMcpDeleteAuthBody {
  authSource: 'oauth' | 'auth-override';
  subjectId: string;
  subjectType: 'user' | 'virtualaccount';
}

export class TrueFoundryServiceFoundryServerClient {
  readonly #baseUrl: string;
  readonly #logger: Logger | undefined;
  readonly #dispatcher: Dispatcher | undefined;

  constructor(input: { serviceFoundryServerUrl: string; logger?: Logger; tls?: InternalTlsOptions }) {
    const tls = input.tls ?? { enabled: false, dir: '' };
    this.#baseUrl = normalizeInternalTlsUrl({ url: input.serviceFoundryServerUrl, enabled: tls.enabled }).replace(
      /\/+$/,
      '',
    );
    this.#dispatcher = createInternalTlsDispatcher(tls);
    this.#logger = input.logger;
  }

  async listProviderIntegrations(accessToken: string): Promise<unknown[]> {
    const items: unknown[] = [];
    let offset = 0;
    for (;;) {
      const payload = await this.#requestJson(
        this.#url(INTEGRATIONS_PATH, {
          type: 'model',
          offset: String(offset),
          limit: String(INTEGRATIONS_PAGE_SIZE),
        }),
        { accessToken },
      );
      const page = readDataArray(payload);
      const total = readPaginationTotal(payload);
      items.push(...page);
      if (total === undefined || items.length >= total || page.length === 0) {
        break;
      }
      offset = items.length;
    }
    return items;
  }

  listGatewayInstallations(accessToken: string): Promise<unknown> {
    return this.#requestJson(this.#url(INSTALLATIONS_PATH), { accessToken });
  }

  /**
   * Paginated `GET v1/mcp`.
   * TODO(mcp): SFY currently loads the full set then slices; this client still walks
   * offset/limit as if the server paginated. Fine for small tenants; fix with SFY or
   * a single fetch once list is lean (see file-level TODO 1).
   */
  async listMcpServers(accessToken: string): Promise<SfyMcpServerSummary[]> {
    const items: SfyMcpServerSummary[] = [];
    let offset = 0;
    for (;;) {
      const payload = await this.#requestJson(
        this.#url(MCP_SERVERS_PATH, {
          offset: String(offset),
          limit: String(MCP_SERVERS_PAGE_SIZE),
        }),
        { accessToken },
      );
      const page = readDataArray(payload)
        .map(parseSfyMcpServerSummary)
        .filter((row): row is SfyMcpServerSummary => row !== undefined);
      const total = readPaginationTotal(payload);
      items.push(...page);
      if (total === undefined || items.length >= total || page.length === 0) {
        break;
      }
      offset = items.length;
    }
    return items;
  }

  /**
   * Resolve one MCP server by name (list filter `name EQUAL`, else full list).
   * Returns `undefined` when the tenant has no server with that name.
   */
  async getMcpServerByName(accessToken: string, name: string): Promise<SfyMcpServerSummary | undefined> {
    const filter = JSON.stringify({
      op: 'AND',
      value: [{ field: 'name', op: 'EQUAL', value: name }],
    });
    const payload = await this.#requestJson(this.#url(MCP_SERVERS_PATH, { filter, limit: '1', offset: '0' }), {
      accessToken,
    });
    const filtered = readDataArray(payload)
      .map(parseSfyMcpServerSummary)
      .filter((row): row is SfyMcpServerSummary => row !== undefined);
    const match = filtered.find(row => row.name === name);
    if (match !== undefined) {
      return match;
    }

    // Filter operators vary by deployment; fall back to a full list once.
    const all = await this.listMcpServers(accessToken);
    return all.find(row => row.name === name);
  }

  getMcpAuthStatus(
    accessToken: string,
    mcpServerId: string,
    params: { subjectId: string; subjectType: string },
  ): Promise<SfyMcpAuthorizeOrStatusResponse> {
    return this.#requestJson(
      this.#url(`${MCP_SERVERS_PATH}/${encodeURIComponent(mcpServerId)}/auth/status`, {
        subjectId: params.subjectId,
        subjectType: params.subjectType,
      }),
      { accessToken },
    ).then(assertSfyMcpAuthResponse);
  }

  authorizeMcpServer(
    accessToken: string,
    mcpServerId: string,
    params: SfyMcpAuthorizeParams = {},
  ): Promise<SfyMcpAuthorizeOrStatusResponse> {
    const search: Record<string, string> = {};
    if (params.gatewayBaseURL !== undefined && params.gatewayBaseURL.length > 0) {
      search['gatewayBaseURL'] = params.gatewayBaseURL;
    }
    if (params.redirectURL !== undefined && params.redirectURL.length > 0) {
      search['redirectURL'] = params.redirectURL;
    }
    return this.#requestJson(this.#url(`${MCP_SERVERS_PATH}/${encodeURIComponent(mcpServerId)}/authorize`, search), {
      accessToken,
    }).then(assertSfyMcpAuthResponse);
  }

  async deleteMcpAuth(accessToken: string, mcpServerId: string, body: SfyMcpDeleteAuthBody): Promise<void> {
    await this.#requestJson(this.#url(`${MCP_SERVERS_PATH}/${encodeURIComponent(mcpServerId)}/auth`), {
      accessToken,
      method: 'DELETE',
      body,
    });
  }

  #url(path: string, search?: Record<string, string>): URL {
    const url = new URL(`${this.#baseUrl}/${path}`);
    if (search) {
      for (const [key, value] of Object.entries(search)) {
        url.searchParams.set(key, value);
      }
    }
    return url;
  }

  async #requestJson(
    url: URL,
    options: { accessToken: string; method?: string; body?: unknown },
  ): Promise<unknown> {
    const startedAt = Date.now();
    const method = options.method ?? 'GET';
    let response: Awaited<ReturnType<typeof undiciFetch>>;
    try {
      response = await undiciFetch(url, {
        method,
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${options.accessToken}`,
          ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
        ...(this.#dispatcher ? { dispatcher: this.#dispatcher } : {}),
      });
    } catch (error) {
      this.#logger?.warn('TrueFoundry ServiceFoundry server request failed', {
        url: url.href,
        method,
        durationMs: Date.now() - startedAt,
        ...extractErrorLogFields(error),
      });
      throw new HTTPException(500, {
        message: 'TrueFoundry ServiceFoundry server request failed',
        cause: error,
      });
    }
    this.#logger?.info('TrueFoundry ServiceFoundry server request completed', {
      url: url.href,
      method,
      status: response.status,
      durationMs: Date.now() - startedAt,
    });
    if (response.status === 401 || response.status === 403) {
      throw new HTTPException(response.status, {
        message: 'TrueFoundry ServiceFoundry server rejected the request',
      });
    }
    if (response.status === 404) {
      throw new HTTPException(404, {
        message: 'TrueFoundry ServiceFoundry resource not found',
      });
    }
    if (!response.ok) {
      const detail = await readServiceFoundryErrorMessage(response);
      throw new HTTPException(424, {
        message: `TrueFoundry ServiceFoundry server request failed: ${detail ?? `HTTP ${String(response.status)}`}`,
      });
    }
    if (response.status === 204) {
      return undefined;
    }
    const text = await response.text();
    if (text.length === 0) {
      return undefined;
    }
    return JSON.parse(text) as unknown;
  }
}

/**
 * Substitute `{{mcpProxyBaseURL}}` in an SFY proxy URL template.
 * TODO(mcp): callers must run this before dialing; see `SfyMcpServerSummary.proxyUrl`.
 */
export function resolveMcpProxyUrl(proxyUrl: string, gatewayBaseURL: string): string {
  const base = gatewayBaseURL.replace(/\/+$/, '');
  if (!proxyUrl.includes(MCP_PROXY_BASE_URL_TEMPLATE)) {
    return proxyUrl;
  }
  return proxyUrl.replaceAll(MCP_PROXY_BASE_URL_TEMPLATE, base);
}

/** `tenant:mcp-server:name` → name; undefined when the FQN is not that shape. */
function nameFromFqn(fqn: string | undefined): string | undefined {
  if (fqn === undefined) {
    return undefined;
  }
  const parts = fqn.split(':');
  if (parts.length < 3 || parts[1] !== 'mcp-server') {
    return undefined;
  }
  return parts.slice(2).join(':') || undefined;
}

function parseSfyMcpServerSummary(row: unknown): SfyMcpServerSummary | undefined {
  if (!isRecord(row)) {
    return undefined;
  }
  const id = readString(row['id']);
  const tenantName = readString(row['tenantName']);
  const proxyUrl = readString(row['proxyUrl']);
  const manifest = isRecord(row['manifest']) ? row['manifest'] : {};
  const name = readString(row['name']) ?? readString(manifest['name']) ?? nameFromFqn(readString(row['fqn']));
  if (id === undefined || name === undefined || tenantName === undefined || proxyUrl === undefined) {
    return undefined;
  }
  const description = readString(manifest['description']) ?? readString(row['description']) ?? name;
  const auth = isRecord(manifest['auth_data'])
    ? manifest['auth_data']
    : isRecord(manifest['auth'])
      ? manifest['auth']
      : undefined;
  const authType = auth !== undefined ? readString(auth['type']) : undefined;
  const createdAt = readIsoTimestamp(row['createdAt']);
  const updatedAt = readIsoTimestamp(row['updatedAt']);
  if (createdAt === undefined || updatedAt === undefined) {
    return undefined;
  }
  return { id, name, tenantName, proxyUrl, description, authType, createdAt, updatedAt };
}

function assertSfyMcpAuthResponse(payload: unknown): SfyMcpAuthorizeOrStatusResponse {
  if (!isRecord(payload)) {
    throw new HTTPException(502, { message: 'TrueFoundry MCP auth response was not an object' });
  }
  const status = readString(payload['status']);
  if (status === undefined) {
    throw new HTTPException(502, { message: 'TrueFoundry MCP auth response missing status' });
  }
  const authorization_endpoint = readString(payload['authorization_endpoint']);
  return {
    status,
    ...(authorization_endpoint === undefined ? {} : { authorization_endpoint }),
  };
}
