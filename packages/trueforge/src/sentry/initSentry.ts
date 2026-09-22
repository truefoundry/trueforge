import * as Sentry from '@sentry/node';
import type { Logger } from 'winston';

import { isTrueFoundryModeEnabled, type ServerConfiguration } from '../config';
import { PACKAGE_VERSION } from '../packageVersion';
import { initTrueFoundrySentry } from '../truefoundry/initTrueFoundrySentry';

function isLocalLikeEnv(nodeEnv: string | undefined): boolean {
  return nodeEnv === 'development' || nodeEnv === 'test' || nodeEnv === 'local';
}

function applyGlobalTags(tags: Record<string, string>): void {
  const scope = Sentry.getGlobalScope();
  for (const [key, value] of Object.entries(tags)) {
    scope.setTag(key, value);
  }
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

  const globalTags: Record<string, string> = {
    service: 'trueforge',
    TRUEFORGE_VERSION: PACKAGE_VERSION,
    ...config.SENTRY_ADDITIONAL_TAGS,
    ...options?.tags,
  };

  if (isTrueFoundryModeEnabled(config)) {
    await initTrueFoundrySentry({ logger, tags: globalTags });
    return;
  }

  const dsn = config.SENTRY_DSN;
  if (dsn === undefined || dsn.trim() === '') {
    logger.error('SENTRY_DSN is required when SENTRY_ENABLED=true');
    return;
  }
  Sentry.init({
    dsn,
    includeLocalVariables: false,
    defaultIntegrations: false,
    integrations: [],
  });
  applyGlobalTags(globalTags);
  logger.info('Sentry initialised');
}
