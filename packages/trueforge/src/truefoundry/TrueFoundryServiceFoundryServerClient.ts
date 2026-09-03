import { extractErrorLogFields } from '@truefoundry/trueforge-core/core';
import { HTTPException } from 'hono/http-exception';
import { fetch as undiciFetch, type Dispatcher } from 'undici';
import type { Logger } from 'winston';
import { z } from 'zod';

import type { McpAuthStatus } from '../schemas/mcpServer';
import { createInternalTlsDispatcher, normalizeInternalTlsUrl, type InternalTlsOptions } from './internalTls';
import { parseSfyMcpAuthStatus, parseSfyMcpAuthorizeResult, type SfyMcpAuthSource } from './mapSfyMcpServers';

const INTEGRATIONS_PATH = 'v1/provider-integrations';
const INSTALLATIONS_PATH = 'v1/llm-gateway/installations';
const MCP_SERVERS_PATH = 'v1/mcp';
const TFG_AGENTS_PATH = 'internal/tfg/agents';
const SESSION_PATH = 'v1/session';
const INTEGRATIONS_PAGE_SIZE = 1000;

/**
 * Fields required to build RequestContext from ServiceFoundry `GET /v1/session`.
 * Wire shape is camelCase (Nest Session + exposed `subject()`).
 * Unauthenticated callers get HTTP 200 with `user: null`.
 */
const SessionSubjectSchema = z.object({
  subjectId: z.string().min(1),
  subjectType: z.string().min(1),
  subjectDisplayName: z.string().nullable().optional(),
  subjectSlug: z.string().nullable().optional(),
});

const GetSessionUserSchema = z.object({
  tenantName: z.string().min(1),
  roles: z.array(z.string()),
  subject: SessionSubjectSchema,
});

const GetSessionWireSchema = z.object({
  user: GetSessionUserSchema.nullable(),
});

/** Authenticated session payload (`user` is non-null after {@link TrueFoundryServiceFoundryServerClient.getSession}). */
export interface GetSessionResponse {
  user: z.infer<typeof GetSessionUserSchema>;
}

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
  mcp_servers: string[];
}

export interface PutRemoteAgentResult {
  externalId: string;
}

export interface DeleteRemoteAgentInput {
  accessToken: string;
  externalId: string;
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
  readonly #logger: Logger;
  readonly #dispatcher: Dispatcher | undefined;
  readonly #httpTimeoutMs: number;
  readonly #httpAgentTimeoutMs: number;

  constructor(input: {
    serviceFoundryServerUrl: string;
    logger: Logger;
    tls: InternalTlsOptions;
    httpTimeoutMs: number;
    httpAgentTimeoutMs: number;
  }) {
    const tls = input.tls;
    this.#baseUrl = normalizeInternalTlsUrl({ url: input.serviceFoundryServerUrl, enabled: tls.enabled }).replace(
      /\/+$/,
      '',
    );
    this.#dispatcher = createInternalTlsDispatcher(tls);
    this.#logger = input.logger;
    this.#httpTimeoutMs = input.httpTimeoutMs;
    this.#httpAgentTimeoutMs = input.httpAgentTimeoutMs;
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

  /** One page of MCP servers; optional `names` filters with `name IN (…)`. */
  async listMcpServers(input: {
    accessToken: string;
    limit: number;
    offset: number;
    names?: readonly string[];
  }): Promise<unknown[]> {
    const query: Record<string, string> = {
      offset: String(input.offset),
      limit: String(input.limit),
      ...(input.names !== undefined
        ? {
            filter: JSON.stringify({
              op: 'and',
              values: [{ field: 'name', op: 'IN', values: [...input.names] }],
            }),
          }
        : {}),
    };
    const payload = await this.#requestJson({
      url: this.#url(MCP_SERVERS_PATH, query),
      accessToken: input.accessToken,
      method: 'GET',
    });
    return listPage(this.#parseListResponse(payload));
  }

  /** Resolve one MCP server by name (`name EQUAL`, limit 1). */
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
      this.#logger.warn('TrueFoundry ServiceFoundry MCP name filter returned multiple rows', {
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
      timeoutMs: this.#httpAgentTimeoutMs,
      body: {
        name: input.name,
        description: input.description,
        model: input.model,
        mcp_servers: input.mcp_servers,
      },
    });
    const parsed = PutRemoteAgentResponseSchema.safeParse(payload);
    if (!parsed.success) {
      this.#logger.error('TrueFoundry ServiceFoundry put remote agent returned an unexpected response', {
        ...extractErrorLogFields(parsed.error),
      });
      throw new HTTPException(424, {
        message: 'TrueFoundry ServiceFoundry put remote agent returned an unexpected response',
        cause: parsed.error,
      });
    }
    return { externalId: parsed.data.agentId };
  }

  /** DELETE `/internal/tfg/agents/:id` — remove remote agent. Missing agent (404) is success. */
  async deleteRemoteAgent(input: DeleteRemoteAgentInput): Promise<void> {
    await this.#requestJson({
      url: this.#url(`${TFG_AGENTS_PATH}/${encodeURIComponent(input.externalId)}`),
      accessToken: input.accessToken,
      method: 'DELETE',
      timeoutMs: this.#httpAgentTimeoutMs,
      notFoundOk: true,
    });
  }

  /** Per-subject authorize; includes a consent URL when auth is required. */
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
      this.#logger.error('TrueFoundry ServiceFoundry MCP authorize returned an unexpected response', {
        mcpServerId: input.mcpServerId,
        ...extractErrorLogFields(error),
      });
      throw new HTTPException(424, {
        message: 'TrueFoundry ServiceFoundry MCP authorize returned an unexpected response',
        cause: error,
      });
    }
  }

  /** Per-subject auth status without seeding a consent URL. */
  async getMcpAuthStatus(input: {
    accessToken: string;
    mcpServerId: string;
    subjectId: string;
    subjectType: string;
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
      this.#logger.error('TrueFoundry ServiceFoundry MCP auth status returned an unexpected response', {
        mcpServerId: input.mcpServerId,
        ...extractErrorLogFields(error),
      });
      throw new HTTPException(424, {
        message: 'TrueFoundry ServiceFoundry MCP auth status returned an unexpected response',
        cause: error,
      });
    }
  }

  /** Revoke the subject's OAuth token or auth-override. */
  async deleteMcpAuth(input: {
    accessToken: string;
    mcpServerId: string;
    subjectId: string;
    subjectType: string;
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

  /**
   * `GET v1/session` for RequestContext mapping.
   * `user: null` (invalid/missing auth on a 200) → 401; all other failures → 500.
   */
  async getSession(accessToken: string): Promise<GetSessionResponse> {
    let payload: unknown;
    try {
      payload = await this.#requestJson({
        url: this.#url(SESSION_PATH),
        accessToken,
        method: 'GET',
      });
    } catch (error) {
      if (error instanceof HTTPException && (error.status === 401 || error.status === 403)) {
        throw error;
      }
      throw new HTTPException(500, {
        message: 'TrueFoundry ServiceFoundry session request failed',
        cause: error,
      });
    }
    const parsed = GetSessionWireSchema.safeParse(payload);
    if (!parsed.success) {
      throw new HTTPException(500, {
        message: 'TrueFoundry ServiceFoundry session response was malformed',
        cause: parsed.error,
      });
    }
    if (parsed.data.user === null) {
      throw new HTTPException(401, { message: 'Authentication required' });
    }
    return { user: parsed.data.user };
  }

  #parseListResponse(payload: unknown): ListResponse {
    const parsed = ListResponseSchema.safeParse(payload);
    if (!parsed.success) {
      this.#logger.error('TrueFoundry ServiceFoundry server returned an unexpected list response', {
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
    timeoutMs?: number;
    /** Treat HTTP 404 as success (idempotent DELETE). */
    notFoundOk?: boolean;
  }): Promise<unknown> {
    const startedAt = Date.now();
    const timeoutMs = input.timeoutMs ?? this.#httpTimeoutMs;
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
        signal: AbortSignal.timeout(timeoutMs),
        ...(this.#dispatcher ? { dispatcher: this.#dispatcher } : {}),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      this.#logger.warn('TrueFoundry ServiceFoundry server request failed', {
        url: input.url.href,
        method: input.method,
        durationMs: Date.now() - startedAt,
        timedOut,
        ...extractErrorLogFields(error),
      });
      throw new HTTPException(500, {
        message: timedOut
          ? `TrueFoundry ServiceFoundry server request timed out after ${String(timeoutMs / 1000)}s`
          : 'TrueFoundry ServiceFoundry server request failed',
        cause: error,
      });
    }
    this.#logger.info('TrueFoundry ServiceFoundry server request completed', {
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
      return JSON.parse(text) as unknown;
    } catch (error) {
      this.#logger.error('TrueFoundry ServiceFoundry server returned non-JSON', {
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
