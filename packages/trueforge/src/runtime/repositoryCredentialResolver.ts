import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';

import type { ResolveRepositoryCredentials } from './sessionResources';

const ExternalRepositoryCredentialResponseSchema = z
  .object({
    credentials: z.string().min(1),
  })
  .strict();

type ExternalRepositoryCredentialResponse = z.infer<typeof ExternalRepositoryCredentialResponseSchema>;

type ResponseBodyReadResult = { done: true } | { done: false; value: Uint8Array };

export interface ExternalRepositoryCredentialResolverOptions {
  endpoint: URL;
  authorization: string | undefined;
  timeoutMs: number;
  maxResponseBytes: number;
  fetchImpl?: typeof fetch | undefined;
}

function resolverError(options: { message: string; cause: unknown }): HTTPException {
  return new HTTPException(424, options);
}

function parseResponseBodyReadResult(value: unknown): ResponseBodyReadResult {
  if (typeof value !== 'object' || value === null || !('done' in value) || typeof value.done !== 'boolean') {
    throw new Error('Repository credential resolver returned an unreadable response');
  }
  if (value.done) {
    return { done: true };
  }
  if (!('value' in value) || !(value.value instanceof Uint8Array)) {
    throw new Error('Repository credential resolver returned an unreadable response');
  }
  return { done: false, value: value.value };
}

async function readBoundedResponseBody(options: { response: Response; maxBytes: number }): Promise<string> {
  const { response, maxBytes } = options;
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null) {
    const declaredBytes = Number(contentLength);
    if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error('Repository credential resolver response exceeded the configured size limit');
    }
  }

  if (response.body === null) {
    return '';
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let receivedBytes = 0;
  try {
    for (;;) {
      const rawResult: unknown = await reader.read();
      const result = parseResponseBodyReadResult(rawResult);
      if (result.done) {
        break;
      }
      receivedBytes += result.value.byteLength;
      if (receivedBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error('Repository credential resolver response exceeded the configured size limit');
      }
      chunks.push(decoder.decode(result.value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join('');
  } finally {
    reader.releaseLock();
  }
}

function isGitCredentialStoreContent(value: string): boolean {
  const lines = value.split(/\r?\n/).filter(line => line.length > 0);
  if (lines.length === 0) {
    return false;
  }
  return lines.every(line => {
    if (line !== line.trim() || line.includes('\r')) {
      return false;
    }
    try {
      const credentialUrl = new URL(line);
      return (
        (credentialUrl.protocol === 'http:' || credentialUrl.protocol === 'https:') &&
        credentialUrl.hostname !== '' &&
        (credentialUrl.username !== '' || credentialUrl.password !== '')
      );
    } catch {
      return false;
    }
  });
}

function parseResolverResponse(body: string): ExternalRepositoryCredentialResponse {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch (error) {
    throw resolverError({ message: 'Repository credential resolver returned an invalid response', cause: error });
  }

  const parsed = ExternalRepositoryCredentialResponseSchema.safeParse(payload);
  if (!parsed.success || !isGitCredentialStoreContent(parsed.data.credentials)) {
    throw new HTTPException(424, { message: 'Repository credential resolver returned an invalid response' });
  }
  return parsed.data;
}

/**
 * Adapts the in-process repository credential resolver contract to an operator-owned HTTP endpoint.
 * The response body is bounded before parsing and is never included in errors or logs.
 */
export function createExternalRepositoryCredentialResolver(
  options: ExternalRepositoryCredentialResolverOptions,
): ResolveRepositoryCredentials {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  return async input => {
    const credentialProviderRef = input.repository.credential_provider_ref;
    if (credentialProviderRef === null) {
      throw new HTTPException(422, { message: 'Repository credential provider reference is required' });
    }

    const headers = new Headers({
      accept: 'application/json',
      'content-type': 'application/json',
    });
    if (options.authorization !== undefined) {
      headers.set('authorization', options.authorization);
    }

    const timeoutSignal = AbortSignal.timeout(options.timeoutMs);
    const signal = AbortSignal.any([input.signal, timeoutSignal]);
    let response: Response;
    try {
      response = await fetchImpl(options.endpoint, {
        method: 'POST',
        headers,
        signal,
        body: JSON.stringify({
          credential_provider_ref: credentialProviderRef,
          tenant_id: input.tenant_id,
          session_id: input.session_id,
          user_ref: input.user_ref,
          repository: {
            url: input.repository.url,
            ref: input.repository.ref,
            access: input.repository.access,
          },
        }),
      });
    } catch (error) {
      throw resolverError({ message: 'Repository credential resolver request failed', cause: error });
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new HTTPException(424, { message: 'Repository credential resolver rejected the request' });
    }

    let body: string;
    try {
      body = await readBoundedResponseBody({ response, maxBytes: options.maxResponseBytes });
    } catch (error) {
      throw resolverError({ message: 'Repository credential resolver returned an invalid response', cause: error });
    }
    return parseResolverResponse(body).credentials;
  };
}
