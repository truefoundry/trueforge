import { extractErrorLogFields } from '@truefoundry/trueforge-core/core';
import { HTTPException } from 'hono/http-exception';
import { fetch as undiciFetch, type Dispatcher } from 'undici';
import type { Logger } from 'winston';
import { z } from 'zod';

import { createInternalTlsDispatcher, normalizeInternalTlsUrl, type InternalTlsOptions } from './internalTls';

const INTEGRATIONS_PATH = 'v1/provider-integrations';
const INSTALLATIONS_PATH = 'v1/llm-gateway/installations';
const MCP_SERVERS_PATH = 'v1/mcp';
const SESSION_PATH = 'v1/session';
const INTEGRATIONS_PAGE_SIZE = 1000;
const MCP_SERVERS_PAGE_SIZE = 100;

/**
 * Fields required to build RequestContext from ServiceFoundry `GET /v1/session`.
 * Wire shape is camelCase (Nest Session + exposed `subject()`).
 */
const SessionSubjectSchema = z.object({
  subjectId: z.string().min(1),
  subjectType: z.string().min(1),
  subjectDisplayName: z.string().nullable().optional(),
  subjectSlug: z.string().nullable().optional(),
});

const GetSessionResponseSchema = z.object({
  user: z.object({
    tenantName: z.string().min(1),
    roles: z.array(z.string()),
    subject: SessionSubjectSchema,
  }),
});

export type GetSessionResponse = z.infer<typeof GetSessionResponseSchema>;

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
      const payload = await this.#getJson(
        this.#url(INTEGRATIONS_PATH, {
          type: 'model',
          offset: String(offset),
          limit: String(INTEGRATIONS_PAGE_SIZE),
        }),
        accessToken,
      );
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
    return this.#getJson(this.#url(INSTALLATIONS_PATH), accessToken);
  }

  /**
   * Paginated `GET v1/mcp`. Returns raw SFY rows; callers parse with {@link mapSfyMcpServers}.
   * Offset advances by raw page length (same as {@link listProviderIntegrations}).
   */
  async listMcpServers(accessToken: string): Promise<unknown[]> {
    const items: unknown[] = [];
    let offset = 0;
    for (;;) {
      const payload = await this.#getJson(
        this.#url(MCP_SERVERS_PATH, {
          offset: String(offset),
          limit: String(MCP_SERVERS_PAGE_SIZE),
        }),
        accessToken,
      );
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
    const payload = await this.#getJson(
      this.#url(MCP_SERVERS_PATH, { filter, limit: '1', offset: '0' }),
      input.accessToken,
    );
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
   * `GET v1/session` for RequestContext mapping.
   * Transport / auth failures follow {@link #getJson}; schema mismatch → 502 with `{ cause }`.
   */
  async getSession(accessToken: string): Promise<GetSessionResponse> {
    const payload = await this.#getJson(this.#url(SESSION_PATH), accessToken);
    const parsed = GetSessionResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new HTTPException(500, {
        message: 'TrueFoundry ServiceFoundry session response was malformed',
        cause: parsed.error,
      });
    }
    return parsed.data;
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
