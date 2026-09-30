/**
 * Shared TrueForge SDK client for controller → server HTTP handoff (mTLS + API key).
 */
import { TrueForge } from '@truefoundry/trueforge-sdk';
import configuration from '../config';
import { createTlsFetch, normalizeTlsUrl } from '../http/tls';

/** One client shape for schedule dispatch and sandbox-env build loops. */
export function createInternalTrueForgeClient(): TrueForge {
  const tls = {
    enabled: configuration.MTLS_ENABLED,
    dir: configuration.MTLS_CERTS_DIR,
  };
  const tlsFetch = createTlsFetch(tls);
  return new TrueForge({
    baseUrl: normalizeTlsUrl({ url: configuration.SERVER_URL, enabled: tls.enabled }),
    token: configuration.TRUEFORGE_API_KEY,
    timeoutInSeconds: 60,
    ...(tlsFetch === undefined ? {} : { fetch: tlsFetch }),
  });
}
