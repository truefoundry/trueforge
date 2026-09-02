import { extractErrorLogFields } from '@truefoundry/trueforge-core/core';
import { HTTPException } from 'hono/http-exception';
import { fetch as undiciFetch, type Dispatcher } from 'undici';
import type { Logger } from 'winston';
import { z } from 'zod';

import type { McpAuthStatus } from '../schemas/mcpServer';
import { createInternalTlsDispatcher, normalizeInternalTlsUrl, type InternalTlsOptions } from './internalTls';
import {
  parseSfyMcpAuthStatus,
  parseSfyMcpAuthorizeResult,
  type SfyMcpAuthSource,
  type SfyMcpAuthSubjectType,
} from './mapSfyMcpServers';

const INTEGRATIONS_PATH = 'v1/provider-integrations';
const INSTALLATIONS_PATH = 'v1/llm-gateway/installations';
const MCP_SERVERS_PATH = 'v1/mcp';
const INTEGRATIONS_PAGE_SIZE = 1000;
const MCP_SERVERS_PAGE_SIZE = 100;

const ListResponseSchema = z.union([
  z.array(z.unknown()),
  z.object({
    data: z.array(z.unknown()).catch([]),
    pagination: z.object({ total: z.number().optional() }).optional(),
  }),
]);

type ListResponse = z.infer<typeof ListResponseSchema>;

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

function listPage(response: ListResponse): unknown[] {
  return Array.isArray(response) ? response : response.data;
}

function listPaginationTotal(response: ListResponse): number | undefined {
  return Array.isArray(response) ? undefined : response.pagination?.total;
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
      const payload = await this.#requestJson({
        url: this.#url(INTEGRATIONS_PATH, {
          type: 'model',
          offset: String(offset),
          limit: String(INTEGRATIONS_PAGE_SIZE),
        }),
        accessToken,
        method: 'GET',
      });
      const response = this.#parseListResponse(payload);
      const page = listPage(response);
      const total = listPaginationTotal(response);
      items.push(...page);
      if (total === undefined || items.length >= total || page.length === 0) {
        break;
      }
      offset = items.length;
    }
    return items;
  }

  listGatewayInstallations(accessToken: string): Promise<unknown> {
    return this.#requestJson({
      url: this.#url(INSTALLATIONS_PATH),
      accessToken,
      method: 'GET',
    });
  }

  /**
   * Paginated `GET v1/mcp`. Returns raw SFY rows; callers parse with {@link mapSfyMcpServers}.
   * Offset advances by raw page length (same as {@link listProviderIntegrations}).
   */
  async listMcpServers(accessToken: string): Promise<unknown[]> {
    const items: unknown[] = [];
    let offset = 0;
    for (;;) {
      const payload = await this.#requestJson({
        url: this.#url(MCP_SERVERS_PATH, {
          offset: String(offset),
          limit: String(MCP_SERVERS_PAGE_SIZE),
        }),
        accessToken,
        method: 'GET',
      });
      const response = this.#parseListResponse(payload);
      const page = listPage(response);
      const total = listPaginationTotal(response);
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
   * Returns the first raw row, or `undefined` when the tenant has no match.
   * Callers parse with {@link parseSfyMcpServerSummary}.
   */
  async getMcpServerByName(input: { accessToken: string; name: string }): Promise<unknown> {
    const filter = JSON.stringify({
      op: 'and',
      values: [{ field: 'name', op: 'EQUAL', value: input.name }],
    });
    const payload = await this.#requestJson({
      url: this.#url(MCP_SERVERS_PATH, { filter, limit: '1', offset: '0' }),
      accessToken: input.accessToken,
      method: 'GET',
    });
    const rows = listPage(this.#parseListResponse(payload));
    if (rows.length > 1) {
      this.#logger?.warn('TrueFoundry ServiceFoundry MCP name filter returned multiple rows', {
        name: input.name,
        count: rows.length,
      });
    }
    return rows[0];
  }

  /**
   * `GET v1/mcp/:id/authorize` — per-subject status; when auth is required includes consent URL.
   */
  async getMcpAuthorize(input: {
    accessToken: string;
    mcpServerId: string;
    redirectURL?: string;
    gatewayBaseURL?: string;
  }): Promise<McpAuthStatus> {
    const search: Record<string, string> = {};
    if (input.redirectURL !== undefined) {
      search['redirectURL'] = input.redirectURL;
    }
    if (input.gatewayBaseURL !== undefined) {
      search['gatewayBaseURL'] = input.gatewayBaseURL;
    }
    const payload = await this.#requestJson({
      url: this.#url(`${MCP_SERVERS_PATH}/${encodeURIComponent(input.mcpServerId)}/authorize`, search),
      accessToken: input.accessToken,
      method: 'GET',
    });
    try {
      return parseSfyMcpAuthorizeResult(payload);
    } catch (error) {
      this.#logger?.error('TrueFoundry ServiceFoundry MCP authorize returned an unexpected response', {
        mcpServerId: input.mcpServerId,
        ...extractErrorLogFields(error),
      });
      throw new HTTPException(424, {
        message: 'TrueFoundry ServiceFoundry MCP authorize returned an unexpected response',
        cause: error,
      });
    }
  }

  /**
   * `GET v1/mcp/:id/auth/status` — per-subject status without seeding a consent URL.
   */
  async getMcpAuthStatus(input: {
    accessToken: string;
    mcpServerId: string;
    subjectId: string;
    subjectType: SfyMcpAuthSubjectType;
  }): Promise<McpAuthStatus> {
    const payload = await this.#requestJson({
      url: this.#url(`${MCP_SERVERS_PATH}/${encodeURIComponent(input.mcpServerId)}/auth/status`, {
        subjectId: input.subjectId,
        subjectType: input.subjectType,
      }),
      accessToken: input.accessToken,
      method: 'GET',
    });
    try {
      return parseSfyMcpAuthStatus(payload);
    } catch (error) {
      this.#logger?.error('TrueFoundry ServiceFoundry MCP auth status returned an unexpected response', {
        mcpServerId: input.mcpServerId,
        ...extractErrorLogFields(error),
      });
      throw new HTTPException(424, {
        message: 'TrueFoundry ServiceFoundry MCP auth status returned an unexpected response',
        cause: error,
      });
    }
  }

  /**
   * `DELETE v1/mcp/:id/auth` — revoke the subject's OAuth token or auth-override.
   */
  async deleteMcpAuth(input: {
    accessToken: string;
    mcpServerId: string;
    subjectId: string;
    subjectType: SfyMcpAuthSubjectType;
    authSource: SfyMcpAuthSource;
  }): Promise<void> {
    await this.#requestJson({
      url: this.#url(`${MCP_SERVERS_PATH}/${encodeURIComponent(input.mcpServerId)}/auth`),
      accessToken: input.accessToken,
      method: 'DELETE',
      body: {
        subjectId: input.subjectId,
        subjectType: input.subjectType,
        authSource: input.authSource,
      },
    });
  }

  #parseListResponse(payload: unknown): ListResponse {
    const parsed = ListResponseSchema.safeParse(payload);
    if (!parsed.success) {
      this.#logger?.error('TrueFoundry ServiceFoundry server returned an unexpected list response', {
        ...extractErrorLogFields(parsed.error),
      });
      throw new HTTPException(424, {
        message: 'TrueFoundry ServiceFoundry server returned an unexpected list response',
        cause: parsed.error,
      });
    }
    return parsed.data;
  }

  #url(path: string, search?: Record<string, string>): URL {
    const url = new URL(`${this.#baseUrl}/${path}`);
    if (search !== undefined) {
      for (const [key, value] of Object.entries(search)) {
        url.searchParams.set(key, value);
      }
    }
    return url;
  }

  async #requestJson(input: {
    url: URL;
    accessToken: string;
    method: 'GET' | 'DELETE' | 'POST' | 'PUT';
    body?: unknown;
  }): Promise<unknown> {
    const startedAt = Date.now();
    const headers: Record<string, string> = {
      accept: 'application/json',
      authorization: `Bearer ${input.accessToken}`,
    };
    let body: string | undefined;
    if (input.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(input.body);
    }
    let response: Awaited<ReturnType<typeof undiciFetch>>;
    try {
      response = await undiciFetch(input.url, {
        method: input.method,
        headers,
        ...(body !== undefined ? { body } : {}),
        ...(this.#dispatcher ? { dispatcher: this.#dispatcher } : {}),
      });
    } catch (error) {
      this.#logger?.warn('TrueFoundry ServiceFoundry server request failed', {
        url: input.url.href,
        method: input.method,
        durationMs: Date.now() - startedAt,
        ...extractErrorLogFields(error),
      });
      throw new HTTPException(500, {
        message: 'TrueFoundry ServiceFoundry server request failed',
        cause: error,
      });
    }
    this.#logger?.info('TrueFoundry ServiceFoundry server request completed', {
      url: input.url.href,
      method: input.method,
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
    if (response.status === 204) {
      return undefined;
    }
    const text = await response.text();
    if (text.length === 0) {
      return undefined;
    }
    try {
      return JSON.parse(text) as unknown;
    } catch (error) {
      this.#logger?.error('TrueFoundry ServiceFoundry server returned non-JSON', {
        url: input.url.href,
        ...extractErrorLogFields(error),
      });
      throw new HTTPException(424, {
        message: 'TrueFoundry ServiceFoundry server returned non-JSON',
        cause: error,
      });
    }
  }
}
