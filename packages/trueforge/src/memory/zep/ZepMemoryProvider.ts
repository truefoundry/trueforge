/**
 * Zep Cloud v4 provider over `fetch`. Each scope is a Zep user; each session is a Zep thread.
 * @see https://help.getzep.com/v4/sdk-reference
 */
import type { Logger } from 'winston';
import { z } from 'zod';
import type { IngestExchangeInput, MemoryMessage, MemoryProvider } from '../MemoryProvider';
import type { MemoryScope } from '../scope';

export const ZEP_DEFAULT_BASE_URL = 'https://api.getzep.com/api/v4';

const PROVIDER_NAME = 'zep';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 4;
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 30_000;

const ZepUuidResponseSchema = z.object({ uuid: z.string().min(1) });

type ZepOperation = 'lookup_user' | 'create_user' | 'create_thread' | 'add_messages';

export class ZepRequestError extends Error {
  readonly operation: ZepOperation;
  /** HTTP status; null when no response arrived (network error or timeout). */
  readonly status: number | null;

  constructor({ operation, status, message }: { operation: ZepOperation; status: number | null; message: string }) {
    super(message);
    this.name = 'ZepRequestError';
    this.operation = operation;
    this.status = status;
  }
}

export interface ZepMemoryProviderOptions {
  apiKey: string;
  baseUrl: string;
  logger: Logger;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  maxAttempts?: number;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function retryAfterMs(response: Response): number | undefined {
  const header = response.headers.get('retry-after');
  if (header === null) {
    return undefined;
  }
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1_000;
  }
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

/** Roles whose messages are all context-only; Zep skips extraction for them. */
function ignoredRoles(messages: readonly MemoryMessage[]): MemoryMessage['role'][] {
  const roles = new Set(messages.map(message => message.role));
  return [...roles].filter(role => messages.every(message => message.role !== role || !message.extract));
}

export class ZepMemoryProvider implements MemoryProvider {
  readonly name = PROVIDER_NAME;
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #logger: Logger;
  readonly #fetch: typeof fetch;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #timeoutMs: number;
  readonly #maxAttempts: number;
  /** Scope key → Zep user uuid; users are never deleted by ingestion. */
  readonly #userUuids = new Map<string, string>();

  constructor(options: ZepMemoryProviderOptions) {
    this.#apiKey = options.apiKey;
    this.#baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.#logger = options.logger;
    this.#fetch = options.fetch ?? fetch;
    this.#sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  }

  async ingestExchange(input: IngestExchangeInput): Promise<{ externalThreadId: string }> {
    const { scope, exchange } = input;
    if (exchange.messages.length === 0) {
      throw new Error(`Exchange ${exchange.firstTurnId}..${exchange.lastTurnId} has no messages`);
    }
    const roles = ignoredRoles(exchange.messages);
    const body = {
      messages: exchange.messages.map(message => ({
        role: message.role,
        name: message.name,
        content: message.content,
        reference_time: message.createdAt,
        metadata: {
          session_id: exchange.sessionId,
          first_turn_id: exchange.firstTurnId,
          last_turn_id: exchange.lastTurnId,
          scope: scope.type,
        },
      })),
      ...(roles.length === 0 ? {} : { ignore_roles: roles }),
    };

    let threadId = input.externalThreadId ?? (await this.#createThread(scope));
    const sent = await this.#request({
      operation: 'add_messages',
      path: `/threads/${encodeURIComponent(threadId)}/messages`,
      body,
      allowNotFound: input.externalThreadId !== null,
    });
    if (sent.status === 404) {
      // The stored thread was deleted on the Zep side; start a new one for the session.
      threadId = await this.#createThread(scope);
      await this.#request({
        operation: 'add_messages',
        path: `/threads/${encodeURIComponent(threadId)}/messages`,
        body,
      });
    }
    return { externalThreadId: threadId };
  }

  async #createThread(scope: MemoryScope): Promise<string> {
    const userUuid = await this.#userUuid(scope);
    const created = await this.#request({
      operation: 'create_thread',
      path: '/threads',
      body: { user_uuid: userUuid },
    });
    return ZepUuidResponseSchema.parse(created.body).uuid;
  }

  async #userUuid(scope: MemoryScope): Promise<string> {
    const cached = this.#userUuids.get(scope.key);
    if (cached !== undefined) {
      return cached;
    }
    const uuid = (await this.#lookupUser(scope)) ?? (await this.#createUser(scope));
    this.#userUuids.set(scope.key, uuid);
    return uuid;
  }

  async #lookupUser(scope: MemoryScope): Promise<string | undefined> {
    const found = await this.#request({
      operation: 'lookup_user',
      path: '/users/lookup',
      body: { user_id: scope.key },
      allowNotFound: true,
    });
    return found.status === 404 ? undefined : ZepUuidResponseSchema.parse(found.body).uuid;
  }

  async #createUser(scope: MemoryScope): Promise<string> {
    try {
      const created = await this.#request({
        operation: 'create_user',
        path: '/users',
        body: {
          user_id: scope.key,
          first_name: scope.displayName,
          metadata: {
            tenant_id: scope.tenantId,
            subject_id: scope.subjectId,
            agent_id: scope.agentId,
            scope_type: scope.type,
          },
        },
      });
      return ZepUuidResponseSchema.parse(created.body).uuid;
    } catch (error) {
      // Another writer may have created the user between lookup and create.
      if (error instanceof ZepRequestError && (error.status === 400 || error.status === 409)) {
        const uuid = await this.#lookupUser(scope);
        if (uuid !== undefined) {
          return uuid;
        }
      }
      throw error;
    }
  }

  async #request({
    operation,
    path,
    body,
    allowNotFound = false,
  }: {
    operation: ZepOperation;
    path: string;
    body: unknown;
    allowNotFound?: boolean;
  }): Promise<{ status: number; body: unknown }> {
    for (let attempt = 1; ; attempt++) {
      const startedAt = Date.now();
      const logFields = (status: number | null) => ({
        provider: PROVIDER_NAME,
        operation,
        status,
        duration_ms: Date.now() - startedAt,
        attempt,
      });
      const canRetry = attempt < this.#maxAttempts;
      const backoffMs = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** (attempt - 1));

      let response: Response;
      try {
        response = await this.#fetch(`${this.#baseUrl}${path}`, {
          method: 'POST',
          headers: { Authorization: `Api-Key ${this.#apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.#timeoutMs),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (canRetry) {
          this.#logger.warn('Memory provider request failed; retrying', { ...logFields(null), error: message });
          await this.#sleep(backoffMs);
          continue;
        }
        this.#logger.error('Memory provider request failed', { ...logFields(null), error: message });
        throw new ZepRequestError({ operation, status: null, message: `Zep ${operation} failed: ${message}` });
      }

      if (response.ok || (allowNotFound && response.status === 404)) {
        this.#logger.debug('Memory provider request', logFields(response.status));
        const text = await response.text();
        return { status: response.status, body: text === '' ? {} : JSON.parse(text) };
      }

      const detail = (await response.text()).slice(0, 500);
      if (isRetryableStatus(response.status) && canRetry) {
        this.#logger.warn('Memory provider request failed; retrying', logFields(response.status));
        await this.#sleep(Math.min(MAX_BACKOFF_MS, retryAfterMs(response) ?? backoffMs));
        continue;
      }
      this.#logger.error('Memory provider request failed', { ...logFields(response.status), error: detail });
      throw new ZepRequestError({
        operation,
        status: response.status,
        message: `Zep ${operation} returned ${String(response.status)}: ${detail}`,
      });
    }
  }
}
