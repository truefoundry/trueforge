import { extractErrorLogFields } from '@truefoundry/trueforge-core/core';
import { HTTPException } from 'hono/http-exception';
import { fetch as undiciFetch, type Dispatcher } from 'undici';
import type { Logger } from 'winston';
import { z } from 'zod';

import { createInternalTlsDispatcher, normalizeInternalTlsUrl, type InternalTlsOptions } from './internalTls';

const INTEGRATIONS_PATH = 'v1/provider-integrations';
const INSTALLATIONS_PATH = 'v1/llm-gateway/installations';
const MCP_SERVERS_PATH = 'v1/mcp';
const TFG_AGENTS_PATH = 'internal/tfg/agents';
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

/** Wire shape from PUT `/internal/tfg/agents` — keep `agentId` only here. */
const PutRemoteAgentResponseSchema = z.object({
  agentId: z.string().min(1),
});

export interface PutRemoteAgentInput {
  accessToken: string;
  name: string;
  description: string;
  model: string;
  mcp_servers?: string[];
}

export interface PutRemoteAgentResult {
  remoteAgentId: string;
}

export interface DeleteRemoteAgentInput {
  accessToken: string;
  remoteAgentId: string;
}

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

  /** PUT `/internal/tfg/agents` — create/reuse remote agent + sync model/MCP grants. */
  async putRemoteAgent(input: PutRemoteAgentInput): Promise<PutRemoteAgentResult> {
    const payload = await this.#requestJson({
      url: this.#url(TFG_AGENTS_PATH),
      accessToken: input.accessToken,
      method: 'PUT',
      body: {
        name: input.name,
        description: input.description,
        model: input.model,
        ...(input.mcp_servers === undefined ? {} : { mcp_servers: input.mcp_servers }),
      },
    });
    const parsed = PutRemoteAgentResponseSchema.safeParse(payload);
    if (!parsed.success) {
      this.#logger?.error('TrueFoundry ServiceFoundry put remote agent returned an unexpected response', {
        ...extractErrorLogFields(parsed.error),
      });
      throw new HTTPException(424, {
        message: 'TrueFoundry ServiceFoundry put remote agent returned an unexpected response',
        cause: parsed.error,
      });
    }
    return { remoteAgentId: parsed.data.agentId };
  }

  /** DELETE `/internal/tfg/agents/:id` — remove remote agent. Missing agent (404) is success. */
  async deleteRemoteAgent(input: DeleteRemoteAgentInput): Promise<void> {
    await this.#requestJson({
      url: this.#url(`${TFG_AGENTS_PATH}/${encodeURIComponent(input.remoteAgentId)}`),
      accessToken: input.accessToken,
      method: 'DELETE',
      notFoundOk: true,
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
    if (search) {
      for (const [key, value] of Object.entries(search)) {
        url.searchParams.set(key, value);
      }
    }
    return url;
  }

  #getJson(url: URL, accessToken: string): Promise<unknown> {
    return this.#requestJson({ url, accessToken, method: 'GET' });
  }

  async #requestJson(input: {
    url: URL;
    accessToken: string;
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    body?: unknown;
    /** Treat HTTP 404 as success (idempotent DELETE). */
    notFoundOk?: boolean;
  }): Promise<unknown> {
    const startedAt = Date.now();
    let response: Awaited<ReturnType<typeof undiciFetch>>;
    try {
      response = await undiciFetch(input.url, {
        method: input.method,
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${input.accessToken}`,
          ...(input.body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
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
    if (response.status === 404 && input.notFoundOk) {
      return undefined;
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
      return JSON.parse(text);
    } catch (error) {
      throw new HTTPException(424, {
        message: 'TrueFoundry ServiceFoundry server returned invalid JSON',
        cause: error,
      });
    }
  }
}
