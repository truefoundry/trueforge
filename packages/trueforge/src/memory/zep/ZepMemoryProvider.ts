/**
 * Zep Cloud v4 provider over `fetch`. Each scope is a Zep user; each session is a Zep thread.
 * @see https://help.getzep.com/v4/sdk-reference
 */
import type { MemoryFact } from '@truefoundry/trueforge-core/core';
import { randomUUID } from 'node:crypto';
import type { Logger } from 'winston';
import { z } from 'zod';
import {
  MemoryIngestError,
  type IngestExchangeInput,
  type MemoryExchange,
  type MemoryMessage,
  type MemoryProvider,
} from '../MemoryProvider';
import type { MemoryScope } from '../scope';

export const ZEP_DEFAULT_BASE_URL = 'https://api.getzep.com/api/v4';

const PROVIDER_NAME = 'zep';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 4;
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 30_000;

const ZepUuidResponseSchema = z.object({ uuid: z.string().min(1) });
/**
 * `GET /threads/{id}/messages` lists newest first; the exchange being checked is the session's
 * latest write, so the default first page covers it.
 */
const ZepMessagesResponseSchema = z.object({
  items: z.array(z.object({ metadata: z.record(z.string(), z.unknown()).nullish() })),
});

/** `GET /users/{uuid}/node`: the user's graph node, whose `summary` Zep keeps up to date. */
const ZepUserNodeResponseSchema = z.object({ summary: z.string().nullish() });
/** `POST /graphs/{uuid}/search/edges`: edges (facts), best first. */
const ZepEdgePageSchema = z.object({
  items: z
    .array(
      z.object({
        fact: z.string().nullish(),
        valid_at: z.string().nullish(),
        invalid_at: z.string().nullish(),
      }),
    )
    .default([]),
});

type ZepOperation =
  | 'lookup_user'
  | 'create_user'
  | 'create_thread'
  | 'add_messages'
  | 'list_messages'
  | 'get_user_node'
  | 'search_edges'
  | 'add_episode';

export class ZepRequestError extends Error {
  readonly operation: ZepOperation;
  /** HTTP status; null when no response arrived (network error or timeout). */
  readonly status: number | null;

  constructor({
    operation,
    status,
    message,
    cause,
  }: {
    operation: ZepOperation;
    status: number | null;
    message: string;
    cause?: unknown;
  }) {
    super(message, { cause });
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

    let threadId = input.externalThreadId;
    try {
      if (threadId !== null && input.mayAlreadyBeStored && (await this.#threadHasExchange(threadId, exchange))) {
        this.#logger.info('Memory exchange already stored by an earlier attempt; not resending', {
          provider: PROVIDER_NAME,
          session_id: exchange.sessionId,
          last_turn_id: exchange.lastTurnId,
        });
        return { externalThreadId: threadId };
      }
      threadId ??= await this.#createThread(scope);
      const sent = await this.#addMessages({ threadId, body, allowNotFound: input.externalThreadId !== null });
      if (sent.status === 404) {
        // The stored thread was deleted on the Zep side; start a new one for the session.
        threadId = await this.#createThread(scope);
        await this.#addMessages({ threadId, body, allowNotFound: false });
      }
      return { externalThreadId: threadId };
    } catch (error) {
      // Hand back a thread created in this attempt so the retry reuses it instead of starting another.
      throw new MemoryIngestError({
        message: error instanceof Error ? error.message : String(error),
        externalThreadId: threadId,
        cause: error,
      });
    }
  }

  /**
   * Adding messages isn't idempotent, and Zep doesn't deduplicate by metadata. A timeout or 5xx may
   * have stored them, so it isn't retried here: the caller retries next run, flagged
   * `mayAlreadyBeStored`, which checks the thread first. A 429 is a rejection and is retried.
   */
  async #addMessages({
    threadId,
    body,
    allowNotFound,
  }: {
    threadId: string;
    body: unknown;
    allowNotFound: boolean;
  }): Promise<{ status: number }> {
    return await this.#request({
      operation: 'add_messages',
      path: `/threads/${encodeURIComponent(threadId)}/messages`,
      body,
      allowNotFound,
      retryUnclearFailures: false,
    });
  }

  /** Whether the thread's newest messages already include this exchange, matched by its metadata. */

  async #threadHasExchange(threadId: string, exchange: MemoryExchange): Promise<boolean> {
    const listed = await this.#request({
      operation: 'list_messages',
      method: 'GET',
      path: `/threads/${encodeURIComponent(threadId)}/messages`,
      allowNotFound: true,
    });
    if (listed.status === 404) {
      return false;
    }
    return ZepMessagesResponseSchema.parse(listed.body).items.some(
      ({ metadata }) =>
        metadata?.['session_id'] === exchange.sessionId &&
        metadata['first_turn_id'] === exchange.firstTurnId &&
        metadata['last_turn_id'] === exchange.lastTurnId,
    );
  }

  async getUserSummary({
    scope,
    signal,
  }: {
    scope: MemoryScope;
    signal: AbortSignal | undefined;
  }): Promise<string | null> {
    const userUuid = await this.#existingUserUuid(scope, { signal, maxAttempts: 1 });
    if (userUuid === undefined) {
      return null;
    }
    const node = await this.#request({
      operation: 'get_user_node',
      method: 'GET',
      path: `/users/${encodeURIComponent(userUuid)}/node`,
      allowNotFound: true,
      signal,
      maxAttempts: 1,
    });
    if (node.status === 404) {
      return null;
    }
    const summary = ZepUserNodeResponseSchema.parse(node.body).summary?.trim();
    return summary === undefined || summary === '' ? null : summary;
  }

  async search({ scope, query, limit }: { scope: MemoryScope; query: string; limit: number }): Promise<MemoryFact[]> {
    const userUuid = await this.#existingUserUuid(scope, { signal: undefined, maxAttempts: undefined });
    if (userUuid === undefined) {
      return [];
    }
    // A user's graph can be addressed by the user's uuid.
    const found = await this.#request({
      operation: 'search_edges',
      path: `/graphs/${encodeURIComponent(userUuid)}/search/edges?page_size=${String(limit)}`,
      body: { query },
    });
    return ZepEdgePageSchema.parse(found.body).items.flatMap(edge =>
      edge.fact === undefined || edge.fact === null || edge.fact.trim() === ''
        ? []
        : [{ fact: edge.fact, valid_at: edge.valid_at ?? null, invalid_at: edge.invalid_at ?? null }],
    );
  }

  async addMemory({
    scope,
    content,
    sessionId,
    createdAt,
  }: {
    scope: MemoryScope;
    content: string;
    sessionId: string;
    createdAt: string;
  }): Promise<void> {
    const userUuid = await this.#userUuid(scope);
    await this.#request({
      operation: 'add_episode',
      path: `/graphs/${encodeURIComponent(userUuid)}/episodes`,
      body: {
        type: 'text',
        data: `${scope.displayName} asked to remember: ${content}`,
        source_description: 'Saved at the user’s explicit request in a TrueForge chat',
        reference_time: createdAt,
        metadata: { session_id: sessionId, source: 'memory_add', scope: scope.type },
      },
      // Fixed across retries, so Zep stores the episode once even if a response is lost.
      headers: { 'Idempotency-Key': randomUUID() },
    });
  }

  /** The scope's Zep user uuid without creating the user; reads use it so they don't create users. */
  async #existingUserUuid(
    scope: MemoryScope,
    options: { signal: AbortSignal | undefined; maxAttempts: number | undefined },
  ): Promise<string | undefined> {
    const cached = this.#userUuids.get(scope.key);
    if (cached !== undefined) {
      return cached;
    }
    const uuid = await this.#lookupUser(scope, options);
    if (uuid !== undefined) {
      this.#userUuids.set(scope.key, uuid);
    }
    return uuid;
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

  async #lookupUser(
    scope: MemoryScope,
    options: { signal: AbortSignal | undefined; maxAttempts: number | undefined } = {
      signal: undefined,
      maxAttempts: undefined,
    },
  ): Promise<string | undefined> {
    const found = await this.#request({
      operation: 'lookup_user',
      path: '/users/lookup',
      body: { user_id: scope.key },
      allowNotFound: true,
      signal: options.signal,
      maxAttempts: options.maxAttempts,
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
    method = 'POST',
    path,
    body,
    allowNotFound = false,
    retryUnclearFailures = true,
    headers = {},
    signal,
    maxAttempts = this.#maxAttempts,
  }: {
    operation: ZepOperation;
    method?: 'GET' | 'POST';
    path: string;
    body?: unknown;
    allowNotFound?: boolean;
    /** False for non-idempotent writes: no retry after a failure that may have reached Zep (no response, 5xx). */
    retryUnclearFailures?: boolean;
    headers?: Record<string, string>;
    /** Aborts the request on top of the per-request timeout. */
    signal?: AbortSignal | undefined;
    maxAttempts?: number | undefined;
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
      const canRetry = attempt < maxAttempts && signal?.aborted !== true;
      const backoffMs = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** (attempt - 1));

      let response: Response;
      let text: string;
      try {
        response = await this.#fetch(`${this.#baseUrl}${path}`, {
          method,
          headers: { ...headers, Authorization: `Api-Key ${this.#apiKey}`, 'Content-Type': 'application/json' },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal:
            signal === undefined
              ? AbortSignal.timeout(this.#timeoutMs)
              : AbortSignal.any([AbortSignal.timeout(this.#timeoutMs), signal]),
        });
        // Inside the try: a connection dropped while reading the body is a network failure too.
        text = await response.text();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (canRetry && retryUnclearFailures) {
          this.#logger.warn('Memory provider request failed; retrying', { ...logFields(null), error: message });
          await this.#sleep(backoffMs);
          continue;
        }
        this.#logger.error('Memory provider request failed', { ...logFields(null), error: message });
        throw new ZepRequestError({
          operation,
          status: null,
          message: `Zep ${operation} failed: ${message}`,
          cause: error,
        });
      }

      if (response.ok || (allowNotFound && response.status === 404)) {
        this.#logger.debug('Memory provider request', logFields(response.status));
        return { status: response.status, body: text === '' ? {} : JSON.parse(text) };
      }

      const detail = text.slice(0, 500);
      const retryable = response.status === 429 || (retryUnclearFailures && isRetryableStatus(response.status));
      const waitMs = retryAfterMs(response) ?? backoffMs;
      // A cooldown longer than the cap isn't waited out inside the run; the next run retries.
      if (retryable && canRetry && waitMs <= MAX_BACKOFF_MS) {
        this.#logger.warn('Memory provider request failed; retrying', logFields(response.status));
        await this.#sleep(waitMs);
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
