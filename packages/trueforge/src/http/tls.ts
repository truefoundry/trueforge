/**
 * Mutual TLS for this process's HTTPS listener and the schedule controller → server hop.
 *
 * Cert triple under `TLS_DIR`: `tls.crt` / `tls.key` / `ca.crt`. Off by default (plain HTTP).
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

function readTlsFile(input: { dir: string; fileName: string }): string {
  const filePath = join(input.dir, input.fileName);
  try {
    return readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new Error(
      `TLS_MUTUAL is true but ${filePath} could not be read. Check that the TLS secret is mounted ` +
        'at TLS_DIR, or set TLS_MUTUAL=false.',
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
  return input.url.startsWith('http://') ? `https://${input.url.slice('http://'.length)}` : input.url;
}

function createTlsDispatcher(options: TlsOptions): Dispatcher | undefined {
  if (!options.enabled) {
    return undefined;
  }
  return new Agent({
    connect: {
      ca: [...rootCertificates, readTlsFile({ dir: options.dir, fileName: TLS_CA_FILE })],
      cert: readTlsFile({ dir: options.dir, fileName: TLS_CERT_FILE }),
      key: readTlsFile({ dir: options.dir, fileName: TLS_KEY_FILE }),
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
  const dispatcher = createTlsDispatcher(options);
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
  return {
    createServer: createHttpsServer,
    serverOptions: {
      key: Buffer.from(readTlsFile({ dir: options.dir, fileName: TLS_KEY_FILE })),
      cert: Buffer.from(readTlsFile({ dir: options.dir, fileName: TLS_CERT_FILE })),
      ca: Buffer.from(readTlsFile({ dir: options.dir, fileName: TLS_CA_FILE })),
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
