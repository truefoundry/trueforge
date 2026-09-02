import type { SessionRepository } from '@truefoundry/trueforge-core/agent-session';
import { HTTPException } from 'hono/http-exception';

import { createExternalRepositoryCredentialResolver } from '../../../src/runtime/repositoryCredentialResolver';

const repository: SessionRepository = {
  url: 'https://git.example.com/acme/widgets.git',
  ref: 'feature/widgets',
  path: 'workspace/widgets',
  access: 'read_write',
  credential_provider_ref: 'installation:example-123',
};

function resolverInput(signal: AbortSignal = new AbortController().signal) {
  return {
    tenant_id: 'tenant-123',
    session_id: 'session-123',
    user_ref: 'user-123',
    repository,
    signal,
  };
}

function resolverWith(fetchImpl: typeof fetch, overrides: { maxResponseBytes?: number; timeoutMs?: number } = {}) {
  return createExternalRepositoryCredentialResolver({
    endpoint: new URL('https://resolver.example.com/v1/repository-credentials'),
    authorization: 'Bearer resolver-secret',
    timeoutMs: overrides.timeoutMs ?? 1_000,
    maxResponseBytes: overrides.maxResponseBytes ?? 1_024,
    fetchImpl,
  });
}

async function rejectionMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('Expected promise to reject');
}

describe('createExternalRepositoryCredentialResolver', () => {
  it('sends provider-neutral authorization context and returns credential-store content', async () => {
    const requests: Request[] = [];
    let call = 0;
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push(new Request(input, init));
      call += 1;
      return Response.json({ credentials: `https://oauth2:token-${String(call)}@git.example.com\n` });
    };
    const resolver = resolverWith(fetchImpl);

    await expect(resolver(resolverInput())).resolves.toBe('https://oauth2:token-1@git.example.com\n');
    await expect(resolver(resolverInput())).resolves.toBe('https://oauth2:token-2@git.example.com\n');

    expect(requests).toHaveLength(2);
    const request = requests[0];
    if (request === undefined) {
      throw new Error('Expected resolver request');
    }
    expect(request.method).toBe('POST');
    expect(request.headers.get('accept')).toBe('application/json');
    expect(request.headers.get('content-type')).toBe('application/json');
    expect(request.headers.get('authorization')).toBe('Bearer resolver-secret');
    expect(await request.text()).toBe(
      JSON.stringify({
        credential_provider_ref: 'installation:example-123',
        tenant_id: 'tenant-123',
        session_id: 'session-123',
        user_ref: 'user-123',
        repository: {
          url: 'https://git.example.com/acme/widgets.git',
          ref: 'feature/widgets',
          access: 'read_write',
        },
      }),
    );
  });

  it('omits authorization when none is configured', async () => {
    let authorization: string | null = 'not-called';
    const fetchImpl: typeof fetch = async (input, init) => {
      authorization = new Request(input, init).headers.get('authorization');
      return Response.json({ credentials: 'https://token@git.example.com\n' });
    };
    const resolver = createExternalRepositoryCredentialResolver({
      endpoint: new URL('http://localhost:9090/resolve'),
      authorization: undefined,
      timeoutMs: 1_000,
      maxResponseBytes: 1_024,
      fetchImpl,
    });

    await resolver(resolverInput());

    expect(authorization).toBeNull();
  });

  it('cancels a request at the configured timeout', async () => {
    const fetchImpl: typeof fetch = (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) {
          reject(signal.reason);
          return;
        }
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    const resolver = resolverWith(fetchImpl, { timeoutMs: 10 });

    await expect(resolver(resolverInput())).rejects.toMatchObject({
      status: 424,
      message: 'Repository credential resolver request failed',
    } satisfies Partial<HTTPException>);
  });

  it('forwards caller cancellation to the request without exposing its reason', async () => {
    const fetchImpl: typeof fetch = (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) {
          reject(signal.reason);
          return;
        }
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    const controller = new AbortController();
    const resolver = resolverWith(fetchImpl);
    const pending = resolver(resolverInput(controller.signal));

    controller.abort(new Error('sensitive caller cancellation detail'));

    await expect(pending).rejects.toMatchObject({
      status: 424,
      message: 'Repository credential resolver request failed',
    } satisfies Partial<HTTPException>);
  });

  it('rejects oversized responses without exposing their content', async () => {
    const secret = 'credential-response-secret';
    const fetchImpl: typeof fetch = async () => Response.json({ credentials: `https://${secret}@example.com` });
    const resolver = resolverWith(fetchImpl, { maxResponseBytes: 16 });

    const message = await rejectionMessage(resolver(resolverInput()));

    expect(message).toBe('Repository credential resolver returned an invalid response');
    expect(message).not.toContain(secret);
  });

  it('rejects resolver errors without reading or exposing the response body', async () => {
    const secret = 'resolver-error-secret';
    const fetchImpl: typeof fetch = async () => new Response(secret, { status: 403 });
    const resolver = resolverWith(fetchImpl);

    const message = await rejectionMessage(resolver(resolverInput()));

    expect(message).toBe('Repository credential resolver rejected the request');
    expect(message).not.toContain(secret);
  });

  it.each([
    ['malformed JSON', 'not-json'],
    ['unexpected fields', JSON.stringify({ credentials: 'https://token@example.com', extra: true })],
    ['empty credentials', JSON.stringify({ credentials: '' })],
    ['non credential-store content', JSON.stringify({ credentials: 'username=secret' })],
    ['credential URL without a secret', JSON.stringify({ credentials: 'https://example.com/repository.git' })],
  ])('rejects %s with a redaction-safe error', async (_caseName, body) => {
    const fetchImpl: typeof fetch = async () => new Response(body);
    const resolver = resolverWith(fetchImpl);

    await expect(resolver(resolverInput())).rejects.toMatchObject({
      status: 424,
      message: 'Repository credential resolver returned an invalid response',
    } satisfies Partial<HTTPException>);
  });
});
