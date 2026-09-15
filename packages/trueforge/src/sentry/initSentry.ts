import * as Sentry from '@sentry/node';
import type { Logger } from 'winston';

import { isTrueFoundryModeEnabled, type ServerConfiguration } from '../config';
import { PACKAGE_VERSION } from '../packageVersion';
import { initTrueFoundrySentry } from '../truefoundry/initTrueFoundrySentry';

function isLocalLikeEnv(nodeEnv: string | undefined): boolean {
  return nodeEnv === 'development' || nodeEnv === 'test' || nodeEnv === 'local';
}

export interface InitSentryOptions {
  tags?: Record<string, string>;
}

export async function initSentry(
  config: ServerConfiguration,
  logger: Pick<Logger, 'info' | 'error'>,
  options?: InitSentryOptions,
): Promise<void> {
  if (!config.SENTRY_ENABLED || isLocalLikeEnv(config.NODE_ENV)) {
    logger.info('Sentry is not enabled (SENTRY_ENABLED=false or local-like NODE_ENV)');
    return;
  }

  if (isTrueFoundryModeEnabled(config)) {
    const authServerUrl = config.TRUEFOUNDRY_AUTH_SERVER_URL;
    const apiKey = config.TRUEFOUNDRY_API_KEY;
    if (authServerUrl === undefined || authServerUrl.trim() === '') {
      logger.error('TRUEFOUNDRY_AUTH_SERVER_URL is required when SENTRY_ENABLED in TrueFoundry mode');
      return;
    }
    if (apiKey === undefined || apiKey.trim() === '') {
      logger.error('TRUEFOUNDRY_API_KEY is required when SENTRY_ENABLED in TrueFoundry mode');
      return;
    }
    await initTrueFoundrySentry({
      config: {
        TRUEFOUNDRY_AUTH_SERVER_URL: authServerUrl,
        TRUEFOUNDRY_API_KEY: apiKey,
        TRUEFOUNDRY_TENANT_NAME: config.TRUEFOUNDRY_TENANT_NAME,
        TRUEFOUNDRY_SERVICEFOUNDRY_HTTP_TIMEOUT_MS: config.TRUEFOUNDRY_SERVICEFOUNDRY_HTTP_TIMEOUT_MS,
      },
      logger,
      version: PACKAGE_VERSION,
      tags: options?.tags,
    });
    return;
  }

  const dsn = config.SENTRY_DSN;
  if (dsn === undefined || dsn.trim() === '') {
    logger.error('SENTRY_DSN is required when SENTRY_ENABLED outside TrueFoundry mode');
    return;
  }
  Sentry.init({
    dsn,
    includeLocalVariables: false,
    integrations: [],
  });
  Sentry.getGlobalScope().setTag('TRUEFORGE_VERSION', PACKAGE_VERSION);
  if (options?.tags) {
    for (const [key, value] of Object.entries(options.tags)) {
      Sentry.getGlobalScope().setTag(key, value);
    }
  }
  logger.info('Sentry initialised');
}
