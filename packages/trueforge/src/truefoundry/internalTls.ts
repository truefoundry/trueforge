/**
 * Client-side (outbound) mutual TLS for calling the TrueFoundry ServiceFoundry server. The cert triple
 * (`tls.crt` / `tls.key` / `ca.crt`) is mounted under `TRUEFOUNDRY_MTLS_CERTS_DIR`. The dispatcher is
 * scoped to the ServiceFoundry server client, so the internal certificate is never presented to the
 * external MCP servers or LLM providers trueforge also reaches over `fetch`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { rootCertificates } from 'node:tls';

import { Agent, type Dispatcher } from 'undici';

const TLS_CERT_FILE = 'tls.crt';
const TLS_KEY_FILE = 'tls.key';
const TLS_CA_FILE = 'ca.crt';

export interface InternalTlsOptions {
  enabled: boolean;
  dir: string;
}

function readTlsFile(input: { dir: string; fileName: string }): string {
  const filePath = join(input.dir, input.fileName);
  try {
    return readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new Error(
      `TRUEFOUNDRY_MTLS_ENABLED is true but ${filePath} could not be read. Check that the mTLS secret ` +
        'is mounted at TRUEFOUNDRY_MTLS_CERTS_DIR, or set TRUEFOUNDRY_MTLS_ENABLED=false.',
      { cause: error },
    );
  }
}

/** Upgrades an internal peer URL from http to https when mTLS is on; no-op otherwise. */
export function normalizeInternalTlsUrl(input: { url: string; enabled: boolean }): string {
  if (!input.enabled) {
    return input.url;
  }
  return input.url.startsWith('http://') ? `https://${input.url.slice('http://'.length)}` : input.url;
}

/** undici dispatcher presenting this pod's client cert and trusting the internal CA, or `undefined` when TLS is off. */
export function createInternalTlsDispatcher(options: InternalTlsOptions): Dispatcher | undefined {
  if (!options.enabled) {
    return undefined;
  }
  const ca = readTlsFile({ dir: options.dir, fileName: TLS_CA_FILE });
  const cert = readTlsFile({ dir: options.dir, fileName: TLS_CERT_FILE });
  const key = readTlsFile({ dir: options.dir, fileName: TLS_KEY_FILE });
  return new Agent({
    connect: {
      // Appended to the default roots, not replacing them: passing `ca` alone would override Node's
      // entire trust store for this dispatcher, breaking verification of the public ServiceFoundry edge.
      ca: [...rootCertificates, ca],
      cert,
      key,
    },
  });
}
