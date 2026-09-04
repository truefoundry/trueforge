/**
 * Shared mutual-TLS helpers: outbound undici (controller → server, ServiceFoundry client) and
 * this process's HTTPS listener + client-cert middleware.
 *
 * Cert triple under the configured dir: `tls.crt` / `tls.key` / `ca.crt`.
 */
import type { HttpBindings } from '@hono/node-server';
import type { MiddlewareHandler } from 'hono';
import { readFileSync } from 'node:fs';
import { createServer as createHttpsServer, type ServerOptions as HttpsServerOptions } from 'node:https';
import { join } from 'node:path';
import { rootCertificates, TLSSocket } from 'node:tls';

import { Agent, fetch as undiciFetch, type Dispatcher } from 'undici';
import type { Logger } from 'winston';

const TLS_CERT_FILE = 'tls.crt';
const TLS_KEY_FILE = 'tls.key';
const TLS_CA_FILE = 'ca.crt';

export interface TlsOptions {
  enabled: boolean;
  dir: string;
}

function readTlsFile(input: { dir: string; fileName: string; enabledEnvKey: string }): string {
  const filePath = join(input.dir, input.fileName);
  try {
    return readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new Error(
      `${input.enabledEnvKey} is true but ${filePath} could not be read. Check that the mTLS secret ` +
        `is mounted at the configured certs directory, or set ${input.enabledEnvKey}=false.`,
      { cause: error },
    );
  }
}

function isTlsSocket(socket: unknown): socket is TLSSocket {
  return socket instanceof TLSSocket;
}

/**
 * True when the peer presented a client certificate that our CA already verified.
 * Only meaningful when the listener was started with `requestCert: true`.
 */
export function hasAuthorizedClientCertificate(socket: unknown): boolean {
  return isTlsSocket(socket) && socket.authorized;
}

/** Upgrades http → https when mTLS is on. */
export function normalizeTlsUrl(input: { url: string; enabled: boolean }): string {
  if (!input.enabled) {
    return input.url;
  }
  const parsed = new URL(input.url);
  if (parsed.protocol === 'http:') {
    parsed.protocol = 'https:';
  }
  return parsed.href;
}

/** undici dispatcher presenting this process's client cert and trusting the CA (+ system roots). */
export function createTlsDispatcher(options: TlsOptions & { enabledEnvKey: string }): Dispatcher | undefined {
  if (!options.enabled) {
    return undefined;
  }
  const read = (fileName: string) => readTlsFile({ dir: options.dir, fileName, enabledEnvKey: options.enabledEnvKey });
  return new Agent({
    connect: {
      // Appended to the default roots, not replacing them: passing `ca` alone would override Node's
      // entire trust store for this dispatcher (breaks public HTTPS peers on the same agent).
      ca: [...rootCertificates, read(TLS_CA_FILE)],
      cert: read(TLS_CERT_FILE),
      key: read(TLS_KEY_FILE),
    },
  });
}

/** Resolves `fetch`'s first argument (`string | URL | Request`) to a URL string. */
function requestUrlFromFetchInput(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

/** `fetch` for the schedule controller SDK client. Undefined when mTLS is off. */
export function createTlsFetch(options: TlsOptions): typeof fetch | undefined {
  const dispatcher = createTlsDispatcher({
    ...options,
    enabledEnvKey: 'TRUEFORGE_MTLS_ENABLED',
  });
  if (dispatcher === undefined) {
    return undefined;
  }
  // Casts bridge undici ↔ DOM fetch types (Fern only needs string URL + init + dispatcher).
  return (input, init) => undiciFetch(requestUrlFromFetchInput(input), { ...(init as object), dispatcher });
}

/** HTTPS `serve` options when mTLS is on; undefined → plain HTTP. */
export function serverTlsServeOptions(
  options: TlsOptions,
): { createServer: typeof createHttpsServer; serverOptions: HttpsServerOptions } | undefined {
  if (!options.enabled) {
    return undefined;
  }
  const read = (fileName: string) =>
    readTlsFile({ dir: options.dir, fileName, enabledEnvKey: 'TRUEFORGE_MTLS_ENABLED' });
  return {
    createServer: createHttpsServer,
    serverOptions: {
      key: Buffer.from(read(TLS_KEY_FILE)),
      cert: Buffer.from(read(TLS_CERT_FILE)),
      ca: Buffer.from(read(TLS_CA_FILE)),
      requestCert: true,
      // Do not reject at handshake so /healthz probes without a cert still connect.
      rejectUnauthorized: false,
    },
  };
}

/** Rejects certless requests except `/healthz`. Mount only when mTLS is enabled. */
export function createClientCertificateMiddleware(logger: Logger): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.path === '/healthz') {
      await next();
      return;
    }
    if (hasAuthorizedClientCertificate((c.env as HttpBindings).incoming.socket)) {
      await next();
      return;
    }
    logger.warn('Rejected request without a valid client certificate', { path: c.req.path });
    return c.json({ error: { message: 'Client certificate required' } }, 403);
  };
}
