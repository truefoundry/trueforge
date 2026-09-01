import { extractErrorLogFields } from '@truefoundry/trueforge-core/core';
import { HTTPException } from 'hono/http-exception';
import { fetch as undiciFetch, type Dispatcher } from 'undici';
import type { Logger } from 'winston';
import { z } from 'zod';

import { createInternalTlsDispatcher, normalizeInternalTlsUrl, type InternalTlsOptions } from './internalTls';

const INTEGRATIONS_PATH = 'v1/provider-integrations';
const INSTALLATIONS_PATH = 'v1/llm-gateway/installations';
const INTEGRATIONS_PAGE_SIZE = 1000;

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
      const parsed = ListResponseSchema.safeParse(payload);
      if (!parsed.success) {
        break;
      }
      const page = Array.isArray(parsed.data) ? parsed.data : parsed.data.data;
      const total = Array.isArray(parsed.data) ? undefined : parsed.data.pagination?.total;
      items.push(...page);
      if (!total || items.length >= total || page.length === 0) {
        break;
      }
      offset = items.length;
    }
    return items;
  }

  listGatewayInstallations(accessToken: string): Promise<unknown> {
    return this.#getJson(this.#url(INSTALLATIONS_PATH), accessToken);
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
