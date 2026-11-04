import * as Sentry from '@sentry/node';

import { currentLogContext, type LogContext } from '../logger';

const LOG_CONTEXT_TAG_KEYS: (keyof LogContext)[] = ['tenant_id', 'request_id', 'session_id', 'turn_id'];

function logContextTags(): Record<string, string> {
  const context = currentLogContext();
  if (context === undefined) {
    return {};
  }
  const tags: Record<string, string> = {};
  for (const key of LOG_CONTEXT_TAG_KEYS) {
    const value = context[key];
    if (value !== undefined) {
      tags[key] = value;
    }
  }
  return tags;
}

export function captureCriticalException(
  err: unknown,
  options?: { tags?: Record<string, string>; extra?: Record<string, unknown> },
): void {
  const tags: Record<string, string> = { ...logContextTags(), ...options?.tags };
  Sentry.withScope(scope => {
    if (Object.keys(tags).length > 0) {
      scope.setTags(tags);
    }
    if (options?.extra) {
      scope.setExtras(options.extra);
    }
    Sentry.captureException(err);
  });
}
