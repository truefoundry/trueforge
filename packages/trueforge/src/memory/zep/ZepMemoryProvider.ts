/**
 * Zep Cloud v4 provider over the Zep SDK. Each scope is a Zep user; each session is a Zep thread.
 * @see https://help.getzep.com/v4/sdk-reference
 */
import { ZepClient, ZepEnvironment, ZepError, type Zep } from '@getzep/zep-cloud';
import type { MemoryFact } from '@truefoundry/trueforge-core/core';
import type { Logger } from 'winston';
import {
  MemoryIngestError,
  type IngestExchangeInput,
  type MemoryExchange,
  type MemoryMessage,
  type MemoryProvider,
} from '../MemoryProvider';
import { DEFAULT_MEMORY_AGENT_KEY, type MemoryScope } from '../scope';

export const ZEP_DEFAULT_BASE_URL: string = ZepEnvironment.Default;

const PROVIDER_NAME = 'zep';
const DEFAULT_TIMEOUT_SECONDS = 30;
/** Retries after the first attempt, for 408, 429 and 5xx; the SDK backs off and honours `Retry-After`. */
const DEFAULT_MAX_RETRIES = 3;

/** Per-request options for user lookups; the session-start summary uses them for one bounded attempt. */
interface LookupOptions {
  maxRetries?: number;
  abortSignal?: AbortSignal;
}

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
}

/**
 * Zep's speaker `name`: the user's or agent's id, never a display name, so no person's name reaches
 * Zep. A Zep user maps back to its TrueForge user through its `metadata` (tenant and subject ids).
 */
function speakerId(scope: MemoryScope, role: MemoryMessage['role']): string {
  return role === 'user' ? scope.subjectId : (scope.agentId ?? DEFAULT_MEMORY_AGENT_KEY);
}

/** Roles whose messages are all context-only; Zep skips extraction for them. */
function ignoredRoles(messages: readonly MemoryMessage[]): MemoryMessage['role'][] {
  const roles = new Set(messages.map(message => message.role));
  return [...roles].filter(role => messages.every(message => message.role !== role || !message.extract));
}

/** `signal`, also aborted once a request attempt, body included, runs past the timeout. */
function withDeadline(signal: AbortSignal | null | undefined): AbortSignal {
  const deadline = new AbortController();
  setTimeout(() => {
    deadline.abort(new DOMException('Zep request timed out', 'TimeoutError'));
  }, DEFAULT_TIMEOUT_SECONDS * 1_000).unref();
  return signal === undefined || signal === null ? deadline.signal : AbortSignal.any([signal, deadline.signal]);
}

function requireUuid(operation: ZepOperation, uuid: string | undefined): string {
  if (uuid === undefined || uuid === '') {
    throw new ZepRequestError({ operation, status: null, message: `Zep ${operation} returned no uuid` });
  }
  return uuid;
}

export class ZepMemoryProvider implements MemoryProvider {
  readonly name = PROVIDER_NAME;
  readonly #client: ZepClient;
  readonly #logger: Logger;
  /** Scope key → Zep user uuid; users are never deleted by ingestion. */
  readonly #userUuids = new Map<string, string>();

  constructor(options: ZepMemoryProviderOptions) {
    this.#logger = options.logger;
    const baseFetch = options.fetch ?? fetch;
    this.#client = new ZepClient({
      apiKey: options.apiKey,
      baseUrl: options.baseUrl.replace(/\/+$/, ''),
      timeoutInSeconds: DEFAULT_TIMEOUT_SECONDS,
      maxRetries: DEFAULT_MAX_RETRIES,
      // The SDK's timeout stops once headers arrive; this deadline also bounds reading the body.
      fetch: (input, init) => baseFetch(input, { ...init, signal: withDeadline(init?.signal) }),
    });
  }

  async ingestExchange(input: IngestExchangeInput): Promise<{ externalThreadId: string }> {
    const { scope, exchange } = input;
    if (exchange.messages.length === 0) {
      throw new Error(`Exchange ending at turn ${exchange.lastTurnId} has no messages`);
    }
    const roles = ignoredRoles(exchange.messages);
    const messages: Zep.AddMessage[] = exchange.messages.map(message => ({
      role: message.role,
      name: speakerId(scope, message.role),
      content: message.content,
      referenceTime: message.createdAt,
      metadata: {
        tenant_id: scope.tenantId,
        session_id: exchange.sessionId,
        last_turn_id: exchange.lastTurnId,
        scope: scope.type,
      },
    }));

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
      const added = await this.#addMessages({
        threadId,
        messages,
        ignoreRoles: roles,
        allowNotFound: input.externalThreadId !== null,
      });
      if (!added) {
        // The stored thread was deleted on the Zep side; start a new one for the session.
        threadId = await this.#createThread(scope);
        await this.#addMessages({ threadId, messages, ignoreRoles: roles, allowNotFound: false });
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
   * `mayAlreadyBeStored`, which checks the thread first. False when the thread no longer exists.
   */
  async #addMessages({
    threadId,
    messages,
    ignoreRoles,
    allowNotFound,
  }: {
    threadId: string;
    messages: Zep.AddMessage[];
    ignoreRoles: Zep.RoleType[];
    allowNotFound: boolean;
  }): Promise<boolean> {
    const result = await this.#call(
      'add_messages',
      () =>
        this.#client.thread.addMessages(
          threadId,
          { messages, ...(ignoreRoles.length === 0 ? {} : { ignoreRoles }) },
          { maxRetries: 0 },
        ),
      { allowNotFound },
    );
    return result !== undefined;
  }

  /**
   * Whether the thread's newest messages already include this exchange, matched by its metadata.
   * Zep doesn't document a default order, so this asks for newest first: the exchange being checked
   * is the session's latest write, so a page the size of the exchange covers it.
   * TODO(memory-idempotency): see `IngestExchangeInput.mayAlreadyBeStored`.
   */
  async #threadHasExchange(threadId: string, exchange: MemoryExchange): Promise<boolean> {
    const page = await this.#call(
      'list_messages',
      () =>
        this.#client.thread.listMessages(threadId, {
          pageSize: exchange.messages.length,
          orderBy: 'created_at',
          order: 'desc',
        }),
      { allowNotFound: true },
    );
    return (page?.data ?? []).some(
      ({ metadata }) =>
        metadata?.['session_id'] === exchange.sessionId && metadata['last_turn_id'] === exchange.lastTurnId,
    );
  }

  async getUserSummary({
    scope,
    signal,
  }: {
    scope: MemoryScope;
    signal: AbortSignal | undefined;
  }): Promise<string | null> {
    const singleAttempt = { maxRetries: 0, ...(signal === undefined ? {} : { abortSignal: signal }) };
    const userUuid = await this.#userUuid(scope, { create: false, lookup: singleAttempt });
    if (userUuid === undefined) {
      return null;
    }
    const node = await this.#call('get_user_node', () => this.#client.user.getNode(userUuid, singleAttempt), {
      allowNotFound: true,
    });
    const summary = node?.summary?.trim();
    return summary === undefined || summary === '' ? null : summary;
  }

  async search({ scope, query, limit }: { scope: MemoryScope; query: string; limit: number }): Promise<MemoryFact[]> {
    const userUuid = await this.#userUuid(scope, { create: false });
    if (userUuid === undefined) {
      return [];
    }
    // A user's graph can be addressed by the user's uuid.
    const page = await this.#call('search_edges', () =>
      this.#client.graph.searchEdges(userUuid, { query, pageSize: limit }),
    );
    return page.data.flatMap(edge =>
      edge.fact === undefined || edge.fact.trim() === ''
        ? []
        : [{ fact: edge.fact, valid_at: edge.validAt ?? null, invalid_at: edge.invalidAt ?? null }],
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
    const userUuid = await this.#userUuid(scope, { create: true });
    await this.#call('add_episode', () =>
      this.#client.graph.episode.add(userUuid, {
        type: 'text',
        data: `${scope.subjectId} asked to remember: ${content}`,
        sourceDescription: 'Saved at the user’s explicit request in a TrueForge chat',
        referenceTime: createdAt,
        metadata: { session_id: sessionId, source: 'memory_add', scope: scope.type },
      }),
    );
  }

  async #createThread(scope: MemoryScope): Promise<string> {
    const userUuid = await this.#userUuid(scope, { create: true });
    const thread = await this.#call('create_thread', () => this.#client.thread.create({ userUuid }));
    return requireUuid('create_thread', thread.uuid);
  }

  /** The scope's Zep user uuid. Only writes pass `create`, so reads never create users. */
  async #userUuid(scope: MemoryScope, options: { create: true }): Promise<string>;
  async #userUuid(scope: MemoryScope, options: { create: false; lookup?: LookupOptions }): Promise<string | undefined>;
  async #userUuid(
    scope: MemoryScope,
    { create, lookup = {} }: { create: boolean; lookup?: LookupOptions },
  ): Promise<string | undefined> {
    const cached = this.#userUuids.get(scope.key);
    if (cached !== undefined) {
      return cached;
    }
    const uuid = (await this.#lookupUser(scope, lookup)) ?? (create ? await this.#createUser(scope) : undefined);
    if (uuid !== undefined) {
      this.#userUuids.set(scope.key, uuid);
    }
    return uuid;
  }

  async #lookupUser(scope: MemoryScope, requestOptions: LookupOptions): Promise<string | undefined> {
    const user = await this.#call(
      'lookup_user',
      () => this.#client.user.lookup({ userId: scope.key }, requestOptions),
      {
        allowNotFound: true,
      },
    );
    return user === undefined ? undefined : requireUuid('lookup_user', user.uuid);
  }

  async #createUser(scope: MemoryScope): Promise<string> {
    try {
      const user = await this.#call('create_user', () =>
        this.#client.user.create({
          userId: scope.key,
          // An id, never a display name: no person's name reaches Zep.
          firstName: scope.subjectId,
          // Maps the Zep user back to its TrueForge user and scope.
          metadata: {
            tenant_id: scope.tenantId,
            subject_id: scope.subjectId,
            agent_id: scope.agentId,
            scope_type: scope.type,
          },
        }),
      );
      return requireUuid('create_user', user.uuid);
    } catch (error) {
      // Another writer may have created the user between lookup and create.
      if (error instanceof ZepRequestError && (error.status === 400 || error.status === 409)) {
        const uuid = await this.#lookupUser(scope, {});
        if (uuid !== undefined) {
          return uuid;
        }
      }
      throw error;
    }
  }

  /** With `allowNotFound`, a 404 resolves to undefined instead of failing. */
  async #call<T>(operation: ZepOperation, request: () => Promise<T>): Promise<T>;
  async #call<T>(
    operation: ZepOperation,
    request: () => Promise<T>,
    options: { allowNotFound: boolean },
  ): Promise<T | undefined>;
  async #call<T>(
    operation: ZepOperation,
    request: () => Promise<T>,
    { allowNotFound = false }: { allowNotFound?: boolean } = {},
  ): Promise<T | undefined> {
    const startedAt = Date.now();
    try {
      const result = await request();
      this.#logger.debug('Memory provider request', {
        provider: PROVIDER_NAME,
        operation,
        duration_ms: Date.now() - startedAt,
      });
      return result;
    } catch (error) {
      const status = error instanceof ZepError ? (error.statusCode ?? null) : null;
      const logFields = { provider: PROVIDER_NAME, operation, status, duration_ms: Date.now() - startedAt };
      if (allowNotFound && status === 404) {
        this.#logger.debug('Memory provider request', logFields);
        return undefined;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.#logger.error('Memory provider request failed', { ...logFields, error: message.slice(0, 500) });
      throw new ZepRequestError({
        operation,
        status,
        message: `Zep ${operation} ${status === null ? 'failed' : `returned ${String(status)}`}: ${message}`,
        cause: error,
      });
    }
  }
}
