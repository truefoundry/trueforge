/**
 * Outbound mutual TLS for the ServiceFoundry server client. Certs under
 * `TRUEFOUNDRY_MTLS_CERTS_DIR`; reuses shared helpers in `http/tls.ts`.
 */
import type { Dispatcher } from 'undici';

import { createTlsDispatcher, normalizeTlsUrl, type TlsOptions } from '../http/tls';

export type InternalTlsOptions = TlsOptions;

/** Upgrades an internal peer URL from http to https when mTLS is on; no-op otherwise. */
export function normalizeInternalTlsUrl(input: { url: string; enabled: boolean }): string {
  return normalizeTlsUrl(input);
}

/** undici dispatcher presenting this pod's client cert, or `undefined` when TLS is off. */
export function createInternalTlsDispatcher(options: InternalTlsOptions): Dispatcher | undefined {
  return createTlsDispatcher({
    ...options,
    enabledEnvKey: 'TRUEFOUNDRY_MTLS_ENABLED',
  });
}
