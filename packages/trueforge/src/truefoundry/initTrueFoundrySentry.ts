import type { NodeOptions } from '@sentry/node';
import * as Sentry from '@sentry/node';
import { fetch as undiciFetch } from 'undici';
import type { Logger } from 'winston';

export const SENTRY_SERVICE_NAME = 'trueforge';

const AUTH_FETCH_TIMEOUT_MS = 10_000;

export interface TrueFoundrySentryInitConfig {
  TRUEFOUNDRY_AUTH_SERVER_URL: string;
  TRUEFOUNDRY_API_KEY: string;
  TRUEFOUNDRY_TENANT_NAME?: string | undefined;
  TRUEFOUNDRY_SERVICEFOUNDRY_HTTP_TIMEOUT_MS?: number | undefined;
}

async function fetchSentryAuth(config: TrueFoundrySentryInitConfig): Promise<unknown> {
  const url = `${config.TRUEFOUNDRY_AUTH_SERVER_URL}/api/v1/tenants/sentry-auth-data`;
  const urlParamsObj: Record<string, string> = {
    serviceName: SENTRY_SERVICE_NAME,
  };
  if (config.TRUEFOUNDRY_TENANT_NAME !== undefined && config.TRUEFOUNDRY_TENANT_NAME !== '') {
    urlParamsObj['tenantName'] = config.TRUEFOUNDRY_TENANT_NAME;
  }
  const params = new URLSearchParams(urlParamsObj);
  const timeoutMs = config.TRUEFOUNDRY_SERVICEFOUNDRY_HTTP_TIMEOUT_MS ?? AUTH_FETCH_TIMEOUT_MS;

  try {
    const res = await undiciFetch(`${url}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${config.TRUEFOUNDRY_API_KEY}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status !== 200) {
      return undefined;
    }
    return await res.json();
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new Error(`Timed out fetching sentry auth data after ${String(timeoutMs)}ms`, { cause: err });
    }
    throw err;
  }
}

export async function initTrueFoundrySentry(input: {
  config: TrueFoundrySentryInitConfig;
  logger: Pick<Logger, 'info' | 'error'>;
  version: string;
  tags?: Record<string, string> | undefined;
}): Promise<boolean> {
  const { config, logger, version, tags } = input;
  try {
    const authData = await fetchSentryAuth(config);
    if (authData === undefined || typeof authData !== 'object' || authData === null) {
      logger.error('Failed to fetch sentry config. Skipping initialization');
      return false;
    }
    const sentryInitOptions: NodeOptions = {
      includeLocalVariables: false,
      integrations: [],
    };
    Object.assign(sentryInitOptions, authData);
    Sentry.init(sentryInitOptions);
    Sentry.getGlobalScope().setTag('TRUEFORGE_VERSION', version);
    if (tags) {
      for (const [key, value] of Object.entries(tags)) {
        Sentry.getGlobalScope().setTag(key, value);
      }
    }
    logger.info('Sentry initialised (TrueFoundry auth server)');
    return true;
  } catch (errorFetchingAuthData) {
    logger.error('Error in fetching sentry auth data; skipping Sentry initialization', {
      error: errorFetchingAuthData instanceof Error ? errorFetchingAuthData.message : errorFetchingAuthData,
    });
    return false;
  }
}
