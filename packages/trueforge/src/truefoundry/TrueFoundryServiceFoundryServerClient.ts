import { extractErrorLogFields } from '@truefoundry/trueforge-core/core';
import { HTTPException } from 'hono/http-exception';
import { fetch as undiciFetch, type Dispatcher } from 'undici';
import type { Logger } from 'winston';
import { z } from 'zod';

import { createInternalTlsDispatcher, normalizeInternalTlsUrl, type InternalTlsOptions } from './internalTls';

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
export interface SfyMcpServerSummary {
  id: string;
  name: string;
  tenantName: string;
  /** May contain `{{mcpProxyBaseURL}}`; callers must run {@link resolveMcpProxyUrl}. */
  proxyUrl: string;
  description: string;
  authType: string | undefined;
  createdAt: string;
  updatedAt: string;
}

export function parseSfyMcpServerSummary(row: unknown): SfyMcpServerSummary | undefined {
  if (!isRecord(row)) {
    return undefined;
  }
  const id = readString(row['id']);
  const name = readString(row['name']);
  const tenantName = readString(row['tenantName']);
  const proxyUrl = readString(row['proxyUrl']);
  if (id === undefined || name === undefined || tenantName === undefined || proxyUrl === undefined) {
    return undefined;
  }
  const manifest = isRecord(row['manifest']) ? row['manifest'] : undefined;
  const description = readString(manifest?.['description']) ?? name;
  const authData = isRecord(manifest?.['auth_data']) ? manifest['auth_data'] : undefined;
  const authType = readString(authData?.['type']);
  const now = new Date().toISOString();
  return {
    id,
    name,
    tenantName,
    proxyUrl,
    description,
    authType,
    createdAt: readIsoTimestamp(row['createdAt']) ?? now,
    updatedAt: readIsoTimestamp(row['updatedAt']) ?? now,
  };
}

/** Substitute `{{mcpProxyBaseURL}}` in an SFY proxy URL template. */
export function resolveMcpProxyUrl(proxyUrl: string, gatewayBaseURL: string): string {
  const base = gatewayBaseURL.replace(/\/+$/, '');
  if (!proxyUrl.includes(MCP_PROXY_BASE_URL_TEMPLATE)) {
    return proxyUrl;
  }
  return proxyUrl.replaceAll(MCP_PROXY_BASE_URL_TEMPLATE, base);
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
      const payload = await this.#getJson(
        this.#url(INTEGRATIONS_PATH, {
          type: 'model',
          offset: String(offset),
          limit: String(INTEGRATIONS_PAGE_SIZE),
        }),
        accessToken,
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
    return this.#getJson(this.#url(INSTALLATIONS_PATH), accessToken);
  }

  /** Paginated `GET v1/mcp`. */
  async listMcpServers(accessToken: string): Promise<SfyMcpServerSummary[]> {
    const items: SfyMcpServerSummary[] = [];
    let offset = 0;
    for (;;) {
      const payload = await this.#getJson(
        this.#url(MCP_SERVERS_PATH, {
          offset: String(offset),
          limit: String(MCP_SERVERS_PAGE_SIZE),
        }),
        accessToken,
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
   * Resolve one MCP server by name via list filter `name EQUAL`.
   * Returns `undefined` when the tenant has no server with that name.
   */
  async getMcpServerByName(accessToken: string, name: string): Promise<SfyMcpServerSummary | undefined> {
    const filter = JSON.stringify({
      op: 'and',
      values: [{ field: 'name', op: 'EQUAL', value: name }],
    });
    const payload = await this.#getJson(this.#url(MCP_SERVERS_PATH, { filter, limit: '1', offset: '0' }), accessToken);
    const match = readDataArray(payload)
      .map(parseSfyMcpServerSummary)
      .filter((row): row is SfyMcpServerSummary => row !== undefined)
      .find(row => row.name === name);
    return match;
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

  async #getJson(url: URL, accessToken: string): Promise<unknown> {
    const startedAt = Date.now();
    let response: Awaited<ReturnType<typeof undiciFetch>>;
    try {
      response = await undiciFetch(url, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${accessToken}`,
        },
        ...(this.#dispatcher ? { dispatcher: this.#dispatcher } : {}),
      });
    } catch (error) {
      this.#logger?.warn('TrueFoundry ServiceFoundry server request failed', {
        url: url.href,
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
      status: response.status,
      durationMs: Date.now() - startedAt,
    });
    if (response.status === 401 || response.status === 403) {
      throw new HTTPException(response.status, {
        message: 'TrueFoundry ServiceFoundry server rejected the request',
      });
    }
    if (!response.ok) {
      const detail = await readServiceFoundryErrorMessage(response);
      throw new HTTPException(424, {
        message: `TrueFoundry ServiceFoundry server request failed: ${detail ?? `HTTP ${String(response.status)}`}`,
      });
    }
    return response.json();
  }
}
