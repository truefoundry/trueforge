import type { NodeOptions } from '@sentry/node';
import * as Sentry from '@sentry/node';
import { fetch as undiciFetch } from 'undici';
import type { Logger } from 'winston';

import configuration, { isTrueFoundryModeEnabled } from '../config';
import { PACKAGE_VERSION } from '../packageVersion';

export const SENTRY_SERVICE_NAME = 'trueforge';

async function fetchSentryAuth(input: {
  authServerUrl: string;
  apiKey: string;
  tenantName: string | undefined;
  timeoutMs: number;
}): Promise<unknown> {
  const url = `${input.authServerUrl}/api/v1/tenants/sentry-auth-data`;
  const urlParamsObj: Record<string, string> = {
    serviceName: SENTRY_SERVICE_NAME,
  };
  if (input.tenantName !== undefined && input.tenantName !== '') {
    urlParamsObj['tenantName'] = input.tenantName;
  }
  const params = new URLSearchParams(urlParamsObj);

  try {
    const res = await undiciFetch(`${url}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${input.apiKey}` },
      signal: AbortSignal.timeout(input.timeoutMs),
    });
    if (res.status !== 200) {
      return undefined;
    }
    return await res.json();
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new Error(`Timed out fetching sentry auth data after ${String(input.timeoutMs)}ms`, { cause: err });
    }
    throw err;
  }
}

export async function initTrueFoundrySentry(input: {
  logger: Pick<Logger, 'info' | 'error'>;
  tags?: Record<string, string> | undefined;
}): Promise<boolean> {
  const { logger, tags } = input;
  if (!isTrueFoundryModeEnabled(configuration)) {
    logger.error('Sentry TrueFoundry init requires TrueFoundry mode; skipping');
    return false;
  }
  const authServerUrl = configuration.TRUEFOUNDRY_AUTH_SERVER_URL;
  const apiKey = configuration.TRUEFOUNDRY_API_KEY;
  if (authServerUrl === undefined || authServerUrl.trim() === '') {
    logger.error('TRUEFOUNDRY_AUTH_SERVER_URL is required when SENTRY_ENABLED in TrueFoundry mode');
    return false;
  }
  if (apiKey === undefined || apiKey.trim() === '') {
    logger.error('TRUEFOUNDRY_API_KEY is required when SENTRY_ENABLED in TrueFoundry mode');
    return false;
  }

  try {
    const authData = await fetchSentryAuth({
      authServerUrl,
      apiKey,
      tenantName: configuration.TRUEFOUNDRY_TENANT_NAME,
      timeoutMs: configuration.TRUEFOUNDRY_SERVICEFOUNDRY_HTTP_TIMEOUT_MS,
    });
    if (authData === undefined || typeof authData !== 'object' || authData === null) {
      logger.error('Failed to fetch sentry config. Skipping initialization');
      return false;
    }
    const sentryInitOptions: NodeOptions = {};
    Object.assign(sentryInitOptions, authData);
    sentryInitOptions.includeLocalVariables = false;
    sentryInitOptions.defaultIntegrations = false;
    sentryInitOptions.integrations = [];
    Sentry.init(sentryInitOptions);
    Sentry.getGlobalScope().setTag('TRUEFORGE_VERSION', PACKAGE_VERSION);
    if (tags) {
      for (const [key, value] of Object.entries(tags)) {
        Sentry.getGlobalScope().setTag(key, value);
      }
    }
    logger.info('Sentry initialised (TrueFoundry auth server)');
    return true;
  } catch (error) {
    logger.error('Error in fetching sentry auth data; skipping Sentry initialization', {
      error: error instanceof Error ? error.message : error,
    });
    return false;
  }
}
